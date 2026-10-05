// Builds notification payloads for music requests. SV2's request subscriber
// calls `notifyRequest()`; every agent receives the same payload.
import {
  MediaRequestStatus,
  MediaType,
  RequestScope,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import type Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { Notification } from '.';
import notificationManager from '.';
import type { NotificationPayload } from './agents/agent';
import type { NotificationTypeKey } from './types';
import { NOTIFICATION_TYPE_KEYS } from './types';

/** The request events Shufflerr notifies about. */
export type MusicNotificationType =
  | 'pending'
  | 'autoApproved'
  | 'approved'
  | 'declined'
  | 'available'
  | 'failed';

/**
 * What every agent receives for a request event.
 *
 * - `event`    — short label, e.g. "Request waiting for approval"
 * - `subject`  — "<Album> — <Artist>", or "<Artist> — discography"
 * - `message`  — one sentence saying what happened (and why, for declined/failed)
 * - `image`    — absolute cover URL through the image proxy; unset when the
 *                application URL is not configured or the item is an artist
 * - `extra`    — `[{name, value}]`: Scope, Tracks / Releases, Reason
 * - `media`, `request` — the entities (webhook variables read from them)
 * - `notifyUser`  — the requester, for approved / declined / available / failed
 * - `notifyAdmin` — true for pending / autoApproved / failed (people with
 *                   MANAGE_REQUESTS, filtered per user by their own prefs)
 */
export type MusicNotificationPayload = NotificationPayload & {
  media: Media;
  request: MediaRequest;
};

export interface RequestNotificationOptions {
  /** Overrides the default sentence. */
  message?: string;
  /** Appended to `extra`. */
  extra?: { name: string; value: string }[];
  /** Pending requests count for the web-push badge (looked up when omitted). */
  pendingRequestsCount?: number;
}

const EVENT_LABEL: Record<MusicNotificationType, string> = {
  pending: 'Request waiting for approval',
  autoApproved: 'Request approved automatically',
  approved: 'Request approved',
  declined: 'Request declined',
  available: 'Music available',
  failed: 'Request failed',
};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** "<Album> — <Artist>" for release groups, "<Artist> — discography" for artists. */
export const notificationSubject = (
  media: Pick<Media, 'mediaType' | 'title' | 'artistName'>,
  scope?: RequestScope
): string => {
  if (media.mediaType === MediaType.ARTIST) {
    return scope === RequestScope.DISCOGRAPHY || !scope
      ? `${media.title} — discography`
      : media.title;
  }
  return media.artistName ? `${media.title} — ${media.artistName}` : media.title;
};

/** Human description of what a request covers: "Album", "4 tracks", "Discography (8 releases)". */
export const scopeLabel = (
  request: Pick<MediaRequest, 'scope' | 'trackCount' | 'releaseCount'>
): string => {
  switch (request.scope) {
    case RequestScope.TRACKS:
      return request.trackCount
        ? plural(request.trackCount, 'track', 'tracks')
        : 'Tracks';
    case RequestScope.DISCOGRAPHY:
      return request.releaseCount
        ? `Discography (${plural(request.releaseCount, 'release', 'releases')})`
        : 'Discography';
    default:
      return 'Album';
  }
};

/** Absolute cover URL through this instance's image proxy, when it can be built. */
export const notificationImage = (media: Media): string | undefined => {
  const { applicationUrl } = getSettings().main;
  if (!applicationUrl || media.mediaType !== MediaType.RELEASE_GROUP) {
    return undefined;
  }
  if (!getSettings().metadata.coverArtArchive.enabled) {
    return undefined;
  }
  return `${applicationUrl}/imageproxy/caa/release-group/${media.mbid}/front-500`;
};

const defaultMessage = (
  type: MusicNotificationType,
  request: MediaRequest,
  subject: string
): string => {
  const who = request.requestedBy?.displayName ?? 'Someone';
  switch (type) {
    case 'pending':
      return `${who} requested ${subject}. It's waiting for an admin to approve it.`;
    case 'autoApproved':
      return `${who} requested ${subject}. It was approved automatically and sent to Lidarr.`;
    case 'approved':
      return `Your request for ${subject} was approved and sent to Lidarr.`;
    case 'declined':
      return request.declineReason
        ? `Your request for ${subject} was declined: ${request.declineReason}`
        : `Your request for ${subject} was declined.`;
    case 'available':
      return `${subject} is now in your library.`;
    case 'failed':
      return request.failureReason
        ? `The request for ${subject} failed: ${request.failureReason}`
        : `The request for ${subject} failed to download. An admin can retry it from the requests page.`;
  }
};

/** Pure: builds the bitmask type and payload for a request event. */
export const buildRequestNotification = (
  type: MusicNotificationType,
  request: MediaRequest,
  options: RequestNotificationOptions = {}
): { type: Notification; payload: MusicNotificationPayload } => {
  const media = request.media;
  const subject = notificationSubject(media, request.scope);

  const extra: { name: string; value: string }[] = [
    { name: 'Scope', value: scopeLabel(request) },
  ];
  if (type === 'declined' && request.declineReason) {
    extra.push({ name: 'Reason', value: request.declineReason });
  }
  if (type === 'failed' && request.failureReason) {
    extra.push({ name: 'Reason', value: request.failureReason });
  }
  if (type === 'approved' && request.modifiedBy) {
    extra.push({ name: 'Approved by', value: request.modifiedBy.displayName });
  }
  if (type === 'declined' && request.modifiedBy) {
    extra.push({ name: 'Declined by', value: request.modifiedBy.displayName });
  }
  extra.push(...(options.extra ?? []));

  const toRequester =
    type === 'approved' ||
    type === 'declined' ||
    type === 'available' ||
    type === 'failed';
  const toManagers =
    type === 'pending' || type === 'autoApproved' || type === 'failed';

  return {
    type: NOTIFICATION_TYPE_KEYS[type as NotificationTypeKey],
    payload: {
      event: EVENT_LABEL[type],
      subject,
      message: options.message ?? defaultMessage(type, request, subject),
      image: notificationImage(media),
      extra,
      media,
      request,
      notifySystem: true,
      notifyAdmin: toManagers,
      notifyUser: toRequester ? request.requestedBy : undefined,
      pendingRequestsCount: options.pendingRequestsCount,
    },
  };
};

/**
 * Sends a request event to every enabled agent. Never throws: a notification
 * problem must not break the request lifecycle.
 */
export const notifyRequest = async (
  type: MusicNotificationType,
  request: MediaRequest,
  options: RequestNotificationOptions = {}
): Promise<void> => {
  try {
    if (!request.media || !request.requestedBy) {
      logger.warn('Skipped a notification: the request has no media or user', {
        label: 'Notifications',
        requestId: request.id,
        type,
      });
      return;
    }

    let pendingRequestsCount = options.pendingRequestsCount;
    if (pendingRequestsCount === undefined) {
      pendingRequestsCount = await getRepository(MediaRequest).count({
        where: { status: MediaRequestStatus.PENDING },
      });
    }

    const built = buildRequestNotification(type, request, {
      ...options,
      pendingRequestsCount,
    });
    notificationManager.sendNotification(built.type, built.payload);
  } catch (e) {
    logger.error('Something went wrong building a notification', {
      label: 'Notifications',
      requestId: request.id,
      type,
      errorMessage: e.message,
    });
  }
};
