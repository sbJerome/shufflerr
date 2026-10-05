import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import type { JellyfinMusicItem } from '@server/api/jellyfin';
import type { PlexAlbum, PlexTrack } from '@server/api/plexapi';
import type { SubsonicAlbum } from '@server/api/subsonic';
import { jellyfinAlbumToScanned } from '@server/lib/scanners/jellyfin';
import type { ScannedFile } from '@server/lib/scanners/local/group';
import { groupFiles } from '@server/lib/scanners/local/group';
import {
  albumFolderOf,
  describeFormat,
  guessFromPath,
  parseAlbumFolder,
} from '@server/lib/scanners/local/tags';
import { plexAlbumToScanned, plexMbids } from '@server/lib/scanners/plex';
import { subsonicAlbumToScanned } from '@server/lib/scanners/subsonic';
import { matchTracks } from './matching';
import {
  durationClose,
  normalizeLoose,
  normalizeText,
  primaryArtist,
  sameText,
  stripQualifiers,
} from './normalize';
import { reducePeaks } from './peaks';
import type { MusicBrainzGateway, ReleaseGroupCandidate } from './resolver';
import {
  editionsToTry,
  pickCandidate,
  resolveReleaseGroup,
  searchAttempts,
} from './resolver';
import { parseRange } from './stream';
import type { ScannedAlbum } from './types';

const FIXTURES = path.join(__dirname, '../../test/fixtures');
const fixture = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8')) as T;

interface MbRelease {
  id: string;
  title: string;
  media: {
    tracks: {
      id: string;
      position: number;
      title: string;
      length: number;
      recording: { id: string };
    }[];
  }[];
  'release-group': { id: string };
  'artist-credit': { artist: { id: string; name: string } }[];
}

/** The canonical CTRL ESCAPE tracklist, from the recorded MusicBrainz release. */
const release = fixture<MbRelease>('musicbrainz/release-ctrl-escape.json');
const canonical = release.media
  .flatMap((medium) => medium.tracks)
  .map((track, index) => ({
    id: index + 1,
    recordingMbid: track.recording.id,
    title: track.title,
    lengthMs: track.length,
    discNumber: 1,
    trackNumber: track.position,
  }));

const gatewayWith = (
  overrides: Partial<MusicBrainzGateway> = {}
): MusicBrainzGateway & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    releaseGroupForRelease: async (mbid) => {
      calls.push(`release:${mbid}`);
      return overrides.releaseGroupForRelease?.(mbid) ?? null;
    },
    releaseGroupExists: async (mbid) => {
      calls.push(`group:${mbid}`);
      return overrides.releaseGroupExists?.(mbid) ?? false;
    },
    searchReleaseGroups: async (artist, title) => {
      calls.push(`search:${artist}|${title}`);
      return overrides.searchReleaseGroups?.(artist, title) ?? [];
    },
  };
};

describe('normalisation', () => {
  it('ignores case, punctuation and diacritics', () => {
    assert.equal(normalizeText('STATUS:AWAY'), normalizeText('Status: Away'));
    assert.equal(normalizeText('HALŌ'), 'halo');
    assert.equal(normalizeText("DON'T BELIEVE IT"), 'dont believe it');
    assert.equal(normalizeText('MESS W/ ME'), normalizeText('MESS W+ ME'));
    assert.ok(sameText('Rock & Roll', 'rock and roll'));
  });

  it('drops qualifiers only in the loose form', () => {
    assert.notEqual(
      normalizeText('Stay With Me (Mishell remix)'),
      normalizeText('Stay With Me')
    );
    assert.equal(
      normalizeLoose('Stay With Me (Mishell remix)'),
      normalizeLoose('Stay With Me')
    );
    assert.equal(normalizeLoose('Song - 2011 Remaster'), 'song');
    assert.equal(normalizeLoose('Song feat. Somebody'), 'song');
    // a title that is nothing but a qualifier keeps its text
    assert.equal(normalizeLoose('(Intro)'), 'intro');
  });

  it('treats unknown durations as compatible and applies the tolerance', () => {
    assert.ok(durationClose(200000, 202900));
    assert.ok(!durationClose(200000, 203100));
    assert.ok(durationClose(undefined, 203100));
  });
});

