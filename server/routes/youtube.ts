import YoutubeAPI from '@server/api/youtube';
import { getRepository } from '@server/datasource';
import Track from '@server/entity/Track';
import type { YoutubeTrackResponse } from '@server/interfaces/api/playbackInterfaces';
import { PersistCache } from '@server/lib/import/persistCache';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

/**
 * Mounted at /api/v1/youtube (signed in). Finds the YouTube video for a
 * recording so the player bar can play it in YouTube's own IFrame player while
 * the real files download. Search only — nothing is downloaded or extracted.
 */
const router = Router();

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CachedVideo {
  videoId: string;
  title: string;
  channel: string;
}

/** A search costs 100 quota units, so a hit is kept for 30 days per recording. */
const videoCache = new PersistCache<CachedVideo>(
  'youtube-tracks',
  30 * 24 * 60 * 60 * 1000
);
/** "Nothing found" is remembered for a day. */
const missCache = new PersistCache<true>(
  'youtube-misses',
  24 * 60 * 60 * 1000
);
const inflight = new Map<string, Promise<CachedVideo | null>>();
/** Set when Google says the daily quota is gone; searching resumes after this time. */
let quotaBlockedUntil = 0;

router.get('/track/:recordingMbid', async (req, res, next) => {
  const settings = getSettings();
  const off: YoutubeTrackResponse = { enabled: false, videoId: null };
  if (!settings.integrations.youtube) {
    return res.status(200).json(off);
  }
  const recordingMbid = String(req.params.recordingMbid).toLowerCase();
  if (!MBID.test(recordingMbid)) {
    return next({ status: 400, message: 'That is not a recording ID.' });
  }

  const respond = (video: CachedVideo | null) => {
    const body: YoutubeTrackResponse = video
      ? { enabled: true, ...video }
      : { enabled: true, videoId: null };
    return res.status(200).json(body);
  };

  const cached = videoCache.get(recordingMbid);
  if (cached) {
    return respond(cached);
  }
  if (missCache.has(recordingMbid) || Date.now() < quotaBlockedUntil) {
    return respond(null);
  }

  let artist = typeof req.query.artist === 'string' ? req.query.artist.trim() : '';
  let title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
  if (!artist || !title) {
    const track = await getRepository(Track).findOne({
      where: { recordingMbid },
      relations: { media: true },
    });
    artist = artist || track?.artistCredit || track?.media?.artistName || '';
    title = title || track?.title || '';
  }
  if (!artist || !title) {
    return next({
      status: 400,
      message: 'Send the artist and title of the track to look it up.',
    });
  }

  try {
    let search = inflight.get(recordingMbid);
    if (!search) {
      search = new YoutubeAPI(settings.youtube.apiKey)
        .searchTrack(artist, title, settings.youtube.region)
        .finally(() => inflight.delete(recordingMbid));
      inflight.set(recordingMbid, search);
    }
    const video = await search;
    if (video) {
      videoCache.set(recordingMbid, video);
    } else {
      missCache.set(recordingMbid, true);
    }
    return respond(video);
  } catch (e) {
    const reason = e.response?.data?.error?.errors?.[0]?.reason;
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      // the quota resets at midnight Pacific; look again in an hour
      quotaBlockedUntil = Date.now() + 60 * 60 * 1000;
      logger.warn(
        "YouTube's daily search quota is used up. Tracks will play from YouTube again once it resets.",
        { label: 'YouTube' }
      );
    } else {
      logger.warn('YouTube search failed', {
        label: 'YouTube',
        reason,
        errorMessage: e.message,
      });
    }
    return respond(null);
  }
});

export default router;
