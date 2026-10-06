// Discover rows against an in-memory library: "New in your library" surfaces
// each album of a discography (artist-scope) request as it lands, and "For you"
// recommends albums in the library's leading genres that it does not hold yet.
// No MusicBrainz in these tests — the genre hooks are replaced with fixtures.
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
  RequestScope,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import type { User } from '@server/entity/User';
import type {
  DiscoverAlbumsResponse,
  DiscoverForYouResponse,
} from '@server/interfaces/api/discoverInterfaces';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import { makeUser } from '@server/test/requestFixtures';
import type { Express } from 'express';
import express from 'express';
import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import discoverRoutes, { forYouHooks, resetDiscoverCaches } from './discover';

const ARTIST_MBID = 'a0000000-0000-4000-8000-000000000001';
const CANDIDATE_MBID = 'c0000000-0000-4000-8000-000000000001';

let app: Express;
let viewer: User;

before(() => {
  getSettings().main.apiKey = 'test-api-key';
  app = express();
  app.use(express.json());
  app.use(checkUser);
  app.use('/discover', discoverRoutes);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
});

const as = (user: Pick<User, 'id'>) => {
  const headers = {
    'X-API-Key': getSettings().main.apiKey,
    'X-API-User': String(user.id),
  };
  return {
    get: (url: string) => request(app).get(url).set(headers),
  };
};

/** Insert a release group in the library with a given recency. */
const addAlbum = (
  mbid: string,
  title: string,
  mediaAddedAt: Date | null,
  status = MediaStatus.AVAILABLE
): Promise<Media> =>
  getRepository(Media).save(
    new Media({
      mediaType: MediaType.RELEASE_GROUP,
      mbid,
      artistMbid: ARTIST_MBID,
      title,
      artistName: 'Test Artist',
      primaryType: 'Album',
      status,
      trackCount: 10,
      tracksAvailable: status === MediaStatus.AVAILABLE ? 10 : 4,
      mediaAddedAt,
    })
  );

setupTestDb();

beforeEach(async () => {
  resetDiscoverCaches();
  viewer = await makeUser(
    'viewer',
    Permission.RECENT_VIEW | Permission.REQUEST | Permission.REQUEST_ALBUM
  );
});

describe('GET /discover/recently-added', () => {
  it('surfaces each album of a partly-filled discography request as it lands', async () => {
    // A discography (artist-scope) request, still in progress on the artist row.
    const artist = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.ARTIST,
        mbid: ARTIST_MBID,
        title: 'Test Artist',
        artistName: 'Test Artist',
        status: MediaStatus.PROCESSING,
        mediaAddedAt: new Date('2026-03-01T00:00:00Z'),
      })
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        media: artist,
        requestedBy: viewer,
        scope: RequestScope.DISCOGRAPHY,
        status: MediaRequestStatus.APPROVED,
        releaseCount: 3,
      })
    );

    // Two of its albums have landed so far, at different times.
    await addAlbum('b0000000-0000-4000-8000-000000000001', 'Early album', new Date('2026-01-01T00:00:00Z'));
    await addAlbum('b0000000-0000-4000-8000-000000000002', 'Later album', new Date('2026-02-01T00:00:00Z'));

    const res = await as(viewer).get('/discover/recently-added?take=20');
    assert.equal(res.status, 200);
    const body = res.body as DiscoverAlbumsResponse;
    assert.equal(body.enabled, true);

    // Both completed albums show, newest first; the artist row is not a result.
    assert.deepEqual(
      body.results.map((a) => a.title),
      ['Later album', 'Early album']
    );
    assert.ok(!body.results.some((a) => a.mbid === ARTIST_MBID));
  });

  it('still surfaces an available album that has no explicit mediaAddedAt', async () => {
    await addAlbum('b0000000-0000-4000-8000-000000000001', 'Dated early', new Date('2026-01-01T00:00:00Z'));
    await addAlbum('b0000000-0000-4000-8000-000000000002', 'Dated later', new Date('2026-02-01T00:00:00Z'));
    // Became available without a timestamp: it must not sort to the bottom and
    // fall off the window (SQLite orders NULLs last in DESC).
    await addAlbum('b0000000-0000-4000-8000-000000000003', 'No timestamp', null);

    const res = await as(viewer).get('/discover/recently-added?take=20');
    const body = res.body as DiscoverAlbumsResponse;
    assert.deepEqual(
      body.results.map((a) => a.title),
      ['No timestamp', 'Dated later', 'Dated early']
    );
  });

  it('is hidden for a viewer without RECENT_VIEW', async () => {
    const guest = await makeUser('guest', Permission.REQUEST);
    const res = await as(guest).get('/discover/recently-added');
    assert.equal(res.status, 200);
    assert.equal((res.body as DiscoverAlbumsResponse).enabled, false);
  });
});

describe('GET /discover/for-you', () => {
  it('recommends albums in the library’s top genres, excluding owned ones', async () => {
    // A held album gives the library a top artist (and a genre to draw from).
    await addAlbum('b0000000-0000-4000-8000-000000000001', 'Owned album', new Date('2026-01-01T00:00:00Z'));

    forYouHooks.artistGenres = async () => ['House', 'Techno'];
    forYouHooks.albumsByGenre = async (genre) => [
      // An album already in the library — must be filtered out.
      {
        mbid: 'b0000000-0000-4000-8000-000000000001',
        title: 'Owned album',
        artistMbid: ARTIST_MBID,
        artistName: 'Test Artist',
        coverUrl: null,
        status: MediaStatus.UNKNOWN,
      },
      // A fresh recommendation the library does not hold.
      {
        mbid: CANDIDATE_MBID,
        title: `New ${genre} album`,
        artistMbid: 'd0000000-0000-4000-8000-000000000001',
        artistName: 'Someone Else',
        coverUrl: null,
        status: MediaStatus.UNKNOWN,
      },
    ];

    const res = await as(viewer).get('/discover/for-you?take=20');
    assert.equal(res.status, 200);
    const body = res.body as DiscoverForYouResponse;
    assert.equal(body.enabled, true);
    assert.deepEqual(body.genres, ['house', 'techno']);
    assert.ok(body.results.some((a) => a.mbid === CANDIDATE_MBID));
    assert.ok(
      !body.results.some(
        (a) => a.mbid === 'b0000000-0000-4000-8000-000000000001'
      ),
      'owned albums are not recommended'
    );
    // Each candidate appears once even though every genre returns it.
    assert.equal(
      body.results.filter((a) => a.mbid === CANDIDATE_MBID).length,
      1
    );
  });

  it('is enabled with a reason when the library has no genres to draw from', async () => {
    forYouHooks.artistGenres = async () => [];
    forYouHooks.albumsByGenre = async () => [];

    const res = await as(viewer).get('/discover/for-you');
    assert.equal(res.status, 200);
    const body = res.body as DiscoverForYouResponse;
    assert.equal(body.enabled, true);
    assert.deepEqual(body.results, []);
    assert.deepEqual(body.genres, []);
    assert.ok(body.reason);
  });
});
