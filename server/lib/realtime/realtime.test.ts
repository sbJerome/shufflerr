import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import type { PermissionCheckOptions } from '@server/lib/permissions';
import { Permission, hasPermission } from '@server/lib/permissions';
import type { RealtimeEvent, RealtimeViewer } from '@server/lib/realtime';
import {
  emitMediaUpdate,
  emitRequestUpdate,
  isEventVisibleTo,
  onRealtimeEvent,
} from '@server/lib/realtime';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const viewer = (id: number, permissions: number): RealtimeViewer => ({
  id,
  hasPermission: (
    perms: Permission | Permission[],
    options?: PermissionCheckOptions
  ) => !!hasPermission(perms, permissions, options),
});

describe('realtime bus', () => {
  it('delivers an emitted event to a subscriber, then stops after unsubscribe', () => {
    const received: RealtimeEvent[] = [];
    const off = onRealtimeEvent((e) => received.push(e));

    emitRequestUpdate({
      requestId: 1,
      mediaId: 2,
      status: MediaRequestStatus.APPROVED,
      downloadProgress: 40,
      requestedById: 7,
    });
    emitMediaUpdate({
      mediaId: 2,
      mbid: 'mb',
      mediaType: MediaType.RELEASE_GROUP,
      status: MediaStatus.AVAILABLE,
    });

    assert.equal(received.length, 2);
    assert.equal(received[0].type, 'request');
    assert.equal(received[1].type, 'media');

    off();
    emitRequestUpdate({ requestId: 9, status: MediaRequestStatus.PENDING });
    assert.equal(received.length, 2);
  });
});

describe('isEventVisibleTo', () => {
  const requestEvent: RealtimeEvent = {
    type: 'request',
    requestId: 1,
    status: MediaRequestStatus.APPROVED,
    requestedById: 7,
  };
  const mediaEvent: RealtimeEvent = {
    type: 'media',
    mediaId: 2,
    mbid: 'mb',
    mediaType: MediaType.RELEASE_GROUP,
    status: MediaStatus.AVAILABLE,
  };

  it('shows a request event to the requester', () => {
    assert.equal(
      isEventVisibleTo(viewer(7, Permission.REQUEST), requestEvent),
      true
    );
  });

  it('hides another user’s request event from a plain requester', () => {
    assert.equal(
      isEventVisibleTo(viewer(99, Permission.REQUEST), requestEvent),
      false
    );
  });

  it('shows any request event to a request manager', () => {
    assert.equal(
      isEventVisibleTo(viewer(99, Permission.MANAGE_REQUESTS), requestEvent),
      true
    );
  });

  it('shows any request event to a user with REQUEST_VIEW', () => {
    assert.equal(
      isEventVisibleTo(viewer(99, Permission.REQUEST_VIEW), requestEvent),
      true
    );
  });

  it('shows a media event to everyone signed in', () => {
    assert.equal(
      isEventVisibleTo(viewer(99, Permission.REQUEST), mediaEvent),
      true
    );
    assert.equal(isEventVisibleTo(viewer(1, 0), mediaEvent), true);
  });
});
