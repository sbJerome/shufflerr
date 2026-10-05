/* eslint-disable @typescript-eslint/no-unused-vars -- stub signatures; remove when implemented */
// STREAM(SV2): implement — poll every Lidarr queue, expose per-album download
// state, write MediaRequest.downloadProgress, mark failed imports FAILED.
// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type { DownloadingItem } from '@server/interfaces/api/mediaInterfaces';

export type { DownloadingItem };

class DownloadTracker {
  /** Items currently in the queue of a Lidarr server for one Lidarr album id. */
  public getMusicProgress(
    _serverId: number,
    _externalAlbumId: number
  ): DownloadingItem[] {
    return [];
  }

  /** Number of albums currently downloading across all servers (Discover stats). */
  public getDownloadingCount(): number {
    return 0;
  }

  /** `download-sync` job. */
  public async updateDownloads(): Promise<void> {
    return;
  }

  /** `download-sync-reset` job. */
  public resetDownloadTracker(): void {
    return;
  }
}

const downloadTracker = new DownloadTracker();

export default downloadTracker;
