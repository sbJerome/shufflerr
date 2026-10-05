// STREAM(SV1): implement. Mounted at /api/v1/discover (see docs/API_CONTRACT.md).
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// GET /discover/stats · signed in
//   in:  —
//   out: DiscoverStatsResponse
//   Real counts from the library index
router.get('/stats', notImplemented('SV1'));

// GET /discover/featured · signed in
//   in:  —
//   out: DiscoverFeaturedResponse
//   `album: null` when there is nothing real to feature
router.get('/featured', notImplemented('SV1'));

// GET /discover/recently-added · signed in (RECENT_VIEW; otherwise `enabled:false`)
//   in:  query `take` (20)
//   out: DiscoverAlbumsResponse
//   From Media.mediaAddedAt
router.get('/recently-added', notImplemented('SV1'));

// GET /discover/trending · signed in
//   in:  query `take` (20)
//   out: DiscoverAlbumsResponse
//   ListenBrainz fresh releases / iTunes chart; `enabled:false` when both are off
router.get('/trending', notImplemented('SV1'));

// GET /discover/popular-artists · signed in
//   in:  query `take` (20)
//   out: DiscoverArtistsResponse
//   Library artists ranked by plays/requests; ListenBrainz sitewide when on
router.get('/popular-artists', notImplemented('SV1'));

// GET /discover/recent-requests · signed in
//   in:  query `take` (10)
//   out: DiscoverRecentRequestsResponse
//   Own requests unless REQUEST_VIEW / MANAGE_REQUESTS
router.get('/recent-requests', notImplemented('SV1'));

// GET /discover/concerts · signed in
//   in:  query `take` (20)
//   out: DiscoverConcertsResponse
//   Reads the Event cache (filled by SV6 `concerts-refresh`), filtered by the viewer's region
router.get('/concerts', notImplemented('SV1'));

export default router;
