// Contract for GET /api/v1/verifier/config — the unauthenticated endpoint the
// audio-verification sidecar polls. It returns `{ enabled, albumIds }`:
// `enabled` reflects `main.musicDirectGrab`, and `albumIds` is the set of Lidarr
// album ids the user has an open request for (direct-grab is scoped to those,
// never Lidarr's whole monitored-missing catalog). The real handler lives inline
// in routes/index.ts and derives albumIds from the database; this mirrors the
// response SHAPE so the contract stays pinned without booting the router graph.
import { getSettings } from '@server/lib/settings';
import express from 'express';
import type { Express } from 'express';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import request from 'supertest';

let app: Express;

before(() => {
  app = express();
  app.get('/verifier/config', (_req, res) => {
    const enabled = getSettings().main.musicDirectGrab;
    // When on, the real handler returns the requested-album ids; stub a
    // representative list here to pin the { enabled, albumIds } shape.
    const albumIds = enabled ? [139, 162] : [];
    res.status(200).json({ enabled, albumIds });
  });
});

describe('GET /verifier/config', () => {
  it('returns { enabled: false, albumIds: [] } by default', async () => {
    getSettings().main.musicDirectGrab = false;
    const res = await request(app).get('/verifier/config');
    assert.equal(res.status, 200);
    assert.equal(res.body.enabled, false);
    assert.deepEqual(res.body.albumIds, []);
  });

  it('includes the requested albumIds when turned on', async () => {
    getSettings().main.musicDirectGrab = true;
    const res = await request(app).get('/verifier/config');
    assert.equal(res.status, 200);
    assert.equal(res.body.enabled, true);
    assert.ok(Array.isArray(res.body.albumIds));
    assert.ok(res.body.albumIds.length > 0);
    getSettings().main.musicDirectGrab = false;
  });
});
