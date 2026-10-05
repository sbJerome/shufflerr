// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: server/constants/media.ts at commit 2cfbcf8940225f1597d44f507fd78040887c5597
//
// Request and media status enums are kept numerically identical to Seerr so the
// request lifecycle code (MediaRequest subscriber, notifications, request list
// filters) can be reused with minimal change.

export enum MediaRequestStatus {
  PENDING = 1,
  APPROVED,
  DECLINED,
  FAILED,
  COMPLETED,
}

/** MusicBrainz entity kinds Shufflerr stores as Media rows. */
export enum MediaType {
  ARTIST = 'artist',
  RELEASE_GROUP = 'release-group', // an "album" in the UI (album, EP, single, compilation)
  RECORDING = 'recording', // a track
}

/** What a request asks Lidarr to fetch. */
export enum RequestScope {
  TRACKS = 'tracks', // only the listed missing tracks of one release group
  ALBUM = 'album', // the whole release group
  DISCOGRAPHY = 'discography', // every release group of an artist, filtered by metadata profile
}

export enum MediaStatus {
  UNKNOWN = 1,
  PENDING,
  PROCESSING,
  PARTIALLY_AVAILABLE, // some tracks of a release group are in a media server library
  AVAILABLE,
  BLOCKLISTED,
  DELETED,
}

/** UI labels used by the approved mockup (keep wording consistent across the app). */
export const REQUEST_STATUS_LABEL: Record<MediaRequestStatus, string> = {
  [MediaRequestStatus.PENDING]: 'Waiting for approval',
  [MediaRequestStatus.APPROVED]: 'Approved, downloading',
  [MediaRequestStatus.DECLINED]: 'Declined',
  [MediaRequestStatus.FAILED]: 'Failed',
  [MediaRequestStatus.COMPLETED]: 'Available',
};

export const MEDIA_STATUS_LABEL: Record<MediaStatus, string> = {
  [MediaStatus.UNKNOWN]: 'Not in library',
  [MediaStatus.PENDING]: 'Waiting for approval',
  [MediaStatus.PROCESSING]: 'Downloading',
  [MediaStatus.PARTIALLY_AVAILABLE]: 'Partly available',
  [MediaStatus.AVAILABLE]: 'Available',
  [MediaStatus.BLOCKLISTED]: 'Blocked',
  [MediaStatus.DELETED]: 'Removed',
};
