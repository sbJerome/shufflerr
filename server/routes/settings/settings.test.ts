import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

import { getRepository } from '@server/datasource';
import AppPassword from '@server/entity/AppPassword';
import { User } from '@server/entity/User';
import { scheduledJobs, startJobs, stopJobs } from '@server/job/schedule';
import { Permission } from '@server/lib/permissions';
import type { AllSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import { setupTestDb } from '@server/test/db';
import axios from 'axios';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import settingsRoutes from './index';

let app: Express;
let pristine: AllSettings;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({ secret: 'test-secret', resave: false, saveUninitialized: false })
  );
  app.use(checkUser);
  app.use('/auth', authRoutes);
  app.use(
    '/settings',
    isAuthenticated(Permission.MANAGE_SETTINGS),
    settingsRoutes
  );
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
  return app;
}

before(async () => {
  app = createApp();
  const settings = getSettings();
  // Never touch the real settings.json from tests.
  mock.method(settings, 'save', async () => undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pristine = structuredClone((settings as any).data);
  startJobs();
});

after(() => {
  stopJobs();
  mock.restoreAll();
});

type HttpCall = { url: string; body?: unknown; config?: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Replaces axios.get/post for one test; no request leaves the process. */
function stubHttp(
  method: 'get' | 'post',
  reply: (call: HttpCall) => { status: number; data?: unknown }
) {
  const calls: HttpCall[] = [];
  const stub = mock.method(axios, method, async (...args: unknown[]) => {
    const call: HttpCall =
      method === 'get'
        ? { url: String(args[0]), config: args[1] as HttpCall['config'] }
        : {
            url: String(args[0]),
            body: args[1],
            config: args[2] as HttpCall['config'],
          };
    calls.push(call);
    const { status, data } = reply(call);
    const ok = call.config?.validateStatus
      ? call.config.validateStatus(status)
      : status >= 200 && status < 300;
    if (!ok) {
      throw Object.assign(
        new Error(`Request failed with status code ${status}`),
        {
          response: { status, data },
        }
      );
    }
    return { status, data };
  });
  return { calls, restore: () => stub.mock.restore() };
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getSettings() as any).data = structuredClone(pristine);
  getSettings().main.localLogin = true;
});

setupTestDb();

async function loginAs(email: string) {
  const agent = request.agent(app);
  const res = await agent
    .post('/auth/local')
    .send({ email, password: 'test1234' });
  assert.strictEqual(res.status, 200);
  return agent;
}
const admin = () => loginAs('admin@shufflerr.test');

describe('settings access', () => {
  it('refuses people without MANAGE_SETTINGS', async () => {
    const agent = await loginAs('demo@shufflerr.test');
    const res = await agent.get('/settings/main');
    assert.strictEqual(res.status, 403);
  });

  it('refuses signed-out requests', async () => {
    const res = await request(app).get('/settings/network');
    assert.strictEqual(res.status, 403);
  });
});

