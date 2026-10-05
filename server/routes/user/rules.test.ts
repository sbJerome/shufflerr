import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import {
  MediaRequestStatus,
  MediaType,
  RequestScope,
} from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import AppPassword from '@server/entity/AppPassword';
import LinkedAccount from '@server/entity/LinkedAccount';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import ScrobbleQueue from '@server/entity/ScrobbleQueue';
import { User } from '@server/entity/User';
import {
  getAppPasswordSecrets,
  touchAppPassword,
  verifyAppPassword,
} from '@server/lib/auth/appPasswords';
import {
  getLinkedSecret,
  lastfmSignature,
  linkProviders,
  pkceChallenge,
} from '@server/lib/auth/linkedAccounts';
import PreparedEmail from '@server/lib/email';
import ImageProxy from '@server/lib/imageproxy';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import authRoutes, { AUTH_MESSAGES } from '@server/routes/auth';
import callbackRoutes from '@server/routes/callback';
import { setupTestDb } from '@server/test/db';
import axios from 'axios';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import schedule from 'node-schedule';
import request from 'supertest';
import userRoutes, { USER_MESSAGES } from '.';
import { SETTINGS_MESSAGES } from './usersettings';

const emailMock = mock.method(
  PreparedEmail.prototype,
  'send',
  async () => undefined
).mock;

const plexGetUserMock = mock.method(
  PlexTvAPI.prototype,
  'getUser',
  async () => {
    throw new Error('not stubbed');
  }
);
const plexCheckAccessMock = mock.method(
  PlexTvAPI.prototype,
  'checkUserAccess',
  async () => false
);
const jellyfinLoginMock = mock.method(
  JellyfinAPI.prototype,
  'login',
  async () => {
    throw new Error('not stubbed');
  }
);
// Jellyfin sign-in refreshes the avatar through the image proxy; keep that off
// the network (and off timers that would hold the test process open).
mock.method(axios, 'head', async () => ({
  status: 200,
  headers: { 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT' },
}));
mock.method(ImageProxy.prototype, 'clearCachedImage', async () => undefined);
mock.method(ImageProxy.prototype, 'getImage', async () => ({
  imageBuffer: Buffer.from('avatar'),
  meta: {
    revalidateAfter: 3600,
    curRevalidate: 3600,
    isStale: false,
    etag: 'mock-meta-etag',
    extension: 'jpg',
    cacheKey: 'mock-cache-key',
    cacheMiss: true,
  },
}));
const listenbrainzMock = mock.method(
  linkProviders,
  'listenbrainzValidate',
  async (token: string) => ({ externalUsername: 'lb-user', secret: token })
);
const lastfmSessionMock = mock.method(
  linkProviders,
  'lastfmGetSession',
  async () => ({
    externalUsername: 'lastfm-user',
    secret: 'lastfm-session-key',
  })
);
const spotifyExchangeMock = mock.method(
  linkProviders,
  'spotifyExchange',
  async () => ({
    externalUsername: 'Spotify Person',
    secret: 'spotify-refresh-token',
    scopes: 'playlist-read-private user-library-read',
  })
);

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({ secret: 'test-secret', resave: false, saveUninitialized: false })
  );
  app.use(checkUser);
  app.use('/auth', authRoutes);
  app.use('/callback', callbackRoutes);
  app.use('/user', isAuthenticated(), userRoutes);
  app.use(
    (
      err: { status?: number; message?: string; errors?: string[] },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res.status(err.status ?? 500).json({
        status: err.status ?? 500,
        message: err.message,
        errors: err.errors,
      });
    }
  );
  return app;
}

before(async () => {
  app = createApp();
});

setupTestDb();

// The first sign-in starts the job scheduler; stop it so the run can end.
after(async () => {
  await schedule.gracefulShutdown();
});

const PASSWORD = 'test1234';

beforeEach(() => {
  const settings = getSettings();
  settings.main.localLogin = true;
  settings.main.mediaServerLogin = true;
  settings.main.newPlexLogin = true;
  settings.main.applicationUrl = 'https://music.example.test';
  settings.main.defaultPermissions =
    Permission.REQUEST | Permission.AUTO_APPROVE_TRACK;
  settings.main.defaultQuotas = {
    album: { quotaLimit: 10, quotaDays: 7 },
    track: { quotaLimit: 50, quotaDays: 7 },
  };
  settings.main.mediaServerType = MediaServerType.PLEX;
  settings.plex.loginEnabled = true;
  settings.jellyfin.loginEnabled = false;
  settings.jellyfin.newLogin = false;
  settings.jellyfin.ip = '';
  settings.notifications.agents.email.enabled = false;
  settings.notifications.agents.discord.enabled = false;
  settings.metadata.lastfm = { enabled: false, apiKey: '', sharedSecret: '' };
  settings.scrobble.lastfm.enabled = false;
  settings.scrobble.listenbrainz.enabled = false;
  settings.discover.spotify.enabled = false;
  settings.discover.spotify.clientId = '';
  settings.discover.spotify.clientSecret = '';
  if (!settings.serverSecret) {
    (
      settings as unknown as { data: { serverSecret: string } }
    ).data.serverSecret = 'test-server-secret';
  }
  emailMock.resetCalls();
  plexGetUserMock.mock.resetCalls();
  plexCheckAccessMock.mock.resetCalls();
  plexCheckAccessMock.mock.mockImplementation(async () => false);
  jellyfinLoginMock.mock.resetCalls();
  listenbrainzMock.mock.resetCalls();
  lastfmSessionMock.mock.resetCalls();
  spotifyExchangeMock.mock.resetCalls();
});

async function loginAs(email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/auth/local').send({ email, password });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return { agent, userId: res.body.id as number };
}

/** A local account with a known password. */
async function makeUser(
  name: string,
  permissions: number,
  extra: Partial<User> = {}
): Promise<User> {
  const user = new User({
    email: `${name}@shufflerr.test`,
    username: name,
    permissions,
    avatar: '',
    userType: UserType.LOCAL,
    ...extra,
  });
  await user.setPassword(PASSWORD);
  return getRepository(User).save(user);
}

const OWNER = 'admin@shufflerr.test';
const DEMO = 'demo@shufflerr.test';

async function idOf(email: string): Promise<number> {
  return (await getRepository(User).findOneOrFail({ where: { email } })).id;
}

