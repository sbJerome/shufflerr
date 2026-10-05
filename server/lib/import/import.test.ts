import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import { getItunesChart } from '@server/api/itunes';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import ImportJob from '@server/entity/ImportJob';
import Media from '@server/entity/Media';
import {
  DuplicateMediaRequestError,
  MediaRequest,
  QuotaRestrictedError,
} from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import cacheManager from '@server/lib/cache';
import {
  ImportLinkError,
  getImportJob,
  listImportJobs,
  parseImportUrl,
  requestImport,
  resolveImport,
  summarizeImport,
} from '@server/lib/import';
import {
  barcodeVariants,
  cleanAlbumTitle,
  clearMatchCaches,
  matchAlbum,
  normalizeName,
} from '@server/lib/import/match';
import { toProxyUrl } from '@server/lib/import/sources';
import type { AllSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import { installHttpMock } from '@server/test/mockAxios';

import deezerAlbum from '@server/test/fixtures/import/deezer-album.json';
import deezerPlaylistTracks from '@server/test/fixtures/import/deezer-playlist-tracks.json';
import deezerPlaylist from '@server/test/fixtures/import/deezer-playlist.json';
import deezerTrack from '@server/test/fixtures/import/deezer-track.json';
import itunesChart from '@server/test/fixtures/import/itunes-chart.json';
import itunesLookup from '@server/test/fixtures/import/itunes-lookup.json';
import mbIsrc from '@server/test/fixtures/import/mb-recording-isrc.json';
import mbBarcode from '@server/test/fixtures/import/mb-release-barcode.json';
import mbName from '@server/test/fixtures/import/mb-release-group-name.json';

const RAM = 'aa997ea0-2936-40bd-884d-3af8a0e064dc';
const MB = 'https://musicbrainz.org';
const EMPTY = {
  release: { count: 0, offset: 0, releases: [] },
  recording: { count: 0, offset: 0, recordings: [] },
  'release-group': { count: 0, offset: 0, 'release-groups': [] },
};

let pristine: AllSettings;
const http = installHttpMock();

before(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pristine = structuredClone((getSettings() as any).data);
});

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getSettings() as any).data = structuredClone(pristine);
  const settings = getSettings();
  settings.discover = {
    ...settings.discover,
    deezer: { enabled: true },
    itunes: { enabled: true, country: 'US' },
  };
  // a mirror-style rate keeps the token bucket out of the way of the tests
  settings.metadata.musicbrainz.requestsPerSecond = 50;
  clearMatchCaches();
  cacheManager.getCache('musicbrainz').flush();
  cacheManager.getCache('deezer').flush();
  cacheManager.getCache('itunes').flush();
  http.reset();
});

afterEach(() => {
  mock.restoreAll();
});

setupTestDb();

