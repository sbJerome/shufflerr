import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { isAuthenticated } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import playlistRoutes from './playlist';

const ALBUM_MBID = 'b1a9c0e9-d987-4042-ae91-78d6a3267d69';
const TRACK_MBID = 'f4a9c0e9-d987-4042-ae91-78d6a3267d70';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(checkUser);
  app.use('/auth', authRoutes);
  app.use('/playlist', isAuthenticated(), playlistRoutes);
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
});

setupTestDb();

async function loginAs(email: string, password: string) {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent.post('/auth/local').send({ email, password });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

describe('Playlist routes', () => {
  it('creates a playlist, adds items and reorders them', async () => {
    const user = await loginAs('demo@shufflerr.test', 'test1234');

    const created = await user
      .post('/playlist')
      .send({ name: 'Late night', description: 'For after midnight' });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.name, 'Late night');
    assert.strictEqual(created.body.description, 'For after midnight');
    assert.deepStrictEqual(created.body.items, []);

    const id = created.body.id;

    const withAlbum = await user.post(`/playlist/${id}/items`).send({
      mbid: ALBUM_MBID,
      mediaType: 'release-group',
      title: 'Comfort In Chaos',
      artistName: 'John Summit',
    });
    assert.strictEqual(withAlbum.status, 201);
    assert.strictEqual(withAlbum.body.items.length, 1);
    assert.strictEqual(withAlbum.body.items[0].position, 0);
    assert.strictEqual(withAlbum.body.items[0].title, 'Comfort In Chaos');

    const withTrack = await user.post(`/playlist/${id}/items`).send({
      mbid: TRACK_MBID,
      mediaType: 'recording',
      title: 'Shiver',
      artistName: 'John Summit',
    });
    assert.strictEqual(withTrack.status, 201);
    assert.strictEqual(withTrack.body.items.length, 2);
    const [first, second] = withTrack.body.items;
    assert.strictEqual(second.position, 1);

    // Flip the order.
    const reordered = await user
      .post(`/playlist/${id}/items/reorder`)
      .send({ itemIds: [second.id, first.id] });
    assert.strictEqual(reordered.status, 200);
    assert.strictEqual(reordered.body.items[0].id, second.id);
    assert.strictEqual(reordered.body.items[0].position, 0);
    assert.strictEqual(reordered.body.items[1].id, first.id);

    // Remove one item.
    const removed = await user.delete(
      `/playlist/${id}/items/${second.id}`
    );
    assert.strictEqual(removed.status, 200);
    assert.strictEqual(removed.body.items.length, 1);
    assert.strictEqual(removed.body.items[0].id, first.id);

    // Rename.
    const renamed = await user
      .put(`/playlist/${id}`)
      .send({ name: 'Very late night' });
    assert.strictEqual(renamed.status, 200);
    assert.strictEqual(renamed.body.name, 'Very late night');

    // Delete.
    const deleted = await user.delete(`/playlist/${id}`);
    assert.strictEqual(deleted.status, 204);

    const afterDelete = await user.get(`/playlist/${id}`);
    assert.strictEqual(afterDelete.status, 404);
  });

  it('keeps playlists private to their owner', async () => {
    const owner = await loginAs('demo@shufflerr.test', 'test1234');
    const other = await loginAs('admin@shufflerr.test', 'test1234');

    const created = await owner.post('/playlist').send({ name: 'Mine only' });
    assert.strictEqual(created.status, 201);
    const id = created.body.id;

    // The other user does not see it in their list...
    const otherList = await other.get('/playlist');
    assert.strictEqual(otherList.status, 200);
    assert.ok(
      !otherList.body.some((p: { id: number }) => p.id === id),
      'another user should not see this playlist'
    );

    // ...cannot read it...
    const otherRead = await other.get(`/playlist/${id}`);
    assert.strictEqual(otherRead.status, 404);

    // ...and cannot delete it.
    const otherDelete = await other.delete(`/playlist/${id}`);
    assert.strictEqual(otherDelete.status, 404);

    // The owner still has it.
    const ownerRead = await owner.get(`/playlist/${id}`);
    assert.strictEqual(ownerRead.status, 200);
  });

  it('rejects invalid input and anonymous access', async () => {
    const anon = request.agent(app);
    const anonList = await anon.get('/playlist');
    assert.strictEqual(anonList.status, 403);

    const user = await loginAs('demo@shufflerr.test', 'test1234');

    const noName = await user.post('/playlist').send({ description: 'no name' });
    assert.strictEqual(noName.status, 400);

    const created = await user.post('/playlist').send({ name: 'Scratch' });
    const id = created.body.id;

    const badItem = await user
      .post(`/playlist/${id}/items`)
      .send({ mbid: 'not-a-uuid', mediaType: 'release-group' });
    assert.strictEqual(badItem.status, 400);

    const badType = await user
      .post(`/playlist/${id}/items`)
      .send({ mbid: ALBUM_MBID, mediaType: 'artist' });
    assert.strictEqual(badType.status, 400);
  });
});
