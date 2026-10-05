// The request engine, branch by branch, in the order of checks fixed by
// docs/PERMISSIONS_AND_APPROVALS.md (plus its minimum test matrix).
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
  RequestScope,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { Blocklist } from '@server/entity/Blocklist';
import Media from '@server/entity/Media';
import {
  BlocklistedMediaError,
  DuplicateMediaRequestError,
  MediaRequest,
  QuotaRestrictedError,
  RequestPermissionError,
  RequestValidationError,
} from '@server/entity/MediaRequest';
import Track from '@server/entity/Track';
import { User } from '@server/entity/User';
import type { MediaRequestBody } from '@server/interfaces/api/requestInterfaces';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { flushRequestSideEffects } from '@server/subscriber/MediaRequestSubscriber';
import { setupTestDb } from '@server/test/db';
import {
  ARTIST_MBID,
  AVAILABLE_ALBUM_MBID,
  MISSING_ALBUM_MBID,
  PARTIAL_ALBUM_MBID,
  ensureTestMedia,
  makeUser,
  recordingMbid,
  setupRequestTests,
  useAlbumQuota,
} from '@server/test/requestFixtures';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

setupTestDb();
const ctx = setupRequestTests();

const album = (mbid = MISSING_ALBUM_MBID): MediaRequestBody => ({
  mbid,
  mediaType: MediaType.RELEASE_GROUP,
  scope: RequestScope.ALBUM,
});
const tracks = (
  mbid = PARTIAL_ALBUM_MBID,
  trackMbids?: string[]
): MediaRequestBody => ({
  mbid,
  mediaType: MediaType.RELEASE_GROUP,
  scope: RequestScope.TRACKS,
  trackMbids,
});
const discography = (releaseCount?: number): MediaRequestBody => ({
  mbid: ARTIST_MBID,
  mediaType: MediaType.ARTIST,
  scope: RequestScope.DISCOGRAPHY,
  releaseCount,
});

const owner = () =>
  getRepository(User).findOneOrFail({
    where: { email: 'admin@shufflerr.test' },
  });

const dryRun = (body: MediaRequestBody, user: User) =>
  MediaRequest.request({ ...body, dryRun: true }, user);

