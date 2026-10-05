// STREAM(SV3): implement. Paths are relative to /api/v1/settings.
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// GET    /local           → LocalFilesSettingsResponse
// POST   /local           → save { enabled, watch, rescanMinutes } (then syncLocalFilesWatcher())
// POST   /local/folders   → { path } → validates (starts with /, exists, readable) and adds → LocalFolderCheckResponse
// DELETE /local/folders   → { path } → removes → LocalFilesSettingsResponse
// GET    /local/sync      → ScanStatus
// POST   /local/sync      → ScanCommandBody → ScanStatus
router.get('/local', notImplemented('SV3'));
router.post('/local', notImplemented('SV3'));
router.post('/local/folders', notImplemented('SV3'));
router.delete('/local/folders', notImplemented('SV3'));
router.get('/local/sync', notImplemented('SV3'));
router.post('/local/sync', notImplemented('SV3'));

export default router;
