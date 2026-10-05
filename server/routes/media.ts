// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Mounted at /api/v1/media (see docs/API_CONTRACT.md).
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import type { MediaResultsResponse } from '@server/interfaces/api/mediaInterfaces';
import { coverUrlFor } from '@server/lib/metadata/index';
import { IN_LIBRARY_STATUSES } from '@server/lib/metadata/library';
import { Permission } from '@server/lib/permissions';
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
router.get<{ id: string }>('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return next({ status: 404, message: 'That item is not in the library index.' });
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
});

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
      if (
        IN_LIBRARY_STATUSES.includes(media.status) &&
        !media.mediaAddedAt
      ) {
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

export default router;