describe('first-run setup with a Shufflerr account', () => {
  it('creates the owner as a local admin when no users exist, then refuses', async () => {
    await getRepository(User).clear();

    const agent = request.agent(app);
    const res = await agent.post('/auth/setup').send({
      username: 'boss',
      email: 'Boss@Shufflerr.test',
      password: 'longenough',
    });

    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.ok(!('password' in res.body));

    const owner = await getRepository(User).findOneOrFail({
      where: { email: 'boss@shufflerr.test' },
    });
    assert.strictEqual(owner.permissions, Permission.ADMIN);
    assert.strictEqual(owner.userType, UserType.LOCAL);

    const me = await agent.get('/auth/me');
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.id, owner.id);

    const again = await request(app)
      .post('/auth/setup')
      .send({ email: 'second@shufflerr.test', password: 'longenough' });
    assert.strictEqual(again.status, 403);
    assert.strictEqual(again.body.message, AUTH_MESSAGES.setupDone);
  });

  it('validates the email and password', async () => {
    await getRepository(User).clear();

    const badEmail = await request(app)
      .post('/auth/setup')
      .send({ email: 'nope', password: 'longenough' });
    assert.strictEqual(badEmail.status, 400);
    assert.strictEqual(badEmail.body.message, AUTH_MESSAGES.invalidEmail);

    const shortPw = await request(app)
      .post('/auth/setup')
      .send({ email: 'boss@shufflerr.test', password: 'short' });
    assert.strictEqual(shortPw.status, 400);
    assert.strictEqual(shortPw.body.message, AUTH_MESSAGES.passwordTooShort);
    assert.strictEqual(await getRepository(User).count(), 0);
  });
});

describe('POST /auth/local copy', () => {
  it('tells a Plex-only account to use the Plex button', async () => {
    await getRepository(User).save(
      new User({
        email: 'plexonly@shufflerr.test',
        plexUsername: 'plexonly',
        plexId: 4242,
        permissions: Permission.REQUEST,
        avatar: '',
        userType: UserType.PLEX,
      })
    );

    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'plexonly@shufflerr.test', password: 'whatever1' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.message, AUTH_MESSAGES.localNoPasswordPlex);
  });
});

