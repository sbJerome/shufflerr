// STREAM(SV3): implement. Paths are relative to /api/v1/settings.
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// GET  /navidrome        → NavidromeSettingsResponse (password masked)
// POST /navidrome        → save
// POST /navidrome/test   → ConnectionTestResponse
// GET  /navidrome/sync   → ScanStatus
// POST /navidrome/sync   → ScanCommandBody → ScanStatus
router.get('/navidrome', notImplemented('SV3'));
router.post('/navidrome', notImplemented('SV3'));
router.post('/navidrome/test', notImplemented('SV3'));
router.get('/navidrome/sync', notImplemented('SV3'));
router.post('/navidrome/sync', notImplemented('SV3'));

export default router;
