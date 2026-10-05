// STREAM(SV6): implement. Mounted at /api/v1/youtube (see docs/API_CONTRACT.md).
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// GET /youtube/track/:recordingMbid · signed in
//   in:  query `artist`, `title` (used when the recording is not cached)
//   out: YoutubeTrackResponse
//   `enabled:false, videoId:null` when YouTube is off. Cached 30 days per recording. IFrame player only
router.get('/track/:recordingMbid', notImplemented('SV6'));

export default router;
