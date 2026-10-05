// Mounted at /api/v1/artist (see docs/API_CONTRACT.md).
import LidarrAPI from '@server/api/servarr/lidarr';
import {
  getArtistDetails,
  getLidarrArtistState,
  invalidateLidarrArtistState,
} from '@server/lib/metadata/details';
import { metadataError } from '@server/lib/metadata/errors';
import { InvalidMbidError, isMbid } from '@server/lib/metadata/index';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import type { ArtistDetails } from '@server/models/music';
import { Router } from 'express';

const router = Router();

// GET /artist/:mbid · signed in → ArtistDetails
router.get<{ mbid: string }, ArtistDetails>(
  '/:mbid',
  async (req, res, next) => {
    try {
      if (!isMbid(req.params.mbid)) {
        throw new InvalidMbidError('That is not a MusicBrainz ID.');
      }
      return res
        .status(200)
        .json(await getArtistDetails(req.params.mbid, req.user));
    } catch (e) {
      return metadataError(e, next, 'artist');
    }
  }
);

// POST /artist/:mbid/watch · MANAGE_REQUESTS
//   in:  body { enabled: boolean }
//   out: { enabled: boolean } — Lidarr "monitor new items" for this artist.
//   409 when the artist is not in Lidarr yet (request something first).
router.post<{ mbid: string }, { enabled: boolean }, { enabled?: boolean }>(
  '/:mbid/watch',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    const mbid = String(req.params.mbid).toLowerCase();
    if (!isMbid(mbid)) {
      return next({ status: 400, message: 'That is not a MusicBrainz ID.' });
    }
    if (typeof req.body?.enabled !== 'boolean') {
      return next({
        status: 400,
        message: 'Say whether to watch this artist: enabled true or false.',
      });
    }
    try {
      invalidateLidarrArtistState(mbid);
      const state = await getLidarrArtistState(mbid);
      const server = state
        ? getSettings().lidarr.find((s) => s.id === state.serverId)
        : undefined;
      if (!state || !server) {
        invalidateLidarrArtistState(mbid);
        return next({
          status: 409,
          message:
            'This artist is not in Lidarr yet. Request an album or the discography first, then turn this on.',
        });
      }
      const lidarr = LidarrAPI.fromSettings(server);
      const artist = await lidarr.getArtist(state.artistId);
      await lidarr.updateArtist({
        ...artist,
        monitored: req.body.enabled ? true : artist.monitored,
        monitorNewItems: req.body.enabled ? 'all' : 'none',
      });
      invalidateLidarrArtistState(mbid);
      logger.info('Watch for new releases changed', {
        label: 'Lidarr',
        artistMbid: mbid,
        enabled: req.body.enabled,
        userId: req.user?.id,
      });
      return res.status(200).json({ enabled: req.body.enabled });
    } catch (e) {
      logger.error('Could not change watch for new releases', {
        label: 'Lidarr',
        errorMessage: e.message,
      });
      return next({
        status: 502,
        message: 'Lidarr did not accept the change. Check that it is running.',
      });
    }
  }
);

export default router;
