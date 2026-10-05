// STREAM(SV6): implement. Mounted at /api/v1/webhooks (see docs/API_CONTRACT.md).
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// POST /webhooks/plex · query `apikey` = main.apiKey
//   in:  Plex webhook multipart payload
//   out: 204
//   media.scrobble / media.play for music → scrobble pipeline
router.post('/plex', notImplemented('SV6'));

// POST /webhooks/jellyfin · query `apikey` = main.apiKey
//   in:  Jellyfin Webhook plugin JSON
//   out: 204
//   PlaybackStart / PlaybackStop → scrobble pipeline
router.post('/jellyfin', notImplemented('SV6'));

export default router;