describe('POST /auth/plex', () => {
  const plexAccount = (id: number, email: string) =>
    ({
      id,
      uuid: `uuid-${id}`,
      email,
      joined_at: '',
      username: email.split('@')[0],
      title: email.split('@')[0],
      thumb: 'https://plex.tv/users/thumb',
      hasPassword: true,
      authToken: `token-${id}`,
      subscription: { active: false, status: 'Inactive', features: [] },
      roles: { roles: [] },
      entitlements: [],
    }) as never;

  it('makes the first Plex user the owner', async () => {
    await getRepository(User).clear();
    plexGetUserMock.mock.mockImplementation(async () =>
      plexAccount(900, 'first@shufflerr.test')
    );

    const res = await request(app).post('/auth/plex').send({ authToken: 't' });

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const owner = await getRepository(User).findOneOrFail({
      where: { email: 'first@shufflerr.test' },
    });
    assert.strictEqual(owner.permissions, Permission.ADMIN);
    assert.strictEqual(
      getSettings().main.mediaServerType,
      MediaServerType.PLEX
    );
  });

  it('creates an unknown user with default permissions when they have server access', async () => {
    plexGetUserMock.mock.mockImplementation(async () =>
      plexAccount(901, 'newplex@shufflerr.test')
    );
    plexCheckAccessMock.mock.mockImplementation(async () => true);

    const res = await request(app).post('/auth/plex').send({ authToken: 't' });

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const user = await getRepository(User).findOneOrFail({
      where: { email: 'newplex@shufflerr.test' },
    });
    assert.strictEqual(
      user.permissions,
      Permission.REQUEST | Permission.AUTO_APPROVE_TRACK
    );
    assert.strictEqual(user.userType, UserType.PLEX);
    assert.strictEqual(user.albumQuotaLimit ?? null, null);
  });

  it('refuses an unknown user when new Plex sign-ins are off', async () => {
    getSettings().main.newPlexLogin = false;
    plexGetUserMock.mock.mockImplementation(async () =>
      plexAccount(902, 'stranger@shufflerr.test')
    );
    plexCheckAccessMock.mock.mockImplementation(async () => true);

    const res = await request(app).post('/auth/plex').send({ authToken: 't' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.message, AUTH_MESSAGES.plexUnknown);
    assert.strictEqual(
      await getRepository(User).count({
        where: { email: 'stranger@shufflerr.test' },
      }),
      0
    );
  });

  it('refuses an unknown user without access to the server', async () => {
    plexGetUserMock.mock.mockImplementation(async () =>
      plexAccount(903, 'noaccess@shufflerr.test')
    );

    const res = await request(app).post('/auth/plex').send({ authToken: 't' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.message, AUTH_MESSAGES.plexNoAccess);
  });

  it('is refused when Plex sign-in is turned off', async () => {
    getSettings().plex.loginEnabled = false;

    const res = await request(app).post('/auth/plex').send({ authToken: 't' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.message, AUTH_MESSAGES.plexDisabled);
    assert.strictEqual(plexGetUserMock.mock.callCount(), 0);
  });
});

describe('POST /auth/jellyfin', () => {
  const jellyfinAccount = (id: string, name: string) =>
    ({
      User: {
        Id: id,
        Name: name,
        ServerId: 'server-1',
        Policy: { IsAdministrator: false },
      },
      AccessToken: `token-${id}`,
    }) as never;

  beforeEach(() => {
    const settings = getSettings();
    settings.jellyfin.loginEnabled = true;
    settings.jellyfin.ip = 'localhost';
    settings.jellyfin.port = 8096;
  });

  it('refuses an unknown user while "let new Jellyfin users sign in" is off', async () => {
    jellyfinLoginMock.mock.mockImplementation(async () =>
      jellyfinAccount('jf-new-1', 'newjf')
    );

    const res = await request(app)
      .post('/auth/jellyfin')
      .send({ username: 'newjf', password: 'pw' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.message, AUTH_MESSAGES.jellyfinUnknown);
  });

  it('creates the account when the rule is on, without touching the owner', async () => {
    getSettings().jellyfin.newLogin = true;
    // A local owner leaves the media server type unset; that must not send a
    // new sign-in down the owner-setup path.
    getSettings().main.mediaServerType = MediaServerType.NOT_CONFIGURED;
    jellyfinLoginMock.mock.mockImplementation(async () =>
      jellyfinAccount('jf-new-2', 'newjf2')
    );

    const ownerBefore = await getRepository(User).findOneOrFail({
      where: { email: OWNER },
    });

    const res = await request(app)
      .post('/auth/jellyfin')
      .send({ username: 'newjf2', password: 'pw' });

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const created = await getRepository(User).findOneOrFail({
      where: { jellyfinUserId: 'jf-new-2' },
    });
    assert.notStrictEqual(created.id, ownerBefore.id);
    assert.strictEqual(
      created.permissions,
      Permission.REQUEST | Permission.AUTO_APPROVE_TRACK
    );
    assert.strictEqual(created.userType, UserType.JELLYFIN);

    const ownerAfter = await getRepository(User).findOneOrFail({
      where: { id: ownerBefore.id },
    });
    assert.strictEqual(ownerAfter.email, OWNER);
    assert.strictEqual(ownerAfter.jellyfinUserId ?? null, null);
  });

  it('is refused when Jellyfin sign-in is turned off', async () => {
    getSettings().jellyfin.loginEnabled = false;

    const res = await request(app)
      .post('/auth/jellyfin')
      .send({ username: 'x', password: 'y' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.message, AUTH_MESSAGES.jellyfinDisabled);
    assert.strictEqual(jellyfinLoginMock.mock.callCount(), 0);
  });
});

describe('sign-in rate limit', () => {
  it('answers 429 after 10 attempts in a minute', async () => {
    process.env.AUTH_RATE_LIMIT_IN_TESTS = 'true';
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const res = await request(app)
          .post('/auth/local')
          .send({ email: 'nobody@shufflerr.test', password: 'wrongwrong' });
        statuses.push(res.status);
      }
      assert.deepStrictEqual(statuses.slice(0, 10), Array(10).fill(403));
      assert.deepStrictEqual(statuses.slice(10), [429, 429]);
    } finally {
      delete process.env.AUTH_RATE_LIMIT_IN_TESTS;
    }
  });
});

describe('user list and creation', () => {
  it('is closed to people who manage neither users nor requests', async () => {
    const { agent } = await loginAs(DEMO);
    const res = await agent.get('/user');
    assert.strictEqual(res.status, 403);
  });

  it('searches and sorts', async () => {
    await makeUser('zelda', Permission.REQUEST);
    await makeUser('abel', Permission.REQUEST);
    const { agent } = await loginAs(OWNER);

    const search = await agent.get('/user').query({ q: 'zel' });
    assert.strictEqual(search.status, 200);
    assert.deepStrictEqual(
      search.body.results.map((u: User) => u.username),
      ['zelda']
    );

    const byName = await agent.get('/user').query({ sort: 'displayname' });
    const names = byName.body.results.map((u: User) => u.displayName);
    assert.deepStrictEqual(names, [...names].sort());
    assert.strictEqual(byName.body.pageInfo.results, 4);

    const byRole = await agent.get('/user').query({ sort: 'role' });
    assert.strictEqual(byRole.body.results[0].email, OWNER);
  });

  it('creates a local user with the default permissions', async () => {
    const { agent } = await loginAs(OWNER);
    const res = await agent.post('/user').send({
      username: 'newbie',
      email: 'Newbie@Shufflerr.test',
      password: 'longenough',
    });

    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.email, 'newbie@shufflerr.test');
    assert.strictEqual(
      res.body.permissions,
      Permission.REQUEST | Permission.AUTO_APPROVE_TRACK
    );
    assert.ok(!('password' in res.body));

    const signIn = await request(app)
      .post('/auth/local')
      .send({ email: 'newbie@shufflerr.test', password: 'longenough' });
    assert.strictEqual(signIn.status, 200);
  });

  it('returns the inline error copy', async () => {
    const { agent } = await loginAs(OWNER);

    const noName = await agent.post('/user').send({
      username: ' ',
      email: 'a@shufflerr.test',
      password: 'longenough',
    });
    assert.strictEqual(noName.status, 400);
    assert.strictEqual(noName.body.message, USER_MESSAGES.usernameRequired);

    const badEmail = await agent
      .post('/user')
      .send({ username: 'a', email: 'not-an-email', password: 'longenough' });
    assert.strictEqual(badEmail.body.message, USER_MESSAGES.emailInvalid);

    const taken = await agent
      .post('/user')
      .send({ username: 'a', email: DEMO, password: 'longenough' });
    assert.strictEqual(taken.status, 409);
    assert.strictEqual(taken.body.message, USER_MESSAGES.emailTaken);

    const shortPw = await agent
      .post('/user')
      .send({ username: 'a', email: 'a@shufflerr.test', password: 'short' });
    assert.strictEqual(shortPw.body.message, USER_MESSAGES.passwordTooShort);

    // No password and the email agent is off: nothing could deliver one.
    const noPw = await agent
      .post('/user')
      .send({ username: 'a', email: 'a@shufflerr.test' });
    assert.strictEqual(noPw.status, 400);
    assert.strictEqual(noPw.body.message, USER_MESSAGES.passwordNeeded);
    assert.strictEqual(emailMock.callCount(), 0);
  });

  it('emails a generated password when the email agent is on', async () => {
    getSettings().notifications.agents.email.enabled = true;
    const { agent } = await loginAs(OWNER);

    const res = await agent
      .post('/user')
      .send({ username: 'mailed', email: 'mailed@shufflerr.test' });

    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(emailMock.callCount(), 1);
  });

  it('needs MANAGE_USERS to create', async () => {
    const { agent } = await loginAs(DEMO);
    const res = await agent.post('/user').send({
      username: 'x',
      email: 'x@shufflerr.test',
      password: 'longenough',
    });
    assert.strictEqual(res.status, 403);
  });
});

describe('permission rules', () => {
  it('bulk edit never applies to the owner or to yourself', async () => {
    const manager = await makeUser('manager', Permission.MANAGE_USERS);
    const target = await makeUser('target', Permission.REQUEST);
    const ownerId = await idOf(OWNER);
    const { agent } = await loginAs(manager.email);

    const res = await agent.put('/user').send({
      ids: [ownerId, manager.id, target.id],
      permissions: Permission.REQUEST | Permission.REQUEST_VIEW,
    });

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(
      res.body.map((u: User) => u.id),
      [target.id]
    );

    const repo = getRepository(User);
    assert.strictEqual(
      (await repo.findOneOrFail({ where: { id: ownerId } })).permissions,
      Permission.ADMIN
    );
    assert.strictEqual(
      (await repo.findOneOrFail({ where: { id: manager.id } })).permissions,
      Permission.MANAGE_USERS
    );
    assert.strictEqual(
      (await repo.findOneOrFail({ where: { id: target.id } })).permissions,
      Permission.REQUEST | Permission.REQUEST_VIEW
    );
  });

  it('even the owner cannot bulk-edit the owner', async () => {
    const ownerId = await idOf(OWNER);
    const { agent } = await loginAs(OWNER);

    const res = await agent
      .put('/user')
      .send({ ids: [ownerId], permissions: Permission.REQUEST });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, []);
    assert.strictEqual(
      (await getRepository(User).findOneOrFail({ where: { id: ownerId } }))
        .permissions,
      Permission.ADMIN
    );
  });

  it('only the owner grants admin', async () => {
    const manager = await makeUser('manager', Permission.MANAGE_USERS);
    const target = await makeUser('target', Permission.REQUEST);
    const { agent } = await loginAs(manager.email);

    const bulk = await agent
      .put('/user')
      .send({ ids: [target.id], permissions: Permission.ADMIN });
    assert.strictEqual(bulk.status, 403);

    const single = await agent
      .post(`/user/${target.id}/settings/permissions`)
      .send({ permissions: Permission.ADMIN });
    assert.strictEqual(single.status, 403);
    assert.strictEqual(single.body.message, SETTINGS_MESSAGES.adminOnlyByOwner);

    const owner = await loginAs(OWNER);
    const granted = await owner.agent
      .post(`/user/${target.id}/settings/permissions`)
      .send({ permissions: Permission.ADMIN | Permission.REQUEST });
    assert.strictEqual(granted.status, 200);
    // ADMIN covers everything: just that bit is stored.
    assert.strictEqual(granted.body.permissions, Permission.ADMIN);
  });

  it("nobody edits the owner's permissions, and nobody their own", async () => {
    const manager = await makeUser('manager', Permission.MANAGE_USERS);
    const ownerId = await idOf(OWNER);

    const asManager = await loginAs(manager.email);
    const onOwner = await asManager.agent
      .post(`/user/${ownerId}/settings/permissions`)
      .send({ permissions: Permission.REQUEST });
    assert.strictEqual(onOwner.status, 403);
    assert.strictEqual(
      onOwner.body.message,
      SETTINGS_MESSAGES.ownerPermissions
    );

    const onSelf = await asManager.agent
      .post(`/user/${manager.id}/settings/permissions`)
      .send({
        permissions: Permission.MANAGE_USERS | Permission.MANAGE_REQUESTS,
      });
    assert.strictEqual(onSelf.status, 403);
    assert.strictEqual(onSelf.body.message, SETTINGS_MESSAGES.ownPermissions);

    // The tab itself is hidden on your own account unless you're the owner.
    const ownTab = await asManager.agent.get(
      `/user/${manager.id}/settings/permissions`
    );
    assert.strictEqual(ownTab.status, 403);

    const asOwner = await loginAs(OWNER);
    const ownerTab = await asOwner.agent.get(
      `/user/${ownerId}/settings/permissions`
    );
    assert.strictEqual(ownerTab.status, 200);
    const ownerOnSelf = await asOwner.agent
      .post(`/user/${ownerId}/settings/permissions`)
      .send({ permissions: Permission.REQUEST });
    assert.strictEqual(ownerOnSelf.status, 403);
  });

  it("other people can't change the owner's settings", async () => {
    const manager = await makeUser('manager', Permission.MANAGE_USERS);
    const ownerId = await idOf(OWNER);
    const { agent } = await loginAs(manager.email);

    const main = await agent
      .post(`/user/${ownerId}/settings/main`)
      .send({ username: 'hijacked' });
    assert.strictEqual(main.status, 403);
    assert.strictEqual(main.body.message, SETTINGS_MESSAGES.ownerOnly);

    const password = await agent
      .post(`/user/${ownerId}/settings/password`)
      .send({ newPassword: 'longenough' });
    assert.strictEqual(password.status, 403);

    const notifications = await agent
      .post(`/user/${ownerId}/settings/notifications`)
      .send({ channels: { email: { enabled: false } } });
    assert.strictEqual(notifications.status, 403);
  });

  it('a plain user cannot read or edit someone else', async () => {
    const other = await makeUser('other', Permission.REQUEST);
    const { agent } = await loginAs(DEMO);

    assert.strictEqual(
      (await agent.get(`/user/${other.id}/settings/main`)).status,
      403
    );
    assert.strictEqual(
      (await agent.get(`/user/${other.id}/settings/app-passwords`)).status,
      403
    );
    assert.strictEqual(
      (await agent.get(`/user/${other.id}/settings/permissions`)).status,
      403
    );
    assert.strictEqual(
      (await agent.get(`/user/${other.id}/quota`)).status,
      403
    );
    assert.strictEqual(
      (await agent.get(`/user/${other.id}/recently-played`)).status,
      403
    );
  });
});

describe('quotas', () => {
  async function addAlbumRequests(user: User, count: number) {
    for (let i = 0; i < count; i++) {
      const media = await getRepository(Media).save(
        new Media({
          mediaType: MediaType.RELEASE_GROUP,
          mbid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          title: `Album ${i}`,
        })
      );
      await getRepository(MediaRequest).save(
        new MediaRequest({
          media,
          requestedBy: user,
          scope: RequestScope.ALBUM,
          status: MediaRequestStatus.PENDING,
        })
      );
    }
  }

  it('follows the global limit, then the per-user override', async () => {
    const user = await makeUser('limited', Permission.REQUEST);
    await addAlbumRequests(user, 3);
    const { agent } = await loginAs(user.email);

    const global = await agent.get(`/user/${user.id}/quota`);
    assert.strictEqual(global.status, 200);
    assert.strictEqual(global.body.album.limit, 10);
    assert.strictEqual(global.body.album.used, 3);
    assert.strictEqual(global.body.album.remaining, 7);
    assert.strictEqual(global.body.album.restricted, false);

    const owner = await loginAs(OWNER);
    const saved = await owner.agent
      .post(`/user/${user.id}/settings/main`)
      .send({ albumQuotaLimit: 3, albumQuotaDays: 14 });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    assert.strictEqual(saved.body.albumQuotaLimit, 3);
    assert.strictEqual(saved.body.globalAlbumQuotaLimit, 10);

    const overridden = await agent.get(`/user/${user.id}/quota`);
    assert.strictEqual(overridden.body.album.limit, 3);
    assert.strictEqual(overridden.body.album.days, 14);
    assert.strictEqual(overridden.body.album.remaining, 0);
    assert.strictEqual(overridden.body.album.restricted, true);

    // null puts the user back on the global limit
    const cleared = await owner.agent
      .post(`/user/${user.id}/settings/main`)
      .send({ albumQuotaLimit: null, albumQuotaDays: null });
    assert.strictEqual(cleared.body.albumQuotaLimit, null);
    assert.strictEqual(
      (await agent.get(`/user/${user.id}/quota`)).body.album.limit,
      10
    );
  });

  it('people who manage users have no limit', async () => {
    const manager = await makeUser('manager', Permission.MANAGE_USERS, {
      albumQuotaLimit: 1,
    });
    await addAlbumRequests(manager, 4);
    const { agent } = await loginAs(manager.email);

    const res = await agent.get(`/user/${manager.id}/quota`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.album.limit, 0);
    assert.strictEqual(res.body.album.restricted, false);
    assert.strictEqual(res.body.track.restricted, false);
  });

  it("a user can't set their own limits", async () => {
    const user = await makeUser('limited', Permission.REQUEST);
    const { agent } = await loginAs(user.email);

    const res = await agent
      .post(`/user/${user.id}/settings/main`)
      .send({ username: 'renamed', albumQuotaLimit: 999 });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.username, 'renamed');
    assert.strictEqual(res.body.albumQuotaLimit ?? null, null);
  });
});

