// STREAM(SV1): implement. Mounted at /api/v1/search (see docs/API_CONTRACT.md).
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// GET /search · signed in
//   in:  query `query` (required), `type`=all|artist|album|track (default all), `page` (1), `pageSize` (20)
//   out: SearchResults
//   Library status merged in; MusicBrainz ≤1 rps so results are cached 1 h
router.get('/', notImplemented('SV1'));

export default router;
