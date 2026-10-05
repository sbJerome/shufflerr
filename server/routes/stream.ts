// Mounted at /api/v1/stream behind isAuthenticated() (docs/API_CONTRACT.md §SV3).
import { getRepository } from '@server/datasource';
import Track from '@server/entity/Track';
import type {
  TrackPeaksResponse,
  TrackPlaybackInfo,
} from '@server/interfaces/api/playbackInterfaces';
import type { StreamOptions } from '@server/lib/library/stream';
import {
  getTrackPeaks,
  getTrackSource,
  streamTrack,
} from '@server/lib/library/stream';
import { coverUrlFor } from '@server/lib/metadata';
import { Router } from 'express';

const router = Router();

const FORMATS = ['original', 'opus-160', 'mp3-320', 'mp3-128'] as const;

const trackIdOf = (raw: string): number | null => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// GET /stream/track/:trackId — audio bytes (206/200), Range supported.
router.get('/track/:trackId', async (req, res, next) => {
  const trackId = trackIdOf(req.params.trackId);
  if (!trackId) {
    return next({ status: 404, message: 'This track is not in the library.' });
  }
  const format = req.query.format as string | undefined;
  if (format && !FORMATS.includes(format as (typeof FORMATS)[number])) {
    return next({
      status: 400,
      message: `Unknown format. Use one of: ${FORMATS.join(', ')}.`,
    });
  }

  await streamTrack(req, res, trackId, {
    format: format as StreamOptions['format'],
  });
});

// GET /stream/track/:trackId/peaks — TrackPeaksResponse
router.get('/track/:trackId/peaks', async (req, res, next) => {
  const trackId = trackIdOf(req.params.trackId);
  if (!trackId) {
    return next({ status: 404, message: 'This track is not in the library.' });
  }
  const peaks = await getTrackPeaks(trackId);

  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.status(200).json({ trackId, peaks } satisfies TrackPeaksResponse);
});

// GET /stream/track/:trackId/info — TrackPlaybackInfo
router.get('/track/:trackId/info', async (req, res, next) => {
  const trackId = trackIdOf(req.params.trackId);
  const track = trackId
    ? await getRepository(Track)
        .createQueryBuilder('track')
        .leftJoinAndSelect('track.media', 'media')
        .addSelect('track.peaks')
        .where('track.id = :trackId', { trackId })
        .getOne()
    : null;
  const source = track ? await getTrackSource(track.id) : null;

  if (!track || !source) {
    return next({ status: 404, message: 'This track is not in the library.' });
  }

  return res.status(200).json({
    trackId: track.id,
    title: track.title,
    artistCredit: track.artistCredit || track.media?.artistName || '',
    albumTitle: track.media?.title ?? '',
    albumMbid: track.media?.mbid ?? '',
    artistMbid: track.media?.artistMbid ?? null,
    recordingMbid: track.recordingMbid ?? null,
    coverUrl: track.media?.mbid ? coverUrlFor(track.media.mbid, 500) : null,
    lengthMs: track.lengthMs ?? null,
    fileFormat: track.fileFormat ?? null,
    source,
    streamUrl: `/api/v1/stream/track/${track.id}`,
    // local tracks get peaks on first request even when none are stored yet
    hasPeaks: !!track.peaks || source === 'local',
  } satisfies TrackPlaybackInfo);
});

export default router;
