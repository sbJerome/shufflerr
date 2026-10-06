import { registerImageSource } from '@server/lib/imageSources';
import imageproxyRoutes from '@server/routes/imageproxy';
import type { Express, Request } from 'express';
import express from 'express';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import request from 'supertest';

// A fake source that records the path it is asked for; the route must never
// reach it for a traversal or a blocked internal request.
let lastPath: string | null;
const fakeImage = {
  async getImage(path: string) {
    lastPath = path;
    return {
      imageBuffer: Buffer.from('img'),
      meta: {
        extension: 'jpg',
        curRevalidate: 0,
        cacheKey: 'k',
        cacheMiss: true,
      },
    };
  },
  // Unused by the route but part of the type surface.
} as unknown as ReturnType<
  typeof import('@server/lib/imageSources').getImageSource
>;

let app: Express;
let sessionUserId: number | undefined;

before(() => {
  registerImageSource('test-public', () => fakeImage as never);
  registerImageSource('test-internal', () => fakeImage as never, {
    internal: true,
  });

  app = express();
  // A tiny session stub so the route's req.session?.userId check works.
  app.use((req: Request, _res, next) => {
    (req as unknown as { session?: { userId?: number } }).session =
      sessionUserId != null ? { userId: sessionUserId } : {};
    next();
  });
  app.use('/imageproxy', imageproxyRoutes);
});

describe('image proxy route', () => {
  it('rejects a `..` traversal before touching the source', async () => {
    lastPath = null;
    sessionUserId = undefined;
    for (const p of [
      'test-public/..%2fsecret',
      'test-public/%2e%2e%2fsecret',
      'test-public/a%2f..%2f..%2fsecret',
      'test-internal/..%2fsystem%2fstatus',
    ]) {
      const res = await request(app).get(`/imageproxy/${p}`);
      assert.equal(res.status, 400, `expected 400 for ${p}`);
    }
    assert.equal(lastPath, null, 'the source must never be reached');
  });

  it('refuses an internal source without a session', async () => {
    sessionUserId = undefined;
    const res = await request(app).get(
      '/imageproxy/test-internal/artist/1/poster.jpg'
    );
    assert.equal(res.status, 401);
  });

  it('serves an internal source for a signed-in user', async () => {
    sessionUserId = 1;
    const res = await request(app).get(
      '/imageproxy/test-internal/artist/1/poster.jpg'
    );
    assert.equal(res.status, 200);
  });

  it('serves a public source without a session (login slideshow)', async () => {
    sessionUserId = undefined;
    const res = await request(app).get('/imageproxy/test-public/cover/1.jpg');
    assert.equal(res.status, 200);
  });

  it('rejects an unknown source type', async () => {
    const res = await request(app).get('/imageproxy/nope/x.jpg');
    assert.equal(res.status, 400);
  });
});
