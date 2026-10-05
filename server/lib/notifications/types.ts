import { Notification } from '@server/lib/notifications';

/**
 * Notification types are stored as Seerr's bitmask (Notification enum) in
 * settings and UserSettings. The HTTP API speaks string keys; convert with
 * these helpers.
 */
export const NOTIFICATION_TYPE_KEYS = {
  pending: Notification.MEDIA_PENDING,
  autoApproved: Notification.MEDIA_AUTO_APPROVED,
  approved: Notification.MEDIA_APPROVED,
  declined: Notification.MEDIA_DECLINED,
  available: Notification.MEDIA_AVAILABLE,
  failed: Notification.MEDIA_FAILED,
  autoRequested: Notification.MEDIA_AUTO_REQUESTED,
  issueCreated: Notification.ISSUE_CREATED,
  issueComment: Notification.ISSUE_COMMENT,
  issueResolved: Notification.ISSUE_RESOLVED,
  issueReopened: Notification.ISSUE_REOPENED,
} as const;

export type NotificationTypeKey = keyof typeof NOTIFICATION_TYPE_KEYS;

/** The six types the UI offers today, in display order. */
export const MUSIC_NOTIFICATION_TYPES: NotificationTypeKey[] = [
  'pending',
  'autoApproved',
  'approved',
  'declined',
  'available',
  'failed',
];

/** Types only shown to users with MANAGE_REQUESTS. */
export const MANAGER_NOTIFICATION_TYPES: NotificationTypeKey[] = [
  'pending',
  'autoApproved',
];

export const typesToMask = (keys: readonly string[] = []): number =>
  keys.reduce(
    (mask, key) =>
      mask | (NOTIFICATION_TYPE_KEYS[key as NotificationTypeKey] ?? 0),
    0
  );

export const maskToTypes = (mask = 0): NotificationTypeKey[] =>
  (Object.keys(NOTIFICATION_TYPE_KEYS) as NotificationTypeKey[]).filter(
    (key) => !!(mask & NOTIFICATION_TYPE_KEYS[key])
  );
