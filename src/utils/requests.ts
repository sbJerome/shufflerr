/**
 * Who may cancel or remove a request, mirrored from the backend DELETE
 * /request/:id rule (server/routes/request.ts): a manager may remove any
 * request at any time; the requester may cancel their own only while it is
 * still waiting for approval. Auto-approved requests (e.g. discographies) are
 * therefore the owner's to cancel only before approval — past that, an admin
 * removes them.
 */
import { MediaRequestStatus } from '@server/constants/media';

export const canCancelRequest = (
  request: {
    status: MediaRequestStatus;
    requestedBy?: { id?: number } | null;
  },
  viewerId: number | undefined,
  canManageRequests: boolean
): boolean =>
  canManageRequests ||
  (request.requestedBy?.id != null &&
    request.requestedBy.id === viewerId &&
    request.status === MediaRequestStatus.PENDING);
