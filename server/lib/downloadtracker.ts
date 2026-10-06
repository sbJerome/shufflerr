// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
//
// Polls every Lidarr queue, exposes per-album download state, writes
// MediaRequest.downloadProgress and turns failed imports into FAILED requests.
import type { LidarrQueueItem } from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import { MediaRequestStatus, RequestScope } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import type { DownloadingItem } from '@server/interfaces/api/mediaInterfaces';
import { emitRequestUpdate } from '@server/lib/realtime';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

export type { DownloadingItem };

type TrackedItem = DownloadingItem & {
  artistId?: number;
  failed: boolean;
  failureReason?: string;
};

const percent = (size: number, sizeLeft: number): number =>
  size > 0
    ? Math.max(0, Math.min(100, Math.round(((size - sizeLeft) / size) * 100)))
    : 0;

/** Lidarr states that mean "this grab will not finish on its own". */
const failureOf = (item: LidarrQueueItem): string | undefined => {
  const state = (item.trackedDownloadState ?? '').toLowerCase();
  const status = (item.status ?? '').toLowerCase();

  if (state !== 'importfailed' && state !== 'failed' && status !== 'failed') {
    return undefined;
  }

  const detail =
    item.errorMessage ||
    (item.statusMessages ?? [])
      .flatMap((m) => (m.messages?.length ? m.messages : [m.title]))
      .filter(Boolean)
      .slice(0, 2)
      .join(' ');

  return state === 'importfailed'
    ? `Lidarr downloaded it but couldn't import the files${
        detail ? `: ${detail}` : '. Check the queue in Lidarr.'
      }`
    : `The download failed in Lidarr${detail ? `: ${detail}` : '.'}`;
};

class DownloadTracker {
  /** serverId → queue items */
  private lidarrServers: Record<number, TrackedItem[]> = {};

  /** Items currently in the queue of a Lidarr server for one Lidarr album id. */
  public getMusicProgress(
    serverId: number,
    externalAlbumId: number
  ): DownloadingItem[] {
    return (this.lidarrServers[serverId] ?? [])
      .filter((item) => item.externalId === externalAlbumId)
      .map((item) => ({
        externalId: item.externalId,
        queueId: item.queueId,
        size: item.size,
        sizeLeft: item.sizeLeft,
        status: item.status,
        timeLeft: item.timeLeft,
        estimatedCompletionTime: item.estimatedCompletionTime,
        title: item.title,
        downloadId: item.downloadId,
        progress: item.progress,
      }));
  }

  /** Number of albums currently downloading across all servers (Discover stats). */
  public getDownloadingCount(): number {
    return Object.values(this.lidarrServers).reduce(
      (count, items) =>
        count +
        new Set(items.filter((i) => !i.failed).map((i) => i.externalId)).size,
      0
    );
  }

  /** `download-sync` job. */
  public async updateDownloads(): Promise<void> {
    const servers = getSettings().lidarr;
    const known = new Set(servers.map((s) => s.id));

    for (const id of Object.keys(this.lidarrServers).map(Number)) {
      if (!known.has(id)) {
        delete this.lidarrServers[id];
      }
    }

    await Promise.all(
      servers
        .filter((server) => server.syncEnabled)
        .map(async (server) => {
          try {
            const queue = await LidarrAPI.fromSettings(server).getQueue();

            this.lidarrServers[server.id] = queue
              .filter((item) => typeof item.albumId === 'number')
              .map((item) => {
                const failureReason = failureOf(item);
                return {
                  externalId: item.albumId as number,
                  artistId: item.artistId,
                  queueId: item.id,
                  size: item.size,
                  sizeLeft: item.sizeleft,
                  status: item.status,
                  timeLeft: item.timeleft,
                  estimatedCompletionTime: item.estimatedCompletionTime,
                  title: item.title,
                  downloadId: item.downloadId,
                  progress: percent(item.size, item.sizeleft),
                  failed: !!failureReason,
                  failureReason,
                };
              });
          } catch (e) {
            logger.error(
              `Unable to get the queue from Lidarr server: ${server.name}`,
              { label: 'Download Tracker', errorMessage: e.message }
            );
          }
        })
    );

    await this.syncRequests();
  }

  /** Write progress onto APPROVED requests and fail the ones Lidarr gave up on. */
  private async syncRequests(): Promise<void> {
    const requestRepository = getRepository(MediaRequest);
    const approved = await requestRepository.find({
      where: { status: MediaRequestStatus.APPROVED },
    });

    for (const request of approved) {
      try {
        const media = request.media;
        const serverId = media?.lidarrServerId;
        if (serverId === null || serverId === undefined) {
          continue;
        }

        const items = (this.lidarrServers[serverId] ?? []).filter((item) =>
          request.scope === RequestScope.DISCOGRAPHY
            ? !!media.lidarrArtistId && item.artistId === media.lidarrArtistId
            : !!media.lidarrAlbumId && item.externalId === media.lidarrAlbumId
        );

        const live = items.filter((item) => !item.failed);
        const failed = items.find((item) => item.failed);

        // Only album/track requests fail on a bad grab: a discography keeps
        // going with its other releases.
        if (
          failed &&
          live.length === 0 &&
          request.scope !== RequestScope.DISCOGRAPHY
        ) {
          request.status = MediaRequestStatus.FAILED;
          request.failureReason = (
            failed.failureReason ?? 'The download failed in Lidarr.'
          ).slice(0, 250);
          request.downloadProgress = null;
          await requestRepository.save(request);
          continue;
        }

        // A progress figure means "Lidarr's queue holds it right now"; when
        // the queue no longer does, clear it so the UI says "Requested" again
        // (a finished grab becomes COMPLETED once the files are scanned).
        let progress: number | null = null;
        if (live.length > 0) {
          const size = live.reduce((sum, item) => sum + item.size, 0);
          const sizeLeft = live.reduce((sum, item) => sum + item.sizeLeft, 0);
          progress = percent(size, sizeLeft);
        }

        if (progress !== (request.downloadProgress ?? null)) {
          // update() on purpose: progress ticks must not fire request transitions.
          await requestRepository.update(request.id, {
            downloadProgress: progress,
          });
          emitRequestUpdate({
            requestId: request.id,
            mediaId: media.id,
            status: request.status,
            downloadProgress: progress,
            requestedById: request.requestedBy?.id,
          });
        }

        if (request.scope !== RequestScope.DISCOGRAPHY) {
          await MediaRequest.completeSatisfied(media.id);
        }
      } catch (e) {
        logger.error('Could not sync download state for a request', {
          label: 'Download Tracker',
          requestId: request.id,
          errorMessage: e.message,
        });
      }
    }
  }

  /** `download-sync-reset` job. */
  public resetDownloadTracker(): void {
    this.lidarrServers = {};
  }
}

const downloadTracker = new DownloadTracker();

export default downloadTracker;
