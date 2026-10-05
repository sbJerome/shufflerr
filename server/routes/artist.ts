// STREAM(SV1): implement. Mounted at /api/v1/artist (see docs/API_CONTRACT.md).
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// GET /artist/:mbid · signed in
//   in:  —
//   out: ArtistDetails
//   Discography carries status + active request per release group; `similar` empty unless Last.fm is on
router.get('/:mbid', notImplemented('SV1'));

export default router;
