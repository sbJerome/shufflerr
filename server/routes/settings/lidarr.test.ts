// Settings → Lidarr: validation copy, the default-server rules, secret
// masking, and the connection test against an in-process fake Lidarr.
import type { LidarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { FakeLidarr } from '@server/test/fakeLidarr';
import type { Express } from 'express';
import express from 'express';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import request from 'supertest';
import lidarrRoutes from './lidarr';

let app: Express;
const lidarr = new FakeLidarr();
const settings = getSettings();
const savedServers = structuredClone(settings.lidarr);
let saveMock: ReturnType<typeof mock.method>;

before(async () => {
  await lidarr.start();
  // Never write the developer's real settings.json from a test.
  saveMock = mock.method(settings, 'save', async () => undefined);

  app = express();
  app.use(express.json());
  app.use('/settings/lidarr', lidarrRoutes);
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

beforeEach(() => {
  lidarr.reset();
  settings.lidarr = [];
  saveMock.mock.resetCalls();
});

after(async () => {
  await lidarr.stop();
  settings.lidarr = savedServers;
  mock.restoreAll();
});

const body = (overrides: Partial<LidarrSettings> = {}) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, ...server } = lidarr.settings(overrides);
  return server;
};

describe('POST /settings/lidarr', () => {
  it('saves a server, masks the key in the response, and makes the first one the default', async () => {
    const res = await request(app)
      .post('/settings/lidarr')
      .send(body({ isDefault: false }));

    assert.equal(res.status, 201);
    assert.equal(res.body.id, 0);
    assert.equal(res.body.isDefault, true);
    assert.equal(res.body.apiKey, '••••-key');
    assert.equal(settings.lidarr[0].apiKey, FakeLidarr.API_KEY);
    assert.equal(saveMock.mock.callCount(), 1);
  });

  it('explains what is wrong with each field', async () => {
    const cases: [Partial<LidarrSettings>, RegExp][] = [
      [{ name: ' ' }, /^Enter a name for this server\.$/],
      [{ hostname: '' }, /^Enter the hostname or IP address of Lidarr\.$/],
      [{ hostname: 'http://lidarr' }, /without http:\/\/ or https:\/\//],
      [{ port: 70000 }, /^Enter a port between 1 and 65535\.$/],
      [{ apiKey: '' }, /^Enter Lidarr's API key\./],
      [{ apiKey: '••••abcd' }, /^Enter Lidarr's API key\./],
      [{ baseUrl: 'lidarr/' }, /^The URL base has to start with a slash/],
      [{ activeQualityProfileId: 0 }, /^Choose a quality profile\./],
      [{ activeMetadataProfileId: 0 }, /^Choose a metadata profile\./],
      [{ activeDirectory: '' }, /^Choose a root folder\./],
    ];

    for (const [overrides, message] of cases) {
      const res = await request(app)
        .post('/settings/lidarr')
        .send(body(overrides));
      assert.equal(res.status, 400, JSON.stringify(overrides));
      assert.match(res.body.message, message);
    }
    assert.equal(settings.lidarr.length, 0);
    assert.equal(saveMock.mock.callCount(), 0);
  });

  it('keeps exactly one default, and at most one default hi-res server', async () => {
    const post = (overrides: Partial<LidarrSettings>) =>
      request(app).post('/settings/lidarr').send(body(overrides));

    await post({ name: 'main', isDefault: true });
    await post({ name: 'second', isDefault: true });
    await post({ name: 'hires-a', isHiRes: true, isDefault: true });
    await post({ name: 'hires-b', isHiRes: true, isDefault: true });
    await post({ name: 'hires-c', isHiRes: true, isDefault: false });

    const flags = () =>
      Object.fromEntries(settings.lidarr.map((s) => [s.name, s.isDefault]));
    assert.deepEqual(flags(), {
      main: false,
      second: true,
      'hires-a': false,
      'hires-b': true,
      'hires-c': false,
    });

    // Removing the default promotes another standard server; hi-res may have none.
    await request(app).delete('/settings/lidarr/1');
    await request(app).delete('/settings/lidarr/3');
    assert.deepEqual(flags(), {
      main: true,
      'hires-a': false,
      'hires-c': false,
    });
  });
});

describe('PUT / GET / DELETE /settings/lidarr', () => {
  it('keeps the stored key when the masked one comes back, replaces it when it changed', async () => {
    await request(app).post('/settings/lidarr').send(body());

    const kept = await request(app)
      .put('/settings/lidarr/0')
      .send(body({ name: 'renamed', apiKey: '••••-key' }));
    assert.equal(kept.status, 200);
    assert.equal(kept.body.name, 'renamed');
    assert.equal(settings.lidarr[0].apiKey, FakeLidarr.API_KEY);

    await request(app)
      .put('/settings/lidarr/0')
      .send(body({ apiKey: 'a-brand-new-key-1234' }));
    assert.equal(settings.lidarr[0].apiKey, 'a-brand-new-key-1234');

    assert.equal(
      (await request(app).put('/settings/lidarr/9').send(body())).status,
      404
    );
  });

  it('lists servers with a masked key and a live connection status', async () => {
    settings.lidarr = [
      lidarr.settings(),
      lidarr.settings({ id: 1, name: 'bad-key', apiKey: 'wrong-key-0000' }),
    ];

    const res = await request(app).get('/settings/lidarr');

    assert.equal(res.status, 200);
    assert.ok(!JSON.stringify(res.body).includes(FakeLidarr.API_KEY));
    assert.equal(res.body[0].apiKey, '••••-key');
    assert.deepEqual(res.body[0].status, {
      id: 0,
      connected: true,
      version: '3.1.0.4875',
    });
    assert.equal(res.body[1].status.connected, false);
    assert.match(res.body[1].status.error, /401/);
  });

  it('loads quality profiles for a saved server and removes servers', async () => {
    settings.lidarr = [lidarr.settings()];

    const profiles = await request(app).get('/settings/lidarr/0/profiles');
    assert.deepEqual(profiles.body, [
      { id: 1, name: 'Any' },
      { id: 2, name: 'Lossless' },
    ]);

    const removed = await request(app).delete('/settings/lidarr/0');
    assert.equal(removed.status, 200);
    assert.equal(removed.body.apiKey, '••••-key');
    assert.equal(settings.lidarr.length, 0);
    assert.equal((await request(app).delete('/settings/lidarr/0')).status, 404);
  });
});

describe('POST /settings/lidarr/test', () => {
  it('returns profiles, metadata profiles, root folders and tags', async () => {
    const res = await request(app).post('/settings/lidarr/test').send({
      hostname: '127.0.0.1',
      port: lidarr.port,
      apiKey: FakeLidarr.API_KEY,
      useSsl: false,
      baseUrl: '',
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      profiles: [
        { id: 1, name: 'Any' },
        { id: 2, name: 'Lossless' },
      ],
      metadataProfiles: [
        { id: 1, name: 'Standard' },
        { id: 2, name: 'None' },
      ],
      rootFolders: [{ id: 1, path: '/music' }],
      tags: [],
      urlBase: '',
      version: '3.1.0.4875',
    });
  });

  it('uses the stored key for a saved server when the masked key is sent', async () => {
    settings.lidarr = [lidarr.settings()];

    const res = await request(app).post('/settings/lidarr/test').send({
      id: 0,
      hostname: '127.0.0.1',
      port: lidarr.port,
      apiKey: '••••-key',
    });
    assert.equal(res.status, 200);
  });

  it('says how to fix a failed connection', async () => {
    const wrongKey = await request(app).post('/settings/lidarr/test').send({
      hostname: '127.0.0.1',
      port: lidarr.port,
      apiKey: 'not-the-key',
    });
    assert.equal(wrongKey.status, 500);
    assert.match(
      wrongKey.body.message,
      /^Couldn't connect to Lidarr\. Check the address, port, SSL setting and API key\./
    );

    const missing = await request(app)
      .post('/settings/lidarr/test')
      .send({ hostname: '', port: 8686, apiKey: 'x' });
    assert.equal(missing.status, 400);

    const noKey = await request(app)
      .post('/settings/lidarr/test')
      .send({ hostname: '127.0.0.1', port: lidarr.port });
    assert.equal(noKey.status, 400);
    assert.match(noKey.body.message, /API key/);
  });
});
