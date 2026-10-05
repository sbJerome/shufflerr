// STREAM(SV1): implement. Mounted at /api/v1/recording (see docs/API_CONTRACT.md).
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// GET /recording/:mbid · signed in
//   in:  —
//   out: TrackResult
router.get('/:mbid', notImplemented('SV1'));

export default router;