describe('track matching', () => {
  it('matches by recording MBID even when the title differs', () => {
    const matches = matchTracks(canonical, [
      {
        sourceId: 'x',
        title: 'completely different',
        recordingMbid: canonical[4].recordingMbid,
      },
    ]);
    assert.equal(matches.size, 1);
    assert.equal(matches.get(canonical[4].id)?.sourceId, 'x');
  });

  it('matches by normalised title and duration within 3 seconds', () => {
    const matches = matchTracks(canonical, [
      { sourceId: 'a', title: 'status: away', durationMs: 206811 },
      { sourceId: 'b', title: 'Shades of Blue', durationMs: 203128 },
    ]);
    assert.equal(matches.get(1)?.sourceId, 'a');
    assert.equal(matches.get(2)?.sourceId, 'b');
  });

  it('rejects a same-titled track whose length is off and position differs', () => {
    const matches = matchTracks(canonical, [
      {
        sourceId: 'long',
        title: 'SATA',
        durationMs: 183000 + 45000,
        trackNumber: 9,
      },
    ]);
    assert.equal(matches.size, 0);
  });

  it('widens the window to 10 s when title and track number agree', () => {
    const matches = matchTracks(canonical, [
      {
        sourceId: 'edit',
        title: 'SATA',
        durationMs: 183000 + 8000,
        trackNumber: 3,
      },
    ]);
    assert.equal(matches.get(3)?.sourceId, 'edit');
  });

  it('matches a guest credit written into the title only when durations agree', () => {
    const tracks = [
      {
        id: 1,
        recordingMbid: null,
        title: 'Heaven Takes You Home',
        lengthMs: 213000,
        discNumber: 1,
        trackNumber: 5,
      },
    ];
    const title = 'Heaven Takes You Home with Connie Constance';
    assert.equal(
      matchTracks(tracks, [{ sourceId: 'a', title, durationMs: 214100 }]).size,
      1
    );
    assert.equal(matchTracks(tracks, [{ sourceId: 'a', title }]).size, 0);
    assert.equal(
      matchTracks(tracks, [{ sourceId: 'a', title, durationMs: 250000 }]).size,
      0
    );
  });

  it('uses every scanned track at most once', () => {
    const tracks = [
      {
        id: 1,
        recordingMbid: null,
        title: 'Intro',
        lengthMs: 60000,
        discNumber: 1,
        trackNumber: 1,
      },
      {
        id: 2,
        recordingMbid: null,
        title: 'Intro',
        lengthMs: 90000,
        discNumber: 2,
        trackNumber: 1,
      },
    ];
    const matches = matchTracks(tracks, [
      {
        sourceId: 'd2',
        title: 'Intro',
        durationMs: 90500,
        discNumber: 2,
        trackNumber: 1,
      },
      {
        sourceId: 'd1',
        title: 'Intro',
        durationMs: 60200,
        discNumber: 1,
        trackNumber: 1,
      },
    ]);
    assert.equal(matches.get(1)?.sourceId, 'd1');
    assert.equal(matches.get(2)?.sourceId, 'd2');
  });
});

