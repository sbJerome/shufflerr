import { getMusicBrainz } from '@server/api/musicbrainz';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
  RequestScope,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import Track from '@server/entity/Track';
import TrackRequest from '@server/entity/TrackRequest';
import { User } from '@server/entity/User';
import cacheManager from '@server/lib/cache';
import { getAlbumDetails } from '@server/lib/metadata/details';
import {
  InvalidMbidError,
  ensureMedia,
  getDiscographyReleaseGroups,
  syncTracklist,
} from '@server/lib/metadata/index';
import { searchMusic } from '@server/lib/search';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import type { RecordedCall } from '@server/test/fixtureAdapter';
import { fixture, fixtureAdapter } from '@server/test/fixtureAdapter';
import type { AxiosAdapter } from 'axios';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

const JOHN_SUMMIT = '2547c5e3-314c-4332-981d-f18c902a4086';
const CTRL_ESCAPE = '324f381f-ebef-4003-8885-c06659395d8b';
const RELEASE = '2555fe96-7bde-4b6d-92ae-9ee09ffe71d4';
const SHADES = '6ea95e5d-1d83-43f0-91b2-3aa6b91cc278';

/** Serve the recorded MusicBrainz responses to the shared client. */
const serveFixtures = (): RecordedCall[] => {
  const { adapter, calls } = fixtureAdapter((call) => {
    switch (call.url) {
      case `/artist/${JOHN_SUMMIT}`:
        return fixture('musicbrainz/artist-john-summit.json');
      case `/release-group/${CTRL_ESCAPE}`:
        return fixture('musicbrainz/release-group-ctrl-escape.json');
      case `/release/${RELEASE}`:
        return fixture('musicbrainz/release-ctrl-escape.json');
      case '/artist':
        return fixture('musicbrainz/artist-search-john-summit.json');
      case '/recording':
        return fixture('musicbrainz/recording-search-shades-of-blue.json');
      case '/release-group':
        if (!call.params.artist) {
          return fixture('musicbrainz/release-group-search-ctrl-escape.json');
        }
        // the recording holds the first 8 of 78; later pages are empty here
        return Number(call.params.offset) > 0
          ? {
              'release-group-count': 8,
              'release-group-offset': 8,
              'release-groups': [],
            }
          : {
              ...fixture<object>(
                'musicbrainz/release-group-browse-john-summit.json'
              ),
              'release-group-count': 8,
            };
      default:
        throw new Error(`No fixture for ${call.url}`);
    }
  });
  (
    getMusicBrainz() as unknown as {
      axios: { defaults: { adapter: AxiosAdapter } };
    }
  ).axios.defaults.adapter = adapter;
  return calls;
};

