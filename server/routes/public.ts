// STREAM(SV1): implement. Mounted at /api/v1/public (see docs/API_CONTRACT.md).
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// GET /public/slideshow · public
//   in:  query `take` (70)
//   out: SlideshowResponse
//   Login background: recently added cover URLs only. Empty array on an empty library
router.get('/slideshow', notImplemented('SV1'));

export default router;
