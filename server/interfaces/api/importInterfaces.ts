import type { DryRunOutcome } from '@server/interfaces/api/requestInterfaces';
import type { AlbumResult } from '@server/models/music';

export type ImportSourceKey = 'spotify' | 'deezer' | 'itunes';

/** One album found behind an import link. */
export interface ImportMatch {
  /** Stable key within the job (source album id). */
  sourceId: string;
  /** What the source calls it. */
  sourceTitle: string;
  sourceArtist: string;
  sourceCoverUrl?: string | null;
  /** How it was matched to MusicBrainz, or 'none'. */
  matchedBy: 'upc' | 'isrc' | 'name' | 'none';
  /** MusicBrainz album with live library status; null when no match was found. */
  album: AlbumResult | null;
  /** True while this album is still being matched to MusicBrainz (poll the job). */
  pending?: boolean;
}

/** POST /import/resolve { url } */
export interface ImportResolveResponse {
  jobId: number;
  source: ImportSourceKey;
  /** Playlist / album title from the source. */
  title?: string;
  url: string;
  matches: ImportMatch[];
  /**
   * Matching runs at MusicBrainz's pace (about one album a second), so a long
   * playlist comes back as 'resolving' with `pending` entries: poll
   * GET /import/jobs/:id until it is 'ready' (or 'failed', see `error`).
   */
  status?: 'resolving' | 'ready' | 'requested' | 'failed';
  error?: string | null;
  /** Albums behind the link that were left out because the link has more than the per-import cap. */
  truncated?: number;
}

/** POST /import/request { jobId?, mbids: string[] } — each goes through the request engine with scope album. */
export interface ImportRequestResponse {
  results: {
    mbid: string;
    title?: string;
    outcome: DryRunOutcome;
    reason?: string;
    requestId?: number;
  }[];
  auto: number;
  pending: number;
  blocked: number;
  /** "N approved automatically, M waiting for approval, K not requested: <first reason>" */
  summary: string;
}

/** GET /import/sources — the sources row on the Import page. */
export interface ImportSourcesResponse {
  sources: {
    key: ImportSourceKey;
    name: string;
    enabled: boolean;
    /** Link shapes this source accepts, for the helper text. */
    accepts: string[];
  }[];
  spotify: {
    /** Spotify integration is on server-side. */
    enabled: boolean;
    /** The viewer has linked their Spotify account. */
    linked: boolean;
    linkedAs?: string;
    /** The viewer's "Request albums I save on Spotify" switch. */
    autoRequest: boolean;
    /** The viewer holds AUTO_REQUEST / AUTO_REQUEST_ALBUM. */
    canAutoRequest: boolean;
  };
}

/** GET /import/spotify/saved — the viewer's saved albums, matched. */
export interface ImportSpotifySavedResponse {
  linked: boolean;
  matches: ImportMatch[];
  /** Saved albums still being matched in the background; ask again in a few seconds. */
  pending?: number;
}

export interface ImportJobSummary {
  id: number;
  source: ImportSourceKey;
  url: string;
  title?: string | null;
  status: 'resolving' | 'ready' | 'requested' | 'failed';
  error?: string | null;
  matchCount: number;
  createdAt: string;
}
