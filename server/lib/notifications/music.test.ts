import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
  RequestScope,
} from '@server/constants/media';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { initI18n } from '@server/i18n';
import {
  Notification,
  hasNotificationType,
  shouldSendAdminNotification,
} from '@server/lib/notifications';
import DiscordAgent from '@server/lib/notifications/agents/discord';
import WebhookAgent from '@server/lib/notifications/agents/webhook';
import {
  buildRequestNotification,
  notificationSubject,
  scopeLabel,
} from '@server/lib/notifications/music';
import { maskToTypes, typesToMask } from '@server/lib/notifications/types';
import { Permission } from '@server/lib/permissions';
import type { AllSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import axios from 'axios';

const ALBUM_MBID = '11111111-2222-4333-8444-555555555555';
const ARTIST_MBID = '99999999-8888-4777-8666-555555555555';

const user = (init: Partial<User>) => {
  const u = new User(init);
  // displayName is filled by an @AfterLoad hook when loaded from the DB.
  u.displayName = init.username ?? init.email ?? '';
  return u;
};

const requester = user({
  id: 7,
  email: 'requester@shufflerr.test',
  username: 'requester',
  avatar: '/avatarproxy/7',
  permissions: Permission.REQUEST,
});
const manager = user({
  id: 2,
  email: 'manager@shufflerr.test',
  username: 'manager',
  permissions: Permission.MANAGE_REQUESTS,
});

const album = () =>
  new Media({
    id: 31,
    mediaType: MediaType.RELEASE_GROUP,
    mbid: ALBUM_MBID,
    artistMbid: ARTIST_MBID,
    title: 'Night Drive',
    artistName: 'The Example Band',
    status: MediaStatus.PENDING,
  });

const artist = () =>
  new Media({
    id: 32,
    mediaType: MediaType.ARTIST,
    mbid: ARTIST_MBID,
    title: 'The Example Band',
    status: MediaStatus.UNKNOWN,
  });

const request = (init: Partial<MediaRequest> = {}) =>
  new MediaRequest({
    id: 12,
    status: MediaRequestStatus.PENDING,
    scope: RequestScope.ALBUM,
    media: album(),
    requestedBy: requester,
    trackCount: 0,
    releaseCount: 0,
    ...init,
  });

let pristine: AllSettings;

before(() => {
  initI18n();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pristine = structuredClone((getSettings() as any).data);
});

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getSettings() as any).data = structuredClone(pristine);
  getSettings().main.applicationUrl = 'https://music.example.test';
});

after(() => mock.restoreAll());

describe('notification subject and scope', () => {
  it('names an album as "<Album> — <Artist>"', () => {
    assert.strictEqual(
      notificationSubject(album(), RequestScope.ALBUM),
      'Night Drive — The Example Band'
    );
  });

  it('names a discography by its artist', () => {
    assert.strictEqual(
      notificationSubject(artist(), RequestScope.DISCOGRAPHY),
      'The Example Band — discography'
    );
  });

  it('describes each scope with its counts', () => {
    assert.strictEqual(scopeLabel(request()), 'Album');
    assert.strictEqual(
      scopeLabel(request({ scope: RequestScope.TRACKS, trackCount: 4 })),
      '4 tracks'
    );
    assert.strictEqual(
      scopeLabel(request({ scope: RequestScope.TRACKS, trackCount: 1 })),
      '1 track'
    );
    assert.strictEqual(
      scopeLabel(
        request({ scope: RequestScope.DISCOGRAPHY, releaseCount: 8 })
      ),
      'Discography (8 releases)'
    );
  });
});

