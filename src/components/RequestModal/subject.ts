/** Turn API results into what the request modal needs. */
import type { RequestModalAlbum } from '@app/components/RequestModal';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { AlbumResult } from '@server/models/music';

export const toModalAlbum = (album: AlbumResult): RequestModalAlbum => ({
  mbid: album.mbid,
  title: album.title,
  artistName: album.artistName,
  artistMbid: album.artistMbid,
  year: album.year ?? album.firstReleaseDate?.slice(0, 4),
  coverUrl: album.coverUrl,
  trackCount: album.trackCount ?? album.mediaInfo?.trackCount,
  tracksAvailable: album.tracksAvailable ?? album.mediaInfo?.tracksAvailable,
});

/** A request that is still waiting or downloading. */
export const hasActiveRequest = (album: AlbumResult): boolean =>
  album.request?.status === MediaRequestStatus.PENDING ||
  album.request?.status === MediaRequestStatus.APPROVED;

/** Nothing of it is in the library and nobody has asked for it yet. */
export const isRequestable = (album: AlbumResult): boolean =>
  (album.status === MediaStatus.UNKNOWN ||
    album.status === MediaStatus.DELETED) &&
  !hasActiveRequest(album);
