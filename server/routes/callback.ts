// STREAM(SV4): implement. Mounted at /api/v1/callback (see docs/API_CONTRACT.md).
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// GET /callback/lastfm · signed in (session cookie)
//   in:  query `token`, `state`
//   out: 302 → /profile/settings/linked-accounts?linked=lastfm (or `?error=`)
//   Exchanges the token with `auth.getSession`
router.get('/lastfm', notImplemented('SV4'));

// GET /callback/spotify · signed in (session cookie)
//   in:  query `code`, `state`
//   out: 302 → /profile/settings/linked-accounts?linked=spotify (or `?error=`)
//   Authorization Code + PKCE; stores the refresh token encrypted
router.get('/spotify', notImplemented('SV4'));

export default router;