describe('/settings/main', () => {
  it('round-trips the general fields', async () => {
    const agent = await admin();
    const res = await agent.post('/settings/main').send({
      applicationTitle: '  Listening room ',
      applicationUrl: 'https://music.example.test',
      locale: 'de',
      discoverRegion: 'gb',
      allowTrackRequests: false,
      hideAvailable: true,
      cacheImages: false,
      versionCheck: false,
    });
    assert.strictEqual(res.status, 200, res.body.message);

    const got = (await agent.get('/settings/main')).body;
    assert.strictEqual(got.applicationTitle, 'Listening room');
    assert.strictEqual(got.applicationUrl, 'https://music.example.test');
    assert.strictEqual(got.locale, 'de');
    assert.strictEqual(got.discoverRegion, 'GB');
    assert.strictEqual(got.allowTrackRequests, false);
    assert.strictEqual(got.hideAvailable, true);
    assert.strictEqual(got.cacheImages, false);
  });

  it('requires a title', async () => {
    const agent = await admin();
    const res = await agent
      .post('/settings/main')
      .send({ applicationTitle: '   ' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.message, 'Enter an application title.');
  });

  it('rejects a trailing slash and a non-URL', async () => {
    const agent = await admin();
    const slash = await agent
      .post('/settings/main')
      .send({ applicationUrl: 'https://music.example.test/' });
    assert.strictEqual(slash.status, 400);
    assert.match(slash.body.message, /Remove the slash/);

    const bad = await agent
      .post('/settings/main')
      .send({ applicationUrl: 'music.example.test' });
    assert.strictEqual(bad.status, 400);
    assert.match(bad.body.message, /isn't a valid address/);
  });

  it('never changes the API key through POST, only through regenerate', async () => {
    const agent = await admin();
    const before = getSettings().main.apiKey;
    await agent
      .post('/settings/main')
      .send({ apiKey: 'chosen-by-client', unknownKey: 1 });
    assert.strictEqual(getSettings().main.apiKey, before);
    assert.ok(!('unknownKey' in getSettings().main));

    const res = await agent.post('/settings/main/regenerate');
    assert.strictEqual(res.status, 200);
    assert.notStrictEqual(res.body.apiKey, before);
    assert.strictEqual(res.body.apiKey, getSettings().main.apiKey);
  });
});

describe('/settings/users', () => {
  it('keeps at least one sign-in method on', async () => {
    const agent = await admin();
    const res = await agent
      .post('/settings/users')
      .send({ localLogin: false, plexLogin: false, jellyfinLogin: false });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(
      res.body.message,
      'At least one sign-in method has to stay on.'
    );
    assert.strictEqual(getSettings().main.localLogin, true);
  });

  it('round-trips sign-in methods, limits and default permissions', async () => {
    const agent = await admin();
    const res = await agent.post('/settings/users').send({
      localLogin: true,
      plexLogin: true,
      newPlexLogin: false,
      jellyfinLogin: true,
      newJellyfinLogin: true,
      defaultPermissions: Permission.REQUEST | Permission.AUTO_APPROVE_ALBUM,
      defaultQuotas: {
        album: { quotaLimit: 5, quotaDays: 14 },
        track: { quotaLimit: 0, quotaDays: 30 },
      },
      discographyAlwaysReview: false,
    });
    assert.strictEqual(res.status, 200, res.body.message);

    const got = (await agent.get('/settings/users')).body;
    assert.deepStrictEqual(got, res.body);
    assert.strictEqual(got.plexLogin, true);
    assert.strictEqual(got.newJellyfinLogin, true);
    assert.deepStrictEqual(got.defaultQuotas.album, {
      quotaLimit: 5,
      quotaDays: 14,
    });
    assert.strictEqual(got.discographyAlwaysReview, false);
    assert.strictEqual(getSettings().plex.loginEnabled, true);
    assert.strictEqual(getSettings().jellyfin.newLogin, true);
    assert.strictEqual(getSettings().main.mediaServerLogin, true);
  });

  it('rejects negative limits', async () => {
    const agent = await admin();
    const res = await agent
      .post('/settings/users')
      .send({ defaultQuotas: { album: { quotaLimit: -1 } } });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /album limit/);
  });
});

describe('/settings/network', () => {
  it('masks the proxy password and keeps it when the mask comes back', async () => {
    const agent = await admin();
    const saved = await agent.post('/settings/network').send({
      proxy: {
        enabled: true,
        hostname: 'proxy.example.test',
        port: 3128,
        user: 'shuffle',
        password: 'correct-horse-battery',
      },
      dnsCache: { enabled: true, forceMinTtl: 60, forceMaxTtl: 600 },
      apiRequestTimeout: 15000,
    });
    assert.strictEqual(saved.status, 200, saved.body.message);
    assert.strictEqual(saved.body.proxy.password, '••••tery');

    const again = await agent
      .post('/settings/network')
      .send({ proxy: { password: saved.body.proxy.password, port: 8080 } });
    assert.strictEqual(again.status, 200);
    assert.strictEqual(
      getSettings().network.proxy.password,
      'correct-horse-battery'
    );
    assert.strictEqual(getSettings().network.proxy.port, 8080);

    const cleared = await agent
      .post('/settings/network')
      .send({ proxy: { password: '' } });
    assert.strictEqual(cleared.body.proxy.password, '');
    assert.strictEqual(getSettings().network.proxy.password, '');
  });

  it('needs a hostname when the proxy is on', async () => {
    const agent = await admin();
    const res = await agent
      .post('/settings/network')
      .send({ proxy: { enabled: true, hostname: '' } });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /proxy hostname/);
    assert.strictEqual(getSettings().network.proxy.enabled, false);
  });

  it('rejects a minimum TTL above the maximum', async () => {
    const agent = await admin();
    const res = await agent
      .post('/settings/network')
      .send({ dnsCache: { forceMinTtl: 900, forceMaxTtl: 60 } });
    assert.strictEqual(res.status, 400);
  });
});

