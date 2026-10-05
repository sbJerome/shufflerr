// STREAM(SV3): implement. Mounted at /api/v1/stream (see docs/API_CONTRACT.md).
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// GET /stream/track/:trackId · signed in
//   in:  Range header; query `format`=original|opus-160|mp3-320|mp3-128
//   out: audio bytes (206/200)
//   Local file first, else proxied from Plex / Jellyfin / Navidrome. 404 when not playable
router.get('/track/:trackId', notImplemented('SV3'));

// GET /stream/track/:trackId/peaks · signed in
//   in:  —
//   out: TrackPeaksResponse
//   `peaks: []` when none (UI draws a flat bar)
router.get('/track/:trackId/peaks', notImplemented('SV3'));

// GET /stream/track/:trackId/info · signed in
//   in:  —
//   out: TrackPlaybackInfo
//   Everything the player bar shows for a track
router.get('/track/:trackId/info', notImplemented('SV3'));

export default router;
