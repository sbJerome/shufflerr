import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import { getAppVersion } from '@server/utils/appVersion';

const DEFAULT_URL = 'https://api.listenbrainz.org';
const TRENDING_TTL = 21600; // 6 h

export interface LbFreshRelease {
  release_group_mbid: string;
  release_mbid?: string;
  release_name: string;
  release_date?: string;
  artist_credit_name: string;
  artist_mbids?: string[];
  release_group_primary_type?: string | null;
  release_group_secondary_type?: string | null;
  caa_id?: number | null;
  caa_release_mbid?: string | null;
  listen_count?: number;
  release_tags?: string[];
}

export interface LbSitewideArtist {
  artist_mbid?: string | null;
  artist_name: string;
  listen_count: number;
}

export interface LbSitewideReleaseGroup {
  release_group_mbid?: string | null;
  release_group_name: string;
  artist_name: string;
  artist_mbids?: string[];
  caa_id?: number | null;
  caa_release_mbid?: string | null;
  listen_count: number;
}

export interface FreshReleaseIndex {
  __index: true;
  groups: Record<
    string,
    { date?: string; primaryType?: string; secondaryType?: string }
  >;
}

export type LbRange = 'this_week' | 'this_month' | 'week' | 'month' | 'year' | 'all_time';

export interface LbTrackMetadata {
  artist_name: string;
  track_name: string;
  release_name?: string;
  additional_info?: Record<string, unknown>;
}

export interface LbListen {
  /** UNIX seconds when the track was played (omit for playing_now) */
  listened_at?: number;
  track_metadata: LbTrackMetadata;
}

export type LbListenType = 'single' | 'playing_now' | 'import';

export interface ListenInput {
  artist: string;
  track: string;
  album?: string | null;
  recordingMbid?: string | null;
  releaseGroupMbid?: string | null;
  artistMbids?: string[];
  durationMs?: number | null;
  /** UNIX seconds; required for single/import */
  listenedAt?: number;
  /** e.g. "Plex", "Symfonium" */
  mediaPlayer?: string;
}

export class ListenBrainzError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
  }
}

/** Build the ListenBrainz payload for one play. */
export const toLbListen = (input: ListenInput, withTimestamp: boolean): LbListen => {
  const additional: Record<string, unknown> = {
    submission_client: 'Shufflerr',
    submission_client_version: getAppVersion(),
  };
  if (input.recordingMbid) {
    additional.recording_mbid = input.recordingMbid;
  }
  if (input.releaseGroupMbid) {
    additional.release_group_mbid = input.releaseGroupMbid;
  }
  if (input.artistMbids?.length) {
    additional.artist_mbids = input.artistMbids;
  }
  if (input.durationMs) {
    additional.duration_ms = input.durationMs;
  }
  if (input.mediaPlayer) {
    additional.media_player = input.mediaPlayer;
  }
  return {
    ...(withTimestamp
      ? { listened_at: input.listenedAt ?? Math.floor(Date.now() / 1000) }
      : {}),
    track_metadata: {
      artist_name: input.artist,
      track_name: input.track,
      ...(input.album ? { release_name: input.album } : {}),
      additional_info: additional,
    },
  };
};

class ListenBrainzAPI extends ExternalAPI {
  constructor(baseUrl?: string) {
    const url = (
      baseUrl ||
      getSettings().scrobble.listenbrainz.url ||
      DEFAULT_URL
    ).replace(/\/+$/, '');
    super(
      url,
      {},
      {
        nodeCache: cacheManager.getCache('listenbrainz').data,
        timeout: Math.max(getSettings().network.apiRequestTimeout, 15000),
      }
    );
  }

  // ---- discovery (public, cached 6 h) --------------------------------------

  /**
   * Releases from the last `days` days (1–90), newest first.
   * (`/1/explore/fresh-releases/` — sitewide, no user needed.)
   */
  public async getFreshReleases(
    options: {
      days?: number;
      sort?: 'release_date' | 'artist_credit_name' | 'release_name';
    } = {}
  ): Promise<LbFreshRelease[]> {
    const data = await this.get<{ payload?: { releases?: LbFreshRelease[] } }>(
      '/1/explore/fresh-releases/',
      {
        params: {
          days: options.days ?? 14,
          sort: options.sort ?? 'release_date',
          past: true,
          future: false,
        },
        timeout: 45000,
      },
      TRENDING_TTL
    );
    return data.payload?.releases ?? [];
  }

