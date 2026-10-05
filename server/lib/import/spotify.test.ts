import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import {
  buildAuthorizeUrl,
  exchangeCode,
  getProfile,
  refreshAccessToken,
} from '@server/api/spotify';
import { MediaRequestStatus } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import LinkedAccount from '@server/entity/LinkedAccount';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { UserSettings } from '@server/entity/UserSettings';
import cacheManager from '@server/lib/cache';
import {
  getSpotifySaved,
  resolveImport,
  syncSpotifySavedAlbums,
} from '@server/lib/import';
import { clearMatchCaches } from '@server/lib/import/match';
import { encryptSecret } from '@server/lib/secrets';
import type { AllSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import youtubeRoutes from '@server/routes/youtube';
import { setupTestDb } from '@server/test/db';
import { installHttpMock } from '@server/test/mockAxios';
import express from 'express';
import request from 'supertest';

import mbBarcode from '@server/test/fixtures/import/mb-release-barcode.json';

// No Spotify or YouTube credentials were available to record live responses;
// these bodies follow the documented response formats.
const ACCOUNTS = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const RAM = 'aa997ea0-2936-40bd-884d-3af8a0e064dc';

const album = (id: string, name: string, upc: string) => ({
  id,
  name,
  album_type: 'album',
  total_tracks: 13,
  artists: [{ id: '4tZwfgrHOc3mvqYlEYSvVi', name: 'Daft Punk' }],
  images: [{ url: `https://i.scdn.co/image/${id}`, width: 640, height: 640 }],
  external_ids: { upc },
});

const http = installHttpMock();
let pristine: AllSettings;

before(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pristine = structuredClone((getSettings() as any).data);
});

setupTestDb();

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getSettings() as any).data = structuredClone(pristine);
  const settings = getSettings();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (settings as any).data.serverSecret =
    settings.serverSecret || 'test-server-secret-for-linked-accounts';
  settings.discover = {
    ...settings.discover,
    spotify: {
      enabled: true,
      clientId: 'client-id',
      clientSecret: 'client-secret',
      savedAlbumsSync: 'daily',
    },
  };
  settings.metadata.musicbrainz.requestsPerSecond = 50;
  clearMatchCaches();
  cacheManager.getCache('spotify').flush();
  cacheManager.getCache('musicbrainz').flush();
  http.reset();
  http.get(/musicbrainz\.org\/ws\/2\//, (req) => [
    200,
    (req.params.get('query') ?? '').includes('886443927087')
      ? mbBarcode
      : {
          count: 0,
          offset: 0,
          releases: [],
          recordings: [],
          'release-groups': [],
        },
  ]);
});

