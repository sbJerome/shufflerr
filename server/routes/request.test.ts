// Request routes end to end against an in-process fake Lidarr: the approval
// lifecycle, the Lidarr hand-off (artist add / album monitor / AlbumSearch),
// visibility, counts, retry, cancel, and the download sync.
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
import downloadTracker from '@server/lib/downloadtracker';
import { Permission } from '@server/lib/permissions';
import { lidarrScanner } from '@server/lib/scanners/lidarr';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { flushRequestSideEffects } from '@server/subscriber/MediaRequestSubscriber';
import { setupTestDb } from '@server/test/db';
import { lidarrFixtures } from '@server/test/fakeLidarr';
import {
  ARTIST_MBID,
  MISSING_ALBUM_MBID,
  PARTIAL_ALBUM_MBID,
  ensureTestMedia,
  makeUser,
  setupRequestTests,
} from '@server/test/requestFixtures';
import type { Express } from 'express';
import express from 'express';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import request from 'supertest';
import requestRoutes from './request';
import serviceRoutes from './service';

let app: Express;

before(() => {
  app = express();
  app.use(express.json());
  app.use(checkUser);
  app.use('/request', requestRoutes);
  app.use('/service', serviceRoutes);
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

setupTestDb();
const ctx = setupRequestTests();

/** Act as a user through the API key (X-API-User), like a script would. */
const as = (user: Pick<User, 'id'>) => {
  const headers = {
    'X-API-Key': getSettings().main.apiKey,
    'X-API-User': String(user.id),
  };
  return {
    get: (url: string) => request(app).get(url).set(headers),
    post: (url: string, body?: object) =>
      request(app).post(url).set(headers).send(body),
    put: (url: string, body?: object) =>
      request(app).put(url).set(headers).send(body),
    delete: (url: string) => request(app).delete(url).set(headers),
  };
};

const albumBody = (mbid = MISSING_ALBUM_MBID) => ({
  mbid,
  mediaType: MediaType.RELEASE_GROUP,
  scope: RequestScope.ALBUM,
});

const names = () => ctx.notifications.map((n) => n.name);

describe('POST /request', () => {
  it('creates a pending request, notifies managers, and leaves Lidarr alone', async () => {
    const sam = await makeUser('sam', Permission.REQUEST);

    const res = await as(sam).post('/request', albumBody());
    await flushRequestSideEffects();

    assert.equal(res.status, 201);
    assert.equal(res.body.status, MediaRequestStatus.PENDING);
    assert.equal(res.body.lastChange, 'No changes yet');
    assert.equal(res.body.canRemove, true);
    assert.equal(res.body.canManage, false);
    assert.equal(res.body.profileName, 'Lossless');
    assert.equal(
      res.body.coverUrl,
      `/imageproxy/caa/release-group/${MISSING_ALBUM_MBID}/front-500`
    );
    assert.equal(res.body.requestedBy.password, undefined);

    assert.deepEqual(names(), ['MEDIA_PENDING']);
    assert.equal(ctx.notifications[0].payload.notifyAdmin, true);
    assert.equal(ctx.notifications[0].payload.notifyUser, undefined);
    assert.equal(ctx.lidarr.calls.length, 0);
  });

  it('dry run returns the outcome and never an engine error status', async () => {
    const sam = await makeUser('sam', Permission.REQUEST);
    const guest = await makeUser('guest', Permission.REQUEST_ALBUM);

    const pending = await as(sam).post('/request?dryRun=1', albumBody());
    assert.equal(pending.status, 200);
    assert.equal(pending.body.outcome, 'pending');

    const blocked = await as(guest).post('/request', {
      ...albumBody(PARTIAL_ALBUM_MBID),
      scope: RequestScope.TRACKS,
      dryRun: true,
    });
    assert.equal(blocked.status, 200);
    assert.deepEqual(blocked.body, {
      outcome: 'blocked',
      reason: "You don't have permission to request tracks.",
      code: 'permission',
    });

    assert.equal(await getRepository(MediaRequest).count(), 0);
  });

  it('maps engine errors to 403 / 409 / 400 with the user-facing copy', async () => {
    const sam = await makeUser('sam', Permission.REQUEST, {
      albumQuotaLimit: 1,
    });
    const guest = await makeUser('guest', Permission.REQUEST_TRACK);

    const forbidden = await as(guest).post('/request', albumBody());
    assert.equal(forbidden.status, 403);
    assert.equal(
      forbidden.body.message,
      "You don't have permission to request albums."
    );

    assert.equal((await as(sam).post('/request', albumBody())).status, 201);

    const duplicate = await as(guest).post('/request', {
      ...albumBody(),
      scope: RequestScope.TRACKS,
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.message, 'This has already been requested.');

    const quota = await as(sam).post('/request', albumBody(PARTIAL_ALBUM_MBID));
    assert.equal(quota.status, 403);
    assert.equal(
      quota.body.message,
      "You've used your weekly limit of 1 album."
    );

    const invalid = await as(sam).post('/request', { scope: 'album' });
    assert.equal(invalid.status, 400);
  });
});

describe('approve → Lidarr', () => {
  it('existing artist: monitors the album and starts an AlbumSearch', async () => {
    const sam = await makeUser('sam', Permission.REQUEST);
    const manager = await makeUser('manager', Permission.MANAGE_REQUESTS);

    const created = await as(sam).post('/request', albumBody());
    await flushRequestSideEffects();
    ctx.notifications.length = 0;

    const res = await as(manager).post(`/request/${created.body.id}/approve`);
    await flushRequestSideEffects();

    assert.equal(res.status, 200);
    assert.equal(res.body.status, MediaRequestStatus.APPROVED);
    assert.equal(res.body.lastChange, 'Approved by manager');
    assert.equal(res.body.isAutoApproved, false);

    const lidarrAlbum = ctx.lidarr.albums.find(
      (a) => a.foreignAlbumId === MISSING_ALBUM_MBID
    );
    assert.equal(lidarrAlbum?.monitored, true);
    assert.equal(ctx.lidarr.callsTo('POST', '/artist').length, 0);
    assert.deepEqual(
      ctx.lidarr.callsTo('PUT', '/album/monitor').map((c) => c.body),
      [{ albumIds: [lidarrAlbum?.id], monitored: true }]
    );
    assert.deepEqual(
      ctx.lidarr.commands('AlbumSearch').map((c) => c.body.albumIds),
      [[lidarrAlbum?.id]]
    );

    const media = await getRepository(Media).findOneByOrFail({
      mbid: MISSING_ALBUM_MBID,
    });
    assert.equal(media.status, MediaStatus.PROCESSING);
    assert.equal(media.lidarrAlbumId, lidarrAlbum?.id);
    assert.equal(media.lidarrArtistId, 5);
    assert.equal(media.lidarrServerId, 0);
    assert.equal(media.lidarrAddedByShufflerr, true);

    assert.deepEqual(names(), ['MEDIA_APPROVED']);
    assert.equal(ctx.notifications[0].payload.notifyUser?.id, sam.id);
  });

  it('new artist: looks it up by MBID, adds it unmonitored-by-default, then monitors and searches the album', async () => {
    const newArtist = lidarrFixtures.newArtist();
    const newAlbum = lidarrFixtures.newAlbum();
    ctx.lidarr.artists = [];
    ctx.lidarr.albums = [];
    ctx.lidarr.lookupArtists = [newArtist];
    ctx.lidarr.albumsOnArtistAdd = [newAlbum];

    await getRepository(Media).save(
      new Media({
        mbid: newAlbum.foreignAlbumId,
        mediaType: MediaType.RELEASE_GROUP,
        title: newAlbum.title,
        artistMbid: newArtist.foreignArtistId,
        artistName: newArtist.artistName,
        trackCount: 14,
        tracksAvailable: 0,
        status: MediaStatus.UNKNOWN,
      })
    );

    const auto = await makeUser(
      'auto',
      Permission.REQUEST | Permission.AUTO_APPROVE
    );
    const res = await as(auto).post('/request', {
      ...albumBody(newAlbum.foreignAlbumId),
      monitorFuture: true,
    });
    await flushRequestSideEffects();

    assert.equal(res.status, 201);
    assert.equal(res.body.lastChange, 'Approved automatically');

    const lookups = ctx.lidarr.callsTo('GET', '/artist/lookup');
    assert.equal(lookups[0].query.term, `lidarr:${newArtist.foreignArtistId}`);

    const [add] = ctx.lidarr.callsTo('POST', '/artist');
    assert.equal(add.body.foreignArtistId, newArtist.foreignArtistId);
    assert.equal(add.body.qualityProfileId, 2);
    assert.equal(add.body.metadataProfileId, 1);
    assert.equal(add.body.rootFolderPath, '/music');
    assert.equal(add.body.monitored, true);
    assert.equal(add.body.monitorNewItems, 'all');
    assert.deepEqual(add.body.addOptions, {
      monitor: 'none',
      searchForMissingAlbums: false,
    });

    const album = ctx.lidarr.albums[0];
    assert.equal(album.monitored, true);
    assert.deepEqual(
      ctx.lidarr.commands('AlbumSearch').map((c) => c.body.albumIds),
      [[album.id]]
    );

    const saved = await getRepository(MediaRequest).findOneByOrFail({
      id: res.body.id,
    });
    assert.equal(saved.status, MediaRequestStatus.APPROVED);
    assert.equal(saved.media.lidarrAddedByShufflerr, true);
    assert.deepEqual(names(), ['MEDIA_AUTO_APPROVED']);
  });

  it('album missing from the artist in Lidarr: adds the album from a lookup', async () => {
    const newAlbum = lidarrFixtures.newAlbum();
    ctx.lidarr.albums = [];
    ctx.lidarr.lookupAlbums = [newAlbum];

    await getRepository(Media).save(
      new Media({
        mbid: newAlbum.foreignAlbumId,
        mediaType: MediaType.RELEASE_GROUP,
        title: newAlbum.title,
        artistMbid: ARTIST_MBID,
        artistName: 'Test Artist',
        status: MediaStatus.UNKNOWN,
      })
    );

    const admin = await makeUser('boss', Permission.ADMIN);
    const res = await as(admin).post(
      '/request',
      albumBody(newAlbum.foreignAlbumId)
    );
    await flushRequestSideEffects();

    assert.equal(res.status, 201);
    const [add] = ctx.lidarr.callsTo('POST', '/album');
    assert.equal(add.body.foreignAlbumId, newAlbum.foreignAlbumId);
    assert.equal(add.body.artistId, 5);
    assert.equal(add.body.monitored, true);
    assert.equal(ctx.lidarr.commands('AlbumSearch').length, 1);
  });

  it('"Enable automatic search" off: monitors but does not search', async () => {
    getSettings().lidarr = [ctx.lidarr.settings({ preventSearch: true })];
    const admin = await makeUser('boss', Permission.ADMIN);

    await as(admin).post('/request', albumBody());
    await flushRequestSideEffects();

    assert.equal(ctx.lidarr.callsTo('PUT', '/album/monitor').length, 1);
    assert.equal(ctx.lidarr.callsTo('POST', '/command').length, 0);
  });

  it('discography: monitors every album of the artist and starts an ArtistSearch', async () => {
    const admin = await makeUser('boss', Permission.ADMIN);

    const res = await as(admin).post('/request', {
      mbid: ARTIST_MBID,
      mediaType: MediaType.ARTIST,
      scope: RequestScope.DISCOGRAPHY,
      monitorFuture: true,
    });
    await flushRequestSideEffects();

    assert.equal(res.status, 201);
    assert.equal(res.body.releaseCount, 8);
    assert.ok(ctx.lidarr.albums.every((a) => a.monitored));
    assert.deepEqual(
      ctx.lidarr.commands('ArtistSearch').map((c) => c.body.artistId),
      [5]
    );
    assert.equal(ctx.lidarr.artists[0].monitorNewItems, 'all');

    const media = await getRepository(Media).findOneByOrFail({
      mbid: ARTIST_MBID,
    });
    assert.equal(media.lidarrArtistId, 5);
  });

  it('a Lidarr error fails the request with a readable reason and notifies', async () => {
    ctx.lidarr.failWith = 500;
    const admin = await makeUser('boss', Permission.ADMIN);

    const res = await as(admin).post('/request', albumBody());
    await flushRequestSideEffects();

    const saved = await getRepository(MediaRequest).findOneByOrFail({
      id: res.body.id,
    });
    assert.equal(saved.status, MediaRequestStatus.FAILED);
    assert.match(
      saved.failureReason ?? '',
      /^Lidarr \(lidarr-test\) refused the request \(HTTP 500\)/
    );
    assert.deepEqual(names(), ['MEDIA_AUTO_APPROVED', 'MEDIA_FAILED']);
    assert.equal(
      (await getRepository(Media).findOneByOrFail({ id: saved.media.id }))
        .status,
      MediaStatus.UNKNOWN
    );

    const list = await as(admin).get('/request?filter=failed');
    assert.equal(list.body.results[0].lastChange, 'Failed after approval');
  });

  it('no Lidarr server configured: fails with setup instructions', async () => {
    getSettings().lidarr = [];
    const admin = await makeUser('boss', Permission.ADMIN);

    const res = await as(admin).post('/request', albumBody());
    await flushRequestSideEffects();

    const saved = await getRepository(MediaRequest).findOneByOrFail({
      id: res.body.id,
    });
    assert.equal(saved.status, MediaRequestStatus.FAILED);
    assert.equal(
      saved.failureReason,
      'No Lidarr server is set up. Add one in Settings → Lidarr, then retry.'
    );
  });

  it('retry: only failed requests; re-sends to Lidarr without a second approval notice', async () => {
    ctx.lidarr.failWith = 503;
    const admin = await makeUser('boss', Permission.ADMIN);
    const sam = await makeUser('sam', Permission.REQUEST);

    const created = await as(admin).post('/request', albumBody());
    await flushRequestSideEffects();

    assert.equal(
      (await as(sam).post(`/request/${created.body.id}/retry`)).status,
      403
    );

    ctx.lidarr.failWith = undefined;
    ctx.lidarr.calls = [];
    ctx.notifications.length = 0;

    const retried = await as(admin).post(`/request/${created.body.id}/retry`);
    await flushRequestSideEffects();

    assert.equal(retried.status, 200);
    assert.equal(retried.body.status, MediaRequestStatus.APPROVED);
    assert.equal(retried.body.failureReason, null);
    assert.equal(ctx.lidarr.commands('AlbumSearch').length, 1);
    assert.deepEqual(names(), []);

    const again = await as(admin).post(`/request/${created.body.id}/retry`);
    assert.equal(again.status, 400);
    assert.equal(again.body.message, 'Only failed requests can be retried.');
  });
});

describe('POST /request/:id/:status', () => {
  it('needs MANAGE_REQUESTS and only works on pending requests', async () => {
    const sam = await makeUser('sam', Permission.REQUEST);
    const manager = await makeUser('manager', Permission.MANAGE_REQUESTS);
    const created = await as(sam).post('/request', albumBody());

    const forbidden = await as(sam).post(`/request/${created.body.id}/approve`);
    assert.equal(forbidden.status, 403);
    assert.equal(
      forbidden.body.message,
      "You don't have permission to manage requests."
    );

    assert.equal(
      (await as(manager).post(`/request/${created.body.id}/approve`)).status,
      200
    );
    await flushRequestSideEffects();

    const twice = await as(manager).post(`/request/${created.body.id}/decline`);
    assert.equal(twice.status, 400);
    assert.equal(
      twice.body.message,
      'Only pending requests can be approved or declined.'
    );

    assert.equal(
      (await as(manager).post(`/request/${created.body.id}/available`)).status,
      400
    );
    assert.equal((await as(manager).post('/request/9999/approve')).status, 404);
  });

  it('decline stores the reason, notifies the requester and puts the album back', async () => {
    const sam = await makeUser('sam', Permission.REQUEST);
    const manager = await makeUser('manager', Permission.MANAGE_REQUESTS);
    const created = await as(sam).post('/request', {
      ...albumBody(PARTIAL_ALBUM_MBID),
      scope: RequestScope.TRACKS,
    });
    await flushRequestSideEffects();
    ctx.notifications.length = 0;

    const res = await as(manager).post(`/request/${created.body.id}/decline`, {
      declineReason: 'Already on the way from another source.',
    });
    await flushRequestSideEffects();

    assert.equal(res.status, 200);
    assert.equal(res.body.status, MediaRequestStatus.DECLINED);
    assert.equal(res.body.lastChange, 'Declined by manager');
    assert.equal(
      res.body.declineReason,
      'Already on the way from another source.'
    );
    assert.deepEqual(names(), ['MEDIA_DECLINED']);
    assert.equal(ctx.notifications[0].payload.notifyUser?.id, sam.id);
    assert.equal(ctx.lidarr.calls.length, 0);

    const media = await getRepository(Media).findOneByOrFail({
      mbid: PARTIAL_ALBUM_MBID,
    });
    assert.equal(media.status, MediaStatus.PARTIALLY_AVAILABLE);
  });
});

describe('GET /request and /request/count', () => {
  it('shows only your own requests without REQUEST_VIEW or MANAGE_REQUESTS', async () => {
    const sam = await makeUser('sam', Permission.REQUEST);
    const maya = await makeUser('maya', Permission.REQUEST);
    const viewer = await makeUser(
      'viewer',
      Permission.REQUEST | Permission.REQUEST_VIEW
    );
    const manager = await makeUser('manager', Permission.MANAGE_REQUESTS);

    const samRequest = await as(sam).post('/request', albumBody());
    await as(maya).post('/request', albumBody(PARTIAL_ALBUM_MBID));
    await flushRequestSideEffects();

    const own = await as(sam).get('/request');
    assert.equal(own.status, 200);
    assert.equal(own.body.pageInfo.results, 1);
    assert.equal(own.body.results[0].requestedBy.id, sam.id);
    assert.deepEqual(own.body.serviceErrors, { lidarr: [] });

    assert.equal((await as(viewer).get('/request')).body.pageInfo.results, 2);
    assert.equal(
      (await as(manager).get(`/request?requestedBy=${maya.id}`)).body.pageInfo
        .results,
      1
    );
    assert.equal(
      (await as(sam).get(`/request?requestedBy=${maya.id}`)).status,
      403
    );

    assert.equal(
      (await as(maya).get(`/request/${samRequest.body.id}`)).status,
      403
    );
    const seen = await as(viewer).get(`/request/${samRequest.body.id}`);
    assert.equal(seen.status, 200);
    assert.equal(seen.body.canRemove, false);

    assert.equal((await as(sam).get('/request/count')).body.pending, 1);
    assert.equal((await as(manager).get('/request/count')).body.pending, 2);
  });

  it('filters by status and scope, sorts, pages and counts', async () => {
    const admin = await makeUser('boss', Permission.ADMIN);
    const sam = await makeUser('sam', Permission.REQUEST);

    await as(sam).post('/request', albumBody());
    await as(admin).post('/request', {
      ...albumBody(PARTIAL_ALBUM_MBID),
      scope: RequestScope.TRACKS,
    });
    await flushRequestSideEffects();

    const waiting = await as(admin).get('/request?filter=pending');
    assert.deepEqual(
      waiting.body.results.map((r: MediaRequest) => r.scope),
      ['album']
    );
    const downloading = await as(admin).get('/request?filter=processing');
    assert.deepEqual(
      downloading.body.results.map((r: MediaRequest) => r.scope),
      ['tracks']
    );
    assert.equal(
      (await as(admin).get('/request?scope=tracks')).body.pageInfo.results,
      1
    );

    const paged = await as(admin).get(
      '/request?take=1&skip=1&sort=added&sortDirection=asc'
    );
    assert.equal(paged.body.pageInfo.pages, 2);
    assert.equal(paged.body.pageInfo.page, 2);
    assert.equal(paged.body.results[0].scope, 'tracks');

    assert.deepEqual((await as(admin).get('/request/count')).body, {
      total: 2,
      pending: 1,
      approved: 1,
      processing: 1,
      available: 0,
      declined: 0,
      failed: 0,
      album: 1,
      tracks: 1,
      discography: 0,
    });
  });
});

describe('DELETE and PUT /request/:id', () => {
  it('requesters cancel their own pending request; managers remove any', async () => {
    const sam = await makeUser('sam', Permission.REQUEST);
    const maya = await makeUser('maya', Permission.REQUEST);
    const manager = await makeUser('manager', Permission.MANAGE_REQUESTS);

    const created = await as(sam).post('/request', albumBody());
    assert.equal(
      (await as(maya).delete(`/request/${created.body.id}`)).status,
      403
    );
    assert.equal(
      (await as(sam).delete(`/request/${created.body.id}`)).status,
      204
    );
    assert.equal(
      (await getRepository(Media).findOneByOrFail({ mbid: MISSING_ALBUM_MBID }))
        .status,
      MediaStatus.UNKNOWN
    );

    const second = await as(sam).post('/request', albumBody());
    await as(manager).post(`/request/${second.body.id}/approve`);
    await flushRequestSideEffects();

    const own = await as(sam).delete(`/request/${second.body.id}`);
    assert.equal(own.status, 403);
    assert.match(own.body.message, /while it waits for approval/);

    ctx.lidarr.calls = [];
    assert.equal(
      (await as(manager).delete(`/request/${second.body.id}`)).status,
      204
    );
    // Shufflerr switched monitoring on for this album, so it switches it off again.
    assert.deepEqual(
      ctx.lidarr.callsTo('PUT', '/album/monitor').map((c) => c.body.monitored),
      [false]
    );
  });

  it('requesters may change their pending track selection; managers the routing', async () => {
    const sam = await makeUser('sam', Permission.REQUEST);
    const manager = await makeUser('manager', Permission.MANAGE_REQUESTS);

    const created = await as(sam).post('/request', {
      ...albumBody(PARTIAL_ALBUM_MBID),
      scope: RequestScope.TRACKS,
    });
    assert.equal(created.body.trackCount, 4);

    const toAlbum = await as(sam).put(`/request/${created.body.id}`, {
      scope: RequestScope.ALBUM,
      serverId: 3,
    });
    assert.equal(toAlbum.status, 200);
    assert.equal(toAlbum.body.scope, 'album');
    assert.equal(toAlbum.body.trackCount, 0);
    assert.equal(toAlbum.body.serverId, null);

    const routed = await as(manager).put(`/request/${created.body.id}`, {
      qualityProfileId: 1,
      rootFolder: '/music/archive',
    });
    assert.equal(routed.body.qualityProfileId, 1);
    assert.equal(routed.body.rootFolder, '/music/archive');
    assert.equal(routed.body.profileName, 'Any');

    const invalid = await as(manager).put(`/request/${created.body.id}`, {
      scope: RequestScope.DISCOGRAPHY,
    });
    assert.equal(invalid.status, 400);
  });
});

describe('GET /service/lidarr', () => {
  it('lists servers without secrets and loads profiles for the request modal', async () => {
    const sam = await makeUser('sam', Permission.REQUEST);

    const list = await as(sam).get('/service/lidarr');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body, [
      {
        id: 0,
        name: 'lidarr-test',
        isHiRes: false,
        isDefault: true,
        activeQualityProfileId: 2,
        activeMetadataProfileId: 1,
        activeDirectory: '/music',
        activeTags: [],
      },
    ]);
    assert.ok(!JSON.stringify(list.body).includes('test-lidarr-key'));

    const details = await as(sam).get('/service/lidarr/0');
    assert.equal(details.status, 200);
    assert.deepEqual(
      details.body.profiles.map((p: { name: string }) => p.name),
      ['Any', 'Lossless']
    );
    assert.deepEqual(
      details.body.metadataProfiles.map((p: { name: string }) => p.name),
      ['Standard', 'None']
    );
    assert.equal(details.body.rootFolders[0].path, '/music');

    assert.equal((await as(sam).get('/service/lidarr/7')).status, 404);
  });
});

describe('download sync', () => {
  it('writes queue progress onto approved requests and exposes it per album', async () => {
    const admin = await makeUser('boss', Permission.ADMIN);
    const created = await as(admin).post('/request', albumBody());
    await flushRequestSideEffects();

    const albumId = ctx.lidarr.albums.find(
      (a) => a.foreignAlbumId === MISSING_ALBUM_MBID
    )?.id as number;
    ctx.lidarr.queue = [
      {
        id: 1,
        artistId: 5,
        albumId,
        title: 'Test Artist - Missing Album',
        size: 1000,
        sizeleft: 250,
        status: 'downloading',
        trackedDownloadState: 'downloading',
        timeleft: '00:01:00',
      },
    ];

    await downloadTracker.updateDownloads();

    const saved = await getRepository(MediaRequest).findOneByOrFail({
      id: created.body.id,
    });
    assert.equal(saved.downloadProgress, 75);
    assert.equal(saved.status, MediaRequestStatus.APPROVED);
    assert.equal(downloadTracker.getDownloadingCount(), 1);
    assert.equal(downloadTracker.getMusicProgress(0, albumId)[0].progress, 75);

    const listed = await as(admin).get('/request');
    assert.equal(listed.body.results[0].media.downloadStatus[0].sizeLeft, 250);

    downloadTracker.resetDownloadTracker();
    assert.equal(downloadTracker.getDownloadingCount(), 0);
  });

  it('a failed import turns the request into FAILED with Lidarr’s reason', async () => {
    const admin = await makeUser('boss', Permission.ADMIN);
    const created = await as(admin).post('/request', albumBody());
    await flushRequestSideEffects();
    ctx.notifications.length = 0;

    const albumId = ctx.lidarr.albums.find(
      (a) => a.foreignAlbumId === MISSING_ALBUM_MBID
    )?.id as number;
    // A real importFailed record, pointed at this album.
    ctx.lidarr.queue = [{ ...lidarrFixtures.queue().records[0], albumId }];

    await downloadTracker.updateDownloads();
    await flushRequestSideEffects();

    const saved = await getRepository(MediaRequest).findOneByOrFail({
      id: created.body.id,
    });
    assert.equal(saved.status, MediaRequestStatus.FAILED);
    assert.match(
      saved.failureReason ?? '',
      /^Lidarr downloaded it but couldn't import the files/
    );
    assert.deepEqual(names(), ['MEDIA_FAILED']);
    downloadTracker.resetDownloadTracker();
  });
});

describe('Lidarr scan', () => {
  it('links existing Media rows to Lidarr and creates rows for monitored albums', async () => {
    const existing = await ensureTestMedia(
      PARTIAL_ALBUM_MBID,
      MediaType.RELEASE_GROUP
    );
    ctx.lidarr.albums[1].monitored = true; // MISSING_ALBUM_MBID
    // A library source is on, so Lidarr's file counts must not decide availability.
    getSettings().localFiles.enabled = true;
    getSettings().localFiles.folders = ['/music'];

    try {
      await lidarrScanner.run();
    } finally {
      getSettings().localFiles.enabled = false;
      getSettings().localFiles.folders = [];
    }

    const mediaRepository = getRepository(Media);
    const artist = await mediaRepository.findOneByOrFail({ mbid: ARTIST_MBID });
    assert.equal(artist.mediaType, MediaType.ARTIST);
    assert.equal(artist.lidarrArtistId, 5);

    const partial = await mediaRepository.findOneByOrFail({ id: existing.id });
    assert.equal(partial.lidarrAlbumId, 200);
    assert.equal(partial.lidarrServerId, 0);
    assert.equal(partial.tracksAvailable, 9);
    assert.equal(partial.status, MediaStatus.PARTIALLY_AVAILABLE);
    assert.equal(partial.title, 'Partial Album');

    const monitored = await mediaRepository.findOneByOrFail({
      mbid: MISSING_ALBUM_MBID,
    });
    assert.equal(monitored.lidarrAlbumId, 201);
    assert.equal(monitored.artistMbid, ARTIST_MBID);
    assert.equal(monitored.status, MediaStatus.UNKNOWN);

    const status = lidarrScanner.status();
    assert.equal(status.running, false);
    assert.equal(status.total, 1);
    assert.equal(status.albums, 3);
  });
});
