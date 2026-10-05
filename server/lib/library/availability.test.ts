import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

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
import type { ScannedFile } from '@server/lib/scanners/local/group';
import { groupFiles } from '@server/lib/scanners/local/group';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import express from 'express';
import request from 'supertest';
import {
  countSource,
  detachSource,
  metadataHooks,
  recomputeArtist,
} from './availability';
import type { IngestDeps } from './ingest';
import { ingestAlbum } from './ingest';
import { decodePeaks, encodePeaks } from './peaks';
import type { MusicBrainzGateway } from './resolver';
import libraryState from './state';
import { getTrackPeaks, getTrackSource, streamTrack } from './stream';
import type { ScannedAlbum } from './types';

const FIXTURES = path.join(__dirname, '../../test/fixtures');
const fixture = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8')) as T;

interface MbRelease {
  id: string;
  title: string;
  media: {
    tracks: {
      position: number;
      title: string;
      length: number;
      recording: { id: string };
    }[];
  }[];
  'release-group': { id: string };
  'artist-credit': { artist: { id: string; name: string } }[];
}

const release = fixture<MbRelease>('musicbrainz/release-ctrl-escape.json');
const RG_MBID = release['release-group'].id;
const ARTIST = release['artist-credit'][0].artist;

/** What SV1's ensureMedia + syncTracklist leave behind: the Media row and its canonical tracks. */
const seedCtrlEscape = async (): Promise<Media> => {
  const media = await getRepository(Media).save(
    new Media({
      mediaType: MediaType.RELEASE_GROUP,
      mbid: RG_MBID,
      artistMbid: ARTIST.id,
      title: release.title,
      artistName: ARTIST.name,
      primaryType: 'Album',
      status: MediaStatus.UNKNOWN,
      releaseMbid: release.id,
      trackCount: 13,
    })
  );
  await getRepository(Track).save(
    release.media
      .flatMap((medium) => medium.tracks)
      .map(
        (track) =>
          new Track({
            media,
            recordingMbid: track.recording.id,
            position: String(track.position).padStart(2, '0'),
            discNumber: 1,
            trackNumber: track.position,
            title: track.title,
            artistCredit: ARTIST.name,
            lengthMs: track.length,
            status: MediaStatus.UNKNOWN,
          })
      )
  );
  return media;
};

/** No MusicBrainz in tests: the search answers from the recorded release group. */
const deps = (): IngestDeps => {
  const gateway: MusicBrainzGateway = {
    releaseGroupForRelease: async () => null,
    releaseGroupExists: async () => false,
    searchReleaseGroups: async () => [
      {
        mbid: RG_MBID,
        title: release.title,
        artistName: ARTIST.name,
        score: 100,
        year: 2026,
        primaryType: 'Album',
      },
    ],
  };
  return {
    gateway,
    ensure: async (mbid) =>
      getRepository(Media).findOneOrFail({
        where: { mbid, mediaType: MediaType.RELEASE_GROUP },
      }),
  };
};

const localAlbum = async (count: number): Promise<ScannedAlbum> => {
  const files = fixture<ScannedFile[]>('local/ctrl-escape-files.json');
  return groupFiles(files.slice(0, count))[0].load() as Promise<ScannedAlbum>;
};

const reload = (id: number): Promise<Media> =>
  getRepository(Media).findOneOrFail({ where: { id } });

// MusicBrainz is unreachable in tests: artist rows fall back to what the
// release groups already know, and discography coverage is supplied per test.
let discography: { mbid: string; title: string }[] = [];
before(() => {
  libraryState.useMemory();
  metadataHooks.ensureMedia = async () => {
    throw new Error('MusicBrainz is not reachable in tests');
  };
  metadataHooks.getDiscographyReleaseGroups = async () => discography;
  metadataHooks.artistName = async () => {
    throw new Error('MusicBrainz is not reachable in tests');
  };
});

