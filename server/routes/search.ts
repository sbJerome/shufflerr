// Mounted at /api/v1/search (see docs/API_CONTRACT.md).
import { metadataError } from '@server/lib/metadata/errors';
import type { SearchType } from '@server/lib/search';
import { searchMusic } from '@server/lib/search';
import type { SearchResults } from '@server/models/music';
import { Router } from 'express';

const router = Router();

const TYPES: SearchType[] = ['all', 'artist', 'album', 'track'];

// GET /search · signed in
//   in:  query `query` (required), `type`=all|artist|album|track (default all), `page` (1), `pageSize` (20)
//   out: SearchResults
router.get<never, SearchResults>('/', async (req, res, next) => {
  const query = typeof req.query.query === 'string' ? req.query.query : '';
  if (!query.trim()) {
    return next({
      status: 400,
      message: 'Type an artist, album or track to search for.',
    });
  }
  const type = TYPES.includes(req.query.type as SearchType)
    ? (req.query.type as SearchType)
    : 'all';

  try {
    const results = await searchMusic({
      query,
      type,
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 20,
      user: req.user,
    });
    return res.status(200).json(results);
  } catch (e) {
    return metadataError(e, next, 'search');
  }
});

export default router;
