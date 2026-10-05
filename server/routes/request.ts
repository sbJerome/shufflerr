// STREAM(SV2): implement. Mounted at /api/v1/request (see docs/API_CONTRACT.md).
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// POST /request · signed in
//   in:  body MediaRequestBody; `?dryRun=1` (or body `dryRun:true`)
//   out: 201 RequestResult · dry run: 200 DryRunResult
//   Errors: 403 RequestPermissionError / QuotaRestrictedError, 409 DuplicateMediaRequestError, 403 BlocklistedMediaError — body `{message}` is the user-facing copy. A dry run never errors for engine outcomes: it returns `{outcome:"blocked",reason,code}`
router.post('/', notImplemented('SV2'));

// GET /request · signed in
//   in:  query `take` (20), `skip`, `filter` RequestFilter, `sort`=added|modified, `sortDirection`=asc|desc, `requestedBy` (user id), `scope`
//   out: RequestResultsResponse
//   Only own requests without MANAGE_REQUESTS / REQUEST_VIEW
router.get('/', notImplemented('SV2'));

// GET /request/count · signed in
//   in:  —
//   out: RequestCountResponse
//   Scoped the same way as the list
router.get('/count', notImplemented('SV2'));

// GET /request/:id · signed in
//   in:  —
//   out: RequestResult
//   403 when not yours and no view permission
router.get('/:id', notImplemented('SV2'));

// PUT /request/:id · MANAGE_REQUESTS, or requester while pending
//   in:  body MediaRequestUpdateBody
//   out: RequestResult
router.put('/:id', notImplemented('SV2'));

// DELETE /request/:id · requester (pending only) or MANAGE_REQUESTS
//   in:  —
//   out: 204
//   Media status is recalculated
router.delete('/:id', notImplemented('SV2'));

// POST /request/:id/retry · MANAGE_REQUESTS
//   in:  —
//   out: RequestResult
//   Only FAILED → APPROVED; re-sends to Lidarr
router.post('/:id/retry', notImplemented('SV2'));

// POST /request/:id/:status · MANAGE_REQUESTS
//   in:  `status`=approve|decline; body DeclineBody (optional)
//   out: RequestResult
//   400 "Only pending requests can be approved or declined."
router.post('/:id/:status', notImplemented('SV2'));

export default router;
