// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Mounted at /api/v1/media (see docs/API_CONTRACT.md).
import LidarrAPI from '@server/api/servarr/lidarr';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import type { MediaResultsResponse } from '@server/interfaces/api/mediaInterfaces';
import { invalidateLidarrArtistState } from '@server/lib/metadata/details';
import { coverUrlFor } from '@server/lib/metadata/index';
import { IN_LIBRARY_STATUSES } from '@server/lib/metadata/library';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import type { FindOneOptions, FindOptionsWhere } from 'typeorm';
import { In } from 'typeorm';

const router = Router();

// GET /media · signed in
//   in:  query `take`, `skip`, `filter`=all|available|partial|allavailable|processing|pending,
//        `sort`=added|modified|mediaAdded, `mediaType`
//   out: MediaResultsResponse
router.get<never, MediaResultsResponse>('/', async (req, res, next) => {
  const pageSize = Math.min(200, Math.max(1, Number(req.query.take) || 20));
  const skip = Math.max(0, Number(req.query.skip) || 0);

  const where: FindOptionsWhere<Media> = {};
  switch (req.query.filter) {
    case 'available':
      where.status = MediaStatus.AVAILABLE;
      break;
    case 'partial':
      where.status = MediaStatus.PARTIALLY_AVAILABLE;
      break;
    case 'allavailable':
      where.status = In(IN_LIBRARY_STATUSES);
      break;
    case 'processing':
      where.status = MediaStatus.PROCESSING;
      break;
    case 'pending':
      where.status = MediaStatus.PENDING;
      break;
  }
  if (
    req.query.mediaType === MediaType.ARTIST ||
    req.query.mediaType === MediaType.RELEASE_GROUP
  ) {
    where.mediaType = req.query.mediaType;
  }

  let order: FindOneOptions<Media>['order'];
  switch (req.query.sort) {
    case 'modified':
      order = { updatedAt: 'DESC' };
      break;
    case 'mediaAdded':
      order = { mediaAddedAt: 'DESC', id: 'DESC' };
      break;
    default:
      order = { id: 'DESC' };
  }

  try {
    const [media, count] = await getRepository(Media).findAndCount({
      where,
      order,
      take: pageSize,
      skip,
    });

    return res.status(200).json({
      pageInfo: {
        pages: Math.ceil(count / pageSize),
        pageSize,
        results: count,
        page: Math.ceil(skip / pageSize) + 1,
      },
      results: media.map((m) =>
        Object.assign(m, {
          coverUrl:
            m.mediaType === MediaType.RELEASE_GROUP
              ? coverUrlFor(m.mbid, 500)
              : null,
        })
      ),
    });
  } catch (e) {
    return next({ status: 500, message: e.message });
  }
});

// GET /media/:id · signed in → Media (with requests, tracks)
// The raw Media row carries library-location detail (local paths, media-server
// item ids). It is only used by the manage tools, so it needs MANAGE_REQUESTS.
router.get<{ id: string }>(
  '/:id',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return next({
        status: 404,
        message: 'That item is not in the library index.',
      });
    }
    try {
      const media = await getRepository(Media).findOne({
        where: { id },
        relations: { requests: true, tracks: true },
      });
      if (!media) {
        return next({
          status: 404,
          message: 'That item is not in the library index.',
        });
      }
      return res.status(200).json(media);
    } catch (e) {
      return next({ status: 500, message: e.message });
    }
  }
);

const STATUS_BY_NAME: Record<string, MediaStatus> = {
  available: MediaStatus.AVAILABLE,
  partial: MediaStatus.PARTIALLY_AVAILABLE,
  processing: MediaStatus.PROCESSING,
  pending: MediaStatus.PENDING,
  unknown: MediaStatus.UNKNOWN,
};