describe('/settings/metadata', () => {
  it('masks keys, keeps untouched ones and replaces changed ones', async () => {
    const agent = await admin();
    const saved = await agent.post('/settings/metadata').send({
      musicbrainz: { contact: 'owner@example.test' },
      fanart: { enabled: true, apiKey: 'fanart-key-0123456789' },
      lastfm: {
        enabled: true,
        apiKey: 'lastfm-key-abcdefgh',
        sharedSecret: 'lastfm-secret-ijklmnop',
      },
      priority: 'lastfm-first',
    });
    assert.strictEqual(saved.status, 200, saved.body.message);
    assert.strictEqual(saved.body.fanart.apiKey, '••••6789');
    assert.strictEqual(saved.body.lastfm.sharedSecret, '••••mnop');

    const again = await agent.post('/settings/metadata').send({
      ...saved.body,
      lastfm: { ...saved.body.lastfm, apiKey: 'a-brand-new-key-0000' },
    });
    assert.strictEqual(again.status, 200);
    const stored = getSettings().metadata;
    assert.strictEqual(stored.fanart.apiKey, 'fanart-key-0123456789');
    assert.strictEqual(stored.lastfm.apiKey, 'a-brand-new-key-0000');
    assert.strictEqual(stored.lastfm.sharedSecret, 'lastfm-secret-ijklmnop');
    assert.strictEqual(stored.priority, 'lastfm-first');
    assert.strictEqual(stored.musicbrainz.contact, 'owner@example.test');
  });

  it('holds the public MusicBrainz server to 1 request per second', async () => {
    const agent = await admin();
    const res = await agent
      .post('/settings/metadata')
      .send({ musicbrainz: { requestsPerSecond: 10 } });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /1 request per second/);

    const mirror = await agent.post('/settings/metadata').send({
      musicbrainz: { url: 'http://mb.lan:5000', requestsPerSecond: 10 },
    });
    assert.strictEqual(mirror.status, 200, mirror.body.message);
    assert.strictEqual(
      getSettings().metadata.musicbrainz.requestsPerSecond,
      10
    );
  });

  it('wants a key before fanart.tv or Last.fm turn on, and drops unknown keys', async () => {
    const agent = await admin();
    const fanart = await agent
      .post('/settings/metadata')
      .send({ fanart: { enabled: true } });
    assert.strictEqual(fanart.status, 400);
    assert.match(fanart.body.message, /fanart\.tv API key/);

    const ok = await agent
      .post('/settings/metadata')
      .send({ coverArtArchive: { enabled: false, sneaky: true }, extra: 1 });
    assert.strictEqual(ok.status, 200);
    assert.ok(!('extra' in getSettings().metadata));
    assert.ok(!('sneaky' in getSettings().metadata.coverArtArchive));
    assert.strictEqual(getSettings().metadata.coverArtArchive.enabled, false);
  });
});

