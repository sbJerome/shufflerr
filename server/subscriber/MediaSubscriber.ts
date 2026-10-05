// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// STREAM(SV3): implement — when a Media row's status / tracksAvailable changes
// (scanners, availability sync), flip related APPROVED requests to COMPLETED
// once their scope is fully present, and back when files disappear.
import Media from '@server/entity/Media';
import type { EntitySubscriberInterface } from 'typeorm';
import { EventSubscriber } from 'typeorm';

@EventSubscriber()
export class MediaSubscriber implements EntitySubscriberInterface<Media> {
  public listenTo(): typeof Media {
    return Media;
  }
}