describe('release-group resolution', () => {
  const album: ScannedAlbum = {
    source: 'local',
    sourceAlbumId: 'k',
    artistName: 'John Summit',
    albumTitle: 'CTRL ESCAPE',
    year: 2026,
    tracks: [],
  };
  const candidates: ReleaseGroupCandidate[] = [
    {
      mbid: 'wrong-artist',
      title: 'CTRL ESCAPE',
      artistName: 'Someone Else',
      score: 100,
    },
    {
      mbid: 'weak',
      title: 'CTRL ESCAPE',
      artistName: 'John Summit',
      score: 40,
    },
    {
      mbid: 'other-title',
      title: 'Comfort in Chaos',
      artistName: 'John Summit',
      score: 95,
    },
    {
      mbid: 'right',
      title: 'CTRL ESCAPE',
      artistName: 'John Summit',
      score: 100,
      year: 2026,
      primaryType: 'Album',
    },
  ];

  it('uses a release-group id from the source without asking MusicBrainz', async () => {
    const gateway = gatewayWith();
    const resolved = await resolveReleaseGroup(
      { ...album, releaseGroupMbid: 'rg-1', releaseMbid: 'rel-1' },
      gateway
    );
    assert.deepEqual(resolved, {
      mbid: 'rg-1',
      via: 'release-group-id',
      releaseMbid: 'rel-1',
    });
    assert.deepEqual(gateway.calls, []);
  });

  it('turns a release id into its release group', async () => {
    const resolved = await resolveReleaseGroup(
      { ...album, releaseMbid: release.id },
      gatewayWith({
        releaseGroupForRelease: async () => release['release-group'].id,
      })
    );
    assert.equal(resolved?.mbid, release['release-group'].id);
    assert.equal(resolved?.via, 'release-id');
    assert.equal(resolved?.releaseMbid, release.id);
  });

  it('tries an ambiguous id as a release, then as a release group', async () => {
    const resolved = await resolveReleaseGroup(
      { ...album, ambiguousMbid: 'maybe-group' },
      gatewayWith({ releaseGroupExists: async () => true })
    );
    assert.deepEqual(resolved, {
      mbid: 'maybe-group',
      via: 'release-group-id',
    });
  });

  it('accepts a search hit only when artist and title both agree', async () => {
    assert.equal(pickCandidate(album, candidates)?.mbid, 'right');
    assert.equal(pickCandidate(album, candidates.slice(0, 3)), undefined);

    const resolved = await resolveReleaseGroup(
      album,
      gatewayWith({ searchReleaseGroups: async () => candidates })
    );
    assert.deepEqual(resolved, { mbid: 'right', via: 'search' });
  });

  it('searches the folder spelling and a cleaned title when the tags find nothing', async () => {
    assert.equal(stripQualifiers('Gin & Juice (Maxi CD)'), 'Gin & Juice');
    assert.equal(stripQualifiers('Proxy WEB'), 'Proxy');
    assert.equal(stripQualifiers('Migraine EP'), 'Migraine');
    assert.equal(
      stripQualifiers("(What's the Story) Morning Glory?"),
      "(What's the Story) Morning Glory?"
    );
    assert.equal(primaryArtist('Martin Garrix, Khalid'), 'Martin Garrix');
    assert.equal(
      primaryArtist('Martin Garrix X Mesto X Wilhelm'),
      'Martin Garrix'
    );
    assert.equal(primaryArtist('Dr. Dre feat. Snoop Doggy Dogg'), 'Dr. Dre');

    const messy = {
      ...album,
      artistName: 'Martin Garrix, Khalid',
      albumTitle: 'Ocean WEB',
      aliases: [{ artistName: 'Martin Garrix', albumTitle: 'Ocean' }],
    };
    assert.deepEqual(searchAttempts(messy), [
      { artistName: 'Martin Garrix, Khalid', albumTitle: 'Ocean WEB' },
      { artistName: 'Martin Garrix', albumTitle: 'Ocean' },
      { artistName: 'Martin Garrix', albumTitle: 'Ocean WEB' },
      { artistName: 'Martin Garrix, Khalid', albumTitle: 'Ocean' },
    ]);

    const gateway = gatewayWith({
      searchReleaseGroups: async (artist, title) =>
        artist === 'Martin Garrix' && title === 'Ocean'
          ? [
              {
                mbid: 'ocean',
                title: 'Ocean',
                artistName: 'Martin Garrix feat. Khalid',
                score: 100,
              },
              {
                mbid: 'other',
                title: 'Ocean',
                artistName: 'Somebody Else',
                score: 100,
              },
            ]
          : [],
    });
    assert.deepEqual(await resolveReleaseGroup(messy, gateway), {
      mbid: 'ocean',
      via: 'search',
    });
    assert.equal(gateway.calls.length, 2);
  });

  it('picks editions that can hold the files, closest size and official first', () => {
    const editions = [
      { mbid: 'promo-4', trackCount: 4, official: false, digital: false },
      {
        mbid: 'std-16',
        trackCount: 16,
        official: true,
        digital: false,
        date: '2007-04-17',
      },
      {
        mbid: 'std-16-digital',
        trackCount: 16,
        official: true,
        digital: true,
        date: '2007-04-17',
      },
      { mbid: 'boot-16', trackCount: 16, official: false, digital: false },
      { mbid: 'deluxe-21', trackCount: 21, official: true, digital: true },
    ];
    assert.deepEqual(editionsToTry(editions, 16, 'promo-4'), [
      'std-16-digital',
      'std-16',
    ]);
    assert.deepEqual(editionsToTry(editions, 17, 'std-16'), ['deluxe-21']);
    assert.deepEqual(editionsToTry(editions, 30, 'std-16'), []);
  });

  it('returns null (never an invented id) when nothing matches', async () => {
    assert.equal(await resolveReleaseGroup(album, gatewayWith()), null);
    assert.equal(
      await resolveReleaseGroup({ ...album, albumTitle: ' ' }, gatewayWith()),
      null
    );
  });

  it('lets lookup failures propagate so the album is retried', async () => {
    await assert.rejects(
      resolveReleaseGroup(
        album,
        gatewayWith({
          searchReleaseGroups: async () => {
            throw new Error('503');
          },
        })
      )
    );
  });
});