  /**
   * Recent release groups keyed by MBID → release date and type. The raw list
   * runs to thousands of rows, so only this compact index is cached.
   */
  public async getFreshReleaseIndex(days = 60): Promise<FreshReleaseIndex> {
    type Raw = { payload?: { releases?: LbFreshRelease[] } };
    const data = await this.get<Raw | FreshReleaseIndex>(
      '/1/explore/fresh-releases/',
      {
        params: { days, sort: 'release_date', past: true, future: false },
        timeout: 45000,
      },
      TRENDING_TTL,
      {
        transform: (raw) => {
          const index: FreshReleaseIndex = { __index: true, groups: {} };
          for (const r of (raw as Raw).payload?.releases ?? []) {
            if (r.release_group_mbid && !index.groups[r.release_group_mbid]) {
              index.groups[r.release_group_mbid] = {
                date: r.release_date,
                primaryType: r.release_group_primary_type ?? undefined,
                secondaryType: r.release_group_secondary_type ?? undefined,
              };
            }
          }
          return index;
        },
      }
    );
    return data as FreshReleaseIndex;
  }

  public async getSitewideArtists(
    range: LbRange = 'week',
    count = 25
  ): Promise<LbSitewideArtist[]> {
    const data = await this.get<{ payload?: { artists?: LbSitewideArtist[] } }>(
      '/1/stats/sitewide/artists',
      { params: { range, count } },
      TRENDING_TTL
    );
    return data.payload?.artists ?? [];
  }

  public async getSitewideReleaseGroups(
    range: LbRange = 'week',
    count = 25
  ): Promise<LbSitewideReleaseGroup[]> {
    const data = await this.get<{
      payload?: { release_groups?: LbSitewideReleaseGroup[] };
    }>(
      '/1/stats/sitewide/release-groups',
      { params: { range, count } },
      TRENDING_TTL
    );
    return data.payload?.release_groups ?? [];
  }

  // ---- per-user (token) ----------------------------------------------------

  /** Check a user token. Returns the ListenBrainz username when valid. */
  public async validateToken(
    token: string
  ): Promise<{ valid: boolean; userName?: string; message?: string }> {
    try {
      const response = await this.axios.get<{
        valid: boolean;
        user_name?: string;
        message?: string;
      }>('/1/validate-token', {
        headers: { Authorization: `Token ${token}` },
      });
      return {
        valid: !!response.data.valid,
        userName: response.data.user_name,
        message: response.data.message,
      };
    } catch (e) {
      if (e?.response?.status && e.response.status < 500) {
        return { valid: false, message: e.response.data?.message };
      }
      throw new ListenBrainzError(
        `ListenBrainz could not be reached: ${e.message}`,
        e?.response?.status
      );
    }
  }

  /** POST /1/submit-listens. `playing_now` takes exactly one listen without a timestamp. */
  public async submitListens(
    token: string,
    listenType: LbListenType,
    listens: ListenInput[]
  ): Promise<void> {
    if (listens.length === 0) {
      return;
    }
    const payload = listens.map((l) => toLbListen(l, listenType !== 'playing_now'));
    try {
      await this.axios.post(
        '/1/submit-listens',
        {
          listen_type: listenType,
          payload: listenType === 'import' ? payload : payload.slice(0, 1),
        },
        { headers: { Authorization: `Token ${token}` } }
      );
    } catch (e) {
      throw new ListenBrainzError(
        e?.response?.data?.error ?? e.message ?? 'ListenBrainz rejected the listen',
        e?.response?.status
      );
    }
  }

  public submitPlayingNow(token: string, listen: ListenInput): Promise<void> {
    return this.submitListens(token, 'playing_now', [listen]);
  }

  /** One finished play (`single`) or a batch (`import`). */
  public submitPlays(token: string, listens: ListenInput[]): Promise<void> {
    return this.submitListens(
      token,
      listens.length > 1 ? 'import' : 'single',
      listens
    );
  }
}

export default ListenBrainzAPI;
