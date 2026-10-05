// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { LRUCache } from 'lru-cache';

export type AvailableCacheIds =
  | 'musicbrainz'
  | 'coverart'
  | 'fanart'
  | 'lastfm'
  | 'listenbrainz'
  | 'spotify'
  | 'deezer'
  | 'itunes'
  | 'ticketmaster'
  | 'skiddle'
  | 'youtube'
  | 'lidarr'
  | 'plex'
  | 'jellyfin'
  | 'navidrome'
  | 'plextv'
  | 'plexwatchlist';

const DEFAULT_TTL = 300;

const OBJECT_VALUE_SIZE = 80;
const PROMISE_VALUE_SIZE = 80;
const ARRAY_VALUE_SIZE = 40;

// Lookups (24 h) and searches (1 h); one key per MBID / query.
const MUSICBRAINZ_MAX_KEYS = 5000;

// Small metadata/discovery tiers: one key per artist, album, link or query.
const METADATA_MAX_KEYS = 2000;

// Only the rolling profile, root folder and tag lookups reach this tier, and keys
// are prefixed by server url, so this is a few keys per server.
const LIDARR_MAX_KEYS = 256;

// Media-server lookups made while scanning and resolving stream sources.
const MEDIA_SERVER_MAX_KEYS = 2000;

// Shared between users as the token is not part of the key.
const PLEX_TV_MAX_KEYS = 5000;

// Keyed by auth token, so one key per Plex linked user.
const PLEX_WATCHLIST_MAX_KEYS = 500;

export interface CacheStats {
  hits: number;
  misses: number;
  keys: number;
  ksize: number;
  vsize: number;
}

export interface CacheStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttl?: number): boolean;
  del(key: string): number;
  getTtl(key: string): number | undefined;
  getStats(): CacheStats;
  flushAll(): void;
}

const keyLength = (key: string): number => key.toString().length;

const valueLength = (value: unknown): number => {
  if (typeof value === 'string') {
    return value.length;
  }
  if (Array.isArray(value)) {
    return ARRAY_VALUE_SIZE * value.length;
  }
  if (typeof value === 'number') {
    return 8;
  }
  if (
    typeof (value as { then?: unknown } | null | undefined)?.then === 'function'
  ) {
    return PROMISE_VALUE_SIZE;
  }
  if (Buffer.isBuffer(value)) {
    return value.length;
  }
  if (value != null && typeof value === 'object') {
    return OBJECT_VALUE_SIZE * Object.keys(value).length;
  }
  if (typeof value === 'boolean') {
    return 8;
  }
  return 0;
};

interface LruEntry {
  value: unknown;
  ksize: number;
  vsize: number;
}

class LruCacheStore implements CacheStore {
  private cache: LRUCache<string, LruEntry>;
  private stdTtl: number;
  private hits = 0;
  private misses = 0;
  private ksize = 0;
  private vsize = 0;

  constructor({ max, stdTtl }: { max: number; stdTtl: number }) {
    this.stdTtl = stdTtl;
    this.cache = new LRUCache<string, LruEntry>({
      max,
      ttl: stdTtl * 1000,
      // Without this, expired entries are only dropped when their key is read.
      ttlAutopurge: true,
      // Fires on every removal path, so one decrement here covers all of them.
      dispose: (entry) => {
        this.ksize -= entry.ksize;
        this.vsize -= entry.vsize;
      },
    });
  }

  // Cloned on read because callers mutate what they get back, as getTvSeason
  // does when it rewrites still_path in place.
  public get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (entry === undefined) {
      this.misses++;
      return undefined;
    }

