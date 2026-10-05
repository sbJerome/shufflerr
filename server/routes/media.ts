// STREAM(SV1): implement. Mounted at /api/v1/media (see docs/API_CONTRACT.md).
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// GET /media · signed in
//   in:  query `take`, `skip`, `filter`=all|available|partial|allavailable|processing|pending, `sort`=added|modified|mediaAdded, `mediaType`
//   out: MediaResultsResponse
//   Seerr-style list
router.get('/', notImplemented('SV1'));

// GET /media/:id · signed in
//   in:  —
//   out: Media (with requests, tracks)
router.get('/:id', notImplemented('SV1'));

// POST /media/:id/:status · MANAGE_REQUESTS
//   in:  `status`=available|partial|processing|pending|unknown
//   out: Media
//   Backlog Manage panel: mark available / clear
router.post('/:id/:status', notImplemented('SV1'));

// DELETE /media/:id · MANAGE_REQUESTS
//   in:  —
//   out: 204
//   Clear data (reset the Media row)
router.delete('/:id', notImplemented('SV1'));

export default router;