describe('parseImportUrl', () => {
  const ok: [string, ReturnType<typeof parseImportUrl>][] = [
    [
      'https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa?si=abc',
      { source: 'spotify', kind: 'album', id: '4m2880jivSbbyEGAKfITCa' },
    ],
    [
      'https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M',
      { source: 'spotify', kind: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' },
    ],
    [
      'open.spotify.com/user/someone/playlist/37i9dQZF1DXcBWIGoYBM5M',
      { source: 'spotify', kind: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' },
    ],
    [
      'spotify:album:4m2880jivSbbyEGAKfITCa',
      { source: 'spotify', kind: 'album', id: '4m2880jivSbbyEGAKfITCa' },
    ],
    [
      'https://open.spotify.com/track/2Foc5Q5nqNiosCNqttzHof',
      { source: 'spotify', kind: 'track', id: '2Foc5Q5nqNiosCNqttzHof' },
    ],
    [
      'https://www.deezer.com/us/album/6575789',
      { source: 'deezer', kind: 'album', id: '6575789' },
    ],
    [
      'https://deezer.com/playlist/13511428543?utm_source=x',
      { source: 'deezer', kind: 'playlist', id: '13511428543' },
    ],
    [
      'https://www.deezer.com/en/track/67238735',
      { source: 'deezer', kind: 'track', id: '67238735' },
    ],
    [
      'https://music.apple.com/us/album/random-access-memories/617154241',
      { source: 'itunes', kind: 'album', id: '617154241', country: 'us' },
    ],
    [
      'https://music.apple.com/gb/album/get-lucky/617154241?i=617154366',
      { source: 'itunes', kind: 'album', id: '617154241', country: 'gb' },
    ],
    [
      'https://itunes.apple.com/us/album/random-access-memories/id617154241',
      { source: 'itunes', kind: 'album', id: '617154241', country: 'us' },
    ],
  ];
  for (const [url, expected] of ok) {
    it(`reads ${url}`, () => {
      assert.deepEqual(parseImportUrl(url), expected);
    });
  }

  it('marks share links that have to be followed first', () => {
    for (const url of [
      'https://deezer.page.link/abc123',
      'https://link.deezer.com/s/30abc',
      'https://spotify.link/xyz',
    ]) {
      assert.equal(parseImportUrl(url).shortLink, true, url);
    }
    assert.equal(
      parseImportUrl('https://deezer.page.link/abc').source,
      'deezer'
    );
    assert.equal(parseImportUrl('https://spotify.link/xyz').source, 'spotify');
  });

  it('explains why Apple Music playlists cannot be imported', () => {
    assert.throws(
      () =>
        parseImportUrl(
          'https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb'
        ),
      (e: Error) =>
        e instanceof ImportLinkError &&
        /Apple Music playlists can't be imported/.test(e.message) &&
        /each album/.test(e.message)
    );
  });

  it('rejects everything else with fix-it copy', () => {
    for (const url of [
      '',
      'not a link at all',
      'https://open.spotify.com/artist/0OdUWJ0sBjDrqHygGUXeCF',
      'https://www.deezer.com/us/artist/27',
      'https://music.youtube.com/playlist?list=PL123',
      'https://bandcamp.com/album/x',
    ]) {
      assert.throws(() => parseImportUrl(url), ImportLinkError, url);
    }
  });
});

describe('match helpers', () => {
  it('spells a barcode as UPC-A, EAN-13 and bare digits', () => {
    assert.deepEqual(barcodeVariants('886443927087').sort(), [
      '0886443927087',
      '886443927087',
    ]);
    assert.ok(barcodeVariants('00602455741234').includes('0602455741234'));
    assert.deepEqual(barcodeVariants('abc'), []);
  });

  it('strips edition noise from store titles', () => {
    assert.equal(
      cleanAlbumTitle('Random Access Memories (10th Anniversary Edition)'),
      'Random Access Memories'
    );
    assert.equal(cleanAlbumTitle('Where You Are - Single'), 'Where You Are');
    assert.equal(cleanAlbumTitle('Thriller [2008 Remaster]'), 'Thriller');
    assert.equal(
      cleanAlbumTitle('Where You Are (GRiZ Remix)'),
      'Where You Are (GRiZ Remix)'
    );
  });

  it('normalises names for comparison', () => {
    assert.equal(normalizeName('Beyoncé & JAY‐Z'), 'beyonce and jay z');
  });

  it('turns CDN urls into image-proxy paths and refuses unknown hosts', () => {
    assert.equal(
      toProxyUrl(
        'https://cdn-images.dzcdn.net/images/cover/abc/500x500-000000-80-0-0.jpg'
      ),
      '/imageproxy/deezer/images/cover/abc/500x500-000000-80-0-0.jpg'
    );
    assert.equal(
      toProxyUrl('https://i.scdn.co/image/ab67616d0000b273'),
      '/imageproxy/spotify/image/ab67616d0000b273'
    );
    assert.equal(
      toProxyUrl(
        'https://is3-ssl.mzstatic.com/image/thumb/Music/a/b.jpg/100x100bb.jpg'
      ),
      '/imageproxy/itunes/image/thumb/Music/a/b.jpg/500x500bb.jpg'
    );
    assert.equal(toProxyUrl('https://evil.example.com/x.jpg'), null);
  });

  it('writes the import summary the way the toast shows it', () => {
    assert.equal(
      summarizeImport(2, 1, 1, 'This has already been requested.'),
      '2 approved automatically, 1 waiting for approval, 1 not requested: This has already been requested.'
    );
    assert.equal(summarizeImport(0, 3, 0), '3 waiting for approval.');
    assert.equal(summarizeImport(0, 0, 0), 'Nothing was requested.');
  });
});

describe('matchAlbum', () => {
  const candidate = {
    key: 'deezer:6575789',
    sourceId: '6575789',
    title: 'Random Access Memories',
    artist: 'Daft Punk',
    upc: '886443927087',
    isrcs: ['USQX91300108'],
  };

  it('matches by barcode first', async () => {
    http.get(`${MB}/ws/2/release`, () => [200, mbBarcode]);
    const result = await matchAlbum(candidate);
    assert.match(
      http.calls[0].params.get('query') ?? '',
      /^barcode:\(.*886443927087/
    );
    assert.match(http.calls[0].headers['user-agent'], /^Shufflerr\//);
    assert.equal(result.matchedBy, 'upc');
    assert.equal(result.releaseGroup?.mbid, RAM);
    assert.equal(result.releaseGroup?.artistName, 'Daft Punk');
    assert.equal(result.releaseGroup?.primaryType, 'Album');
    assert.equal(http.calls.length, 1);
  });

  it('falls back to the ISRC and only accepts the release with the same title', async () => {
    http.get(`${MB}/ws/2/release`, () => [200, EMPTY.release]);
    http.get(`${MB}/ws/2/recording`, (req) => [
      200,
      req.params.get('query') === 'isrc:USQX91300108'
        ? mbIsrc
        : EMPTY.recording,
    ]);
    const result = await matchAlbum(candidate);
    assert.equal(result.matchedBy, 'isrc');
    // the recording is also on soundtracks; those must be skipped
    assert.equal(result.releaseGroup?.mbid, RAM);
  });

  it('falls back to artist and title', async () => {
    http.get(`${MB}/ws/2/release-group`, (req) => [
      200,
      /releasegroup:"Random Access Memories" AND artist:"Daft Punk"/.test(
        req.params.get('query') ?? ''
      )
        ? mbName
        : EMPTY['release-group'],
    ]);
    const result = await matchAlbum({
      key: 'itunes:617154241',
      sourceId: '617154241',
      title: 'Random Access Memories',
      artist: 'Daft Punk',
    });
    assert.equal(result.matchedBy, 'name');
    assert.equal(result.releaseGroup?.mbid, RAM);
  });

  it('reports no match instead of guessing', async () => {
    http.get(`${MB}/ws/2/release-group`, () => [200, mbName]);
    const result = await matchAlbum({
      key: 'itunes:1',
      sourceId: '1',
      title: 'Homework',
      artist: 'Daft Punk',
    });
    assert.deepEqual(result, { matchedBy: 'none', releaseGroup: null });
  });

  it('remembers a match so MusicBrainz is asked once', async () => {
    http.get(`${MB}/ws/2/release`, () => [200, mbBarcode]);
    await matchAlbum(candidate);
    cacheManager.getCache('musicbrainz').flush();
    const again = await matchAlbum(candidate);
    assert.equal(again.matchedBy, 'upc');
    assert.equal(http.calls.length, 1);
  });
});

describe('import pipeline', () => {
  const admin = () => getRepository(User).findOneOrFail({ where: { id: 1 } });

  const mockMusicBrainz = () =>
    http.get(
      /musicbrainz\.org\/ws\/2\/(release|recording|release-group)\?/,
      (req) => {
        const query = req.params.get('query') ?? '';
        if (/^barcode:/.test(query)) {
          return [
            200,
            query.includes('886443927087') ? mbBarcode : EMPTY.release,
          ];
        }
        if (/^isrc:/.test(query)) {
          return [200, EMPTY.recording];
        }
        return [200, EMPTY['release-group']];
      }
    );

  it('resolves a Deezer album to a MusicBrainz album with its library status', async () => {
    http.get('https://api.deezer.com/album/6575789', () => [200, deezerAlbum]);
    http.get(
      `https://api.deezer.com/track/${deezerAlbum.tracks.data[0].id}`,
      () => [200, deezerTrack]
    );
    mockMusicBrainz();
    await getRepository(Media).save(
      new Media({
        mediaType: MediaType.RELEASE_GROUP,
        mbid: RAM,
        title: 'Random Access Memories',
        artistName: 'Daft Punk',
        status: MediaStatus.PARTIALLY_AVAILABLE,
        trackCount: 13,
        tracksAvailable: 9,
      })
    );

    const user = await admin();
    const result = await resolveImport(
      'https://www.deezer.com/us/album/6575789',
      user
    );
    assert.equal(result.status, 'ready');
    assert.equal(result.source, 'deezer');
    assert.equal(result.title, 'Random Access Memories');
    assert.equal(result.matches.length, 1);
    const [match] = result.matches;
    assert.equal(match.matchedBy, 'upc');
    assert.equal(match.sourceArtist, 'Daft Punk');
    assert.match(match.sourceCoverUrl ?? '', /^\/imageproxy\/deezer\//);
    assert.equal(match.album?.mbid, RAM);
    assert.equal(match.album?.status, MediaStatus.PARTIALLY_AVAILABLE);
    assert.equal(match.album?.tracksAvailable, 9);
    assert.equal(
      match.album?.coverUrl,
      `/imageproxy/caa/release-group/${RAM}/front-500`
    );

    // the job survives a reload and is private to its owner
    const reloaded = await getImportJob(result.jobId, user);
    assert.equal(reloaded?.matches[0].album?.mbid, RAM);
    const other = await getRepository(User).findOneOrFail({ where: { id: 2 } });
    assert.equal(await getImportJob(result.jobId, other), null);
    const jobs = await listImportJobs(user);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].matchCount, 1);
  });

  it('resolves a Deezer playlist to its unique albums, unmatched ones included', async () => {
    const albumIds = [
      ...new Set(deezerPlaylistTracks.data.map((t) => t.album.id)),
    ];
    http.get('https://api.deezer.com/playlist/13511428543', () => [
      200,
      deezerPlaylist,
    ]);
    http.get('https://api.deezer.com/playlist/13511428543/tracks', () => [
      200,
      deezerPlaylistTracks,
    ]);
    albumIds.forEach((id, i) =>
      http.get(`https://api.deezer.com/album/${id}`, () => [
        200,
        {
          id,
          title: deezerPlaylistTracks.data.find((t) => t.album.id === id)?.album
            .title,
          // only the first album has a barcode MusicBrainz knows
          upc: i === 0 ? '886443927087' : `00000000000${i}`,
          artist: { id: 1, name: 'John Summit' },
        },
      ])
    );
    mockMusicBrainz();

    const user = await admin();
    let result = await resolveImport(
      'https://www.deezer.com/playlist/13511428543',
      user
    );
    // long lists answer 'resolving' and finish in the background
    for (let i = 0; i < 100 && result.status === 'resolving'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      result = (await getImportJob(result.jobId, user)) ?? result;
    }
    assert.equal(result.status, 'ready');
    assert.equal(result.title, deezerPlaylist.title);
    assert.equal(result.matches.length, albumIds.length);
    assert.equal(result.matches[0].album?.mbid, RAM);
    assert.ok(
      result.matches
        .slice(1)
        .every((m) => m.album === null && m.matchedBy === 'none')
    );
    assert.ok(result.matches.every((m) => !m.pending));
  });

  it('resolves an Apple Music album by name', async () => {
    http.get('https://itunes.apple.com/lookup', (req) => [
      200,
      req.params.get('id') === '617154241' && req.params.get('country') === 'GB'
        ? itunesLookup
        : { resultCount: 0, results: [] },
    ]);
    http.get(`${MB}/ws/2/release-group`, () => [200, mbName]);
    const result = await resolveImport(
      'https://music.apple.com/gb/album/random-access-memories/617154241',
      await admin()
    );
    assert.equal(result.source, 'itunes');
    assert.equal(result.matches[0].matchedBy, 'name');
    assert.equal(result.matches[0].album?.mbid, RAM);
    assert.match(
      result.matches[0].sourceCoverUrl ?? '',
      /^\/imageproxy\/itunes\//
    );
  });

  it('turns provider problems into fix-it copy', async () => {
    const user = await admin();
    http.get('https://api.deezer.com/album/1', () => [
      200,
      { error: { type: 'DataException', message: 'no data', code: 800 } },
    ]);
    await assert.rejects(
      resolveImport('https://www.deezer.com/album/1', user),
      (e: Error) =>
        e instanceof ImportLinkError && /couldn't find/.test(e.message)
    );

    getSettings().discover = {
      ...getSettings().discover,
      deezer: { enabled: false },
    };
    await assert.rejects(
      resolveImport('https://www.deezer.com/album/6575789', user),
      (e: Error) =>
        e instanceof ImportLinkError && /switched off/.test(e.message)
    );
    await assert.rejects(
      resolveImport(
        'https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa',
        user
      ),
      (e: Error) => e instanceof ImportLinkError && /Spotify/.test(e.message)
    );
    assert.equal(await getRepository(ImportJob).count(), 0);
  });

  it('sends each chosen album through the request engine and sums up the outcomes', async () => {
    const user = await admin();
    const mbids = [
      RAM,
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ];
    const calls: { mbid: string; scope: string; mediaType: string }[] = [];
    mock.method(
      MediaRequest,
      'request',
      async (body: { mbid: string; scope: string; mediaType: string }) => {
        calls.push(body);
        switch (body.mbid) {
          case mbids[0]:
            return {
              id: 10,
              status: MediaRequestStatus.APPROVED,
              media: { title: 'Random Access Memories' },
            };
          case mbids[1]:
            return {
              id: 11,
              status: MediaRequestStatus.PENDING,
              media: { title: 'Pending album' },
            };
          case mbids[2]:
            throw new DuplicateMediaRequestError(
              'This has already been requested.'
            );
          default:
            throw new QuotaRestrictedError(
              "You've used your weekly limit of 10 albums."
            );
        }
      }
    );

    const result = await requestImport(user, { mbids: [...mbids, RAM] });
    assert.equal(calls.length, 4, 'duplicates in the list are requested once');
    assert.ok(
      calls.every((c) => c.scope === 'album' && c.mediaType === 'release-group')
    );
    assert.deepEqual(
      result.results.map((r) => r.outcome),
      ['auto', 'pending', 'blocked', 'blocked']
    );
    assert.equal(result.results[0].requestId, 10);
    assert.equal(result.results[0].title, 'Random Access Memories');
    assert.equal(
      result.results[3].reason,
      "You've used your weekly limit of 10 albums."
    );
    assert.deepEqual([result.auto, result.pending, result.blocked], [1, 1, 2]);
    assert.equal(
      result.summary,
      '1 approved automatically, 1 waiting for approval, 2 not requested: This has already been requested.'
    );
  });
});

describe('iTunes chart', () => {
  it('returns the most-played albums with proxied covers, and nothing when iTunes is off', async () => {
    http.get(
      'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/3/albums.json',
      () => [200, itunesChart]
    );
    const chart = await getItunesChart(3);
    assert.equal(chart.length, itunesChart.feed.results.length);
    assert.equal(chart[0].title, itunesChart.feed.results[0].name);
    assert.match(
      chart[0].coverUrl ?? '',
      /^\/imageproxy\/itunes\/.*500x500bb\.jpg$/
    );

    getSettings().discover = {
      ...getSettings().discover,
      itunes: { enabled: false, country: 'US' },
    };
    assert.deepEqual(await getItunesChart(3), []);
  });
});
