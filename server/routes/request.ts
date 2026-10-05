// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Mounted at /api/v1/request (see docs/API_CONTRACT.md and
// docs/PERMISSIONS_AND_APPROVALS.md).
import {
  MediaRequestStatus,
  MediaStatus,
  RequestScope,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import {
  BlocklistedMediaError,
  DuplicateMediaRequestError,
  MediaRequest,
  QuotaRestrictedError,
  RequestPermissionError,
  RequestValidationError,
} from '@server/entity/MediaRequest';
import Track from '@server/entity/Track';
import TrackRequest from '@server/entity/TrackRequest';
import { User } from '@server/entity/User';
import type {
  DeclineBody,
  DryRunResult,
  MediaRequestBody,
  MediaRequestUpdateBody,
  RequestCountResponse,
  RequestResult,
  RequestResultsResponse,
} from '@server/interfaces/api/requestInterfaces';
import { Permission } from '@server/lib/permissions';
import { toRequestResult, toRequestResults } from '@server/lib/requestResults';
import logger from '@server/logger';
import { unmonitorInLidarr } from '@server/subscriber/MediaRequestSubscriber';
import requestLock, { requestKey, userKey } from '@server/utils/requestLock';
import { Router } from 'express';

const router = Router();

const MANAGE_COPY = "You don't have permission to manage requests.";
const NOT_FOUND = "That request doesn't exist any more.";

const canViewAll = (user: User): boolean =>
  user.hasPermission([Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW], {
    type: 'or',
  });

const statusesFor = (filter: unknown): MediaRequestStatus[] | null => {
  switch (filter) {
    case 'pending':
      return [MediaRequestStatus.PENDING];
    case 'approved':
    case 'processing':
      return [MediaRequestStatus.APPROVED];
    case 'available':
      return [MediaRequestStatus.COMPLETED];
    case 'declined':
      return [MediaRequestStatus.DECLINED];
    case 'failed':
      return [MediaRequestStatus.FAILED];
    case undefined:
    case '':
    case 'all':
      return null;
    default:
      return null;
  }
};

const isTruthy = (value: unknown): boolean =>
  value === true || value === 1 || value === '1' || value === 'true';

// POST /request · signed in
router.post<
  Record<string, string>,
  RequestResult | DryRunResult,
  MediaRequestBody
>('/', async (req, res, next) => {
  const user = req.user;
  if (!user) {
    return next({ status: 401, message: 'Sign in to request music.' });
  }

  const body: MediaRequestBody = {
    ...req.body,
    dryRun: isTruthy(req.query.dryRun) || isTruthy(req.body?.dryRun),
  };

  try {
    if (body.dryRun) {
      const result = await MediaRequest.request(
        { ...body, dryRun: true },
        user
      );
      return res.status(200).json(result);
    }

    // One request at a time per requester, so two quick clicks can't both
    // pass the quota and duplicate checks.
    const request = await requestLock.dispatch(
      userKey(body.userId ?? user.id),
      () => MediaRequest.request(body, user)
    );

    return res.status(201).json(await toRequestResult(request, user));
  } catch (error) {
    if (!(error instanceof Error)) {
      return next({ status: 500, message: 'Something went wrong.' });
    }

    if (
      error instanceof RequestPermissionError ||
      error instanceof QuotaRestrictedError ||
      error instanceof BlocklistedMediaError
    ) {
      return next({ status: 403, message: error.message });
    }
    if (error instanceof DuplicateMediaRequestError) {
      return next({ status: 409, message: error.message });
    }
    if (error instanceof RequestValidationError) {
      return next({ status: 400, message: error.message });
    }

    logger.error('Something went wrong creating a request', {
      label: 'API',
      errorMessage: error.message,
      mbid: req.body?.mbid,
    });
    return next({
      status: 500,
      message:
        "Couldn't create the request. Check that MusicBrainz is reachable, then try again.",
    });
  }
});

// GET /request · signed in
router.get<Record<string, string>, RequestResultsResponse>(
  '/',
  async (req, res, next) => {
    const user = req.user as User;

    try {
      const pageSize = Math.min(
        100,
        Math.max(1, req.query.take ? Number(req.query.take) : 20)
      );
      const skip = Math.max(0, req.query.skip ? Number(req.query.skip) : 0);
      const requestedBy = req.query.requestedBy
        ? Number(req.query.requestedBy)
        : null;
      const scope = req.query.scope as RequestScope | undefined;
      const statuses = statusesFor(req.query.filter);
      const direction =
        String(req.query.sortDirection).toLowerCase() === 'asc'
          ? 'ASC'
          : 'DESC';
      const sortColumn =
        req.query.sort === 'modified' ? 'request.updatedAt' : 'request.id';

      if (
        requestedBy !== null &&
        requestedBy !== user.id &&
        !canViewAll(user)
      ) {
        return next({
          status: 403,
          message: "You don't have permission to see other people's requests.",
        });
      }

      let query = getRepository(MediaRequest)
        .createQueryBuilder('request')
        .leftJoinAndSelect('request.media', 'media')
        .leftJoinAndSelect('request.tracks', 'tracks')
        .leftJoinAndSelect('tracks.track', 'track')
        .leftJoinAndSelect('request.modifiedBy', 'modifiedBy')
        .leftJoinAndSelect('request.requestedBy', 'requestedBy')
        .where('1 = 1');

      if (statuses) {
        query = query.andWhere('request.status IN (:...statuses)', {
          statuses,
        });
      }
      if (scope && Object.values(RequestScope).includes(scope)) {
        query = query.andWhere('request.scope = :scope', { scope });
      }
      if (!canViewAll(user)) {
        query = query.andWhere('requestedBy.id = :id', { id: user.id });
      } else if (requestedBy !== null) {
        query = query.andWhere('requestedBy.id = :id', { id: requestedBy });
      }

      const [requests, requestCount] = await query
        .orderBy(sortColumn, direction)
        .take(pageSize)
        .skip(skip)
        .getManyAndCount();

      const { results, serviceErrors } = await toRequestResults(requests, user);

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(requestCount / pageSize),
          pageSize,
          results: requestCount,
          page: Math.ceil(skip / pageSize) + 1,
        },
        results,
        serviceErrors,
      });
    } catch (e) {
      logger.error('Could not list requests', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: "Couldn't load requests. Try again." });
    }
  }
);

