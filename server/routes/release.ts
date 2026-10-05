// STREAM(SV1): implement. Mounted at /api/v1/album (see docs/API_CONTRACT.md).
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// GET /album/:mbid · signed in
//   in:  —
//   out: AlbumDetails
//   Release-group MBID. Syncs the canonical tracklist into Track rows so every track has an `id`
router.get('/:mbid', notImplemented('SV1'));

export default router;
