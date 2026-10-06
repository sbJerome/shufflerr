import type {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import type { PermissionCheckOptions } from '@server/lib/permissions';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { EventEmitter } from 'events';

/**
 * Process-wide push bus. Request/media/scan state changes are published here
 * and streamed to connected browsers over SSE (see server/routes/realtime.ts),
 * so the UI updates without waiting for a poll.
 */

export interface RequestRealtimeEvent {
  type: 'request';
  requestId: number;
  mediaId?: number;
  status: MediaRequestStatus;
  downloadProgress?: number | null;
  /** Who made the request — used to scope the event to viewers who may see it. */
  requestedById?: number;
}

export interface MediaRealtimeEvent {
  type: 'media';
  mediaId: number;
  mbid: string;
  mediaType: MediaType;
  status: MediaStatus;
}

export interface ScanRealtimeEvent {
  type: 'scan';
  source: string;
  running: boolean;
  current?: number;
  total?: number;
}

export type RealtimeEvent =
  | RequestRealtimeEvent
  | MediaRealtimeEvent
  | ScanRealtimeEvent;

/** The bit of a user the visibility check needs (avoids importing the entity). */
export interface RealtimeViewer {
  id: number;
  hasPermission(
    permissions: Permission | Permission[],
    options?: PermissionCheckOptions
  ): boolean;
}

const CHANNEL = 'event';
const emitter = new EventEmitter();
// One listener per connected SSE client; there is no sensible fixed cap.
emitter.setMaxListeners(0);

/** Subscribe to every realtime event. Returns an unsubscribe function. */
export const onRealtimeEvent = (
  listener: (event: RealtimeEvent) => void
): (() => void) => {
  emitter.on(CHANNEL, listener);
  return () => {
    emitter.off(CHANNEL, listener);
  };
};

const publish = (event: RealtimeEvent): void => {
  try {
    emitter.emit(CHANNEL, event);
  } catch (e) {
    logger.debug('Realtime publish failed', {
      label: 'Realtime',
      errorMessage: (e as Error).message,
    });
  }
};

export const emitRequestUpdate = (
  event: Omit<RequestRealtimeEvent, 'type'>
): void => publish({ type: 'request', ...event });

export const emitMediaUpdate = (
  event: Omit<MediaRealtimeEvent, 'type'>
): void => publish({ type: 'media', ...event });

export const emitScanProgress = (
  event: Omit<ScanRealtimeEvent, 'type'>
): void => publish({ type: 'scan', ...event });

/**
 * Whether a viewer may receive an event. A `request` event only reaches the
 * requester or someone who can already see everyone's requests
 * (MANAGE_REQUESTS / REQUEST_VIEW); `media` and `scan` events are library-wide
 * and non-sensitive, so every signed-in viewer gets them.
 */
export const isEventVisibleTo = (
  viewer: RealtimeViewer,
  event: RealtimeEvent
): boolean => {
  if (event.type !== 'request') {
    return true;
  }
  if (
    viewer.hasPermission(
      [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
      { type: 'or' }
    )
  ) {
    return true;
  }
  return event.requestedById === viewer.id;
};