// GET /request/count · signed in — scoped the same way as the list
router.get<Record<string, string>, RequestCountResponse>(
  '/count',
  async (req, res, next) => {
    const user = req.user as User;

    try {
      let query = getRepository(MediaRequest)
        .createQueryBuilder('request')
        .leftJoin('request.requestedBy', 'requestedBy')
        .select('request.status', 'status')
        .addSelect('request.scope', 'scope')
        .addSelect('COUNT(*)', 'count')
        .groupBy('request.status')
        .addGroupBy('request.scope');

      if (!canViewAll(user)) {
        query = query.where('requestedBy.id = :id', { id: user.id });
      }

      const rows = await query.getRawMany<{
        status: number | string;
        scope: RequestScope;
        count: number | string;
      }>();

      const counts: RequestCountResponse = {
        total: 0,
        pending: 0,
        approved: 0,
        processing: 0,
        available: 0,
        declined: 0,
        failed: 0,
        album: 0,
        tracks: 0,
        discography: 0,
      };

      for (const row of rows) {
        const count = Number(row.count);
        counts.total += count;

        switch (Number(row.status)) {
          case MediaRequestStatus.PENDING:
            counts.pending += count;
            break;
          case MediaRequestStatus.APPROVED:
            counts.approved += count;
            counts.processing += count;
            break;
          case MediaRequestStatus.COMPLETED:
            counts.available += count;
            break;
          case MediaRequestStatus.DECLINED:
            counts.declined += count;
            break;
          case MediaRequestStatus.FAILED:
            counts.failed += count;
            break;
        }

        if (row.scope === RequestScope.ALBUM) counts.album += count;
        if (row.scope === RequestScope.TRACKS) counts.tracks += count;
        if (row.scope === RequestScope.DISCOGRAPHY) counts.discography += count;
      }

      return res.status(200).json(counts);
    } catch (e) {
      logger.error('Could not count requests', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: "Couldn't count requests. Try again." });
    }
  }
);

const loadRequest = async (id: unknown): Promise<MediaRequest | null> => {
  const requestId = Number(id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return null;
  }
  return getRepository(MediaRequest).findOne({ where: { id: requestId } });
};

// GET /request/:id · signed in
router.get<{ id: string }, RequestResult>('/:id', async (req, res, next) => {
  const user = req.user as User;

  try {
    const request = await loadRequest(req.params.id);
    if (!request) {
      return next({ status: 404, message: NOT_FOUND });
    }
    if (request.requestedBy.id !== user.id && !canViewAll(user)) {
      return next({
        status: 403,
        message: "You don't have permission to see this request.",
      });
    }

    return res.status(200).json(await toRequestResult(request, user));
  } catch (e) {
    logger.error('Could not load a request', {
      label: 'API',
      errorMessage: e.message,
    });
    next({ status: 500, message: "Couldn't load the request. Try again." });
  }
});

