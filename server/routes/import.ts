// STREAM(SV6): implement. Mounted at /api/v1/import (see docs/API_CONTRACT.md).
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// GET /import/sources · signed in
//   in:  —
//   out: ImportSourcesResponse
router.get('/sources', notImplemented('SV6'));

// POST /import/resolve · signed in (REQUEST / REQUEST_ALBUM)
//   in:  body `{url}`
//   out: ImportResolveResponse
//   400 with fix-it copy for unsupported links (e.g. Apple Music playlists)
router.post('/resolve', notImplemented('SV6'));

// POST /import/request · signed in
//   in:  body `{jobId?, mbids: string[]}`
//   out: ImportRequestResponse
//   Each MBID goes through the request engine with scope `album`
router.post('/request', notImplemented('SV6'));

// GET /import/spotify/saved · signed in
//   in:  —
//   out: ImportSpotifySavedResponse
//   `linked:false` when the viewer has not linked Spotify
router.get('/spotify/saved', notImplemented('SV6'));

// GET /import/jobs · signed in
//   in:  —
//   out: ImportJobSummary[]
//   The viewer's recent import links
router.get('/jobs', notImplemented('SV6'));

// GET /import/jobs/:id · signed in
//   in:  —
//   out: ImportResolveResponse
router.get('/jobs/:id', notImplemented('SV6'));

export default router;
