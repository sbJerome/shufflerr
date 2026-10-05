// STREAM(SV2): implement. Mounted at /api/v1/service (see docs/API_CONTRACT.md).
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// GET /service/lidarr · signed in
//   in:  —
//   out: ServiceCommonServer[]
//   No secrets
router.get('/lidarr', notImplemented('SV2'));

// GET /service/lidarr/:id · signed in
//   in:  —
//   out: ServiceCommonServerWithDetails
//   Profiles, metadata profiles, root folders, tags for the request modal
router.get('/lidarr/:id', notImplemented('SV2'));

export default router;