describe('local files', () => {
  it('reads artist, album, year and track number from the path when tags are missing', () => {
    const guess = guessFromPath(
      '/music/John Summit/CTRL ESCAPE (2026)/John Summit - CTRL ESCAPE - 07 - MESS W+ ME.mp3'
    );
    assert.deepEqual(guess, {
      title: 'MESS W+ ME',
      artist: 'John Summit',
      album: 'CTRL ESCAPE',
      year: 2026,
      trackNo: 7,
      discNo: undefined,
    });
    assert.deepEqual(
      guessFromPath('/music/Artist/Album [FLAC]/CD 2/03 Some Song.flac'),
      {
        title: 'Some Song',
        artist: 'Artist',
        album: 'Album',
        year: undefined,
        trackNo: 3,
        discNo: 2,
      }
    );
  });

  it('folds disc subfolders into the album folder', () => {
    assert.equal(albumFolderOf('/m/A/B/CD1/01.flac'), '/m/A/B');
    assert.equal(albumFolderOf('/m/A/B/Disc 2/01.flac'), '/m/A/B');
    assert.equal(albumFolderOf('/m/A/B/01.flac'), '/m/A/B');
    assert.deepEqual(parseAlbumFolder('2019 - Some Album'), {
      title: 'Some Album',
      year: 2019,
    });
  });

  it('describes formats the way the tracklist shows them', () => {
    assert.equal(
      describeFormat('a.flac', {
        lossless: true,
        bitsPerSample: 16,
        sampleRate: 44100,
      }),
      'FLAC 16/44.1'
    );
    assert.equal(
      describeFormat('a.flac', {
        lossless: true,
        bitsPerSample: 24,
        sampleRate: 96000,
      }),
      'FLAC 24/96'
    );
    assert.equal(
      describeFormat('a.mp3', { lossless: false, bitrate: 320000 }),
      'MP3 320'
    );
    assert.equal(
      describeFormat('a.m4a', { codec: 'ALAC', lossless: true }),
      'ALAC'
    );
  });

  it('groups the real CTRL ESCAPE folder into one album that matches all 13 tracks', async () => {
    const files = fixture<ScannedFile[]>('local/ctrl-escape-files.json');
    const stubs = groupFiles(files);
    assert.equal(stubs.length, 1);

    const album = (await stubs[0].load()) as ScannedAlbum;
    assert.equal(album.artistName, 'John Summit');
    assert.equal(album.albumTitle, 'CTRL ESCAPE');
    assert.equal(album.year, 2026);
    assert.equal(album.localPath, '/music/John Summit/CTRL ESCAPE (2026)');
    assert.equal(album.tracks.length, 13);
    assert.equal(album.tracks[0].fileFormat, 'MP3 320');

    const matches = matchTracks(canonical, album.tracks);
    assert.equal(matches.size, 13);
    for (const track of canonical) {
      assert.equal(matches.get(track.id)?.trackNumber, track.trackNumber);
    }
  });

  it('changes the signature when a file changes and splits two albums in one folder', () => {
    const files = fixture<ScannedFile[]>('local/ctrl-escape-files.json');
    const before = groupFiles(files)[0].signature;
    const touched = files.map((file, index) =>
      index === 0 ? { ...file, mtimeMs: file.mtimeMs + 1000 } : file
    );
    assert.notEqual(groupFiles(touched)[0].signature, before);

    const mixed = files.map((file, index) =>
      index < 3
        ? { ...file, tags: { ...file.tags, album: 'Another Album' } }
        : file
    );
    assert.equal(groupFiles(mixed).length, 2);
  });
});