// POST /media/:id/:status · MANAGE_REQUESTS
//   in:  `status`=available|partial|processing|pending|unknown
//   out: Media
router.post<{ id: string; status: string }, Media>(
  '/:id/:status',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    const status = STATUS_BY_NAME[req.params.status];
    if (status === undefined) {
      return next({
        status: 400,
        message:
          'Use one of these statuses: available, partial, processing, pending, unknown.',
      });
    }
    try {
      const mediaRepository = getRepository(Media);
      const media = await mediaRepository.findOne({
        where: { id: Number(req.params.id) },
      });
      if (!media) {
        return next({
          status: 404,
          message: 'That item is not in the library index.',
        });
      }

      // "unknown" means "forget what was set by hand": fall back to what the scans found.
      media.status =
        status === MediaStatus.UNKNOWN ? media.libraryStatus() : status;
      if (IN_LIBRARY_STATUSES.includes(media.status) && !media.mediaAddedAt) {
        media.mediaAddedAt = new Date();
      }
      await mediaRepository.save(media);
      logger.info('Media status changed by hand', {
        label: 'Media',
        mediaId: media.id,
        status: media.status,
        userId: req.user?.id,
      });
      return res.status(200).json(media);
    } catch (e) {
      return next({ status: 500, message: e.message });
    }
  }
);

// DELETE /media/:id · MANAGE_REQUESTS → 204
//   Clear data: removes the row with its requests and tracks; the next scan rebuilds it.
router.delete<{ id: string }>(
  '/:id',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    try {
      const mediaRepository = getRepository(Media);
      const media = await mediaRepository.findOne({
        where: { id: Number(req.params.id) },
      });
      if (!media) {
        return next({
          status: 404,
          message: 'That item is not in the library index.',
        });
      }
      await mediaRepository.remove(media);
      return res.status(204).send();
    } catch (e) {
      logger.error('Could not clear media data', {
        label: 'Media',
        errorMessage: e.message,
      });
      return next({ status: 500, message: e.message });
    }
  }
);

// DELETE /media/:id/lidarr · MANAGE_REQUESTS → 204
//   in:  query `deleteFiles`=0|1
//   Removes the album (release group) or artist from Lidarr. With deleteFiles=1
//   Lidarr also deletes the files; the next library scan then steps the status
//   back. 409 when the item is not in Lidarr.
router.delete<{ id: string }>(
  '/:id/lidarr',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    try {
      const mediaRepository = getRepository(Media);
      const media = await mediaRepository.findOne({
        where: { id: Number(req.params.id) },
      });
      if (!media) {
        return next({
          status: 404,
          message: 'That item is not in the library index.',
        });
      }
      const servers = getSettings().lidarr;
      const server =
        servers.find((s) => s.id === media.lidarrServerId) ??
        servers.find((s) => s.isDefault && !s.isHiRes) ??
        servers[0];
      if (!server) {
        return next({ status: 409, message: 'No Lidarr server is set up.' });
      }
      const lidarr = LidarrAPI.fromSettings(server);
      const deleteFiles = ['1', 'true'].includes(String(req.query.deleteFiles));

      if (media.mediaType === MediaType.ARTIST) {
        const artist = await lidarr.getArtistByMbid(media.mbid);
        if (!artist?.id) {
          return next({
            status: 409,
            message: 'This artist is not in Lidarr.',
          });
        }
        await lidarr.deleteArtist(artist.id, { deleteFiles });
        await mediaRepository.update(
          [
            { id: media.id },
            { artistMbid: media.mbid, lidarrServerId: server.id },
          ],
          {
            lidarrArtistId: null,
            lidarrAlbumId: null,
            lidarrServerId: null,
            lidarrAddedByShufflerr: false,
          }
        );
      } else {
        const album = await lidarr.getAlbumByMbid(media.mbid);
        if (!album?.id) {
          return next({ status: 409, message: 'This album is not in Lidarr.' });
        }
        await lidarr.deleteAlbum(album.id, { deleteFiles });
        await mediaRepository.update(media.id, {
          lidarrAlbumId: null,
          lidarrAddedByShufflerr: false,
        });
      }
      if (media.artistMbid || media.mediaType === MediaType.ARTIST) {
        invalidateLidarrArtistState(media.artistMbid ?? media.mbid);
      }
      logger.info('Removed from Lidarr by hand', {
        label: 'Media',
        mediaId: media.id,
        deleteFiles,
        userId: req.user?.id,
      });
      return res.status(204).send();
    } catch (e) {
      logger.error('Could not remove the item from Lidarr', {
        label: 'Media',
        errorMessage: e.message,
      });
      return next({
        status: 502,
        message: 'Lidarr did not remove it. Check that Lidarr is running.',
      });
    }
  }
);

export default router;
