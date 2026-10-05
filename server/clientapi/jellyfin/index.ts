// STREAM(SV7): implement — Jellyfin-compatible API, mounted at /jellyfin
// (docs/CLIENT_API.md). Mounted outside /api/v1: no session, no CSRF, no
// OpenAPI validation. Auth is username + app password → access token.
import { getSettings } from '@server/lib/settings';
import { Router } from 'express';

const router = Router();

router.use((_req, res) => {
  if (!getSettings().clients.jellyfinApi) {
    return res.status(404).json({ message: 'The Jellyfin API is turned off.' });
  }
  return res.status(501).json({ message: 'Not implemented' });
});

export default router;