describe('deleting users', () => {
  it("can't delete the owner or yourself", async () => {
    const manager = await makeUser('manager', Permission.MANAGE_USERS);
    const ownerId = await idOf(OWNER);
    const { agent } = await loginAs(manager.email);

    const owner = await agent.delete(`/user/${ownerId}`);
    assert.strictEqual(owner.status, 405);

    const self = await agent.delete(`/user/${manager.id}`);
    assert.strictEqual(self.status, 405);
    assert.strictEqual(self.body.message, "You can't delete your own account.");

    assert.strictEqual(await getRepository(User).count(), 3);
  });

  it('only the owner deletes an admin', async () => {
    const manager = await makeUser('manager', Permission.MANAGE_USERS);
    const admin = await makeUser('otheradmin', Permission.ADMIN);

    const asManager = await loginAs(manager.email);
    assert.strictEqual(
      (await asManager.agent.delete(`/user/${admin.id}`)).status,
      405
    );

    const asOwner = await loginAs(OWNER);
    assert.strictEqual(
      (await asOwner.agent.delete(`/user/${admin.id}`)).status,
      200
    );
  });

  it('removes the account with its requests and app passwords', async () => {
    const user = await makeUser('leaving', Permission.REQUEST);
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.RELEASE_GROUP,
        mbid: '11111111-1111-4111-8111-111111111111',
        title: 'Kept in the library',
      })
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        media,
        requestedBy: user,
        scope: RequestScope.ALBUM,
        status: MediaRequestStatus.PENDING,
      })
    );
    const asUser = await loginAs(user.email);
    await asUser.agent
      .post(`/user/${user.id}/settings/app-passwords`)
      .send({ name: 'Phone' });

    const { agent } = await loginAs(OWNER);
    const res = await agent.delete(`/user/${user.id}`);

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(
      await getRepository(User).count({ where: { id: user.id } }),
      0
    );
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
    assert.strictEqual(await getRepository(AppPassword).count(), 0);
    // Music already in the library stays.
    assert.strictEqual(
      await getRepository(Media).count({ where: { id: media.id } }),
      1
    );
  });

  it('needs MANAGE_USERS', async () => {
    const other = await makeUser('other', Permission.REQUEST);
    const { agent } = await loginAs(DEMO);
    assert.strictEqual((await agent.delete(`/user/${other.id}`)).status, 403);
  });
});

