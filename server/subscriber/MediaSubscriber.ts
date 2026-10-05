// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// When a release group is saved as AVAILABLE from outside the scanners (an
// admin marking it available), complete the approved requests it satisfies.
// The scanners and the availability sync do this themselves through
// server/lib/library/availability.ts and write with update(), which does not
// pass through here.
import { MediaStatus, MediaType } from '@server/constants/media';
import Media from '@server/entity/Media';
import { completeReleaseGroupRequests } from '@server/lib/library/availability';
import logger from '@server/logger';
import type { EntitySubscriberInterface, UpdateEvent } from 'typeorm';
import { EventSubscriber } from 'typeorm';

@EventSubscriber()
export class MediaSubscriber implements EntitySubscriberInterface<Media> {
  public listenTo(): typeof Media {
    return Media;
  }

  public afterUpdate(event: UpdateEvent<Media>): void {
    const media = event.entity as Media | undefined;
    const before = event.databaseEntity;

    if (
      !media?.id ||
      !before ||
      media.mediaType !== MediaType.RELEASE_GROUP ||
      media.status !== MediaStatus.AVAILABLE ||
      before.status === MediaStatus.AVAILABLE
    ) {
      return;
    }

    // after the surrounding save has finished
    setImmediate(() => {
      completeReleaseGroupRequests(media.id, true).catch((e) =>
        logger.error('Could not complete requests for an available album', {
          label: 'Library',
          mediaId: media.id,
          errorMessage: e.message,
        })
      );
    });
  }
}
