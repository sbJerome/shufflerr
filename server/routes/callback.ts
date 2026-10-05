import {
  consumePendingLink,
  linkProviders,
  setLinkedAccount,
} from '@server/lib/auth/linkedAccounts';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { Response } from 'express';
import { Router } from 'express';

/**
 * Returns from Last.fm web auth and Spotify OAuth (docs/USER_SYSTEM.md §Linked
 * accounts). Mounted at /api/v1/callback. The one-shot `state` created by the
 * authorize route identifies the user, so the link completes even when the
 * session cookie is not sent on the cross-site return (SameSite=Strict).
 */
const router = Router();

const finish = (
  res: Response,
  returnPath: string,
  result: { linked?: string; error?: string }
) => {
  const query = new URLSearchParams(
    result.linked ? { linked: result.linked } : { error: result.error ?? '' }
  );
  return res.redirect(302, `${returnPath}?${query.toString()}`);
};

const DEFAULT_RETURN = '/profile/settings/linked-accounts';

router.get('/lastfm', async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const pending = consumePendingLink(state, 'lastfm');

  if (!pending) {
    return finish(res, DEFAULT_RETURN, { error: 'lastfm_expired' });
  }
  if (req.user && req.user.id !== pending.userId) {
    return finish(res, DEFAULT_RETURN, { error: 'lastfm_wrong_user' });
  }
  if (!getSettings().integrations.lastfmScrobble) {
    return finish(res, pending.returnPath, { error: 'lastfm_disabled' });
  }
  if (!token) {
    return finish(res, pending.returnPath, { error: 'lastfm_denied' });
  }

  try {
    const result = await linkProviders.lastfmGetSession(token);
    await setLinkedAccount(pending.userId, 'lastfm', result);
    logger.info('Linked a Last.fm account', {
      label: 'Auth',
      userId: pending.userId,
    });
    return finish(res, pending.returnPath, { linked: 'lastfm' });
  } catch (e) {
    logger.error('Could not finish linking Last.fm', {
      label: 'Auth',
      userId: pending.userId,
      errorMessage: e.message,
    });
    return finish(res, pending.returnPath, { error: 'lastfm_failed' });
  }
});

router.get('/spotify', async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const pending = consumePendingLink(state, 'spotify');

  if (!pending || !pending.codeVerifier) {
    return finish(res, DEFAULT_RETURN, { error: 'spotify_expired' });
  }
  if (req.user && req.user.id !== pending.userId) {
    return finish(res, DEFAULT_RETURN, { error: 'spotify_wrong_user' });
  }
  if (!getSettings().integrations.spotify) {
    return finish(res, pending.returnPath, { error: 'spotify_disabled' });
  }
  if (!code) {
    // The user pressed "Cancel" on Spotify (`?error=access_denied`).
    return finish(res, pending.returnPath, { error: 'spotify_denied' });
  }

  try {
    const result = await linkProviders.spotifyExchange(
      code,
      pending.codeVerifier,
      pending.redirectUri
    );
    await setLinkedAccount(pending.userId, 'spotify', result);
    logger.info('Linked a Spotify account', {
      label: 'Auth',
      userId: pending.userId,
    });
    return finish(res, pending.returnPath, { linked: 'spotify' });
  } catch (e) {
    logger.error('Could not finish linking Spotify', {
      label: 'Auth',
      userId: pending.userId,
      errorMessage: e.message,
    });
    return finish(res, pending.returnPath, { error: 'spotify_failed' });
  }
});

export default router;