// PUT /request/:id · MANAGE_REQUESTS, or requester while pending
router.put<{ id: string }, RequestResult, MediaRequestUpdateBody>(
  '/:id',
  async (req, res, next) => {
    const user = req.user as User;

    try {
      const result = await requestLock.dispatch(
        requestKey(Number(req.params.id)),
        async () => {
          const requestRepository = getRepository(MediaRequest);
          const request = await loadRequest(req.params.id);
          if (!request) {
            return { status: 404, message: NOT_FOUND };
          }

          const isManager = user.hasPermission(Permission.MANAGE_REQUESTS);
          const isOwnPending =
            request.requestedBy.id === user.id &&
            request.status === MediaRequestStatus.PENDING;

          if (!isManager && !isOwnPending) {
            return {
              status: 403,
              message:
                request.requestedBy.id === user.id
                  ? 'You can only change a request while it waits for approval.'
                  : "You don't have permission to change this request.",
            };
          }
          if (
            request.status !== MediaRequestStatus.PENDING &&
            request.status !== MediaRequestStatus.FAILED
          ) {
            return {
              status: 400,
              message:
                'Only requests that are waiting or failed can be changed.',
            };
          }

          const body = req.body ?? {};

          // Scope and track selection (requester or manager). Discography
          // lives on the artist, so it can't be swapped for an album scope.
          const nextScope = body.scope ?? request.scope;
          if (nextScope !== request.scope || body.trackMbids) {
            if (
              request.scope === RequestScope.DISCOGRAPHY ||
              nextScope === RequestScope.DISCOGRAPHY
            ) {
              return {
                status: 400,
                message:
                  "A discography request can't be changed into an album or track request. Cancel it and request again.",
              };
            }

            if (nextScope === RequestScope.ALBUM) {
              if (request.tracks?.length) {
                await getRepository(TrackRequest).remove(request.tracks);
              }
              request.tracks = [];
              request.trackCount = 0;
            } else {
              const albumTracks = await getRepository(Track).find({
                where: { media: { id: request.media.id } },
              });
              const wanted = body.trackMbids?.length
                ? new Set(body.trackMbids)
                : null;
              const chosen = albumTracks.filter(
                (t) =>
                  t.status !== MediaStatus.AVAILABLE &&
                  (wanted
                    ? !!t.recordingMbid && wanted.has(t.recordingMbid)
                    : true)
              );
              if (chosen.length === 0) {
                return {
                  status: 400,
                  message:
                    'Pick at least one track that is still missing from the library.',
                };
              }
              if (!isManager) {
                const quota = await request.requestedBy.getQuota();
                const allowance =
                  (quota.track.remaining ?? 0) + (request.trackCount ?? 0);
                if (quota.track.limit && chosen.length > allowance) {
                  return {
                    status: 403,
                    message: `That's more tracks than your limit allows (${Math.max(
                      0,
                      allowance
                    )} left).`,
                  };
                }
              }

              const keep = (request.tracks ?? []).filter((tr) =>
                chosen.some((t) => t.id === tr.track?.id)
              );
              const drop = (request.tracks ?? []).filter(
                (tr) => !keep.includes(tr)
              );
              if (drop.length) {
                await getRepository(TrackRequest).remove(drop);
              }
              request.tracks = [
                ...keep,
                ...chosen
                  .filter((t) => !keep.some((tr) => tr.track?.id === t.id))
                  .map(
                    (track) =>
                      new TrackRequest({ track, status: request.status })
                  ),
              ];
              request.trackCount = request.tracks.length;
            }
            request.scope = nextScope;
          }

          if (body.monitorFuture !== undefined) {
            request.monitorFuture = !!body.monitorFuture;
          }

          if (isManager) {
            if (body.serverId !== undefined) {
              request.serverId = body.serverId ?? null;
            }
            if (body.qualityProfileId !== undefined) {
              request.qualityProfileId = body.qualityProfileId ?? null;
            }
            if (body.metadataProfileId !== undefined) {
              request.metadataProfileId = body.metadataProfileId ?? null;
            }
            if (body.rootFolder !== undefined) {
              request.rootFolder = body.rootFolder || null;
            }
            if (
              body.userId !== undefined &&
              body.userId !== request.requestedBy.id
            ) {
              const requester = await getRepository(User).findOne({
                where: { id: body.userId },
              });
              if (!requester) {
                return {
                  status: 400,
                  message: "The user you picked doesn't exist any more.",
                };
              }
              request.requestedBy = requester;
            }
          }

          return { request: await requestRepository.save(request) };
        }
      );

      if ('request' in result && result.request) {
        return res
          .status(200)
          .json(await toRequestResult(result.request, user));
      }
      return next(result);
    } catch (e) {
      logger.error('Could not update a request', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: "Couldn't save the request. Try again." });
    }
  }
);