describe('/settings/youtube, /discover, /scrobble, /clients', () => {
  it('validates YouTube', async () => {
    const agent = await admin();
    const res = await agent.post('/settings/youtube').send({ enabled: true });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /YouTube Data API key/);

    const ok = await agent.post('/settings/youtube').send({
      enabled: true,
      apiKey: 'AIzaSy-example-key-1234',
      region: 'GB',
      fillMissingWhileDownloading: false,
    });
    assert.strictEqual(ok.status, 200, ok.body.message);
    assert.strictEqual(ok.body.apiKey, '••••1234');
    assert.strictEqual(getSettings().integrations.youtube, true);
  });

  it('validates each discover source and reschedules the Spotify check', async () => {
    const agent = await admin();
    const noSecret = await agent
      .post('/settings/discover')
      .send({ spotify: { enabled: true, clientId: 'abc' } });
    assert.strictEqual(noSecret.status, 400);
    assert.match(noSecret.body.message, /Spotify client ID and client secret/);

    const badCountry = await agent
      .post('/settings/discover')
      .send({ itunes: { enabled: true, country: 'USA' } });
    assert.strictEqual(badCountry.status, 400);

    const ok = await agent.post('/settings/discover').send({
      spotify: {
        enabled: true,
        clientId: 'client-id',
        clientSecret: 'client-secret-wxyz',
        savedAlbumsSync: 'hourly',
      },
      deezer: { enabled: true },
      ticketmaster: {
        enabled: true,
        apiKey: 'tm-key-12345678',
        country: 'GB',
        radiusMiles: 25,
      },
      listenbrainzTrending: { enabled: true },
    });
    assert.strictEqual(ok.status, 200, ok.body.message);
    assert.strictEqual(ok.body.spotify.clientSecret, '••••wxyz');
    assert.strictEqual(ok.body.ticketmaster.apiKey, '••••5678');
    assert.strictEqual(
      scheduledJobs.find((j) => j.id === 'spotify-saved-albums-sync')
        ?.cronSchedule,
      '0 0 * * * *'
    );
    assert.strictEqual(getSettings().integrations.spotify, true);
  });

  it('needs the Last.fm key before Last.fm scrobbling turns on', async () => {
    const agent = await admin();
    const res = await agent
      .post('/settings/scrobble')
      .send({ lastfm: { enabled: true } });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /under Metadata first/);

    const ok = await agent.post('/settings/scrobble').send({
      listenbrainz: { enabled: true, url: 'https://lb.example.test' },
      rule: 'end',
      sources: { plex: false },
    });
    assert.strictEqual(ok.status, 200, ok.body.message);
    assert.strictEqual(ok.body.rule, 'end');
    assert.strictEqual(ok.body.sources.plex, false);
    assert.strictEqual(ok.body.sources.web, true);

    const badRule = await agent
      .post('/settings/scrobble')
      .send({ rule: '10s' });
    assert.strictEqual(badRule.status, 400);
  });

  it('builds client endpoints from the application URL', async () => {
    const agent = await admin();
    getSettings().main.applicationUrl = 'https://music.example.test';
    const res = await agent.post('/settings/clients').send({
      openSubsonic: true,
      jellyfinApi: false,
      mobileTranscode: 'mp3-320',
      endpoints: { openSubsonic: 'ignored' },
    });
    assert.strictEqual(res.status, 200, res.body.message);
    assert.deepStrictEqual(res.body.endpoints, {
      openSubsonic: 'https://music.example.test/rest',
      jellyfin: 'https://music.example.test/jellyfin',
    });
    assert.strictEqual(res.body.mobileTranscode, 'mp3-320');

    const bad = await agent
      .post('/settings/clients')
      .send({ mobileTranscode: 'flac-999' });
    assert.strictEqual(bad.status, 400);
  });

  it('lists and revokes app passwords across users', async () => {
    const agent = await admin();
    const user = await getRepository(User).findOneOrFail({
      where: { email: 'demo@shufflerr.test' },
    });
    const repo = getRepository(AppPassword);
    const row = await repo.save(
      repo.create({
        user,
        name: 'Phone app',
        hash: 'not-a-real-hash',
        encryptedSecret: 'not-a-real-secret',
      })
    );

    const list = await agent.get('/settings/clients/devices');
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.length, 1);
    assert.strictEqual(list.body[0].name, 'Phone app');
    assert.strictEqual(list.body[0].user.id, user.id);
    assert.ok(!('hash' in list.body[0]));

    const del = await agent.delete(`/settings/clients/devices/${row.id}`);
    assert.strictEqual(del.status, 204);
    assert.strictEqual(await repo.count(), 0);

    const gone = await agent.delete(`/settings/clients/devices/${row.id}`);
    assert.strictEqual(gone.status, 404);
  });
});