describe('MediaRequest.request — test matrix', () => {
  it('owner (ADMIN): every scope is approved automatically, discography too with review on', async () => {
    const user = await owner();
    assert.equal(getSettings().main.discographyAlwaysReview, true);

    for (const body of [album(), tracks(), discography()]) {
      const request = await MediaRequest.request(body, user);
      assert.equal(request.status, MediaRequestStatus.APPROVED, body.scope);
      assert.equal(request.isAutoApproved, true);
      assert.equal(request.modifiedBy?.id, user.id);
      await flushRequestSideEffects();
    }
  });

  it('maya (REQUEST + AUTO_APPROVE_TRACK): 4 tracks → auto', async () => {
    const maya = await makeUser(
      'maya',
      Permission.REQUEST | Permission.AUTO_APPROVE_TRACK
    );
    const request = await MediaRequest.request(tracks(), maya);

    assert.equal(request.status, MediaRequestStatus.APPROVED);
    assert.equal(request.isAutoApproved, true);
    assert.equal(request.trackCount, 4);
    assert.equal(request.tracks.length, 4);
    assert.deepEqual(
      request.tracks.map((tr) => tr.track.position),
      ['10', '11', '12', '13']
    );
    assert.equal(request.tracks[0].status, MediaRequestStatus.APPROVED);
  });

  it('maya: album → pending', async () => {
    const maya = await makeUser(
      'maya',
      Permission.REQUEST | Permission.AUTO_APPROVE_TRACK
    );
    const request = await MediaRequest.request(album(), maya);

    assert.equal(request.status, MediaRequestStatus.PENDING);
    assert.equal(request.isAutoApproved, false);
    assert.equal(request.modifiedBy, null);

    const media = await getRepository(Media).findOneByOrFail({
      mbid: MISSING_ALBUM_MBID,
    });
    assert.equal(media.status, MediaStatus.PENDING);
  });

  it('maya: discography of 8 with 7 albums left → blocked by quota', async () => {
    const maya = await makeUser(
      'maya',
      Permission.REQUEST | Permission.AUTO_APPROVE_TRACK
    );
    await useAlbumQuota(maya, 3);

    await assert.rejects(
      MediaRequest.request(discography(), maya),
      (e: Error) =>
        e instanceof QuotaRestrictedError &&
        e.message ===
          'A discography counts each release against your album limit. You have 7 left.'
    );
    assert.deepEqual(await dryRun(discography(), maya), {
      outcome: 'blocked',
      reason:
        'A discography counts each release against your album limit. You have 7 left.',
      code: 'quota',
    });
  });

  it('sam (REQUEST, limit 3 albums, 3 used): album → blocked by quota', async () => {
    const sam = await makeUser('sam', Permission.REQUEST, {
      albumQuotaLimit: 3,
    });
    await useAlbumQuota(sam, 3);

    await assert.rejects(
      MediaRequest.request(album(), sam),
      (e: Error) =>
        e instanceof QuotaRestrictedError &&
        e.message === "You've used your weekly limit of 3 albums."
    );
  });

  it('dre (REQUEST + AUTO_APPROVE + REQUEST_VIEW): discography pending with review on, auto with review off', async () => {
    const dre = await makeUser(
      'dre',
      Permission.REQUEST | Permission.AUTO_APPROVE | Permission.REQUEST_VIEW
    );

    assert.equal((await dryRun(discography(), dre)).outcome, 'pending');

    getSettings().main.discographyAlwaysReview = false;
    const result = await dryRun(discography(), dre);
    assert.equal(result.outcome, 'auto');
    assert.equal(result.releaseCount, 8);
  });

  it('guest (REQUEST_ALBUM only): tracks → blocked by permission', async () => {
    const guest = await makeUser('guest', Permission.REQUEST_ALBUM);

    await assert.rejects(
      MediaRequest.request(tracks(), guest),
      (e: Error) =>
        e instanceof RequestPermissionError &&
        e.message === "You don't have permission to request tracks."
    );
    assert.equal((await dryRun(album(), guest)).outcome, 'pending');
    await assert.rejects(
      MediaRequest.request(discography(), guest),
      /permission to request discographies/
    );
  });

  it('anyone: a duplicate active request → blocked', async () => {
    const sam = await makeUser('sam', Permission.REQUEST);
    const maya = await makeUser('maya', Permission.REQUEST);
    await MediaRequest.request(album(), sam);

    await assert.rejects(
      MediaRequest.request(album(), maya),
      (e: Error) =>
        e instanceof DuplicateMediaRequestError &&
        e.message === 'This has already been requested.'
    );
    assert.deepEqual(await dryRun(album(), maya), {
      outcome: 'blocked',
      reason: 'This has already been requested.',
      code: 'duplicate',
    });
  });

  it('manager with a limit (MANAGE_REQUESTS): album with ignoreQuota → allowed past the limit', async () => {
    const manager = await makeUser(
      'manager',
      Permission.REQUEST | Permission.MANAGE_REQUESTS,
      { albumQuotaLimit: 1 }
    );
    await useAlbumQuota(manager, 1);

    await assert.rejects(
      MediaRequest.request(album(), manager),
      QuotaRestrictedError
    );

    const request = await MediaRequest.request(
      { ...album(), ignoreQuota: true },
      manager
    );
    assert.equal(request.ignoreQuota, true);
    assert.equal(request.status, MediaRequestStatus.PENDING);

    // …and it doesn't count against the limit afterwards
    const quota = await manager.getQuota();
    assert.equal(quota.album.used, 1);
  });

  it('user (REQUEST): album with ignoreQuota → RequestPermissionError', async () => {
    const user = await makeUser('user', Permission.REQUEST);

    await assert.rejects(
      MediaRequest.request({ ...album(), ignoreQuota: true }, user),
      (e: Error) =>
        e instanceof RequestPermissionError &&
        e.message === "You don't have permission to go over request limits."
    );
  });
});