// DELETE /request/:id · requester (pending only) or MANAGE_REQUESTS
router.delete<{ id: string }>('/:id', async (req, res, next) => {
  const user = req.user as User;

  try {
    const result = await requestLock.dispatch(
      requestKey(Number(req.params.id)),
      async () => {
        const requestRepository = getRepository(MediaRequest);
        const request = await loadRequest(req.params.id);
        if (!request) {
          return { status: 404, message: NOT_FOUND };
        }

        const isManager = user.hasPermission(Permission.MANAGE_REQUESTS);
        if (
          !isManager &&
          !(
            request.requestedBy.id === user.id &&
            request.status === MediaRequestStatus.PENDING
          )
        ) {
          return {
            status: 403,
            message:
              request.requestedBy.id === user.id
                ? 'You can only cancel a request while it waits for approval. Ask an admin to remove it.'
                : "You don't have permission to remove this request.",
          };
        }

        const snapshot = {
          id: request.id,
          scope: request.scope,
          status: request.status,
          media: { id: request.media.id },
        };

        await requestRepository.remove(request);
        await MediaRequest.refreshMediaStatus(snapshot.media.id);
        if (snapshot.status === MediaRequestStatus.APPROVED) {
          await unmonitorInLidarr(snapshot);
        }

        return null;
      }
    );

    if (result) {
      return next(result);
    }
    return res.status(204).send();
  } catch (e) {
    logger.error('Could not delete a request', {
      label: 'API',
      errorMessage: e.message,
    });
    next({ status: 500, message: "Couldn't remove the request. Try again." });
  }
});

// POST /request/:id/retry · MANAGE_REQUESTS — only FAILED → APPROVED
router.post<{ id: string }, RequestResult>(
  '/:id/retry',
  async (req, res, next) => {
    const user = req.user as User;

    if (!user.hasPermission(Permission.MANAGE_REQUESTS)) {
      return next({ status: 403, message: MANAGE_COPY });
    }

    try {
      const result = await requestLock.dispatch(
        requestKey(Number(req.params.id)),
        async () => {
          const requestRepository = getRepository(MediaRequest);
          const request = await loadRequest(req.params.id);
          if (!request) {
            return { status: 404, message: NOT_FOUND };
          }
          if (request.status !== MediaRequestStatus.FAILED) {
            return {
              status: 400,
              message: 'Only failed requests can be retried.',
            };
          }

          request.status = MediaRequestStatus.APPROVED;
          request.failureReason = null;
          request.downloadProgress = null;
          for (const tr of request.tracks ?? []) {
            tr.status = MediaRequestStatus.APPROVED;
          }
          // The subscriber re-sends it to Lidarr.
          return { request: await requestRepository.save(request) };
        }
      );

      if ('request' in result && result.request) {
        return res
          .status(200)
          .json(await toRequestResult(result.request, user));
      }
      return next(result);
    } catch (e) {
      logger.error('Could not retry a request', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: "Couldn't retry the request. Try again." });
    }
  }
);

// POST /request/:id/:status · MANAGE_REQUESTS — approve | decline, only while pending
router.post<
  { id: string; status: string },
  RequestResult,
  DeclineBody | undefined
>('/:id/:status', async (req, res, next) => {
  const user = req.user as User;

  if (!user.hasPermission(Permission.MANAGE_REQUESTS)) {
    return next({ status: 403, message: MANAGE_COPY });
  }

  let newStatus: MediaRequestStatus;
  switch (req.params.status) {
    case 'approve':
      newStatus = MediaRequestStatus.APPROVED;
      break;
    case 'decline':
      newStatus = MediaRequestStatus.DECLINED;
      break;
    default:
      return next({
        status: 400,
        message: 'Requests can only be approved or declined.',
      });
  }

  try {
    const result = await requestLock.dispatch(
      requestKey(Number(req.params.id)),
      async () => {
        const requestRepository = getRepository(MediaRequest);
        const request = await loadRequest(req.params.id);
        if (!request) {
          return { status: 404, message: NOT_FOUND };
        }
        if (request.status !== MediaRequestStatus.PENDING) {
          return {
            status: 400,
            message: 'Only pending requests can be approved or declined.',
          };
        }

        request.status = newStatus;
        request.modifiedBy = user;
        request.isAutoApproved = false;
        request.declineReason =
          newStatus === MediaRequestStatus.DECLINED
            ? req.body?.declineReason?.trim().slice(0, 250) || null
            : null;
        for (const tr of request.tracks ?? []) {
          tr.status = newStatus;
        }

        const saved = await requestRepository.save(request);
        if (newStatus === MediaRequestStatus.APPROVED) {
          await MediaRequest.refreshMediaStatus(saved.media.id);
        }
        return { request: saved };
      }
    );

    if ('request' in result && result.request) {
      return res.status(200).json(await toRequestResult(result.request, user));
    }
    return next(result);
  } catch (e) {
    logger.error('Could not change a request', {
      label: 'API',
      errorMessage: e.message,
    });
    next({ status: 500, message: "Couldn't update the request. Try again." });
  }
});

export default router;
