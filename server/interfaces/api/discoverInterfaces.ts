// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type { RequestResult } from '@server/interfaces/api/requestInterfaces';
import type {
  AlbumResult,
  ArtistResult,
  ConcertResult,
  SourcedList,
} from '@server/models/music';

export interface WatchlistItem {
  id: number;
  mbid: string;
  mediaType: string;
  title: string;
  source: 'manual' | 'spotify' | 'plex-playlist';
}

export interface WatchlistResponse {
  page: number;
  totalPages: number;
  totalResults: number;
  results: WatchlistItem[];
}

/** GET /discover/stats — hero 2×2 panel. Real counts from the library index. */
export interface DiscoverStatsResponse {
  albums: number;
  artists: number;
  tracks: number;
  /** Approved requests currently downloading. */
  downloading: number;
}

/**
 * GET /discover/featured — the Featured release band. Chosen from real data:
 * the most recently added album that still has missing tracks, else the most
 * recently added album, else the top trending release. Null when the library
 * is empty and no trending source is on.
 */
export interface DiscoverFeaturedResponse {
  album:
    | (AlbumResult & {
        /** Wide artist image for the band, or null. */
        artistImageUrl: string | null;
        /** Why it is featured. */
        source: 'recently-added' | 'trending';
        /** Track row id of the first playable track, when any. */
        firstPlayableTrackId?: number;
      })
    | null;
}

export type DiscoverAlbumsResponse = SourcedList<AlbumResult>;
export type DiscoverArtistsResponse = SourcedList<ArtistResult>;
export type DiscoverConcertsResponse = SourcedList<ConcertResult> & {
  /** Provider names to credit under the row. */
  attribution: ('ticketmaster' | 'skiddle')[];
};
/** Recent requests the viewer may see (all with REQUEST_VIEW/MANAGE_REQUESTS, else own). */
export type DiscoverRecentRequestsResponse = SourcedList<RequestResult> & {
  /** True when the list is only the viewer's own requests ("Your recent requests"). */
  ownOnly: boolean;
};

/** GET /genre/:name — music MusicBrainz tags with this genre, library status merged in. */
export interface GenreResponse {
  genre: string;
  page: number;
  pageSize: number;
  albums: { total: number; results: AlbumResult[] };
  /** First page only. */
  artists: { total: number; results: ArtistResult[] };
}
