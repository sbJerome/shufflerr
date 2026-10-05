// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// STREAM(SV2): implement — side effects of request transitions
// (docs/PERMISSIONS_AND_APPROVALS.md §Subscriber side effects):
//   → PENDING   notify `pending` to managers; media PENDING
//   → APPROVED  notify (`autoApproved` to managers | `approved` to requester); send to Lidarr
//   → DECLINED  notify `declined`; media back to its library status; unmonitor if Shufflerr added it
//   → FAILED    notify `failed` to requester + managers
//   → COMPLETED notify `available` to requester
import { MediaRequest } from '@server/entity/MediaRequest';
import type { EntitySubscriberInterface } from 'typeorm';
import { EventSubscriber } from 'typeorm';

@EventSubscriber()
export class MediaRequestSubscriber implements EntitySubscriberInterface<MediaRequest> {
  public listenTo(): typeof MediaRequest {
    return MediaRequest;
  }
}
