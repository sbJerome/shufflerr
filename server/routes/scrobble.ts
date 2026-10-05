import { getRepository } from '@server/datasource';
import Track from '@server/entity/Track';
import type {
  ScrobbleBody,
  ScrobbleResponse,
  ScrobbleStatusResponse,
} from '@server/interfaces/api/playbackInterfaces';
import { getUserTargets, nowPlaying, recordPlay } from '@server/lib/scrobble';
import logger from '@server/logger';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

// Mounted at /api/v1/scrobble (signed in): the web player reports plays here.
const router = Router();

/** startedAt must be a plausible recent time: not in the future, not older than two weeks. */
const parseBody = (
  body: Partial<ScrobbleBody> | undefined
): { trackId: number; startedAt: Date; playedSeconds?: number } | null => {
  const trackId = Number(body?.trackId);
  if (!Number.isInteger(trackId) || trackId <= 0) {
    return null;
  }
  const now = Date.now();
  let startedAt = Number(body?.startedAt);
  if (
    !Number.isFinite(startedAt) ||
    startedAt > now + 60_000 ||
    startedAt < now - 14 * 86_400_000
  ) {
    startedAt = now;
  }
  const playedSeconds =
    body?.playedSeconds === undefined ? undefined : Number(body.playedSeconds);
  return {
    trackId,
    startedAt: new Date(startedAt),
    playedSeconds:
      playedSeconds !== undefined && Number.isFinite(playedSeconds)
        ? Math.max(0, playedSeconds)
        : undefined,
  };
};

router.get('/status', async (req, res, next) => {
  if (!req.user) {
    return next({ status: 403, message: 'Sign in first.' });
  }
  try {
    const targets = await getUserTargets(req.user);
    const response: ScrobbleStatusResponse = {
      enabled: targets.length > 0,
      targets,
    };
    return res.status(200).json(response);
  } catch (e) {
    return next({ status: 500, message: e.message });
  }
});

const handle =
  (finished: boolean) =>
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next({ status: 403, message: 'Sign in first.' });
    }
    const parsed = parseBody(req.body);
    if (!parsed) {
      return next({ status: 400, message: 'Say which track was played.' });
    }
    try {
      const exists = await getRepository(Track).exist({
        where: { id: parsed.trackId },
      });
      if (!exists) {
        return next({
          status: 404,
          message: "That track isn't in the library any more.",
        });
      }
      const event = {
        user: req.user,
        source: 'web' as const,
        trackId: parsed.trackId,
        // artist/title/album/length come from the Track row
        artist: '',
        track: '',
        startedAt: parsed.startedAt,
        // a play reported without a duration counts as nothing heard
        playedSeconds: parsed.playedSeconds ?? 0,
      };
      let response: ScrobbleResponse;
      if (finished) {
        const targets = await recordPlay(event);
        response = { queued: targets.length > 0, targets };
      } else {
        // answer right away; the services are told in the background
        const targets = await getUserTargets(req.user);
        void nowPlaying(event);
        response = { queued: false, targets };
      }
      return res.status(200).json(response);
    } catch (e) {
      logger.error('Could not record a play', {
        label: 'Scrobbler',
        errorMessage: e.message,
      });
      return next({ status: 500, message: 'The play could not be recorded.' });
    }
  };

router.post('/now-playing', handle(false));
router.post('/', handle(true));

export default router;