describe('metadata library helpers', () => {
  setupTestDb();

  let calls: RecordedCall[];
  beforeEach(() => {
    cacheManager.getCache('musicbrainz').flush();
    getSettings().metadata.musicbrainz.requestsPerSecond = 50;
    calls = serveFixtures();
  });

  it('rejects something that is not an MBID before calling MusicBrainz', async () => {
    await assert.rejects(
      () => ensureMedia('ctrl-escape', MediaType.RELEASE_GROUP),
      InvalidMbidError
    );
    assert.equal(calls.length, 0);
  });

  it('creates the Media row for a release group without touching its status', async () => {
    const media = await ensureMedia(CTRL_ESCAPE, MediaType.RELEASE_GROUP);
    assert.equal(media.title, 'CTRL ESCAPE');
    assert.equal(media.artistName, 'John Summit');
    assert.equal(media.artistMbid, JOHN_SUMMIT);
    assert.equal(media.primaryType, 'Album');
    assert.equal(media.firstReleaseDate, '2026-04-15');
    assert.equal(media.status, MediaStatus.UNKNOWN);
    assert.equal(await getRepository(Track).count(), 0);

    // a second call reuses the row and needs no lookup
    const before = calls.length;
    const again = await ensureMedia(CTRL_ESCAPE, MediaType.RELEASE_GROUP);
    assert.equal(again.id, media.id);
    assert.equal(calls.length, before);
  });

  it('creates the Media row for an artist', async () => {
    const media = await ensureMedia(JOHN_SUMMIT, MediaType.ARTIST);
    assert.equal(media.mediaType, MediaType.ARTIST);
    assert.equal(media.title, 'John Summit');
  });

  it('creates one row when two callers ask at once', async () => {
    const [a, b] = await Promise.all([
      ensureMedia(CTRL_ESCAPE, MediaType.RELEASE_GROUP, { withTracks: true }),
      ensureMedia(CTRL_ESCAPE, MediaType.RELEASE_GROUP, { withTracks: true }),
    ]);
    assert.equal(a.id, b.id);
    assert.equal(await getRepository(Media).count(), 1);
    assert.equal(await getRepository(Track).count(), 13);
  });

  it('stores the canonical tracklist and keeps library data on a re-sync', async () => {
    const media = await ensureMedia(CTRL_ESCAPE, MediaType.RELEASE_GROUP, {
      withTracks: true,
    });
    assert.equal(media.releaseMbid, RELEASE);
    assert.equal(media.trackCount, 13);

    const trackRepository = getRepository(Track);
    const shades = await trackRepository.findOneOrFail({
      where: { recordingMbid: SHADES },
    });
    assert.equal(shades.position, '02');

    // what a scanner would write
    shades.status = MediaStatus.AVAILABLE;
    shades.fileFormat = 'MP3 320';
    shades.sourceIds = { localPath: '/music/John Summit/02.mp3' };
    shades.peaks = 'AAEC';
    await trackRepository.save(shades);

    const synced = await syncTracklist(media);
    assert.equal(synced.trackCount, 13);
    assert.equal(synced.tracksAvailable, 1);
    assert.equal(
      synced.status,
      MediaStatus.UNKNOWN,
      'status is the scanners job'
    );

    const after = await trackRepository.findOneOrFail({
      where: { recordingMbid: SHADES },
      select: {
        id: true,
        status: true,
        fileFormat: true,
        sourceIds: true,
        peaks: true,
        position: true,
      },
    });
    assert.equal(after.id, shades.id);
    assert.equal(after.status, MediaStatus.AVAILABLE);
    assert.equal(after.fileFormat, 'MP3 320');
    assert.deepEqual(after.sourceIds, {
      localPath: '/music/John Summit/02.mp3',
    });
    assert.equal(after.peaks, 'AAEC');
    assert.equal(await trackRepository.count(), 13);
  });

  it('adopts tracks a scanner created first, matching by recording then title', async () => {
    const media = await ensureMedia(CTRL_ESCAPE, MediaType.RELEASE_GROUP);
    const trackRepository = getRepository(Track);
    const byRecording = await trackRepository.save(
      new Track({
        media,
        recordingMbid: SHADES,
        position: '99',
        title: 'Shades Of Blue (tagged differently)',
        status: MediaStatus.AVAILABLE,
        sourceIds: { plex: '1001' },
      })
    );
    const byTitle = await trackRepository.save(
      new Track({
        media,
        position: '3',
        title: 'sata',
        lengthMs: 184000,
        status: MediaStatus.AVAILABLE,
        sourceIds: { localPath: '/music/03.mp3' },
      })
    );
    const stray = await trackRepository.save(
      new Track({
        media,
        position: '77',
        title: 'Hidden bonus',
        status: MediaStatus.UNKNOWN,
      })
    );
    const strayOwned = await trackRepository.save(
      new Track({
        media,
        position: '78',
        title: 'Bonus the library has',
        status: MediaStatus.AVAILABLE,
        sourceIds: { localPath: '/music/bonus.mp3' },
      })
    );

    const synced = await syncTracklist(media);
    const tracks = await trackRepository.find({
      where: { media: { id: media.id } },
    });
    const find = (id: number) => tracks.find((t) => t.id === id);

    assert.equal(find(byRecording.id)?.position, '02');
    assert.equal(find(byRecording.id)?.title, 'SHADES OF BLUE');
    assert.deepEqual(find(byRecording.id)?.sourceIds, { plex: '1001' });
    assert.equal(find(byTitle.id)?.position, '03');
    assert.equal(
      find(byTitle.id)?.recordingMbid,
      '34e11944-3b08-487b-a782-9113df6a3d8a'
    );
    assert.equal(find(stray.id), undefined, 'unmatched empty row is removed');
    assert.equal(
      find(strayOwned.id)?.discNumber,
      0,
      'library file is kept as an extra'
    );
    assert.equal(tracks.length, 14);
    assert.equal(synced.trackCount, 13);
    assert.equal(synced.tracksAvailable, 2);
  });

  it('filters a discography to studio albums', async () => {
    const browse = fixture<{
      'release-groups': {
        id: string;
        'primary-type'?: string;
        'secondary-types'?: string[];
      }[];
    }>('musicbrainz/release-group-browse-john-summit.json');
    const expected = browse['release-groups']
      .filter(
        (rg) =>
          rg['primary-type'] === 'Album' &&
          (rg['secondary-types'] ?? []).length === 0
      )
      .map((rg) => rg.id);

    const groups = await getDiscographyReleaseGroups(JOHN_SUMMIT);
    assert.deepEqual(
      groups.map((g) => g.mbid),
      expected
    );
  });

  it('merges library status and requests into search results', async () => {
    const media = await ensureMedia(CTRL_ESCAPE, MediaType.RELEASE_GROUP, {
      withTracks: true,
    });
    const trackRepository = getRepository(Track);
    const shades = await trackRepository.findOneOrFail({
      where: { recordingMbid: SHADES },
    });
    shades.status = MediaStatus.AVAILABLE;
    shades.sourceIds = { localPath: '/music/02.mp3' };
    await trackRepository.save(shades);
    media.status = MediaStatus.PARTIALLY_AVAILABLE;
    media.tracksAvailable = 1;
    await getRepository(Media).save(media);

    const admin = await getRepository(User).findOneOrFail({
      where: { email: 'admin@shufflerr.test' },
    });
    const friend = await getRepository(User).findOneOrFail({
      where: { email: 'demo@shufflerr.test' },
    });
    const request = await getRepository(MediaRequest).save(
      new MediaRequest({
        media,
        scope: RequestScope.ALBUM,
        status: MediaRequestStatus.PENDING,
        requestedBy: friend,
      })
    );

    const results = await searchMusic({
      query: 'john summit ctrl escape',
      user: admin,
    });
    const album = results.albums.results.find((a) => a.mbid === CTRL_ESCAPE);
    assert.ok(album, 'the album is in the recorded search');
    assert.equal(album.status, MediaStatus.PARTIALLY_AVAILABLE);
    assert.equal(album.tracksAvailable, 1);
    assert.equal(album.trackCount, 13);
    assert.equal(album.request?.id, request.id);
    assert.equal(album.request?.requestedBy.id, friend.id);

    const artist = results.artists.results.find((a) => a.mbid === JOHN_SUMMIT);
    assert.equal(artist?.status, MediaStatus.AVAILABLE);
    assert.equal(artist?.albumsInLibrary, 1);

    const track = results.tracks.results.find(
      (t) => t.recordingMbid === SHADES
    );
    assert.equal(track?.trackId, shades.id);
    assert.equal(track?.playable, true);
    assert.equal(track?.status, MediaStatus.AVAILABLE);

    // someone who may not see other people's requests learns it is requested, not by whom
    const other = await getRepository(User).save(
      new User({
        email: 'third@shufflerr.test',
        username: 'third',
        permissions: 32,
        avatar: '',
      })
    );
    cacheManager.getCache('musicbrainz').flush();
    const limited = await searchMusic({
      query: 'john summit ctrl escape',
      type: 'album',
      user: other,
    });
    const hidden = limited.albums.results.find((a) => a.mbid === CTRL_ESCAPE);
    assert.equal(hidden?.request?.status, MediaRequestStatus.PENDING);
    assert.equal(hidden?.request?.requestedBy.displayName, '');
    assert.equal(limited.artists.total, 0);
    assert.equal(limited.tracks.total, 0);
  });

  it('returns an empty result for an empty query without calling MusicBrainz', async () => {
    const results = await searchMusic({ query: '   ' });
    assert.equal(calls.length, 0);
    assert.deepEqual(results.albums, { total: 0, results: [] });
  });

  it('builds album details with per-track status, playability and requests', async () => {
    const admin = await getRepository(User).findOneOrFail({
      where: { email: 'admin@shufflerr.test' },
    });
    let details = await getAlbumDetails(CTRL_ESCAPE, admin);
    assert.equal(details.tracks.length, 13);
    assert.equal(details.releaseMbid, RELEASE);
    assert.equal(details.discCount, 1);
    assert.ok(details.tracks.every((t) => typeof t.id === 'number'));
    assert.ok(details.tracks.every((t) => !t.playable && !t.hasPeaks));
    assert.equal(details.lidarr, null);
    assert.equal(details.links[0].type, 'musicbrainz');
    assert.deepEqual(details.requests, []);

    const trackRepository = getRepository(Track);
    const shades = await trackRepository.findOneOrFail({
      where: { recordingMbid: SHADES },
    });
    shades.status = MediaStatus.AVAILABLE;
    shades.fileFormat = 'FLAC 16/44.1';
    shades.sourceIds = { localPath: '/music/02.flac' };
    shades.peaks = 'AAEC';
    await trackRepository.save(shades);

    const media = await getRepository(Media).findOneOrFail({
      where: { mbid: CTRL_ESCAPE },
    });
    const sata = await trackRepository.findOneOrFail({
      where: { media: { id: media.id }, position: '03' },
    });
    const request = await getRepository(MediaRequest).save(
      new MediaRequest({
        media,
        scope: RequestScope.TRACKS,
        status: MediaRequestStatus.APPROVED,
        requestedBy: admin,
        trackCount: 1,
      })
    );
    await getRepository(TrackRequest).save(
      new TrackRequest({
        request,
        track: sata,
        status: MediaRequestStatus.APPROVED,
      })
    );

    details = await getAlbumDetails(CTRL_ESCAPE, admin);
    const two = details.tracks.find((t) => t.position === '02');
    assert.equal(two?.playable, true);
    assert.equal(two?.hasPeaks, true);
    assert.equal(two?.fileFormat, 'FLAC 16/44.1');
    assert.deepEqual(two?.sources, ['local']);
    assert.equal(two?.requestStatus, undefined);

    const three = details.tracks.find((t) => t.position === '03');
    assert.equal(three?.requestStatus, MediaRequestStatus.APPROVED);
    assert.equal(
      details.tracks.find((t) => t.position === '04')?.requestStatus,
      undefined
    );

    assert.equal(details.request?.id, request.id);
    assert.deepEqual(details.request?.trackIds, [sata.id]);
    assert.equal(details.requests.length, 1);
  });
});
