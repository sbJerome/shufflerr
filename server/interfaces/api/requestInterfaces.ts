// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type { MediaType, RequestScope } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties, PaginatedResponse } from './common';

/** One request as lists show it: the entity plus resolved display fields. */
export type RequestResult = NonFunctionProperties<MediaRequest> & {
  /** `/imageproxy/...` cover (release group) or artist photo (discography), or null. */
  coverUrl: string | null;
  /** Quality profile name on the target Lidarr server, when resolvable. */
  profileName?: string;
  /** The viewer may cancel/delete this request. */
  canRemove: boolean;
  /** The viewer may approve/decline/retry. */
  canManage: boolean;
  /** "Approved automatically" | "Approved by <name>" | "Declined by <name>" | "Failed after approval" | "No changes yet" */
  lastChange: string;
  /** True when every requested track is playable from the library. */
  playable: boolean;
};

export interface RequestResultsResponse extends PaginatedResponse {
  results: RequestResult[];
  /** Lidarr servers that could not be reached while resolving profile names. */
  serviceErrors: { lidarr: { id: number; name: string }[] };
}

/** Counts for the status chips on the Requests page (scoped to what the viewer may see). */
export interface RequestCountResponse {
  total: number;
  pending: number;
  approved: number;
  /** approved and currently downloading/processing */
  processing: number;
  available: number;
  declined: number;
  failed: number;
  album: number;
  tracks: number;
  discography: number;
}

export type RequestFilter =
  | 'all'
  | 'pending'
  | 'approved'
  | 'processing'
  | 'available'
  | 'declined'
  | 'failed';

/** POST /request body (docs/PERMISSIONS_AND_APPROVALS.md). `?dryRun=1` or `dryRun: true` evaluates without writing. */
export type MediaRequestBody = {
  /** Release-group MBID (tracks/album) or artist MBID (discography). */
  mbid: string;
  /** 'release-group' for tracks/album, 'artist' for discography. */
  mediaType: MediaType;
  scope: RequestScope;
  /** tracks scope: recording MBIDs to fetch. Omitted = all tracks missing from the library. */
  trackMbids?: string[];
  /** discography scope: number of release groups included (server computes it when omitted). */
  releaseCount?: number;
  /** REQUEST_ADVANCED only (silently ignored otherwise) */
  serverId?: number;
  qualityProfileId?: number;
  metadataProfileId?: number;
  rootFolder?: string;
  isHiRes?: boolean;
  /** "Watch for new releases from <artist>" */
  monitorFuture?: boolean;
  /** Managers only: bypass own quota. */
  ignoreQuota?: boolean;
  /** Request on behalf of another user (MANAGE_USERS | MANAGE_REQUESTS). */
  userId?: number;
  isAutoRequest?: boolean;
  dryRun?: boolean;
};

export type DryRunOutcome = 'auto' | 'pending' | 'blocked';

export interface DryRunResult {
  outcome: DryRunOutcome;
  /** Human-readable reason when blocked (the same message the real request would fail with). */
  reason?: string;
  /** Machine code for blocked outcomes. */
  code?:
    | 'permission'
    | 'quota'
    | 'duplicate'
    | 'available'
    | 'blocklisted'
    | 'error';
  /** What the request would count against quotas. */
  trackCount?: number;
  releaseCount?: number;
}

/** PUT /request/:id body (managers; requester while pending may change scope/tracks). */
export type MediaRequestUpdateBody = Partial<
  Pick<
    MediaRequestBody,
    | 'scope'
    | 'trackMbids'
    | 'serverId'
    | 'qualityProfileId'
    | 'metadataProfileId'
    | 'rootFolder'
    | 'monitorFuture'
    | 'userId'
  >
>;

/** POST /request/:id/decline optional body */
export interface DeclineBody {
  declineReason?: string;
}
