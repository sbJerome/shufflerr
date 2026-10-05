import { nowPlaying, recordPlay } from '@server/lib/scrobble';
import type { WebhookPlay } from '@server/lib/scrobble/webhooks';
import {
  jellyfinPayloadToPlay,
  plexPayloadToPlay,
  readJellyfinPayload,
  readPlexPayload,
} from '@server/lib/scrobble/webhooks';
import { safeEqual } from '@server/lib/secrets';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { RequestHandler } from 'express';
import { Router } from 'express';

/**
 * Mounted at /api/v1/webhooks. Media servers cannot hold a session, so these
 * are authenticated with the server API key:
 *
 *   Plex (Plex Pass → Settings → Webhooks):
 *     <applicationUrl>/api/v1/webhooks/plex?apikey=<API key>
 *   Jellyfin (Webhook plugin → Generic destination, events Playback Start and
 *   Playback Stop, item type Songs, "Send all properties"):
 *     <applicationUrl>/api/v1/webhooks/jellyfin?apikey=<API key>
 *
 * Both always answer 204 for an accepted key, whether or not the event was a
 * play Shufflerr cares about.
 */
const router = Router();

const requireApiKey: RequestHandler = (req, res, next) => {
  const given =
    (typeof req.query.apikey === 'string' && req.query.apikey) ||
    req.header('X-Api-Key') ||
    '';
  const expected = getSettings().main.apiKey;
  if (!given || !expected || !safeEqual(given, expected)) {
    res.status(401).json({
      message:
        'This webhook needs the Shufflerr API key. Add ?apikey=<API key> from Settings → General to the webhook URL.',
    });
    return;
  }
  next();
};

const dispatch = async (play: WebhookPlay | null): Promise<void> => {
  if (!play) {
    return;
  }
  if (play.kind === 'played') {
    await recordPlay(play.event);
  } else {
    await nowPlaying(play.event);
  }
};

router.post('/plex', requireApiKey, async (req, res) => {
  try {
    const payload = await readPlexPayload(req);
    if (payload && getSettings().scrobble.sources.plex) {
      await dispatch(await plexPayloadToPlay(payload));
    }
  } catch (e) {
    logger.warn('Could not handle a Plex webhook', {
      label: 'Scrobbler',
      errorMessage: e.message,
    });
  }
  res.status(204).send();
});

router.post('/jellyfin', requireApiKey, async (req, res) => {
  try {
    const payload = await readJellyfinPayload(req);
    if (payload && getSettings().scrobble.sources.jellyfin) {
      await dispatch(await jellyfinPayloadToPlay(payload));
    }
  } catch (e) {
    logger.warn('Could not handle a Jellyfin webhook', {
      label: 'Scrobbler',
      errorMessage: e.message,
    });
  }
  res.status(204).send();
});

export default router;