describe('buildRequestNotification', () => {
  it('sends pending and autoApproved to managers only', () => {
    for (const key of ['pending', 'autoApproved'] as const) {
      const { type, payload } = buildRequestNotification(key, request());
      assert.strictEqual(
        type,
        key === 'pending'
          ? Notification.MEDIA_PENDING
          : Notification.MEDIA_AUTO_APPROVED
      );
      assert.strictEqual(payload.notifyAdmin, true);
      assert.strictEqual(payload.notifyUser, undefined);
      assert.strictEqual(payload.notifySystem, true);
    }
  });

  it('sends approved, declined and available to the requester only', () => {
    for (const key of ['approved', 'declined', 'available'] as const) {
      const { payload } = buildRequestNotification(key, request());
      assert.strictEqual(payload.notifyAdmin, false, key);
      assert.strictEqual(payload.notifyUser, requester, key);
    }
  });

  it('sends failed to the requester and to managers, with the reason', () => {
    const { type, payload } = buildRequestNotification(
      'failed',
      request({ failureReason: 'No release matched the quality profile.' })
    );
    assert.strictEqual(type, Notification.MEDIA_FAILED);
    assert.strictEqual(payload.notifyAdmin, true);
    assert.strictEqual(payload.notifyUser, requester);
    assert.match(payload.message ?? '', /No release matched the quality profile/);
    assert.deepStrictEqual(payload.extra, [
      { name: 'Scope', value: 'Album' },
      { name: 'Reason', value: 'No release matched the quality profile.' },
    ]);
  });

  it('carries subject, event, cover through the image proxy, and who decided', () => {
    const { payload } = buildRequestNotification(
      'declined',
      request({
        scope: RequestScope.TRACKS,
        trackCount: 4,
        modifiedBy: manager,
        declineReason: 'Already on the way.',
      })
    );
    assert.strictEqual(payload.event, 'Request declined');
    assert.strictEqual(payload.subject, 'Night Drive — The Example Band');
    assert.strictEqual(
      payload.image,
      `https://music.example.test/imageproxy/caa/release-group/${ALBUM_MBID}/front-500`
    );
    assert.deepStrictEqual(payload.extra, [
      { name: 'Scope', value: '4 tracks' },
      { name: 'Reason', value: 'Already on the way.' },
      { name: 'Declined by', value: 'manager' },
    ]);
    assert.match(payload.message ?? '', /was declined: Already on the way\./);
  });

  it('has no image without an application URL, or for an artist', () => {
    const forArtist = buildRequestNotification(
      'pending',
      request({
        scope: RequestScope.DISCOGRAPHY,
        releaseCount: 8,
        media: artist(),
      })
    ).payload;
    assert.strictEqual(forArtist.image, undefined);
    assert.strictEqual(forArtist.subject, 'The Example Band — discography');

    getSettings().main.applicationUrl = '';
    assert.strictEqual(
      buildRequestNotification('pending', request()).payload.image,
      undefined
    );
  });
});

describe('who gets manager notifications', () => {
  it('needs MANAGE_REQUESTS and skips the person being notified', () => {
    const { type, payload } = buildRequestNotification('failed', request());
    assert.strictEqual(shouldSendAdminNotification(type, manager, payload), true);
    // No MANAGE_REQUESTS
    assert.strictEqual(
      shouldSendAdminNotification(
        type,
        user({ id: 9, username: 'someone', permissions: Permission.REQUEST }),
        payload
      ),
      false
    );
    // The requester already gets it as notifyUser, even if they manage requests.
    assert.strictEqual(
      shouldSendAdminNotification(
        type,
        user({ id: 7, username: 'requester', permissions: Permission.ADMIN }),
        payload
      ),
      false
    );
  });

  it("doesn't tell a manager about their own auto-approved request", () => {
    const { type, payload } = buildRequestNotification(
      'autoApproved',
      request({ requestedBy: manager, modifiedBy: manager })
    );
    assert.strictEqual(
      shouldSendAdminNotification(type, manager, payload),
      false
    );
  });
});

describe('type keys', () => {
  it('converts between string keys and the bitmask', () => {
    const mask = typesToMask(['pending', 'available', 'failed']);
    assert.strictEqual(mask, 2 | 8 | 16);
    assert.deepStrictEqual(maskToTypes(mask), ['pending', 'available', 'failed']);
    assert.strictEqual(typesToMask(['nope']), 0);
  });

  it('lets test notifications through whatever is ticked', () => {
    assert.strictEqual(hasNotificationType(Notification.TEST_NOTIFICATION, 0), true);
    assert.strictEqual(hasNotificationType(Notification.MEDIA_PENDING, 0), false);
  });
});