    this.hits++;
    return structuredClone(entry.value) as T;
  }

  public set<T>(key: string, value: T, ttl?: number): boolean {
    const entry: LruEntry = {
      value: structuredClone(value),
      ksize: keyLength(key),
      vsize: valueLength(value),
    };

    // A ttl of 0 means the entry never expires.
    this.cache.set(key, entry, { ttl: (ttl ?? this.stdTtl) * 1000 });

    this.ksize += entry.ksize;
    this.vsize += entry.vsize;

    return true;
  }

  public del(key: string): number {
    return this.cache.delete(key) ? 1 : 0;
  }

  public getTtl(key: string): number | undefined {
    if (!this.cache.has(key)) {
      return undefined;
    }

    const remaining = this.cache.getRemainingTTL(key);

    // Keys with no expiry report 0.
    return remaining === Infinity ? 0 : Date.now() + remaining;
  }

  public getStats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      keys: this.cache.size,
      ksize: this.ksize,
      vsize: this.vsize,
    };
  }

  public flushAll(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.ksize = 0;
    this.vsize = 0;
  }
}

class Cache {
  public id: AvailableCacheIds;
  public data: CacheStore;
  public name: string;

  constructor(
    id: AvailableCacheIds,
    name: string,
    options: { max: number; stdTtl?: number }
  ) {
    this.id = id;
    this.name = name;

    this.data = new LruCacheStore({
      max: options.max,
      stdTtl: options.stdTtl ?? DEFAULT_TTL,
    });
  }

  public getStats() {
    return this.data.getStats();
  }

  public flush(): void {
    this.data.flushAll();
  }
}

class CacheManager {
  private availableCaches: Record<AvailableCacheIds, Cache> = {
    musicbrainz: new Cache('musicbrainz', 'MusicBrainz', {
      stdTtl: 86400,
      max: MUSICBRAINZ_MAX_KEYS,
    }),
    coverart: new Cache('coverart', 'Cover Art Archive', {
      stdTtl: 86400,
      max: METADATA_MAX_KEYS,
    }),
    fanart: new Cache('fanart', 'fanart.tv', {
      stdTtl: 86400,
      max: METADATA_MAX_KEYS,
    }),
    lastfm: new Cache('lastfm', 'Last.fm', {
      stdTtl: 43200,
      max: METADATA_MAX_KEYS,
    }),
    listenbrainz: new Cache('listenbrainz', 'ListenBrainz', {
      stdTtl: 21600,
      max: METADATA_MAX_KEYS,
    }),
    spotify: new Cache('spotify', 'Spotify', {
      stdTtl: 3600,
      max: METADATA_MAX_KEYS,
    }),
    deezer: new Cache('deezer', 'Deezer', {
      stdTtl: 3600,
      max: METADATA_MAX_KEYS,
    }),
    itunes: new Cache('itunes', 'iTunes', {
      stdTtl: 21600,
      max: METADATA_MAX_KEYS,
    }),
    ticketmaster: new Cache('ticketmaster', 'Ticketmaster', {
      stdTtl: 43200,
      max: METADATA_MAX_KEYS,
    }),
    skiddle: new Cache('skiddle', 'Skiddle', {
      stdTtl: 43200,
      max: METADATA_MAX_KEYS,
    }),
    youtube: new Cache('youtube', 'YouTube', {
      stdTtl: 86400 * 30,
      max: METADATA_MAX_KEYS,
    }),
    lidarr: new Cache('lidarr', 'Lidarr', { max: LIDARR_MAX_KEYS }),
    plex: new Cache('plex', 'Plex', { max: MEDIA_SERVER_MAX_KEYS }),
    jellyfin: new Cache('jellyfin', 'Jellyfin', { max: MEDIA_SERVER_MAX_KEYS }),
    navidrome: new Cache('navidrome', 'Navidrome', {
      max: MEDIA_SERVER_MAX_KEYS,
    }),
    plextv: new Cache('plextv', 'Plex TV', {
      stdTtl: 86400 * 7, // 1 week cache
      max: PLEX_TV_MAX_KEYS,
    }),
    plexwatchlist: new Cache('plexwatchlist', 'Plex Watchlist', {
      max: PLEX_WATCHLIST_MAX_KEYS,
    }),
  };

  public getCache(id: AvailableCacheIds): Cache {
    return this.availableCaches[id];
  }

  public getAllCaches(): Record<string, Cache> {
    return this.availableCaches;
  }
}

const cacheManager = new CacheManager();

export default cacheManager;
