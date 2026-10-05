// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type { DownloadingItem } from '@server/lib/downloadtracker';

/**
 * SWR refresh interval for views that show download progress: poll every
 * `timer` ms while something is downloading, otherwise don't poll.
 */
export const refreshIntervalHelper = (
  downloadItem: {
    downloadStatus: DownloadingItem[] | undefined;
  },
  timer: number
) => ((downloadItem.downloadStatus ?? []).length > 0 ? timer : 0);