describe('library ingest and availability', () => {
  setupTestDb();

  it('9 of 13 tracks → partly available; 13 of 13 → available and the tracks request completes', async () => {
    const media = await seedCtrlEscape();

    const first = await ingestAlbum(await localAlbum(9), deps());
    assert.equal(first.result, 'ingested');
    assert.equal(first.result === 'ingested' && first.matched, 9);

    let current = await reload(media.id);
    assert.equal(current.status, MediaStatus.PARTIALLY_AVAILABLE);
    assert.equal(current.tracksAvailable, 9);
    assert.equal(current.trackCount, 13);
    assert.ok(current.mediaAddedAt);
    assert.equal(current.localPath, '/music/John Summit/CTRL ESCAPE (2026)');

    // The artist row follows its albums
    const artist = await getRepository(Media).findOneOrFail({
      where: { mbid: ARTIST.id, mediaType: MediaType.ARTIST },
    });
    assert.equal(artist.status, MediaStatus.AVAILABLE);
    assert.equal(artist.tracksAvailable, 9);

    // An approved request for the four missing tracks
    const missing = await getRepository(Track).find({
      where: { media: { id: media.id }, status: MediaStatus.UNKNOWN },
    });
    assert.equal(missing.length, 4);
    const requester = await getRepository(User).findOneOrFail({
      where: { email: 'demo@shufflerr.test' },
    });
    const requestRepository = getRepository(MediaRequest);
    const created = await requestRepository.save(
      new MediaRequest({
        media: current,
        requestedBy: requester,
        scope: RequestScope.TRACKS,
        status: MediaRequestStatus.PENDING,
        trackCount: missing.length,
        tracks: missing.map(
          (track) =>
            new TrackRequest({ track, status: MediaRequestStatus.PENDING })
        ),
      })
    );
    // approve without going through the request subscriber (no Lidarr here)
    await requestRepository.update(created.id, {
      status: MediaRequestStatus.APPROVED,
    });

    // Re-ingesting the same nine tracks: still downloading, nothing completes
    await ingestAlbum(await localAlbum(9), deps());
    current = await reload(media.id);
    assert.equal(current.status, MediaStatus.PROCESSING);
    assert.equal(
      (await requestRepository.findOneOrFail({ where: { id: created.id } }))
        .status,
      MediaRequestStatus.APPROVED
    );

    // The rest arrives
    const second = await ingestAlbum(await localAlbum(13), deps());
    assert.equal(second.result === 'ingested' && second.matched, 13);

    current = await reload(media.id);
    assert.equal(current.status, MediaStatus.AVAILABLE);
    assert.equal(current.tracksAvailable, 13);

    const completed = await requestRepository.findOneOrFail({
      where: { id: created.id },
    });
    assert.equal(completed.status, MediaRequestStatus.COMPLETED);
    assert.ok(
      completed.tracks.every((t) => t.status === MediaRequestStatus.COMPLETED)
    );

    assert.deepEqual(await countSource('local'), { albums: 1, tracks: 13 });
    assert.deepEqual(await countSource('plex'), { albums: 0, tracks: 0 });
  });

  it('an album request completes only when every track is present', async () => {
    const media = await seedCtrlEscape();
    const requester = await getRepository(User).findOneOrFail({
      where: { email: 'demo@shufflerr.test' },
    });
    const requestRepository = getRepository(MediaRequest);
    const created = await requestRepository.save(
      new MediaRequest({
        media,
        requestedBy: requester,
        scope: RequestScope.ALBUM,
        status: MediaRequestStatus.PENDING,
      })
    );
    await requestRepository.update(created.id, {
      status: MediaRequestStatus.APPROVED,
    });

    await ingestAlbum(await localAlbum(12), deps());
    assert.equal((await reload(media.id)).status, MediaStatus.PROCESSING);
    assert.equal(
      (await requestRepository.findOneOrFail({ where: { id: created.id } }))
        .status,
      MediaRequestStatus.APPROVED
    );

    await ingestAlbum(await localAlbum(13), deps());
    assert.equal((await reload(media.id)).status, MediaStatus.AVAILABLE);
    assert.equal(
      (await requestRepository.findOneOrFail({ where: { id: created.id } }))
        .status,
      MediaRequestStatus.COMPLETED
    );
  });

  it('two sources on one track: losing one keeps it available, losing both steps the album back', async () => {
    const media = await seedCtrlEscape();
    const local = await localAlbum(13);
    await ingestAlbum(local, deps());
    await ingestAlbum(
      {
        ...local,
        source: 'plex',
        sourceAlbumId: '48211',
        tracks: local.tracks.map((track, index) => ({
          ...track,
          sourceId: String(48212 + index),
          plexPartKey: `/library/parts/${91000 + index}/1/file.mp3`,
        })),
      },
      deps()
    );

    const both = await getRepository(Track).findOneOrFail({
      where: { media: { id: media.id }, trackNumber: 1 },
    });
    assert.equal(both.sourceIds?.plex, '48212');
    assert.match(both.sourceIds?.localPath ?? '', /STATUS - AWAY\.mp3$/);
    assert.equal((await reload(media.id)).plexRatingKey, '48211');

    // Plex drops four tracks: still available through the local files
    const removedFromPlex = await detachSource(
      'plex',
      (id) => Number(id) < 48221
    );
    assert.equal(removedFromPlex, 4);
    assert.equal((await reload(media.id)).status, MediaStatus.AVAILABLE);

    // Four local files disappear: the last four tracks now have no source at all
    const removedLocal = await detachSource(
      'local',
      (filePath) => !/ - (10|11|12|13) - /.test(filePath)
    );
    assert.equal(removedLocal, 4);
    const after = await reload(media.id);
    assert.equal(after.status, MediaStatus.PARTIALLY_AVAILABLE);
    assert.equal(after.tracksAvailable, 9);

    const gone = await getRepository(Track).findOneOrFail({
      where: { media: { id: media.id }, trackNumber: 13 },
    });
    assert.equal(gone.status, MediaStatus.UNKNOWN);
    assert.equal(gone.sourceIds, null);
    assert.equal(gone.fileFormat, null);

    // Everything goes: back to "Not in library", artist too
    await detachSource('local', () => false);
    await detachSource('plex', () => false);
    assert.equal((await reload(media.id)).status, MediaStatus.UNKNOWN);
    const artist = await getRepository(Media).findOneOrFail({
      where: { mbid: ARTIST.id, mediaType: MediaType.ARTIST },
    });
    assert.equal(artist.status, MediaStatus.UNKNOWN);
  });

  it('a discography request completes when every covered release group is available', async () => {
    const media = await seedCtrlEscape();
    const other = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.RELEASE_GROUP,
        mbid: '11111111-2222-4333-8444-555555555555',
        artistMbid: ARTIST.id,
        title: 'Another release group',
        artistName: ARTIST.name,
        status: MediaStatus.UNKNOWN,
      })
    );
    const artist = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.ARTIST,
        mbid: ARTIST.id,
        title: ARTIST.name,
        artistName: ARTIST.name,
        status: MediaStatus.UNKNOWN,
      })
    );
    const requester = await getRepository(User).findOneOrFail({
      where: { email: 'demo@shufflerr.test' },
    });
    const requestRepository = getRepository(MediaRequest);
    const created = await requestRepository.save(
      new MediaRequest({
        media: artist,
        requestedBy: requester,
        scope: RequestScope.DISCOGRAPHY,
        status: MediaRequestStatus.PENDING,
        releaseCount: 2,
      })
    );
    await requestRepository.update(created.id, {
      status: MediaRequestStatus.APPROVED,
    });
    discography = [
      { mbid: RG_MBID, title: release.title },
      { mbid: other.mbid, title: other.title },
    ];

    // One of two release groups is in: still downloading
    await ingestAlbum(await localAlbum(13), deps());
    assert.equal((await reload(media.id)).status, MediaStatus.AVAILABLE);
    assert.equal(
      (await requestRepository.findOneOrFail({ where: { id: created.id } }))
        .status,
      MediaRequestStatus.APPROVED
    );
    // an artist is "available" as soon as the library holds anything by them;
    // the open discography request is reported separately
    assert.equal((await reload(artist.id)).status, MediaStatus.AVAILABLE);

    // Only the first one is covered now → complete
    discography = [{ mbid: RG_MBID, title: release.title }];
    await ingestAlbum(await localAlbum(13), deps());
    assert.equal(
      (await requestRepository.findOneOrFail({ where: { id: created.id } }))
        .status,
      MediaRequestStatus.COMPLETED
    );
    assert.equal((await reload(artist.id)).status, MediaStatus.AVAILABLE);
    discography = [];
  });

  it("an artist row made from an album credit takes the artist's own name once MusicBrainz answers", async () => {
    const media = await seedCtrlEscape();
    await getRepository(Media).update(media.id, {
      artistName: 'John Summit, Devault & Julia Church',
    });
    await ingestAlbum(await localAlbum(9), deps());

    // MusicBrainz was unreachable: the provisional row carries the credit phrase
    const provisional = await getRepository(Media).findOneOrFail({
      where: { mbid: ARTIST.id, mediaType: MediaType.ARTIST },
    });
    assert.equal(provisional.title, 'John Summit, Devault & Julia Church');
    assert.ok(!provisional.artistMbid);

    const unreachable = metadataHooks.artistName;
    metadataHooks.artistName = async () => ARTIST.name;
    try {
      await recomputeArtist(ARTIST.id);
    } finally {
      metadataHooks.artistName = unreachable;
    }

    const fixed = await reload(provisional.id);
    assert.equal(fixed.title, ARTIST.name);
    assert.equal(fixed.artistName, ARTIST.name);
    assert.equal(fixed.artistMbid, ARTIST.id);
  });

  it('never invents a match: unresolved and unreachable albums change nothing', async () => {
    const media = await seedCtrlEscape();
    const album = await localAlbum(13);

    const unresolved = await ingestAlbum(album, {
      ...deps(),
      gateway: {
        releaseGroupForRelease: async () => null,
        releaseGroupExists: async () => false,
        searchReleaseGroups: async () => [],
      },
    });
    assert.equal(unresolved.result, 'unresolved');

    const deferred = await ingestAlbum(album, {
      ...deps(),
      ensure: async () => {
        throw new Error('MusicBrainz is down');
      },
    });
    assert.equal(deferred.result, 'deferred');

    assert.equal((await reload(media.id)).status, MediaStatus.UNKNOWN);
    assert.equal(await getRepository(Media).count(), 1);
  });
});

