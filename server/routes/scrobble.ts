// STREAM(SV6): implement. Mounted at /api/v1/scrobble (see docs/API_CONTRACT.md).
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// GET /scrobble/status · signed in
//   in:  —
//   out: ScrobbleStatusResponse
//   Player bar "scrobbling to …"
router.get('/status', notImplemented('SV6'));

// POST /scrobble/now-playing · signed in
//   in:  body ScrobbleBody
//   out: ScrobbleResponse
router.post('/now-playing', notImplemented('SV6'));

// POST /scrobble · signed in
//   in:  body ScrobbleBody (with `playedSeconds`)
//   out: ScrobbleResponse
//   Server applies settings.scrobble.rule
router.post('/', notImplemented('SV6'));

export default router;