describe('Spotify sign-in (PKCE)', () => {
  it('builds the authorize URL', () => {
    const url = new URL(
      buildAuthorizeUrl({
        redirectUri: 'https://music.example.com/api/v1/callback/spotify',
        state: 'state-123',
        codeChallenge: 'challenge-abc',
      })
    );
    assert.equal(
      url.origin + url.pathname,
      'https://accounts.spotify.com/authorize'
    );
    assert.equal(url.searchParams.get('client_id'), 'client-id');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('code_challenge'), 'challenge-abc');
    assert.equal(url.searchParams.get('state'), 'state-123');
    assert.equal(
      url.searchParams.get('scope'),
      'playlist-read-private user-library-read'
    );
  });

  it('exchanges the code, refreshes tokens and reads the profile', async () => {
    http.post(ACCOUNTS, (req) => {
      const form = req.body as URLSearchParams;
      return [
        200,
        form.get('grant_type') === 'authorization_code'
          ? {
              access_token: 'access-1',
              token_type: 'Bearer',
              expires_in: 3600,
              refresh_token: 'refresh-1',
            }
          : {
              access_token: 'access-2',
              token_type: 'Bearer',
              expires_in: 3600,
            },
      ];
    });
    http.get(`${API}/me`, (req) => [
      200,
      { id: 'jerome', display_name: req.headers.authorization },
    ]);

    const tokens = await exchangeCode({
      code: 'the-code',
      codeVerifier: 'the-verifier',
      redirectUri: 'https://music.example.com/api/v1/callback/spotify',
    });
    assert.equal(tokens.refresh_token, 'refresh-1');
    const form = http.callsTo(ACCOUNTS)[0].body as URLSearchParams;
    assert.equal(form.get('code'), 'the-code');
    assert.equal(form.get('code_verifier'), 'the-verifier');
    assert.equal(
      http.callsTo(ACCOUNTS)[0].headers.authorization,
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`
    );

    assert.equal(
      (await refreshAccessToken('refresh-1')).access_token,
      'access-2'
    );
    assert.equal(
      (http.callsTo(ACCOUNTS)[1].body as URLSearchParams).get('refresh_token'),
      'refresh-1'
    );
    assert.equal(
      (await getProfile('access-1')).display_name,
      'Bearer access-1'
    );
  });
});

describe('Spotify import', () => {
  const user = () => getRepository(User).findOneOrFail({ where: { id: 1 } });

  beforeEach(() => {
    http.post(ACCOUNTS, (req) => [
      200,
      {
        access_token:
          (req.body as URLSearchParams).get('grant_type') ===
          'client_credentials'
            ? 'app-token'
            : 'user-token',
        token_type: 'Bearer',
        expires_in: 3600,
      },
    ]);
  });

  it('resolves a public playlist to its unique albums using the app token', async () => {
    http.get(`${API}/playlists/37i9dQZF1DXcBWIGoYBM5M`, () => [
      200,
      { id: '37i9dQZF1DXcBWIGoYBM5M', name: 'Robots' },
    ]);
    http.get(`${API}/playlists/37i9dQZF1DXcBWIGoYBM5M/tracks`, () => [
      200,
      {
        next: null,
        total: 3,
        items: [
          {
            track: {
              id: 't1',
              name: 'Get Lucky',
              external_ids: { isrc: 'USQX91300108' },
              album: {
                id: 'albumRAM',
                name: 'Random Access Memories',
                artists: [],
              },
            },
          },
          {
            track: {
              id: 't2',
              name: 'Instant Crush',
              album: {
                id: 'albumRAM',
                name: 'Random Access Memories',
                artists: [],
              },
            },
          },
          { track: null },
          {
            track: {
              id: 't3',
              name: 'Da Funk',
              album: { id: 'albumHW', name: 'Homework', artists: [] },
            },
          },
        ],
      },
    ]);
    http.get(`${API}/albums`, (req) => {
      assert.equal(req.params.get('ids'), 'albumRAM,albumHW');
      return [
        200,
        {
          albums: [
            album('albumRAM', 'Random Access Memories', '886443927087'),
            album('albumHW', 'Homework', '724384260927'),
          ],
        },
      ];
    });

    const result = await resolveImport(
      'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=1',
      await user()
    );
    assert.equal(result.status, 'ready');
    assert.equal(result.title, 'Robots');
    assert.equal(
      http.callsTo(`${API}/albums`)[0].headers.authorization,
      'Bearer app-token'
    );
    assert.deepEqual(
      result.matches.map((m) => [
        m.sourceTitle,
        m.matchedBy,
        m.album?.mbid ?? null,
      ]),
      [
        ['Random Access Memories', 'upc', RAM],
        ['Homework', 'none', null],
      ]
    );
    assert.equal(
      result.matches[0].sourceCoverUrl,
      '/imageproxy/spotify/image/albumRAM'
    );
  });

  it('explains a playlist Spotify will not show', async () => {
    http.get(`${API}/playlists/37i9dQZF1DXcBWIGoYBM5M`, () => [
      404,
      { error: { status: 404, message: 'Resource not found' } },
    ]);
    await assert.rejects(
      resolveImport('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', await user()),
      /If it's private, link your Spotify account/
    );
  });

  it('lists saved albums for a linked user and says so when not linked', async () => {
    assert.deepEqual(await getSpotifySaved(await user()), {
      linked: false,
      matches: [],
    });

    await getRepository(LinkedAccount).save(
      new LinkedAccount({
        user: await user(),
        provider: 'spotify',
        externalUsername: 'jerome',
        secret: encryptSecret('refresh-token'),
      })
    );
    http.get(`${API}/me/albums`, () => [
      200,
      {
        next: null,
        total: 1,
        items: [
          {
            added_at: '2026-09-30T10:00:00Z',
            album: album('albumRAM', 'Random Access Memories', '886443927087'),
          },
        ],
      },
    ]);
    const saved = await getSpotifySaved(await user());
    assert.equal(saved.linked, true);
    assert.equal(saved.pending, 0);
    assert.equal(saved.matches[0].album?.mbid, RAM);
    assert.equal(
      http.callsTo(`${API}/me/albums`)[0].headers.authorization,
      'Bearer user-token'
    );
    assert.equal(
      (http.callsTo(ACCOUNTS)[0].body as URLSearchParams).get('refresh_token'),
      'refresh-token'
    );
  });
});

describe('Spotify saved-albums sync', () => {
  afterEach(() => mock.restoreAll());

  it('requests albums saved after linking, once, for users who switched it on', async () => {
    const users = getRepository(User);
    const owner = await users.findOneOrFail({ where: { id: 1 } });
    owner.settings = new UserSettings({
      autoRequestSpotifySaved: true,
      notificationTypes: {},
    });
    await users.save(owner);
    await getRepository(LinkedAccount).save(
      new LinkedAccount({
        user: owner,
        provider: 'spotify',
        externalUsername: 'jerome',
        secret: encryptSecret('refresh-token'),
        createdAt: new Date('2026-09-01T00:00:00Z'),
      })
    );
    http.post(ACCOUNTS, () => [
      200,
      { access_token: 'user-token', token_type: 'Bearer', expires_in: 3600 },
    ]);
    http.get(`${API}/me/albums`, () => [
      200,
      {
        next: null,
        total: 3,
        items: [
          {
            added_at: '2026-09-30T10:00:00Z',
            album: album('albumRAM', 'Random Access Memories', '886443927087'),
          },
          // no MusicBrainz match: nothing to request
          {
            added_at: '2026-09-20T10:00:00Z',
            album: album('albumHW', 'Homework', '724384260927'),
          },
          // saved before the account was linked: left alone
          {
            added_at: '2026-08-01T10:00:00Z',
            album: album('albumOld', 'Random Access Memories', '886443927087'),
          },
        ],
      },
    ]);
    const requested: { mbid: string; isAutoRequest?: boolean }[] = [];
    mock.method(
      MediaRequest,
      'request',
      async (body: { mbid: string; isAutoRequest?: boolean }) => {
        requested.push(body);
        return {
          id: 1,
          status: MediaRequestStatus.APPROVED,
          media: { title: 'x' },
        };
      }
    );

    await syncSpotifySavedAlbums();
    assert.deepEqual(requested, [
      {
        mbid: RAM,
        mediaType: 'release-group',
        scope: 'album',
        isAutoRequest: true,
      },
    ]);

    // the next run sees nothing new
    await syncSpotifySavedAlbums();
    assert.equal(requested.length, 1);

    // switched off server-side: Spotify is not even asked
    getSettings().discover.spotify.savedAlbumsSync = 'never';
    const calls = http.callsTo(`${API}/me/albums`).length;
    await syncSpotifySavedAlbums();
    assert.equal(http.callsTo(`${API}/me/albums`).length, calls);
  });
});

describe('YouTube lookup', () => {
  const YT = 'https://www.googleapis.com/youtube/v3/search';
  const RECORDING = '5b9f3b3c-6c0c-4f0e-9d4e-0a5d1c6f7a10';
  const app = express().use('/youtube', youtubeRoutes);

  it('is off without a key and never calls YouTube', async () => {
    const res = await request(app).get(
      `/youtube/track/${RECORDING}?artist=Daft Punk&title=Get Lucky`
    );
    assert.deepEqual(res.body, { enabled: false, videoId: null });
    assert.equal(http.callsTo(YT).length, 0);
  });

  it('searches once per recording and serves the cached video after that', async () => {
    const settings = getSettings();
    settings.youtube.enabled = true;
    settings.youtube.apiKey = 'yt-key';
    settings.youtube.region = 'US';
    http.get(YT, () => [
      200,
      {
        items: [
          {
            id: { kind: 'youtube#video', videoId: '5NV6Rdv1a3I' },
            snippet: {
              title: 'Daft Punk - Get Lucky (Official Audio)',
              channelTitle: 'Daft Punk',
            },
          },
        ],
      },
    ]);

    const first = await request(app).get(
      `/youtube/track/${RECORDING}?artist=Daft%20Punk&title=Get%20Lucky`
    );
    assert.deepEqual(first.body, {
      enabled: true,
      videoId: '5NV6Rdv1a3I',
      title: 'Daft Punk - Get Lucky (Official Audio)',
      channel: 'Daft Punk',
    });
    const [call] = http.callsTo(YT);
    assert.equal(call.params.get('q'), 'Daft Punk - Get Lucky');
    assert.equal(call.params.get('type'), 'video');
    assert.equal(call.params.get('videoCategoryId'), '10');
    assert.equal(call.params.get('videoEmbeddable'), 'true');
    assert.equal(call.params.get('regionCode'), 'US');
    assert.equal(call.params.get('key'), 'yt-key');

    const second = await request(app).get(`/youtube/track/${RECORDING}`);
    assert.equal(second.body.videoId, '5NV6Rdv1a3I');
    assert.equal(http.callsTo(YT).length, 1);
  });

  it('stops searching for a while when the quota is used up', async () => {
    const settings = getSettings();
    settings.youtube.enabled = true;
    settings.youtube.apiKey = 'yt-key';
    http.get(YT, () => [
      403,
      { error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } },
    ]);
    const other = '6c0c3b3c-5b9f-4f0e-9d4e-0a5d1c6f7a11';
    const res = await request(app).get(
      `/youtube/track/${other}?artist=A&title=B`
    );
    assert.deepEqual(res.body, { enabled: true, videoId: null });
    await request(app).get(`/youtube/track/${other}?artist=A&title=B`);
    assert.equal(http.callsTo(YT).length, 1);
  });
});
