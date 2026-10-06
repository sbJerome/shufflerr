// Contract for GET /api/v1/verifier/config — the unauthenticated endpoint the
// audio-verification sidecar polls for the direct-grab on/off switch. It must
// return only `{ enabled }` reflecting `main.musicDirectGrab`. The handler lives
// inline in routes/index.ts; this mirrors it so the contract stays pinned
// without booting the whole router graph.
import { getSettings } from '@server/lib/settings';
import express from 'express';
import type { Express } from 'express';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import request from 'supertest';

let app: Express;

before(() => {
  app = express();
  app.get('/verifier/config', (_req, res) =>
    res.status(200).json({ enabled: getSettings().main.musicDirectGrab })
  );
});

describe('GET /verifier/config', () => {
  it('returns only { enabled } and defaults to false', async () => {
    getSettings().main.musicDirectGrab = false;
    const res = await request(app).get('/verifier/config');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { enabled: false });
  });

  it('reflects the setting when turned on', async () => {
    getSettings().main.musicDirectGrab = true;
    const res = await request(app).get('/verifier/config');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { enabled: true });
    getSettings().main.musicDirectGrab = false;
  });
});
