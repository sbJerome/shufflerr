import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { getAppVersion } from '@server/utils/appVersion';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  MbArtist,
  MbArtistSearch,
  MbRecording,
  MbRecordingSearch,
  MbRelease,
  MbReleaseGroup,
  MbReleaseGroupBrowse,
  MbReleaseGroupSearch,
  MbReleaseSearch,
} from './interfaces';
import { TokenBucket } from './rateLimiter';

export * from './interfaces';

const LOOKUP_TTL = 86400; // 24 h
const SEARCH_TTL = 3600; // 1 h
const MAX_RETRIES = 3;
const BURST = 3;

type RetryConfig = InternalAxiosRequestConfig & { mbAttempt?: number };

/** One bucket for the whole process, whatever number of client instances exist. */
const bucket = new TokenBucket(1, BURST);

const LUCENE_SPECIAL = /([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g;

/** Escape user input for MusicBrainz's Lucene query syntax. */
export const escapeLucene = (input: string): string =>
  input.replace(LUCENE_SPECIAL, '\\$1').trim();

/** `Shufflerr/<version> ( <contact> )` — MusicBrainz asks for a contact in the User-Agent. */
export const musicBrainzUserAgent = (contact?: string): string => {
  const settings = getSettings();
  const who =
    contact?.trim() ||
    settings.metadata.musicbrainz.contact?.trim() ||
    settings.main.applicationUrl?.trim() ||
    'https://github.com/shufflerr/shufflerr';
  return `Shufflerr/${getAppVersion()} ( ${who} )`;
};

export type ReleaseGroupType = 'album' | 'ep' | 'single' | 'broadcast' | 'other';

export interface SearchPage {
  limit?: number;
  offset?: number;
}

class MusicBrainz extends ExternalAPI {
  private inflight = new Map<string, Promise<unknown>>();

  constructor(baseUrl?: string) {
    const url = (
      baseUrl ??
      getSettings().metadata.musicbrainz.url ??
      'https://musicbrainz.org'
    ).replace(/\/+$/, '');

    super(
      `${url}/ws/2`,
      { fmt: 'json' },
      {
        nodeCache: cacheManager.getCache('musicbrainz').data,
        timeout: Math.max(getSettings().network.apiRequestTimeout, 15000),
      }
    );

    // Every real network call waits for a token and carries the contact User-Agent.
    this.axios.interceptors.request.use(async (config) => {
      const rps = Math.max(
        1,
        Number(getSettings().metadata.musicbrainz.requestsPerSecond) || 1
      );
      bucket.configure(rps, Math.max(BURST, rps));
      await bucket.take();
      config.headers.set('User-Agent', musicBrainzUserAgent());
      return config;
    });

    // 503 / 429 = slow down: back off and retry a few times.
    this.axios.interceptors.response.use(undefined, async (error: AxiosError) => {
      const config = error.config as RetryConfig | undefined;
      const status = error.response?.status;
      if (!config || (status !== 503 && status !== 429)) {
        throw error;
      }
      const attempt = (config.mbAttempt ?? 0) + 1;
      if (attempt > MAX_RETRIES) {
        throw error;
      }
      config.mbAttempt = attempt;
      const retryAfter = Number(error.response?.headers?.['retry-after']);
      const wait = Math.min(
        30000,
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 1000 * 2 ** (attempt - 1)
      );
      logger.debug('MusicBrainz asked us to slow down, retrying', {
        label: 'MusicBrainz',
        status,
        attempt,
        wait,
      });
      bucket.pause(wait);
      return this.axios.request(config);
    });
  }

  /** Cached GET with in-flight de-duplication (two viewers opening one album = one call). */
  private async fetch<T>(
    endpoint: string,
    params: Record<string, unknown>,
    ttl: number
  ): Promise<T> {
    const key = `${endpoint}${JSON.stringify(params)}`;
    const running = this.inflight.get(key) as Promise<T> | undefined;
    if (running) {
      return running;
    }
    const promise = this.get<T>(endpoint, { params }, ttl).finally(() =>
      this.inflight.delete(key)
    );
    this.inflight.set(key, promise);
    return promise;
  }

  // ---- search -------------------------------------------------------------

  public searchArtists(
    query: string,
    { limit = 20, offset = 0 }: SearchPage = {}
  ): Promise<MbArtistSearch> {
    return this.fetch<MbArtistSearch>(
      '/artist',
      { query: escapeLucene(query), limit, offset },
      SEARCH_TTL
    );
  }

  public searchReleaseGroups(
    query: string,
    { limit = 20, offset = 0 }: SearchPage = {}
  ): Promise<MbReleaseGroupSearch> {
    return this.fetch<MbReleaseGroupSearch>(
      '/release-group',
      { query: escapeLucene(query), limit, offset },
      SEARCH_TTL
    );
  }

  public searchRecordings(
    query: string,
    { limit = 20, offset = 0 }: SearchPage = {}
  ): Promise<MbRecordingSearch> {
    return this.fetch<MbRecordingSearch>(
      '/recording',
      { query: escapeLucene(query), limit, offset },
      SEARCH_TTL
    );
  }

  /**
   * Raw Lucene search (the caller builds and escapes the query), used by the
   * import matcher: `barcode:<upc>`, `isrc:<isrc>`,
   * `releasegroup:"<title>" AND artist:"<name>"`.
   */
  public searchReleaseGroupsRaw(
    luceneQuery: string,
    { limit = 10, offset = 0 }: SearchPage = {}
  ): Promise<MbReleaseGroupSearch> {
    return this.fetch<MbReleaseGroupSearch>(
      '/release-group',
      { query: luceneQuery, limit, offset },
      SEARCH_TTL
    );
  }

  public searchReleasesRaw(
    luceneQuery: string,
    { limit = 10, offset = 0 }: SearchPage = {}
  ): Promise<MbReleaseSearch> {
    return this.fetch<MbReleaseSearch>(
      '/release',
      { query: luceneQuery, limit, offset },
      SEARCH_TTL
    );
  }

  public searchRecordingsRaw(
    luceneQuery: string,
    { limit = 10, offset = 0 }: SearchPage = {}
  ): Promise<MbRecordingSearch> {
    return this.fetch<MbRecordingSearch>(
      '/recording',
      { query: luceneQuery, limit, offset },
      SEARCH_TTL
    );
  }

  // ---- lookups ------------------------------------------------------------

  public getArtist(
    mbid: string,
    inc: string[] = ['url-rels', 'tags', 'genres']
  ): Promise<MbArtist> {
    return this.fetch<MbArtist>(
      `/artist/${mbid}`,
      { inc: inc.join('+') },
      LOOKUP_TTL
    );
  }

  /** Release group with its releases (and their media, for the canonical pick). */
  public getReleaseGroup(
    mbid: string,
    inc: string[] = ['artist-credits', 'releases', 'media', 'genres', 'tags']
  ): Promise<MbReleaseGroup> {
    return this.fetch<MbReleaseGroup>(
      `/release-group/${mbid}`,
      { inc: inc.join('+') },
      LOOKUP_TTL
    );
  }

  /** One release (edition) with its tracklist. */
  public getRelease(
    mbid: string,
    inc: string[] = ['recordings', 'artist-credits', 'labels', 'release-groups']
  ): Promise<MbRelease> {
    return this.fetch<MbRelease>(
      `/release/${mbid}`,
      { inc: inc.join('+') },
      LOOKUP_TTL
    );
  }

  public getRecording(
    mbid: string,
    inc: string[] = ['artist-credits', 'releases', 'release-groups', 'isrcs']
  ): Promise<MbRecording> {
    return this.fetch<MbRecording>(
      `/recording/${mbid}`,
      { inc: inc.join('+') },
      LOOKUP_TTL
    );
  }

  // ---- browse -------------------------------------------------------------

  public browseReleaseGroups(
    artistMbid: string,
    {
      types,
      limit = 100,
      offset = 0,
    }: { types?: ReleaseGroupType[]; limit?: number; offset?: number } = {}
  ): Promise<MbReleaseGroupBrowse> {
    return this.fetch<MbReleaseGroupBrowse>(
      '/release-group',
      {
        artist: artistMbid,
        ...(types?.length ? { type: types.join('|') } : {}),
        // hide release groups that only exist as bootlegs / promos
        'release-group-status': 'website-default',
        inc: 'artist-credits',
        limit,
        offset,
      },
      LOOKUP_TTL
    );
  }

  /** Every release group of an artist (pages of 100, capped). */
  public async getAllReleaseGroups(
    artistMbid: string,
    { types, maxPages = 6 }: { types?: ReleaseGroupType[]; maxPages?: number } = {}
  ): Promise<MbReleaseGroup[]> {
    const all: MbReleaseGroup[] = [];
    for (let page = 0; page < maxPages; page++) {
      const data = await this.browseReleaseGroups(artistMbid, {
        types,
        limit: 100,
        offset: page * 100,
      });
      all.push(...(data['release-groups'] ?? []));
      if (all.length >= (data['release-group-count'] ?? 0)) {
        break;
      }
      if ((data['release-groups'] ?? []).length === 0) {
        break;
      }
    }
    return all;
  }
}

let instance: MusicBrainz | null = null;
let instanceUrl = '';

/** Shared client; rebuilt when the server URL (mirror) changes in settings. */
export const getMusicBrainz = (): MusicBrainz => {
  const url = getSettings().metadata.musicbrainz.url || 'https://musicbrainz.org';
  if (!instance || instanceUrl !== url) {
    instance = new MusicBrainz(url);
    instanceUrl = url;
  }
  return instance;
};

export default MusicBrainz;