describe('password settings', () => {
  it('own account: needs the current password, 8 characters and a matching confirmation', async () => {
    const user = await makeUser('pwuser', Permission.REQUEST);
    const { agent } = await loginAs(user.email);
    const url = `/user/${user.id}/settings/password`;

    assert.deepStrictEqual((await agent.get(url)).body, { hasPassword: true });

    const noCurrent = await agent.post(url).send({ newPassword: 'longenough' });
    assert.strictEqual(noCurrent.status, 400);
    assert.strictEqual(
      noCurrent.body.message,
      SETTINGS_MESSAGES.currentPasswordRequired
    );

    const wrongCurrent = await agent
      .post(url)
      .send({ currentPassword: 'nope-nope', newPassword: 'longenough' });
    assert.strictEqual(wrongCurrent.status, 403);

    const tooShort = await agent
      .post(url)
      .send({ currentPassword: PASSWORD, newPassword: 'short' });
    assert.strictEqual(tooShort.status, 400);
    assert.strictEqual(
      tooShort.body.message,
      SETTINGS_MESSAGES.newPasswordTooShort
    );

    const mismatch = await agent.post(url).send({
      currentPassword: PASSWORD,
      newPassword: 'longenough',
      confirmPassword: 'longenougH',
    });
    assert.strictEqual(mismatch.status, 400);
    assert.strictEqual(
      mismatch.body.message,
      SETTINGS_MESSAGES.passwordMismatch
    );

    const ok = await agent.post(url).send({
      currentPassword: PASSWORD,
      newPassword: 'longenough',
      confirmPassword: 'longenough',
    });
    assert.strictEqual(ok.status, 204);
    await loginAs(user.email, 'longenough');
  });

  it('an admin sets a new password without the current one', async () => {
    const user = await makeUser('pwuser', Permission.REQUEST);
    const { agent } = await loginAs(OWNER);

    const res = await agent
      .post(`/user/${user.id}/settings/password`)
      .send({ newPassword: 'set-by-admin', confirmPassword: 'set-by-admin' });

    assert.strictEqual(res.status, 204);
    await loginAs(user.email, 'set-by-admin');
  });

  it('a media-server account without a password can set one', async () => {
    const plexUser = await getRepository(User).save(
      new User({
        email: 'plexonly@shufflerr.test',
        plexUsername: 'plexonly',
        plexId: 4243,
        permissions: Permission.REQUEST,
        avatar: '',
        userType: UserType.PLEX,
      })
    );
    plexGetUserMock.mock.mockImplementation(
      async () =>
        ({
          id: 4243,
          uuid: 'u',
          email: 'plexonly@shufflerr.test',
          joined_at: '',
          username: 'plexonly',
          title: 'plexonly',
          thumb: '',
          hasPassword: true,
          authToken: 'tok',
          subscription: { active: false, status: 'Inactive', features: [] },
          roles: { roles: [] },
          entitlements: [],
        }) as never
    );
    plexCheckAccessMock.mock.mockImplementation(async () => true);

    const agent = request.agent(app);
    const signIn = await agent.post('/auth/plex').send({ authToken: 'tok' });
    assert.strictEqual(signIn.status, 200, JSON.stringify(signIn.body));

    const url = `/user/${plexUser.id}/settings/password`;
    assert.deepStrictEqual((await agent.get(url)).body, { hasPassword: false });

    const res = await agent
      .post(url)
      .send({ newPassword: 'my-first-pw', confirmPassword: 'my-first-pw' });
    assert.strictEqual(res.status, 204);
    await loginAs(plexUser.email, 'my-first-pw');
  });
});

