// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type Media from '@server/entity/Media';
import type { AlbumResult, ArtistResult } from '@server/models/music';
import type { PaginatedResponse } from './common';

export interface MediaResultsResponse extends PaginatedResponse {
  results: (Media & { coverUrl: string | null })[];
}

/** An item in the Lidarr queue, attached to Media.downloadStatus by the download tracker. */
export interface DownloadingItem {
  /** Lidarr album id */
  externalId: number;
  /** Lidarr queue item id */
  queueId?: number;
  size: number;
  sizeLeft: number;
  status: string;
  timeLeft?: string;
  estimatedCompletionTime?: string;
  title: string;
  downloadId?: string;
  /** 0–100 */
  progress: number;
}

/** GET /api/v1/auth/slideshow — public, cover URLs only. */
export interface SlideshowResponse {
  covers: { url: string; title?: string }[];
}

export interface LibraryArtistsResponse extends PaginatedResponse {
  results: ArtistResult[];
}

export interface LibraryAlbumsResponse extends PaginatedResponse {
  results: AlbumResult[];
}