describe('webhook template', () => {
  const agentFor = (template: string) =>
    new WebhookAgent({
      enabled: true,
      embedPoster: true,
      types: typesToMask(['pending']),
      options: {
        webhookUrl: 'https://hooks.example.test/in',
        jsonPayload: Buffer.from(JSON.stringify(template)).toString('base64'),
      },
    });

  const ALL_VARIABLES = `{
    "event": "{{event}}",
    "subject": "{{subject}}",
    "message": "{{message}}",
    "image": "{{image}}",
    "notification_type": "{{notification_type}}",
    "notification_key": "{{notification_key}}",
    "requestedBy_username": "{{requestedBy_username}}",
    "requestedBy_email": "{{requestedBy_email}}",
    "requestedBy_avatar": "{{requestedBy_avatar}}",
    "{{media}}": {
      "media_type": "{{media_type}}",
      "media_mbid": "{{media_mbid}}",
      "media_title": "{{media_title}}",
      "media_artist": "{{media_artist}}",
      "media_status": "{{media_status}}"
    },
    "{{request}}": {
      "request_id": "{{request_id}}",
      "request_scope": "{{request_scope}}",
      "request_track_count": "{{request_track_count}}",
      "request_release_count": "{{request_release_count}}"
    },
    "{{extra}}": [],
    "twice": "{{media_title}} / {{media_title}}"
  }`;

  it('fills every documented variable for a request event', () => {
    const { type, payload } = buildRequestNotification(
      'pending',
      request({ scope: RequestScope.TRACKS, trackCount: 4 })
    );
    const body = agentFor(ALL_VARIABLES).buildPayload(type, payload);

    assert.strictEqual(body.event, 'Request waiting for approval');
    assert.strictEqual(body.subject, 'Night Drive — The Example Band');
    assert.match(String(body.message), /requester requested Night Drive/);
    assert.strictEqual(
      body.image,
      `https://music.example.test/imageproxy/caa/release-group/${ALBUM_MBID}/front-500`
    );
    assert.strictEqual(body.notification_type, 'MEDIA_PENDING');
    assert.strictEqual(body.notification_key, 'pending');
    assert.strictEqual(body.requestedBy_username, 'requester');
    assert.strictEqual(body.requestedBy_email, 'requester@shufflerr.test');
    assert.strictEqual(body.requestedBy_avatar, '/avatarproxy/7');
    assert.deepStrictEqual(body.media, {
      media_type: 'release-group',
      media_mbid: ALBUM_MBID,
      media_title: 'Night Drive',
      media_artist: 'The Example Band',
      media_status: 'PENDING',
    });
    assert.deepStrictEqual(body.request, {
      request_id: '12',
      request_scope: 'tracks',
      request_track_count: '4',
      request_release_count: '0',
    });
    assert.deepStrictEqual(body.extra, [{ name: 'Scope', value: '4 tracks' }]);
    assert.strictEqual(body.twice, 'Night Drive / Night Drive');
  });

  it('nulls media and request for events without them', () => {
    const body = agentFor(ALL_VARIABLES).buildPayload(
      Notification.TEST_NOTIFICATION,
      {
        subject: 'Test notification',
        message: 'Hello',
        notifySystem: true,
        notifyAdmin: false,
      }
    );
    assert.strictEqual(body.media, null);
    assert.strictEqual(body.request, null);
    assert.deepStrictEqual(body.extra, []);
    assert.strictEqual(body.notification_key, 'test');
  });

  it('renders the default template', () => {
    const agent = new WebhookAgent({
      ...getSettings().notifications.agents.webhook,
      enabled: true,
    });
    const { type, payload } = buildRequestNotification('available', request());
    const body = agent.buildPayload(type, payload) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.strictEqual(body.notification_type, 'MEDIA_AVAILABLE');
    assert.strictEqual(body.media.mbid, ALBUM_MBID);
    assert.strictEqual(body.media.artist, 'The Example Band');
    assert.strictEqual(body.request.scope, 'album');
    assert.strictEqual(body.request.requestedBy_username, 'requester');
  });

  it('skips types that are not ticked and posts the ones that are', async () => {
    const posted: unknown[] = [];
    const stub = mock.method(axios, 'post', async (_url: string, body: unknown) => {
      posted.push(body);
      return { status: 200, data: {} };
    });
    try {
      const agent = agentFor('{"key":"{{notification_key}}"}');
      const approved = buildRequestNotification('approved', request());
      assert.strictEqual(await agent.send(approved.type, approved.payload), true);
      assert.strictEqual(posted.length, 0);

      const pending = buildRequestNotification('pending', request());
      assert.strictEqual(await agent.send(pending.type, pending.payload), true);
      assert.deepStrictEqual(posted, [{ key: 'pending' }]);
    } finally {
      stub.mock.restore();
    }
  });
});

describe('Discord embed', () => {
  it('shows requester, the fixed status label, scope and a link to the album', () => {
    const { type, payload } = buildRequestNotification('pending', request());
    const embed = new DiscordAgent().buildEmbed(type, payload, 'en');

    assert.strictEqual(
      embed.title,
      'Request waiting for approval: Night Drive — The Example Band'
    );
    assert.strictEqual(
      embed.url,
      `https://music.example.test/album/${ALBUM_MBID}`
    );
    assert.deepStrictEqual(embed.fields, [
      { name: 'Requested by', value: 'requester', inline: true },
      {
        name: 'Request status',
        value: '[Waiting for approval](https://music.example.test/requests)',
        inline: true,
      },
      { name: 'Scope', value: 'Album', inline: true },
    ]);
    assert.strictEqual(
      embed.thumbnail?.url,
      `https://music.example.test/imageproxy/caa/release-group/${ALBUM_MBID}/front-500`
    );
  });

  it('links a discography request to the artist page', () => {
    const { type, payload } = buildRequestNotification(
      'approved',
      request({
        scope: RequestScope.DISCOGRAPHY,
        releaseCount: 3,
        media: artist(),
      })
    );
    const embed = new DiscordAgent().buildEmbed(type, payload, 'en');
    assert.strictEqual(
      embed.url,
      `https://music.example.test/artist/${ARTIST_MBID}`
    );
    assert.ok(
      embed.fields?.some(
        (f) => f.name === 'Request status' && f.value === 'Approved, downloading'
      )
    );
  });
});