describe('connection tests', () => {
  it('reports a rejected Last.fm key in plain words', async () => {
    const http = stubHttp('get', () => ({
      status: 403,
      data: { error: 10, message: 'Invalid API key' },
    }));
    try {
      const agent = await admin();
      const res = await agent
        .post('/settings/metadata/test/lastfm')
        .send({ apiKey: 'wrong' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, false);
      assert.match(res.body.message, /didn't accept that API key/);
      assert.strictEqual(http.calls[0].config?.params.api_key, 'wrong');
    } finally {
      http.restore();
    }
  });

  it('tests MusicBrainz with the Shufflerr user agent and the unsaved URL', async () => {
    const http = stubHttp('get', () => ({
      status: 200,
      data: { count: 1, artists: [] },
    }));
    try {
      const agent = await admin();
      const res = await agent
        .post('/settings/metadata/test/musicbrainz')
        .send({ url: 'http://mb.lan:5000/', contact: 'owner@example.test' });
      assert.deepStrictEqual(res.body, { ok: true, name: 'MusicBrainz' });
      assert.strictEqual(http.calls[0].url, 'http://mb.lan:5000/ws/2/artist');
      assert.match(
        http.calls[0].config?.headers['User-Agent'],
        /^Shufflerr\/\S+ \( owner@example\.test \)$/
      );
    } finally {
      http.restore();
    }
  });

  it('says when the address is not a MusicBrainz server', async () => {
    const http = stubHttp('get', () => ({
      status: 200,
      data: '<html></html>',
    }));
    try {
      const agent = await admin();
      const res = await agent
        .post('/settings/metadata/test/musicbrainz')
        .send({ url: 'http://mb.lan:5000' });
      assert.strictEqual(res.body.ok, false);
      assert.match(res.body.message, /not like a MusicBrainz server/);
    } finally {
      http.restore();
    }
  });

  it('uses the stored secret when the masked one is posted', async () => {
    getSettings().discover.spotify.clientId = 'stored-id';
    getSettings().discover.spotify.clientSecret = 'stored-secret-9999';
    const http = stubHttp('post', () => ({
      status: 200,
      data: { access_token: 'x', expires_in: 3600 },
    }));
    try {
      const agent = await admin();
      const res = await agent
        .post('/settings/discover/test/spotify')
        .send({ clientId: 'stored-id', clientSecret: '••••9999' });
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(
        http.calls[0].config?.headers.Authorization,
        `Basic ${Buffer.from('stored-id:stored-secret-9999').toString('base64')}`
      );
    } finally {
      http.restore();
    }
  });

  it('does not call out when there is no key to test', async () => {
    const http = stubHttp('get', () => ({ status: 200, data: {} }));
    try {
      const agent = await admin();
      const res = await agent.post('/settings/youtube/test').send({});
      assert.strictEqual(res.body.ok, false);
      assert.match(res.body.message, /Enter the YouTube Data API key first/);
      assert.strictEqual(http.calls.length, 0);
    } finally {
      http.restore();
    }
  });
});

describe('/settings/jobs and /settings/cache', () => {
  it('lists the 15 jobs with schedules in words', async () => {
    const agent = await admin();
    const res = await agent.get('/settings/jobs');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, 15);
    const sync = res.body.find((j: { id: string }) => j.id === 'download-sync');
    assert.strictEqual(sync.cronSchedule, '0 * * * * *');
    assert.strictEqual(sync.scheduleText, 'Every minute');
    assert.strictEqual(sync.running, false);
    assert.ok(sync.nextExecutionTime);
    const scrobble = res.body.find(
      (j: { id: string }) => j.id === 'scrobble-queue'
    );
    assert.strictEqual(scrobble.cronSchedule, '*/30 * * * * *');
    // Lidarr isn't configured in the test settings: its jobs skip their ticks.
    assert.strictEqual(sync.enabled, false);
  });

  it('edits a schedule and refuses a broken one', async () => {
    const agent = await admin();
    const ok = await agent
      .post('/settings/jobs/lidarr-scan/schedule')
      .send({ schedule: '0 30 5 * * *' });
    assert.strictEqual(ok.status, 200, ok.body.message);
    assert.strictEqual(ok.body.cronSchedule, '0 30 5 * * *');
    assert.strictEqual(
      getSettings().jobs['lidarr-scan'].schedule,
      '0 30 5 * * *'
    );

    for (const schedule of ['every day', '* * * * *', '0 99 5 * * *', '']) {
      const bad = await agent
        .post('/settings/jobs/lidarr-scan/schedule')
        .send({ schedule });
      assert.strictEqual(bad.status, 400, `accepted "${schedule}"`);
    }
    assert.strictEqual(
      getSettings().jobs['lidarr-scan'].schedule,
      '0 30 5 * * *'
    );

    const missing = await agent
      .post('/settings/jobs/nope/schedule')
      .send({ schedule: '0 0 5 * * *' });
    assert.strictEqual(missing.status, 404);
  });

  it('runs a job now and reports it as running', async () => {
    const agent = await admin();
    const res = await agent.post('/settings/jobs/image-cache-cleanup/run');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.running, true);
    assert.strictEqual(res.body.id, 'image-cache-cleanup');
  });

  it('lists caches by display name and flushes one', async () => {
    const agent = await admin();
    const res = await agent.get('/settings/cache');
    assert.strictEqual(res.status, 200);
    const names = res.body.apiCaches.map((c: { name: string }) => c.name);
    for (const name of [
      'MusicBrainz',
      'Cover Art Archive',
      'Last.fm',
      'Lidarr',
    ]) {
      assert.ok(names.includes(name), `missing ${name}`);
    }
    assert.ok('caa' in res.body.imageCache);

    assert.strictEqual(
      (await agent.post('/settings/cache/musicbrainz/flush')).status,
      204
    );
    assert.strictEqual(
      (await agent.post('/settings/cache/nope/flush')).status,
      404
    );
    assert.strictEqual(
      (await agent.post('/settings/cache/images/cleanup')).status,
      204
    );
  });

  it('reports real counts on About', async () => {
    const agent = await admin();
    const res = await agent.get('/settings/about');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.totalUsers, await getRepository(User).count());
    assert.strictEqual(res.body.totalRequests, 0);
    assert.strictEqual(res.body.totalMediaItems, 0);
    assert.ok(res.body.version);
    assert.ok(res.body.tz);
  });
});