describe('app passwords', () => {
  it('create shows the password once, list hides it, revoke stops it working', async () => {
    const user = await makeUser('listener', Permission.REQUEST);
    const { agent } = await loginAs(user.email);
    const url = `/user/${user.id}/settings/app-passwords`;

    const noName = await agent.post(url).send({ name: '  ' });
    assert.strictEqual(noName.status, 400);
    assert.strictEqual(noName.body.message, SETTINGS_MESSAGES.appPasswordName);

    const created = await agent.post(url).send({ name: 'Finamp on my phone' });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    assert.match(
      created.body.password,
      /^[0-9a-z]{6}-[0-9a-z]{6}-[0-9a-z]{6}$/
    );
    assert.strictEqual(created.body.name, 'Finamp on my phone');
    const password: string = created.body.password;

    const list = await agent.get(url);
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.username, 'listener');
    assert.strictEqual(list.body.serverUrl, 'https://music.example.test');
    assert.strictEqual(list.body.passwords.length, 1);
    assert.ok(!JSON.stringify(list.body).includes(password));
    assert.strictEqual(list.body.passwords[0].lastUsedAt, null);

    // Stored hashed (argon2id) plus an encrypted copy, never in the clear.
    const row = await getRepository(AppPassword)
      .createQueryBuilder('ap')
      .addSelect(['ap.hash', 'ap.encryptedSecret'])
      .getOneOrFail();
    assert.match(row.hash, /^\$argon2id\$/);
    assert.match(row.encryptedSecret, /^v1:/);
    assert.ok(!row.encryptedSecret.includes(password));

    // What the client APIs call
    const verified = await verifyAppPassword('Listener', password);
    assert.strictEqual(verified?.user.id, user.id);
    assert.strictEqual(
      await verifyAppPassword('listener', 'wrong-wrong-wrong'),
      null
    );
    assert.strictEqual(await verifyAppPassword('someoneelse', password), null);
    // ...by email too
    assert.strictEqual(
      (await verifyAppPassword(user.email, password))?.user.id,
      user.id
    );

    // Subsonic token auth: t = md5(password + salt)
    const salt = 'c19b2d';
    const token = createHash('md5')
      .update(password + salt)
      .digest('hex');
    const secrets = await getAppPasswordSecrets('listener');
    assert.strictEqual(secrets.length, 1);
    assert.strictEqual(
      createHash('md5')
        .update(secrets[0].secret + salt)
        .digest('hex'),
      token
    );

    await touchAppPassword(created.body.id, 'Finamp/0.9');
    const used = await agent.get(url);
    assert.strictEqual(used.body.passwords[0].lastUsedClient, 'Finamp/0.9');
    assert.ok(used.body.passwords[0].lastUsedAt);

    const revoked = await agent.delete(`${url}/${created.body.id}`);
    assert.strictEqual(revoked.status, 204);
    assert.strictEqual(await verifyAppPassword('listener', password), null);
    assert.deepStrictEqual(await getAppPasswordSecrets('listener'), []);
    assert.strictEqual((await agent.get(url)).body.passwords.length, 0);
    assert.strictEqual(
      (await agent.delete(`${url}/${created.body.id}`)).status,
      404
    );
  });

  it("an admin can list and revoke someone's app passwords but not create them", async () => {
    const user = await makeUser('listener', Permission.REQUEST);
    const asUser = await loginAs(user.email);
    const url = `/user/${user.id}/settings/app-passwords`;
    const created = await asUser.agent.post(url).send({ name: 'Desktop' });

    const { agent } = await loginAs(OWNER);
    assert.strictEqual((await agent.get(url)).body.passwords.length, 1);
    assert.strictEqual(
      (await agent.post(url).send({ name: 'Sneaky' })).status,
      403
    );
    assert.strictEqual(
      (await agent.delete(`${url}/${created.body.id}`)).status,
      204
    );
  });

  it("one user can't revoke another user's app password", async () => {
    const user = await makeUser('listener', Permission.REQUEST);
    const other = await makeUser('other', Permission.REQUEST);
    const asUser = await loginAs(user.email);
    const created = await asUser.agent
      .post(`/user/${user.id}/settings/app-passwords`)
      .send({ name: 'Desktop' });

    const asOther = await loginAs(other.email);
    // Their own URL with someone else's password id
    const res = await asOther.agent.delete(
      `/user/${other.id}/settings/app-passwords/${created.body.id}`
    );
    assert.strictEqual(res.status, 404);
    assert.strictEqual(await getRepository(AppPassword).count(), 1);
  });
});

describe('notification settings', () => {
  it('speaks string type keys and hides manager-only types from non-managers', async () => {
    getSettings().notifications.agents.email.enabled = true;
    const user = await makeUser('notified', Permission.REQUEST);
    const { agent } = await loginAs(user.email);
    const url = `/user/${user.id}/settings/notifications`;

    const initial = await agent.get(url);
    assert.strictEqual(initial.status, 200);
    assert.deepStrictEqual(initial.body.availableTypes, [
      'approved',
      'declined',
      'available',
      'failed',
    ]);
    assert.strictEqual(initial.body.channels.email.available, true);
    assert.strictEqual(initial.body.channels.email.enabled, true);
    assert.strictEqual(initial.body.channels.discord.available, false);
    assert.strictEqual(initial.body.channels.discord.enabled, false);

    const saved = await agent.post(url).send({
      channels: {
        email: { enabled: true, types: ['pending', 'available'] },
        telegram: {
          enabled: true,
          types: ['declined'],
          telegramChatId: ' 12345 ',
          telegramSendSilently: true,
        },
      },
    });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    // 'pending' is manager-only and is dropped
    assert.deepStrictEqual(saved.body.channels.email.types, ['available']);
    assert.deepStrictEqual(saved.body.channels.telegram.types, ['declined']);
    assert.strictEqual(saved.body.channels.telegram.telegramChatId, '12345');
    assert.strictEqual(saved.body.channels.telegram.telegramSendSilently, true);

    const off = await agent
      .post(url)
      .send({ channels: { email: { enabled: false } } });
    assert.strictEqual(off.body.channels.email.enabled, false);
    assert.deepStrictEqual(off.body.channels.email.types, []);
    // untouched channel keeps its settings
    assert.deepStrictEqual(off.body.channels.telegram.types, ['declined']);
  });

  it('offers the manager types to request managers', async () => {
    const manager = await makeUser('reqmanager', Permission.MANAGE_REQUESTS);
    const { agent } = await loginAs(manager.email);

    const res = await agent.get(`/user/${manager.id}/settings/notifications`);
    assert.deepStrictEqual(res.body.availableTypes, [
      'pending',
      'autoApproved',
      'approved',
      'declined',
      'available',
      'failed',
    ]);
  });

  it('rejects a malformed Discord ID', async () => {
    const user = await makeUser('notified', Permission.REQUEST);
    const { agent } = await loginAs(user.email);

    const res = await agent
      .post(`/user/${user.id}/settings/notifications`)
      .send({ channels: { discord: { discordIds: ['not-a-number'] } } });
    assert.strictEqual(res.status, 400);
  });
});

