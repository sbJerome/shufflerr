/**
 * Status labels and colors. Labels are fixed product copy (CLAUDE.md §Domain
 * vocabulary); status is always shown as dot + label, never color alone.
 */
import defineMessages from '@app/utils/defineMessages';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';

export type StatusTone =
  | 'available'
  | 'partial'
  | 'processing'
  | 'pending'
  | 'declined'
  | 'none';

export const statusMessages = defineMessages('components.StatusBadge', {
  notinlibrary: 'Not in library',
  waiting: 'Waiting for approval',
  downloading: 'Downloading',
  requested: 'Requested',
  approveddownloading: 'Approved, downloading',
  partlyavailable: 'Partly available',
  available: 'Available',
  declined: 'Declined',
  failed: 'Failed',
  blocked: 'Blocked',
  removed: 'Removed',
  inlibrary: 'In library',
  missing: 'Missing',
  connected: 'Connected',
  notconnected: 'Not connected',
});

type Msg = (typeof statusMessages)[keyof typeof statusMessages];

export const toneColor = (tone: StatusTone): string => `var(--st-${tone})`;

/**
 * `downloading` says whether Lidarr's queue really holds the item right now
 * (request `downloadProgress` is a number). An approved request that Lidarr
 * has not started is "Requested", never "Downloading".
 */
export const mediaStatusInfo = (
  status?: MediaStatus | null,
  downloading = false
): { tone: StatusTone; message: Msg } => {
  switch (status) {
    case MediaStatus.PENDING:
      return { tone: 'pending', message: statusMessages.waiting };
    case MediaStatus.PROCESSING:
      return {
        tone: 'processing',
        message: downloading
          ? statusMessages.downloading
          : statusMessages.requested,
      };
    case MediaStatus.PARTIALLY_AVAILABLE:
      return { tone: 'partial', message: statusMessages.partlyavailable };
    case MediaStatus.AVAILABLE:
      return { tone: 'available', message: statusMessages.available };
    case MediaStatus.BLOCKLISTED:
      return { tone: 'declined', message: statusMessages.blocked };
    case MediaStatus.DELETED:
      return { tone: 'none', message: statusMessages.removed };
    case MediaStatus.UNKNOWN:
    default:
      return { tone: 'none', message: statusMessages.notinlibrary };
  }
};

export const requestStatusInfo = (
  status?: MediaRequestStatus | null,
  downloading = false
): { tone: StatusTone; message: Msg } => {
  switch (status) {
    case MediaRequestStatus.APPROVED:
      return {
        tone: 'processing',
        message: downloading
          ? statusMessages.downloading
          : statusMessages.requested,
      };
    case MediaRequestStatus.DECLINED:
      return { tone: 'declined', message: statusMessages.declined };
    case MediaRequestStatus.FAILED:
      return { tone: 'declined', message: statusMessages.failed };
    case MediaRequestStatus.COMPLETED:
      return { tone: 'available', message: statusMessages.available };
    case MediaRequestStatus.PENDING:
    default:
      return { tone: 'pending', message: statusMessages.waiting };
  }
};

/** Lidarr's queue holds the request right now (download sync wrote a progress figure). */
export const isDownloading = (
  request?: {
    status?: MediaRequestStatus | null;
    downloadProgress?: number | null;
  } | null
): boolean =>
  !!request &&
  request.status === MediaRequestStatus.APPROVED &&
  request.downloadProgress != null;
