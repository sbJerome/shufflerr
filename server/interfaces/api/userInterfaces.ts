// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type { User } from '@server/entity/User';
import type { RequestResult } from '@server/interfaces/api/requestInterfaces';
import type { PlayResult, SourcedList } from '@server/models/music';
import type { PaginatedResponse } from './common';

export interface UserResultsResponse extends PaginatedResponse {
  results: User[];
}

export interface UserRequestsResponse extends PaginatedResponse {
  results: RequestResult[];
}

export interface QuotaStatus {
  /** Rolling window in days. */
  days?: number;
  /** 0 = unlimited. */
  limit?: number;
  used: number;
  /** undefined when unlimited. */
  remaining?: number;
  restricted: boolean;
}

export interface QuotaResponse {
  album: QuotaStatus;
  track: QuotaStatus;
}

/** GET /user/:id/recently-played */
export type UserRecentlyPlayedResponse = SourcedList<PlayResult> & {
  /** Sources feeding the list, for the sub-line ("From Plex and connected apps."). */
  sources: ('plex' | 'jellyfin' | 'navidrome' | 'apps' | 'web')[];
  /** Linked + enabled scrobble targets ("Scrobbling to ListenBrainz and Last.fm"). */
  scrobblingTo: ('listenbrainz' | 'lastfm')[];
};

/** POST /user (create local user) */
export interface CreateUserBody {
  username: string;
  email: string;
  /** Omit to email a generated password (requires the email agent). */
  password?: string;
}

/** PUT /user (bulk permission edit) */
export interface BulkPermissionsBody {
  ids: number[];
  permissions: number;
}

/** GET /settings/plex/users and /settings/jellyfin/users — importable users not yet in Shufflerr. */
export interface ImportableUser {
  id: string;
  username: string;
  email?: string;
  thumb?: string;
}

/** POST /user/import-from-plex { plexIds?: string[] } / import-from-jellyfin { jellyfinUserIds: string[] } → created users */
export type ImportUsersResponse = User[];