describe('linked accounts', () => {
  const enableLastfm = () => {
    const settings = getSettings();
    settings.metadata.lastfm = {
      enabled: true,
      apiKey: 'lfm-key',
      sharedSecret: 'lfm-secret',
    };
    settings.scrobble.lastfm.enabled = true;
  };
  const enableSpotify = () => {
    const settings = getSettings();
    settings.discover.spotify.enabled = true;
    settings.discover.spotify.clientId = 'spotify-client';
    settings.discover.spotify.clientSecret = 'spotify-secret';
  };

  it('lists a row per provider and marks the ones that are switched off', async () => {
    const user = await makeUser('linker', Permission.REQUEST);
    const { agent } = await loginAs(user.email);

    const res = await agent.get(`/user/${user.id}/settings/linked-accounts`);
    assert.strictEqual(res.status, 200);
    const byProvider = Object.fromEntries(
      res.body.accounts.map((a: { provider: string }) => [a.provider, a])
    );
    assert.deepStrictEqual(Object.keys(byProvider), [
      'plex',
      'jellyfin',
      'lastfm',
      'listenbrainz',
      'spotify',
    ]);
    assert.strictEqual(byProvider.plex.available, true);
    assert.strictEqual(byProvider.plex.linked, false);
    assert.strictEqual(byProvider.jellyfin.available, false);
    assert.strictEqual(byProvider.lastfm.available, false);
    assert.strictEqual(byProvider.listenbrainz.available, false);
    assert.strictEqual(byProvider.spotify.available, false);
  });

  it('ListenBrainz: validates the pasted token, stores it encrypted, unlinks', async () => {
    getSettings().scrobble.listenbrainz.enabled = true;
    const user = await makeUser('linker', Permission.REQUEST);
    const { agent } = await loginAs(user.email);
    const url = `/user/${user.id}/settings/linked-accounts/listenbrainz`;

    const empty = await agent.post(url).send({ token: '' });
    assert.strictEqual(empty.status, 400);
    assert.strictEqual(listenbrainzMock.mock.callCount(), 0);

    const linked = await agent.post(url).send({ token: 'lb-token-123' });
    assert.strictEqual(linked.status, 200, JSON.stringify(linked.body));
    assert.strictEqual(linked.body.linked, true);
    assert.strictEqual(linked.body.externalUsername, 'lb-user');
    assert.ok(!JSON.stringify(linked.body).includes('lb-token-123'));

    const row = await getRepository(LinkedAccount)
      .createQueryBuilder('la')
      .addSelect('la.secret')
      .getOneOrFail();
    assert.match(row.secret, /^v1:/);
    assert.ok(!row.secret.includes('lb-token-123'));
    assert.strictEqual(
      await getLinkedSecret(user.id, 'listenbrainz'),
      'lb-token-123'
    );

    const unlinked = await agent.delete(url);
    assert.strictEqual(unlinked.status, 204);
    assert.strictEqual(await getLinkedSecret(user.id, 'listenbrainz'), null);
  });

  it('ListenBrainz: is refused while the integration is off', async () => {
    const user = await makeUser('linker', Permission.REQUEST);
    const { agent } = await loginAs(user.email);

    const res = await agent
      .post(`/user/${user.id}/settings/linked-accounts/listenbrainz`)
      .send({ token: 'lb-token-123' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(listenbrainzMock.mock.callCount(), 0);
  });

  it('Last.fm: authorize URL, then the callback stores the session key', async () => {
    enableLastfm();
    const user = await makeUser('linker', Permission.REQUEST);
    const { agent } = await loginAs(user.email);

    const authorize = await agent.get(
      `/user/${user.id}/settings/linked-accounts/lastfm/authorize`
    );
    assert.strictEqual(authorize.status, 200, JSON.stringify(authorize.body));
    const url = new URL(authorize.body.url);
    assert.strictEqual(
      url.origin + url.pathname,
      'https://www.last.fm/api/auth/'
    );
    assert.strictEqual(url.searchParams.get('api_key'), 'lfm-key');
    const cb = new URL(url.searchParams.get('cb')!);
    assert.strictEqual(
      cb.origin + cb.pathname,
      'https://music.example.test/api/v1/callback/lastfm'
    );
    const state = cb.searchParams.get('state')!;

    // The return works without the session cookie: the state identifies the user.
    const back = await request(app)
      .get('/callback/lastfm')
      .query({ state, token: 'web-auth-token' });
    assert.strictEqual(back.status, 302);
    assert.strictEqual(
      back.headers.location,
      '/profile/settings/linked-accounts?linked=lastfm'
    );
    assert.strictEqual(lastfmSessionMock.mock.callCount(), 1);
    assert.strictEqual(
      await getLinkedSecret(user.id, 'lastfm'),
      'lastfm-session-key'
    );

    // A state is single use.
    const replay = await request(app)
      .get('/callback/lastfm')
      .query({ state, token: 'web-auth-token' });
    assert.match(replay.headers.location, /error=lastfm_expired/);
    assert.strictEqual(lastfmSessionMock.mock.callCount(), 1);
  });

  it('Spotify: PKCE authorize URL with the documented scopes, callback stores the refresh token', async () => {
    enableSpotify();
    const user = await makeUser(
      'linker',
      Permission.REQUEST | Permission.AUTO_REQUEST
    );
    const { agent } = await loginAs(user.email);

    const authorize = await agent.get(
      `/user/${user.id}/settings/linked-accounts/spotify/authorize`
    );
    assert.strictEqual(authorize.status, 200, JSON.stringify(authorize.body));
    const url = new URL(authorize.body.url);
    assert.strictEqual(
      url.origin + url.pathname,
      'https://accounts.spotify.com/authorize'
    );
    assert.strictEqual(url.searchParams.get('client_id'), 'spotify-client');
    assert.strictEqual(url.searchParams.get('response_type'), 'code');
    assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256');
    assert.strictEqual(
      url.searchParams.get('scope'),
      'playlist-read-private user-library-read'
    );
    assert.strictEqual(
      url.searchParams.get('redirect_uri'),
      'https://music.example.test/api/v1/callback/spotify'
    );
    const state = url.searchParams.get('state')!;

    const back = await agent
      .get('/callback/spotify')
      .query({ state, code: 'auth-code' });
    assert.strictEqual(back.status, 302);
    assert.strictEqual(
      back.headers.location,
      '/profile/settings/linked-accounts?linked=spotify'
    );
    const [code, verifier, redirectUri] =
      spotifyExchangeMock.mock.calls[0].arguments;
    assert.strictEqual(code, 'auth-code');
    assert.strictEqual(
      pkceChallenge(verifier as string),
      url.searchParams.get('code_challenge')
    );
    assert.strictEqual(
      redirectUri,
      'https://music.example.test/api/v1/callback/spotify'
    );
    assert.strictEqual(
      await getLinkedSecret(user.id, 'spotify'),
      'spotify-refresh-token'
    );

    const list = await agent.get(`/user/${user.id}/settings/linked-accounts`);
    const spotify = list.body.accounts.find(
      (a: { provider: string }) => a.provider === 'spotify'
    );
    assert.strictEqual(spotify.externalUsername, 'Spotify Person');
    assert.ok(!JSON.stringify(list.body).includes('spotify-refresh-token'));

    // Unlinking also switches off "Request albums I save on Spotify".
    await agent
      .post(`/user/${user.id}/settings/main`)
      .send({ autoRequestSpotifySaved: true });
    await agent.delete(`/user/${user.id}/settings/linked-accounts/spotify`);
    const main = await agent.get(`/user/${user.id}/settings/main`);
    assert.strictEqual(main.body.autoRequestSpotifySaved, false);
  });

  it('Spotify: a cancelled or forged return links nothing', async () => {
    enableSpotify();
    const user = await makeUser('linker', Permission.REQUEST);
    const { agent } = await loginAs(user.email);
    const authorize = await agent.get(
      `/user/${user.id}/settings/linked-accounts/spotify/authorize`
    );
    const state = new URL(authorize.body.url).searchParams.get('state')!;

    const forged = await agent
      .get('/callback/spotify')
      .query({ state: 'made-up', code: 'x' });
    assert.match(forged.headers.location, /error=spotify_expired/);

    const cancelled = await agent
      .get('/callback/spotify')
      .query({ state, error: 'access_denied' });
    assert.match(cancelled.headers.location, /error=spotify_denied/);
    assert.strictEqual(spotifyExchangeMock.mock.callCount(), 0);
    assert.strictEqual(await getLinkedSecret(user.id, 'spotify'), null);
  });

  it("you can't link on someone else's behalf", async () => {
    getSettings().scrobble.listenbrainz.enabled = true;
    const user = await makeUser('linker', Permission.REQUEST);
    const { agent } = await loginAs(OWNER);

    const res = await agent
      .post(`/user/${user.id}/settings/linked-accounts/listenbrainz`)
      .send({ token: 'lb-token-123' });
    assert.strictEqual(res.status, 403);
  });

  it("a media-server link can't be removed while it is the only way to sign in", async () => {
    const plexUser = await getRepository(User).save(
      new User({
        email: 'plexonly@shufflerr.test',
        plexUsername: 'plexonly',
        plexId: 5151,
        permissions: Permission.REQUEST,
        avatar: '',
        userType: UserType.PLEX,
      })
    );
    const { agent } = await loginAs(OWNER);
    const url = `/user/${plexUser.id}/settings/linked-accounts/plex`;

    const refused = await agent.delete(url);
    assert.strictEqual(refused.status, 400);

    await agent
      .post(`/user/${plexUser.id}/settings/password`)
      .send({ newPassword: 'longenough' });
    const ok = await agent.delete(url);
    assert.strictEqual(ok.status, 204);

    const after = await getRepository(User).findOneOrFail({
      where: { id: plexUser.id },
    });
    assert.strictEqual(after.plexId, null);
    assert.strictEqual(after.userType, UserType.LOCAL);
  });

  it('signs Last.fm calls the documented way', () => {
    // md5("api_keyKmethodauth.getSessiontokenT" + secret)
    const expected = createHash('md5')
      .update('api_keyKmethodauth.getSessiontokenTS')
      .digest('hex');
    assert.strictEqual(
      lastfmSignature(
        { token: 'T', method: 'auth.getSession', api_key: 'K', format: 'json' },
        'S'
      ),
      expected
    );
  });
});

describe('GET /user/:id/recently-played', () => {
  it('is empty until something has been played, then lists real plays newest first', async () => {
    const user = await makeUser('player', Permission.REQUEST);
    const { agent } = await loginAs(user.email);
    const url = `/user/${user.id}/recently-played`;

    const empty = await agent.get(url);
    assert.strictEqual(empty.status, 200);
    assert.deepStrictEqual(empty.body.results, []);
    assert.deepStrictEqual(empty.body.scrobblingTo, []);

    const repo = getRepository(ScrobbleQueue);
    const play = (track: string, minutesAgo: number) =>
      repo.save(
        new ScrobbleQueue({
          user,
          artist: 'An Artist',
          track,
          album: 'An Album',
          releaseGroupMbid: '22222222-2222-4222-8222-222222222222',
          playedAt: new Date(Date.now() - minutesAgo * 60 * 1000),
          source: 'web',
          targets: {},
        })
      );
    await play('Older', 30);
    await play('Newer', 5);
    await play('Newer', 1); // same track again, back to back

    const res = await agent.get(url).query({ take: 5 });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((p: { title: string }) => p.title),
      ['Newer', 'Older']
    );
    assert.strictEqual(res.body.results[0].artistName, 'An Artist');
    assert.strictEqual(res.body.results[0].source, 'web');
    assert.strictEqual(res.body.results[0].playable, false);
    assert.strictEqual(
      res.body.results[0].coverUrl,
      '/imageproxy/caa/release-group/22222222-2222-4222-8222-222222222222/front-250'
    );
    assert.ok(res.body.sources.includes('web'));
  });
});