describe('MediaRequest.request — engine branches', () => {
  it('1. acting user: userId needs MANAGE_USERS or MANAGE_REQUESTS', async () => {
    const sam = await makeUser('sam', Permission.REQUEST);
    const maya = await makeUser('maya', Permission.REQUEST);
    const manager = await makeUser('manager', Permission.MANAGE_REQUESTS);

    await assert.rejects(
      MediaRequest.request({ ...album(), userId: maya.id }, sam),
      (e: Error) =>
        e instanceof RequestPermissionError &&
        e.message === "You don't have permission to request for someone else."
    );

    // your own id is not "someone else"
    assert.equal(
      (await dryRun({ ...album(), userId: sam.id }, sam)).outcome,
      'pending'
    );

    const request = await MediaRequest.request(
      { ...album(), userId: maya.id },
      manager
    );
    assert.equal(request.requestedBy.id, maya.id);
    // the requester's permissions decide the outcome, not the manager's
    assert.equal(request.status, MediaRequestStatus.PENDING);
  });

  it('1. acting user: the target user must be allowed to request', async () => {
    const manager = await makeUser('manager', Permission.MANAGE_USERS);
    const nobody = await makeUser('nobody', Permission.NONE);

    await assert.rejects(
      MediaRequest.request({ ...album(), userId: nobody.id }, manager),
      /permission to request albums/
    );
  });

  it('2. advanced fields are silently dropped without REQUEST_ADVANCED', async () => {
    const plain = await makeUser('plain', Permission.REQUEST);
    const advanced = await makeUser(
      'advanced',
      Permission.REQUEST | Permission.REQUEST_ADVANCED
    );
    const fields = {
      serverId: 0,
      qualityProfileId: 1,
      metadataProfileId: 2,
      rootFolder: '/music/other',
    };

    const dropped = await MediaRequest.request(
      { ...album(), ...fields },
      plain
    );
    assert.equal(dropped.serverId, null);
    assert.equal(dropped.qualityProfileId, null);
    assert.equal(dropped.metadataProfileId, null);
    assert.equal(dropped.rootFolder, null);

    const kept = await MediaRequest.request(
      { ...album(PARTIAL_ALBUM_MBID), ...fields },
      advanced
    );
    assert.equal(kept.serverId, 0);
    assert.equal(kept.qualityProfileId, 1);
    assert.equal(kept.metadataProfileId, 2);
    assert.equal(kept.rootFolder, '/music/other');
  });

  it('2. track requests can be switched off for everyone', async () => {
    const user = await makeUser('user', Permission.REQUEST);
    getSettings().main.allowTrackRequests = false;

    await assert.rejects(
      MediaRequest.request(tracks(), user),
      (e: Error) =>
        e instanceof RequestPermissionError &&
        e.message ===
          'Track requests are turned off. Request the whole album instead.'
    );
  });

  it('3. quota: tracks over the remaining track limit are blocked', async () => {
    const user = await makeUser('user', Permission.REQUEST, {
      trackQuotaLimit: 3,
    });

    await assert.rejects(
      MediaRequest.request(tracks(), user),
      (e: Error) =>
        e instanceof QuotaRestrictedError &&
        e.message === "That's more tracks than your limit allows (3 left)."
    );

    const request = await MediaRequest.request(
      tracks(PARTIAL_ALBUM_MBID, [
        recordingMbid(PARTIAL_ALBUM_MBID, 10),
        recordingMbid(PARTIAL_ALBUM_MBID, 11),
      ]),
      user
    );
    assert.equal(request.trackCount, 2);
    assert.equal((await user.getQuota()).track.remaining, 1);
  });

  it('3. quota: MANAGE_USERS bypasses limits; declined requests give quota back', async () => {
    const admin = await makeUser(
      'usermanager',
      Permission.REQUEST | Permission.MANAGE_USERS,
      { albumQuotaLimit: 1 }
    );
    await useAlbumQuota(admin, 4);
    assert.equal((await dryRun(album(), admin)).outcome, 'pending');

    const sam = await makeUser('sam', Permission.REQUEST, {
      albumQuotaLimit: 2,
    });
    await useAlbumQuota(sam, 2, MediaRequestStatus.DECLINED);
    assert.equal((await dryRun(album(), sam)).outcome, 'pending');
  });

  it('3. quota comes before the duplicate check', async () => {
    const sam = await makeUser('sam', Permission.REQUEST, {
      albumQuotaLimit: 1,
    });
    const maya = await makeUser('maya', Permission.REQUEST);
    await MediaRequest.request(album(), maya);
    await useAlbumQuota(sam, 1);

    const result = await dryRun(album(), sam);
    assert.equal(result.code, 'quota');
  });

  it('4. blocklisted albums and artists cannot be requested', async () => {
    const user = await makeUser('user', Permission.REQUEST);
    const admin = await owner();

    await Blocklist.addToBlocklist({
      blocklistRequest: {
        mbid: ARTIST_MBID,
        mediaType: MediaType.ARTIST,
        title: 'Test Artist',
        user: admin,
      },
    });

    await assert.rejects(
      MediaRequest.request(album(), user),
      (e: Error) =>
        e instanceof BlocklistedMediaError &&
        e.message === "This has been blocked, so it can't be requested."
    );
    assert.equal((await dryRun(discography(), user)).code, 'blocklisted');
  });

  it('5. duplicates are per track: covered tracks are dropped, none left → duplicate', async () => {
    const sam = await makeUser('sam', Permission.REQUEST);
    const maya = await makeUser('maya', Permission.REQUEST);

    const first = await MediaRequest.request(
      tracks(PARTIAL_ALBUM_MBID, [
        recordingMbid(PARTIAL_ALBUM_MBID, 10),
        recordingMbid(PARTIAL_ALBUM_MBID, 11),
      ]),
      sam
    );
    assert.equal(first.trackCount, 2);

    // "all missing" now only covers what nobody asked for yet
    const second = await MediaRequest.request(tracks(), maya);
    assert.deepEqual(
      second.tracks.map((tr) => tr.track.position),
      ['12', '13']
    );

    await assert.rejects(
      MediaRequest.request(tracks(), sam),
      (e: Error) =>
        e instanceof DuplicateMediaRequestError &&
        e.message === 'This has already been requested.'
    );
  });

  it('5. an active album or discography request covers track and album requests', async () => {
    const sam = await makeUser('sam', Permission.REQUEST);
    const maya = await makeUser('maya', Permission.REQUEST);
    getSettings().main.defaultQuotas.album.quotaLimit = 0;

    await MediaRequest.request(album(PARTIAL_ALBUM_MBID), sam);
    assert.equal((await dryRun(tracks(), maya)).code, 'duplicate');

    await MediaRequest.request(discography(), sam);
    assert.equal(
      (await dryRun(album(MISSING_ALBUM_MBID), maya)).code,
      'duplicate'
    );
    assert.equal((await dryRun(discography(), maya)).code, 'duplicate');
  });

  it('5. declined, failed and completed requests do not block a new one', async () => {
    const sam = await makeUser('sam', Permission.REQUEST);
    const requestRepository = getRepository(MediaRequest);

    for (const status of [
      MediaRequestStatus.DECLINED,
      MediaRequestStatus.FAILED,
      MediaRequestStatus.COMPLETED,
    ]) {
      const media = await ensureTestMedia(
        MISSING_ALBUM_MBID,
        MediaType.RELEASE_GROUP
      );
      await requestRepository.save(
        new MediaRequest({
          media,
          scope: RequestScope.ALBUM,
          status,
          requestedBy: sam,
          tracks: [],
        })
      );
    }

    assert.equal((await dryRun(album(), sam)).outcome, 'pending');
  });

  it('6. already available: album and tracks', async () => {
    const user = await makeUser('user', Permission.REQUEST);

    for (const body of [
      album(AVAILABLE_ALBUM_MBID),
      tracks(AVAILABLE_ALBUM_MBID),
      tracks(PARTIAL_ALBUM_MBID, [recordingMbid(PARTIAL_ALBUM_MBID, 1)]),
    ]) {
      await assert.rejects(
        MediaRequest.request(body, user),
        (e: Error) =>
          e instanceof DuplicateMediaRequestError &&
          e.message === 'This is already in the library.'
      );
      assert.deepEqual(await dryRun(body, user), {
        outcome: 'blocked',
        reason: 'This is already in the library.',
        code: 'available',
      });
    }
  });

  it('6. explicitly chosen tracks that are already there are left out', async () => {
    const user = await makeUser('user', Permission.REQUEST);
    const request = await MediaRequest.request(
      tracks(PARTIAL_ALBUM_MBID, [
        recordingMbid(PARTIAL_ALBUM_MBID, 2),
        recordingMbid(PARTIAL_ALBUM_MBID, 12),
      ]),
      user
    );

    assert.deepEqual(
      request.tracks.map((tr) => tr.track.position),
      ['12']
    );
  });

  it('7. auto-approve per scope', async () => {
    const albumAuto = await makeUser(
      'albumauto',
      Permission.REQUEST | Permission.AUTO_APPROVE_ALBUM
    );
    const discoAuto = await makeUser(
      'discoauto',
      Permission.REQUEST | Permission.AUTO_APPROVE_DISCOGRAPHY
    );

    assert.equal((await dryRun(album(), albumAuto)).outcome, 'auto');
    assert.equal((await dryRun(tracks(), albumAuto)).outcome, 'pending');

    // "Unless discographies always need review"
    assert.equal((await dryRun(discography(), discoAuto)).outcome, 'pending');
    getSettings().main.discographyAlwaysReview = false;
    assert.equal((await dryRun(discography(), discoAuto)).outcome, 'auto');
  });

  it('8. a dry run writes no request and reports what it would count', async () => {
    const user = await makeUser('user', Permission.REQUEST);
    const before = await getRepository(MediaRequest).count();

    assert.deepEqual(await dryRun(tracks(), user), {
      outcome: 'pending',
      trackCount: 4,
      releaseCount: 0,
    });
    assert.equal(await getRepository(MediaRequest).count(), before);
    assert.equal(ctx.notifications.length, 0);
  });

  it('9. create: pending leaves a partly available album visible as pending; auto marks it processing', async () => {
    const pendingUser = await makeUser('pending', Permission.REQUEST);
    const autoUser = await makeUser(
      'auto',
      Permission.REQUEST | Permission.AUTO_APPROVE
    );
    const mediaRepository = getRepository(Media);

    const pending = await MediaRequest.request(tracks(), pendingUser);
    assert.equal(
      (await mediaRepository.findOneByOrFail({ id: pending.media.id })).status,
      MediaStatus.PENDING
    );

    const approved = await MediaRequest.request(album(), autoUser);
    await flushRequestSideEffects();
    assert.equal(
      (await mediaRepository.findOneByOrFail({ id: approved.media.id })).status,
      MediaStatus.PROCESSING
    );
    assert.equal(approved.isAutoRequest, false);
  });

  it('rejects malformed bodies with a validation error', async () => {
    const user = await makeUser('user', Permission.REQUEST);

    await assert.rejects(
      MediaRequest.request(
        { ...album(), scope: 'everything' as RequestScope },
        user
      ),
      RequestValidationError
    );
    await assert.rejects(
      MediaRequest.request(
        { ...discography(), mediaType: MediaType.RELEASE_GROUP },
        user
      ),
      RequestValidationError
    );
    await assert.rejects(
      MediaRequest.request(
        tracks(PARTIAL_ALBUM_MBID, ['00000000-0000-4000-8000-000000000000']),
        user
      ),
      RequestValidationError
    );
  });
});

describe('MediaRequest.completeSatisfied', () => {
  it('completes a tracks request when its tracks arrive, and an album request when the album is whole', async () => {
    const user = await makeUser(
      'user',
      Permission.REQUEST | Permission.AUTO_APPROVE
    );
    const trackRepository = getRepository(Track);
    const mediaRepository = getRepository(Media);

    const request = await MediaRequest.request(tracks(), user);
    await flushRequestSideEffects();
    assert.deepEqual(
      await MediaRequest.completeSatisfied(request.media.id),
      []
    );

    for (const tr of request.tracks) {
      await trackRepository.update(tr.track.id, {
        status: MediaStatus.AVAILABLE,
      });
    }
    await mediaRepository.update(request.media.id, { tracksAvailable: 13 });

    const completed = await MediaRequest.completeSatisfied(request.media.id);
    await flushRequestSideEffects();

    assert.equal(completed.length, 1);
    assert.equal(completed[0].status, MediaRequestStatus.COMPLETED);
    assert.equal(
      (await mediaRepository.findOneByOrFail({ id: request.media.id })).status,
      MediaStatus.AVAILABLE
    );
    assert.ok(ctx.notifications.some((n) => n.name === 'MEDIA_AVAILABLE'));
  });
});