describe('Plex scanner mapping', () => {
  const albums = fixture<{ MediaContainer: { Metadata: PlexAlbum[] } }>(
    'plex/albums-ctrl-escape.json'
  ).MediaContainer.Metadata;
  const tracks = fixture<{ MediaContainer: { Metadata: PlexTrack[] } }>(
    'plex/tracks-ctrl-escape.json'
  ).MediaContainer.Metadata;

  it('reads MusicBrainz ids from mbid:// GUIDs only', () => {
    assert.deepEqual(
      plexMbids([
        { id: 'plex://album/abc' },
        { id: 'mbid://2555FE96-7bde-4b6d-92ae-9ee09ffe71d4' },
        { id: 'mbid://not-a-uuid' },
      ]),
      ['2555fe96-7bde-4b6d-92ae-9ee09ffe71d4']
    );
  });

  it('maps an album and its tracks, and matches the canonical tracklist by title and duration', () => {
    const scanned = plexAlbumToScanned(albums[0], tracks);
    assert.equal(scanned.source, 'plex');
    assert.equal(scanned.sourceAlbumId, '48211');
    assert.equal(scanned.artistName, 'John Summit');
    assert.equal(scanned.ambiguousMbid, release.id);
    assert.equal(scanned.releaseGroupMbid, undefined);
    assert.equal(scanned.tracks.length, 13);
    assert.equal(scanned.tracks[0].fileFormat, 'MP3 320');
    assert.match(scanned.tracks[0].plexPartKey ?? '', /^\/library\/parts\//);

    // Plex track GUIDs here are release-track ids, not recording ids
    const matches = matchTracks(canonical, scanned.tracks);
    assert.equal(matches.size, 13);
    assert.equal(matches.get(5)?.sourceId, tracks[4].ratingKey);
  });
});

describe('Jellyfin scanner mapping', () => {
  const album = fixture<{ Items: JellyfinMusicItem[] }>(
    'jellyfin/albums-ctrl-escape.json'
  ).Items[0];
  const tracks = fixture<{ Items: JellyfinMusicItem[] }>(
    'jellyfin/tracks-ctrl-escape.json'
  ).Items;

  it('takes release group, release and recording ids from ProviderIds', () => {
    const scanned = jellyfinAlbumToScanned(album, tracks);
    assert.equal(scanned.releaseGroupMbid, release['release-group'].id);
    assert.equal(scanned.releaseMbid, release.id);
    assert.equal(scanned.artistMbid, release['artist-credit'][0].artist.id);
    assert.equal(scanned.tracks[0].recordingMbid, canonical[0].recordingMbid);
    assert.equal(scanned.tracks[1].recordingMbid, undefined);
    assert.equal(scanned.tracks[0].durationMs, canonical[0].lengthMs);
    assert.equal(scanned.tracks[0].fileFormat, 'FLAC 16/44.1');

    assert.equal(matchTracks(canonical, scanned.tracks).size, 13);
  });
});

describe('Navidrome scanner mapping', () => {
  const album = fixture<{ 'subsonic-response': { album: SubsonicAlbum } }>(
    'subsonic/getAlbum-ctrl-escape.json'
  )['subsonic-response'].album;

  it('uses OpenSubsonic musicBrainzId fields when present', () => {
    const scanned = subsonicAlbumToScanned(album);
    assert.equal(scanned.source, 'navidrome');
    assert.equal(scanned.ambiguousMbid, release.id);
    assert.equal(scanned.tracks.length, 13);
    assert.equal(scanned.tracks[0].recordingMbid, canonical[0].recordingMbid);
    assert.equal(scanned.tracks[12].recordingMbid, undefined);
    assert.equal(scanned.tracks[0].fileFormat, 'MP3 320');
    assert.equal(matchTracks(canonical, scanned.tracks).size, 13);
  });
});

describe('range requests', () => {
  it('parses ordinary, open-ended and suffix ranges', () => {
    assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
    assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
    assert.deepEqual(parseRange('bytes=-200', 1000), { start: 800, end: 999 });
    assert.deepEqual(parseRange('bytes=900-5000', 1000), {
      start: 900,
      end: 999,
    });
  });

  it('reports unsatisfiable ranges and ignores what it cannot use', () => {
    assert.equal(parseRange('bytes=1000-', 1000), null);
    assert.equal(parseRange('bytes=-0', 1000), null);
    assert.equal(parseRange(undefined, 1000), undefined);
    assert.equal(parseRange('bytes=0-1,5-9', 1000), undefined);
    assert.equal(parseRange('items=0-1', 1000), undefined);
  });
});

describe('waveform peaks', () => {
  it('reduces to the requested number of bars scaled to 0–255', () => {
    const windows = Array.from({ length: 960 }, (_v, i) =>
      i < 480 ? 1000 : 4000
    );
    const peaks = reducePeaks(windows, 96);
    assert.equal(peaks.length, 96);
    assert.equal(peaks[0], 64);
    assert.equal(peaks[95], 255);
    assert.deepEqual(reducePeaks([], 96), []);
    // fewer windows than bars still yields a full set
    assert.equal(reducePeaks([5, 10], 96).length, 96);
  });
});