describe('streaming a local track', () => {
  setupTestDb();

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'shufflerr-stream-'));
  const file = path.join(folder, 'track.flac');
  const bytes = Buffer.from(
    Array.from({ length: 1000 }, (_value, index) => index % 251)
  );
  fs.writeFileSync(file, bytes);
  after(() => fs.rmSync(folder, { recursive: true, force: true }));

  const app = express();
  app.get('/track/:id', (req, res) =>
    streamTrack(req, res, Number(req.params.id), {
      download: req.query.download === '1',
    })
  );

  const seedTrack = async (localPath: string | undefined): Promise<Track> => {
    const settings = getSettings();
    settings.localFiles.enabled = true;
    settings.localFiles.folders = [folder];
    const media = await seedCtrlEscape();
    const track = await getRepository(Track).findOneOrFail({
      where: { media: { id: media.id }, trackNumber: 1 },
    });
    await getRepository(Track).update(track.id, {
      status: localPath ? MediaStatus.AVAILABLE : MediaStatus.UNKNOWN,
      sourceIds: localPath ? { localPath } : null,
      peaks: encodePeaks([0, 128, 255]),
    });
    return track;
  };

  it('serves the whole file with range support advertised', async () => {
    const track = await seedTrack(file);
    const response = await request(app)
      .get(`/track/${track.id}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'audio/flac');
    assert.equal(response.headers['accept-ranges'], 'bytes');
    assert.equal(response.headers['content-length'], '1000');
    assert.ok(bytes.equals(response.body));
    assert.equal(await getTrackSource(track.id), 'local');
  });

  it('answers a Range request with 206 and exactly those bytes', async () => {
    const track = await seedTrack(file);
    const response = await request(app)
      .get(`/track/${track.id}`)
      .set('Range', 'bytes=100-199')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    assert.equal(response.status, 206);
    assert.equal(response.headers['content-range'], 'bytes 100-199/1000');
    assert.equal(response.headers['content-length'], '100');
    assert.ok(bytes.subarray(100, 200).equals(response.body));

    const tail = await request(app)
      .get(`/track/${track.id}`)
      .set('Range', 'bytes=-10');
    assert.equal(tail.status, 206);
    assert.equal(tail.headers['content-range'], 'bytes 990-999/1000');
  });

  it('answers 416 past the end and 404 when the track has no playable source', async () => {
    const track = await seedTrack(file);
    const past = await request(app)
      .get(`/track/${track.id}`)
      .set('Range', 'bytes=5000-');
    assert.equal(past.status, 416);
    assert.equal(past.headers['content-range'], 'bytes */1000');

    assert.equal((await request(app).get('/track/999999')).status, 404);
  });

  it('refuses files outside the configured music folders', async () => {
    const outside = await seedTrack('/etc/hostname');
    assert.equal((await request(app).get(`/track/${outside.id}`)).status, 404);
    assert.equal(await getTrackSource(outside.id), null);
  });

  it('sets a download disposition on request and returns stored peaks', async () => {
    const track = await seedTrack(file);
    const response = await request(app).get(`/track/${track.id}?download=1`);
    assert.match(
      response.headers['content-disposition'],
      /^attachment; filename\*=UTF-8''01%20STATUS/
    );
    assert.deepEqual(await getTrackPeaks(track.id), [0, 128, 255]);
    assert.deepEqual(decodePeaks(encodePeaks([1, 2, 3])), [1, 2, 3]);
  });
});
