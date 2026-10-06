// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
//
// Side effects of request transitions
// (docs/PERMISSIONS_AND_APPROVALS.md §Subscriber side effects):
//   → PENDING   notify `pending` to managers
//   → APPROVED  notify (`autoApproved` to managers | `approved` to requester); send to Lidarr
//   → DECLINED  notify `declined`; media back to its library status; unmonitor what Shufflerr added
//   → FAILED    notify `failed` to requester + managers
//   → COMPLETED notify `available` to requester
//
// Transitions are detected by comparing the saved entity with the row that was
// in the database, so status changes must go through `repository.save(entity)`
// (not `repository.update()`), exactly like Seerr.
import type { LidarrAlbum, LidarrArtist } from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import {
  MediaRequestStatus,
  MediaType,
  RequestScope,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { ACTIVE_STATUSES, MediaRequest } from '@server/entity/MediaRequest';
import type { MusicNotificationType } from '@server/lib/notifications/music';
import { notifyRequest } from '@server/lib/notifications/music';
import overrideRules from '@server/lib/overrideRules';
import { emitRequestUpdate } from '@server/lib/realtime';
import type { LidarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type {
  EntitySubscriberInterface,
  InsertEvent,
  QueryRunner,
  UpdateEvent,
} from 'typeorm';
import { EventSubscriber, In, Not } from 'typeorm';

/** Raised with copy that is safe to show as `failureReason`. */
export class LidarrSendError extends Error {}

/**
 * How long to wait for Lidarr to load a freshly added artist's albums before
 * falling back to adding the album directly. Lidarr creates the album rows
 * first and pulls each album's tracks afterwards (~30s for a large
 * discography), so the wait covers both. Tests set the delay to 0.
 */
export const lidarrTiming = {
  albumPollAttempts: 20,
  albumPollDelayMs: 3000,
};

type Job = () => Promise<void>;

const JOBS_KEY = 'shufflerrRequestJobs';
const running = new Set<Promise<void>>();

const run = (job: Job): void => {
  const promise: Promise<void> = job()
    .catch((e) => {
      logger.error('A request side effect failed', {
        label: 'Media Request',
        errorMessage: e.message,
      });
    })
    .finally(() => {
      running.delete(promise);
    });
  running.add(promise);
};

/** Resolves once every queued side effect (notifications, Lidarr hand-off) has finished. */
export const flushRequestSideEffects = async (): Promise<void> => {
  while (running.size > 0) {
    await Promise.all([...running]);
  }
};

const sleep = (ms: number) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : undefined;

/** Turns a Lidarr client error into something an admin can act on. */
const describeLidarrError = (e: Error, server?: LidarrSettings): string => {
  if (e instanceof LidarrSendError) {
    return e.message;
  }

  const cause = (e as Error & { cause?: unknown }).cause as
    | {
        code?: string;
        response?: { status?: number; data?: unknown };
      }
    | undefined;
  const name = server?.name ? `Lidarr (${server.name})` : 'Lidarr';
  const status = cause?.response?.status;

  if (status === 401 || status === 403) {
    return `${name} rejected the API key. Update it in Settings → Lidarr, then retry.`;
  }
  if (status && status >= 400) {
    const data = cause?.response?.data;
    const detail = Array.isArray(data)
      ? data
          .map((d: { errorMessage?: string }) => d?.errorMessage)
          .filter(Boolean)
          .join(' ')
      : typeof data === 'object' && data !== null
        ? ((data as { message?: string }).message ?? '')
        : '';
    return `${name} refused the request (HTTP ${status})${
      detail ? `: ${detail}` : '.'
    }`;
  }
  if (
    cause?.code &&
    [
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'ECONNABORTED',
      'ECONNRESET',
      'EHOSTUNREACH',
      'EAI_AGAIN',
    ].includes(cause.code)
  ) {
    return `Couldn't reach ${name}. Check the connection in Settings → Lidarr, then retry.`;
  }

  return `${name} returned an error: ${e.message.replace(/^\[Lidarr\]\s*/, '')}`;
};

interface LidarrTarget {
  server: LidarrSettings;
  api: LidarrAPI;
  qualityProfileId: number;
  metadataProfileId: number;
  rootFolder: string;
  tags: number[];
}

/**
 * Step 1 of the hand-off: `serverId` on the request → override rule → default
 * server (the default hi-res server for hi-res requests).
 */
export const resolveLidarrTarget = async (
  request: MediaRequest
): Promise<LidarrTarget> => {
  const servers = getSettings().lidarr;

  if (servers.length === 0) {
    throw new LidarrSendError(
      'No Lidarr server is set up. Add one in Settings → Lidarr, then retry.'
    );
  }

  let rule: Awaited<ReturnType<typeof overrideRules>> | null = null;
  try {
    rule = await overrideRules({
      requestUser: request.requestedBy,
      primaryType: request.media.primaryType ?? undefined,
    });
  } catch (e) {
    logger.warn('Could not evaluate override rules', {
      label: 'Media Request',
      errorMessage: e.message,
    });
  }

  const byId = (id?: number | null) =>
    id === undefined || id === null
      ? undefined
      : servers.find((s) => s.id === id);

  const server =
    byId(request.serverId) ??
    byId(rule?.serverId) ??
    servers.find((s) => s.isDefault && s.isHiRes === !!request.isHiRes) ??
    servers.find((s) => s.isDefault) ??
    servers[0];

  if (
    request.serverId !== undefined &&
    request.serverId !== null &&
    server.id !== request.serverId
  ) {
    logger.warn('The Lidarr server chosen for a request no longer exists', {
      label: 'Media Request',
      requestId: request.id,
      serverId: request.serverId,
    });
  }

  const rootFolder =
    request.rootFolder ?? rule?.rootFolder ?? server.activeDirectory;
  const qualityProfileId =
    request.qualityProfileId ??
    rule?.profileId ??
    server.activeQualityProfileId;
  const metadataProfileId =
    request.metadataProfileId ??
    rule?.metadataProfileId ??
    server.activeMetadataProfileId;

  if (!rootFolder || !qualityProfileId || !metadataProfileId) {
    throw new LidarrSendError(
      `Lidarr (${server.name}) has no quality profile, metadata profile or root folder chosen. Finish its setup in Settings → Lidarr, then retry.`
    );
  }

  return {
    server,
    api: LidarrAPI.fromSettings(server),
    qualityProfileId,
    metadataProfileId,
    rootFolder,
    tags: rule?.tags ?? server.tags ?? [],
  };
};

const waitForAlbum = async (
  api: LidarrAPI,
  releaseGroupMbid: string,
  artistJustAdded: boolean
): Promise<LidarrAlbum | undefined> => {
  const attempts = artistJustAdded
    ? Math.max(1, lidarrTiming.albumPollAttempts)
    : 1;

  let album: LidarrAlbum | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    album = await api.getAlbumByMbid(releaseGroupMbid);
    // Searching before Lidarr has the album's tracks is fatal: every result
    // is rejected with "Album duration is 0" and Lidarr never retries.
    if (album && (!artistJustAdded || hasTracks(album))) {
      return album;
    }
    if (attempt < attempts - 1) {
      await sleep(lidarrTiming.albumPollDelayMs);
    }
  }

  if (album) {
    logger.warn(
      'Lidarr has not loaded the album tracks yet; searching anyway',
      {
        label: 'Lidarr',
        albumId: album.id,
        mbid: releaseGroupMbid,
      }
    );
  }

  return album;
};

const hasTracks = (album: LidarrAlbum): boolean =>
  (album.statistics?.totalTrackCount ?? 0) > 0;

const markFailed = async (requestId: number, reason: string): Promise<void> => {
  const requestRepository = getRepository(MediaRequest);
  const request = await requestRepository.findOne({ where: { id: requestId } });

  if (!request || request.status !== MediaRequestStatus.APPROVED) {
    return;
  }

  request.status = MediaRequestStatus.FAILED;
  request.failureReason = reason.slice(0, 250);
  request.downloadProgress = null;
  // Saving fires the subscriber again → `failed` notification + media status.
  await requestRepository.save(request);
};

/**
 * Hands an APPROVED request to Lidarr (steps 1–5 of "Send to Lidarr"). Never
 * throws: a failure turns the request into FAILED with a readable reason.
 */
export const sendToLidarr = async (requestId: number): Promise<void> => {
  const requestRepository = getRepository(MediaRequest);
  const mediaRepository = getRepository(Media);
  const request = await requestRepository.findOne({ where: { id: requestId } });

  if (!request || request.status !== MediaRequestStatus.APPROVED) {
    return;
  }

  let server: LidarrSettings | undefined;

  try {
    const target = await resolveLidarrTarget(request);
    server = target.server;
    const { api } = target;
    const media = request.media;
    const isDiscography = request.scope === RequestScope.DISCOGRAPHY;
    const artistMbid =
      media.mediaType === MediaType.ARTIST ? media.mbid : media.artistMbid;

    if (!artistMbid) {
      throw new LidarrSendError(
        "Shufflerr doesn't know which artist this album belongs to. Open the album page to refresh it, then retry."
      );
    }

    // 2. Artist: look up by MBID, add if missing.
    let artist: LidarrArtist | undefined =
      await api.getArtistByMbid(artistMbid);
    let artistAdded = false;

    if (!artist) {
      const lookup = await api.lookupArtist(artistMbid);
      if (!lookup) {
        throw new LidarrSendError(
          "Lidarr couldn't find this artist in its metadata source. It may be too new; retry later."
        );
      }

      artist = await api.addArtist({
        artist: lookup,
        qualityProfileId: target.qualityProfileId,
        metadataProfileId: target.metadataProfileId,
        rootFolderPath: target.rootFolder,
        tags: target.tags,
        monitored: true,
        monitorNewItems: request.monitorFuture ? 'all' : 'none',
        monitor: isDiscography ? 'all' : 'none',
        searchForMissingAlbums: isDiscography && !server.preventSearch,
      });
      artistAdded = true;
    } else {
      const monitorNewItems = request.monitorFuture
        ? 'all'
        : artist.monitorNewItems;
      if (!artist.monitored || artist.monitorNewItems !== monitorNewItems) {
        artist = await api.updateArtist({
          ...artist,
          monitored: true,
          monitorNewItems,
        });
      }
    }

    if (!artist.id) {
      throw new LidarrSendError(
        "Lidarr didn't return an id for the artist. Check Lidarr's logs, then retry."
      );
    }

    if (isDiscography) {
      // 4. Discography: monitor everything the metadata profile lists, search the artist.
      if (!artistAdded) {
        const albums = await api.getAlbums(artist.id);
        await api.monitorAlbums(
          albums
            .filter((album) => !album.monitored && album.id)
            .map((album) => album.id as number),
          true
        );
        if (!server.preventSearch) {
          await api.searchArtist(artist.id);
        }
      }

      await mediaRepository.update(media.id, {
        lidarrServerId: server.id,
        lidarrArtistId: artist.id,
        lidarrAddedByShufflerr: media.lidarrAddedByShufflerr || artistAdded,
      });
    } else {
      // 3. Album / tracks: monitor the release group and search it. Lidarr
      // fetches a release, so a tracks request may bring the whole album.
      let album = await waitForAlbum(api, media.mbid, artistAdded);
      let albumAdded = false;

      if (!album) {
        const lookup = await api.lookupAlbum(media.mbid);
        if (!lookup) {
          throw new LidarrSendError(
            "Lidarr couldn't find this album in its metadata source. It may be too new; retry later."
          );
        }
        album = await api.addAlbum({
          album: lookup,
          artist,
          monitored: true,
          searchForNewAlbum: false,
        });
        albumAdded = true;
      }

      if (!album.id) {
        throw new LidarrSendError(
          "Lidarr didn't return an id for the album. Check Lidarr's logs, then retry."
        );
      }

      const wasMonitored = album.monitored && !albumAdded;
      if (!album.monitored) {
        await api.monitorAlbums([album.id], true);
      }
      if (!server.preventSearch) {
        await api.searchAlbums([album.id]);
      }

      await mediaRepository.update(media.id, {
        lidarrServerId: server.id,
        lidarrArtistId: artist.id,
        lidarrAlbumId: album.id,
        lidarrAddedByShufflerr:
          media.lidarrAddedByShufflerr || artistAdded || !wasMonitored,
      });
    }

    await MediaRequest.refreshMediaStatus(media.id);

    logger.info('Sent a request to Lidarr', {
      label: 'Media Request',
      requestId: request.id,
      scope: request.scope,
      mbid: media.mbid,
      server: server.name,
      artistAdded,
    });
  } catch (e) {
    const reason = describeLidarrError(e, server);

    logger.error('Something went wrong sending a request to Lidarr', {
      label: 'Media Request',
      errorMessage: e.message,
      requestId: request.id,
      mbid: request.media?.mbid,
    });

    await markFailed(request.id, reason);
  }
};

/**
 * Undo Shufflerr's monitoring when a request is declined or cancelled: only
 * for items Shufflerr itself added or switched on, and only when no other
 * active request still wants them. Never throws.
 */
export const unmonitorInLidarr = async (
  request: Pick<MediaRequest, 'id' | 'scope'> & { media: Pick<Media, 'id'> }
): Promise<void> => {
  try {
    const mediaRepository = getRepository(Media);
    const media = await mediaRepository.findOne({
      where: { id: request.media.id },
    });

    if (
      !media ||
      !media.lidarrAddedByShufflerr ||
      media.lidarrServerId === null ||
      media.lidarrServerId === undefined
    ) {
      return;
    }

    const stillWanted = await getRepository(MediaRequest).count({
      where: {
        media: { id: media.id },
        status: In(ACTIVE_STATUSES),
        id: Not(request.id),
      },
    });
    if (stillWanted > 0) {
      return;
    }

    const server = getSettings().lidarr.find(
      (s) => s.id === media.lidarrServerId
    );
    if (!server) {
      return;
    }
    const api = LidarrAPI.fromSettings(server);

    if (media.mediaType === MediaType.ARTIST) {
      if (!media.lidarrArtistId) {
        return;
      }
      const artist = await api.getArtist(media.lidarrArtistId);
      await api.updateArtist({
        ...artist,
        monitored: false,
        monitorNewItems: 'none',
      });
    } else {
      if (!media.lidarrAlbumId) {
        return;
      }
      await api.monitorAlbums([media.lidarrAlbumId], false);
    }

    await mediaRepository.update(media.id, { lidarrAddedByShufflerr: false });

    logger.info('Stopped monitoring in Lidarr after a request ended', {
      label: 'Media Request',
      requestId: request.id,
      mbid: media.mbid,
    });
  } catch (e) {
    logger.warn('Could not stop monitoring in Lidarr', {
      label: 'Media Request',
      requestId: request.id,
      errorMessage: e.message,
    });
  }
};

/** Push the request's new state to connected browsers (best effort). */
const pushRequest = (entity: MediaRequest, previous?: MediaRequest): void => {
  emitRequestUpdate({
    requestId: entity.id,
    mediaId: entity.media?.id ?? previous?.media?.id,
    status: entity.status,
    downloadProgress: entity.downloadProgress,
    requestedById: entity.requestedBy?.id ?? previous?.requestedBy?.id,
  });
};

const notify = async (
  type: MusicNotificationType,
  requestId: number
): Promise<void> => {
  const request = await getRepository(MediaRequest).findOne({
    where: { id: requestId },
  });
  if (request) {
    await notifyRequest(type, request);
  }
};

@EventSubscriber()
export class MediaRequestSubscriber implements EntitySubscriberInterface<MediaRequest> {
  public listenTo(): typeof MediaRequest {
    return MediaRequest;
  }

  /**
   * Side effects read the request back from the database and call Lidarr, so
   * they must not run while the saving transaction still holds its connection:
   * queue them until the transaction commits.
   */
  private defer(queryRunner: QueryRunner | undefined, job: Job): void {
    if (queryRunner?.isTransactionActive) {
      const data = queryRunner.data as Record<string, Job[] | undefined>;
      (data[JOBS_KEY] ??= []).push(job);
    } else {
      run(job);
    }
  }

  public afterInsert(event: InsertEvent<MediaRequest>): void {
    const entity = event.entity;
    if (!entity?.id) {
      return;
    }
    const id = entity.id;

    this.defer(event.queryRunner, async () => pushRequest(entity));
    if (entity.status === MediaRequestStatus.PENDING) {
      this.defer(event.queryRunner, () => notify('pending', id));
    } else if (entity.status === MediaRequestStatus.APPROVED) {
      this.defer(event.queryRunner, async () => {
        if (entity.isAutoApproved) {
          await notify('autoApproved', id);
        }
        await sendToLidarr(id);
      });
    }
  }

  public afterUpdate(event: UpdateEvent<MediaRequest>): void {
    const entity = event.entity as MediaRequest | undefined;
    const previous = event.databaseEntity;

    if (!entity?.id || !previous || entity.status === previous.status) {
      return;
    }
    const id = entity.id;
    const mediaId = entity.media?.id ?? previous.media?.id;

    this.defer(event.queryRunner, async () => pushRequest(entity, previous));

    switch (entity.status) {
      case MediaRequestStatus.APPROVED:
        this.defer(event.queryRunner, async () => {
          // A retry (FAILED → APPROVED) re-sends without notifying again.
          if (previous.status === MediaRequestStatus.PENDING) {
            await notify('approved', id);
          }
          await sendToLidarr(id);
        });
        break;
      case MediaRequestStatus.DECLINED:
        this.defer(event.queryRunner, async () => {
          await notify('declined', id);
          if (mediaId) {
            await MediaRequest.refreshMediaStatus(mediaId);
            await unmonitorInLidarr({
              id,
              scope: entity.scope,
              media: { id: mediaId },
            });
          }
        });
        break;
      case MediaRequestStatus.FAILED:
        this.defer(event.queryRunner, async () => {
          await notify('failed', id);
          if (mediaId) {
            await MediaRequest.refreshMediaStatus(mediaId);
          }
        });
        break;
      case MediaRequestStatus.COMPLETED:
        this.defer(event.queryRunner, async () => {
          await notify('available', id);
          if (mediaId) {
            await MediaRequest.refreshMediaStatus(mediaId);
          }
        });
        break;
      default:
        break;
    }
  }

  public afterTransactionCommit(event: { queryRunner: QueryRunner }): void {
    const data = event.queryRunner.data as Record<string, Job[] | undefined>;
    const jobs = data[JOBS_KEY];
    if (jobs?.length) {
      delete data[JOBS_KEY];
      jobs.forEach(run);
    }
  }

  public afterTransactionRollback(event: { queryRunner: QueryRunner }): void {
    delete (event.queryRunner.data as Record<string, unknown>)[JOBS_KEY];
  }
}