describe('/settings/notifications', () => {
  it('lists the ten agents in page order', async () => {
    const agent = await admin();
    const res = await agent.get('/settings/notifications');
    assert.deepStrictEqual(
      res.body.agents.map((a: { key: string }) => a.key),
      [
        'email',
        'webpush',
        'discord',
        'slack',
        'telegram',
        'pushbullet',
        'pushover',
        'webhook',
        'gotify',
        'ntfy',
      ]
    );
    assert.ok(res.body.agents.every((a: { enabled: boolean }) => !a.enabled));
  });

  it('speaks string type keys and masks secrets', async () => {
    const agent = await admin();
    const saved = await agent.post('/settings/notifications/discord').send({
      enabled: true,
      types: ['pending', 'autoApproved', 'available'],
      options: {
        webhookUrl: 'https://discord.example.test/api/webhooks/1/abcdWXYZ',
        botUsername: 'Shufflerr',
        enableMentions: true,
      },
    });
    assert.strictEqual(saved.status, 200, saved.body.message);
    assert.deepStrictEqual(saved.body.types, [
      'pending',
      'autoApproved',
      'available',
    ]);
    assert.strictEqual(saved.body.options.webhookUrl, '••••WXYZ');
    // Stored as Seerr's bitmask: pending 2 | autoApproved 128 | available 8
    assert.strictEqual(getSettings().notifications.agents.discord.types, 138);

    const again = await agent
      .post('/settings/notifications/discord')
      .send({ ...saved.body, types: ['failed'] });
    assert.strictEqual(again.status, 200);
    assert.strictEqual(
      getSettings().notifications.agents.discord.options.webhookUrl,
      'https://discord.example.test/api/webhooks/1/abcdWXYZ'
    );
    assert.deepStrictEqual(again.body.types, ['failed']);
  });

  it('says what is missing when an agent is switched on', async () => {
    const agent = await admin();
    const cases: [string, object, RegExp][] = [
      ['discord', {}, /Enter the webhook URL/],
      ['slack', { webhookUrl: 'not a url' }, /isn't a valid address/],
      ['telegram', { botAPI: 'x' }, /Enter the chat ID/],
      ['pushover', { accessToken: 'x' }, /user or group key/],
      [
        'gotify',
        { url: 'https://g.example.test', token: 't', priority: 99 },
        /0 to 10/,
      ],
      ['ntfy', { url: 'https://ntfy.example.test' }, /Enter the topic/],
      [
        'email',
        { emailFrom: 'nope', smtpHost: 'smtp.example.test' },
        /valid email/,
      ],
    ];
    for (const [key, options, pattern] of cases) {
      const res = await agent
        .post(`/settings/notifications/${key}`)
        .send({ enabled: true, types: [], options });
      assert.strictEqual(res.status, 400, key);
      assert.match(res.body.message, pattern, key);
    }
    // Switched off, incomplete settings are allowed to be saved.
    const off = await agent
      .post('/settings/notifications/telegram')
      .send({ enabled: false, types: [], options: { botAPI: 'x' } });
    assert.strictEqual(off.status, 200);

    assert.strictEqual(
      (await agent.get('/settings/notifications/carrier-pigeon')).status,
      404
    );
  });

  it('maps the email encryption choice onto the SMTP flags', async () => {
    const agent = await admin();
    const res = await agent.post('/settings/notifications/email').send({
      enabled: true,
      types: ['approved', 'available'],
      options: {
        senderName: 'Shufflerr',
        emailFrom: 'shufflerr@example.test',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        encryption: 'starttls',
        authUser: 'shufflerr',
        authPass: 'smtp-password-1234',
      },
    });
    assert.strictEqual(res.status, 200, res.body.message);
    assert.strictEqual(res.body.options.encryption, 'starttls');
    assert.strictEqual(res.body.options.authPass, '••••1234');
    const stored = getSettings().notifications.agents.email.options;
    assert.strictEqual(stored.requireTls, true);
    assert.strictEqual(stored.secure, false);
    assert.strictEqual(stored.authPass, 'smtp-password-1234');
    assert.ok(!('encryption' in stored));
  });

  it('stores the webhook template and rejects broken JSON', async () => {
    const agent = await admin();
    const template =
      '{\n  "what": "{{event}}",\n  "album": "{{media_title}}"\n}';
    const saved = await agent.post('/settings/notifications/webhook').send({
      enabled: true,
      types: ['pending'],
      options: {
        webhookUrl: 'https://hooks.example.test/in',
        authHeader: 'Bearer secret-token-7777',
        jsonPayload: template,
      },
    });
    assert.strictEqual(saved.status, 200, saved.body.message);
    assert.strictEqual(saved.body.options.jsonPayload, template);
    assert.strictEqual(saved.body.options.authHeader, '••••7777');

    const got = await agent.get('/settings/notifications/webhook');
    assert.strictEqual(got.body.options.jsonPayload, template);

    const bad = await agent.post('/settings/notifications/webhook').send({
      enabled: true,
      types: ['pending'],
      options: {
        webhookUrl: 'https://hooks.example.test/in',
        jsonPayload: '{ nope',
      },
    });
    assert.strictEqual(bad.status, 400);
    assert.match(bad.body.message, /isn't valid JSON/);
  });

  it('sends a test with unsaved values and the stored secret', async () => {
    getSettings().notifications.agents.webhook.options.authHeader =
      'Bearer stored-token-4242';
    const http = stubHttp('post', () => ({ status: 200, data: {} }));
    try {
      const agent = await admin();
      const res = await agent
        .post('/settings/notifications/webhook/test')
        .send({
          enabled: false,
          types: [],
          options: {
            webhookUrl: 'https://hooks.example.test/test',
            authHeader: '••••4242',
            jsonPayload:
              '{"type":"{{notification_type}}","key":"{{notification_key}}","subject":"{{subject}}","message":"{{message}}"}',
          },
        });
      assert.strictEqual(res.status, 204, res.body?.message);
      assert.strictEqual(http.calls.length, 1);
      const call = http.calls[0];
      assert.strictEqual(call.url, 'https://hooks.example.test/test');
      assert.strictEqual(
        call.config?.headers.Authorization,
        'Bearer stored-token-4242'
      );
      const received = call.body as Record<string, string>;
      assert.strictEqual(received.type, 'TEST_NOTIFICATION');
      assert.strictEqual(received.key, 'test');
      assert.strictEqual(received.subject, 'Test notification');
      assert.match(received.message, /notifications work/);
      // Testing never saves.
      assert.strictEqual(
        getSettings().notifications.agents.webhook.options.webhookUrl,
        ''
      );
    } finally {
      http.restore();
    }
  });

  it('explains a failed test', async () => {
    const http = stubHttp('post', () => ({ status: 404 }));
    try {
      const agent = await admin();
      const res = await agent
        .post('/settings/notifications/discord/test')
        .send({
          enabled: true,
          types: [],
          options: {
            webhookUrl: 'https://discord.example.test/api/webhooks/1/x',
          },
        });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.message, /Discord didn't accept the test/);
    } finally {
      http.restore();
    }
  });
});
