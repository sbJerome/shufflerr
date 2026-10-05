import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import crypto from 'crypto';

const API_URL = 'https://ws.audioscrobbler.com/2.0';
const AUTH_URL = 'https://www.last.fm/api/auth/';

const METADATA_TTL = 43200; // 12 h

export interface LastfmTag {
  name: string;
  url?: string;
}

export interface LastfmArtistInfo {
  name: string;
  mbid?: string;
  url: string;
  stats?: { listeners?: string; playcount?: string };
  tags?: { tag: LastfmTag[] };
  bio?: { summary?: string; content?: string; published?: string };
  similar?: { artist: { name: string; url: string }[] };
}

export interface LastfmSimilarArtist {
  name: string;
  mbid?: string;
  match?: string;
  url: string;
}

export interface LastfmAlbumInfo {
  name: string;
  artist: string;
  mbid?: string;
  url: string;
  listeners?: string;
  playcount?: string;
  tags?: { tag: LastfmTag[] } | string;
  wiki?: { summary?: string; content?: string; published?: string };
}

export interface LastfmTopAlbum {
  name: string;
  mbid?: string;
  url: string;
  artist: { name: string; mbid?: string; url: string };
  '@attr'?: { rank: string };
}

export interface LastfmSession {
  /** Last.fm username */
  name: string;
  /** Session key — store encrypted (LinkedAccount.secret) */
  key: string;
  subscriber?: number;
}

export interface LastfmScrobble {
  artist: string;
  track: string;
  album?: string;
  albumArtist?: string;
  /** seconds */
  duration?: number;
  /** MusicBrainz recording id */
  mbid?: string;
  trackNumber?: number;
  /** UNIX seconds when the track started playing (scrobble only) */
  timestamp?: number;
}

export interface LastfmScrobbleResult {
  accepted: number;
  ignored: number;
}

export class LastfmError extends Error {
  constructor(
    message: string,
    public code?: number
  ) {
    super(message);
  }
}

type Params = Record<string, string | number | undefined>;

/**
 * Last.fm signature: md5 of every parameter (except `format` and `callback`)
 * as `<name><value>`, sorted by name, followed by the shared secret.
 */
export const signLastfmParams = (params: Params, sharedSecret: string): string => {
  const base = Object.keys(params)
    .filter(
      (k) => k !== 'format' && k !== 'callback' && params[k] !== undefined
    )
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('');
  return crypto
    .createHash('md5')
    .update(base + sharedSecret, 'utf8')
    .digest('hex');
};

/**
 * Strip Last.fm's trailing "Read more on Last.fm" anchor and any other markup
 * from a bio; the UI renders the attribution link itself.
 */
export const cleanLastfmText = (html?: string): string =>
  (html ?? '')
    .replace(/<a\b[^>]*>.*?<\/a>\.?/gis, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+\n/g, '\n')
    .trim();

class LastfmAPI extends ExternalAPI {
  private apiKey: string;
  private sharedSecret: string;

  constructor(options: { apiKey?: string; sharedSecret?: string } = {}) {
    const { lastfm } = getSettings().metadata;
    const apiKey = options.apiKey ?? lastfm.apiKey;
    super(
      API_URL,
      { api_key: apiKey, format: 'json' },
      {
        nodeCache: cacheManager.getCache('lastfm').data,
        timeout: getSettings().network.apiRequestTimeout,
      }
    );
    this.apiKey = apiKey;
    this.sharedSecret = options.sharedSecret ?? lastfm.sharedSecret;
  }

  /** Metadata calls need the switch and an API key. */
  public static enabled(): boolean {
    const { lastfm } = getSettings().metadata;
    return lastfm.enabled && !!lastfm.apiKey;
  }

  /** Scrobbling / linking also needs the shared secret. */
  public static canSign(): boolean {
    return LastfmAPI.enabled() && !!getSettings().metadata.lastfm.sharedSecret;
  }

  // ---- metadata (unsigned) ------------------------------------------------

  private async call<T>(method: string, params: Params, ttl = METADATA_TTL) {
    const data = await this.get<T & { error?: number; message?: string }>(
      '/',
      { params: { method, ...params } },
      ttl
    );
    if (data?.error) {
      throw new LastfmError(data.message ?? 'Last.fm error', data.error);
    }
    return data as T;
  }

  /** Artist bio, tags and listener counts. Prefer the MBID; falls back to the name. */
  public async getArtistInfo(q: {
    mbid?: string;
    artist?: string;
    lang?: string;
  }): Promise<LastfmArtistInfo | null> {
    const attempts: Params[] = [];
    if (q.mbid) {
      attempts.push({ mbid: q.mbid });
    }
    if (q.artist) {
      attempts.push({ artist: q.artist, autocorrect: 1 });
    }
    for (const params of attempts) {
      try {
        const data = await this.call<{ artist?: LastfmArtistInfo }>(
          'artist.getinfo',
          { ...params, lang: q.lang }
        );
        if (data.artist) {
          return data.artist;
        }
      } catch {
        // unknown MBID on Last.fm → try the name
      }
    }
    return null;
  }

  public async getSimilarArtists(
    q: { mbid?: string; artist?: string },
    limit = 12
  ): Promise<LastfmSimilarArtist[]> {
    const attempts: Params[] = [];
    if (q.mbid) {
      attempts.push({ mbid: q.mbid });
    }
    if (q.artist) {
      attempts.push({ artist: q.artist, autocorrect: 1 });
    }
    for (const params of attempts) {
      try {
        const data = await this.call<{
          similarartists?: { artist: LastfmSimilarArtist[] };
        }>('artist.getsimilar', { ...params, limit });
        const artists = data.similarartists?.artist;
        if (artists?.length) {
          return artists;
        }
      } catch {
        // try the next identifier
      }
    }
    return [];
  }

  public async getAlbumInfo(q: {
    mbid?: string;
    artist?: string;
    album?: string;
  }): Promise<LastfmAlbumInfo | null> {
    const attempts: Params[] = [];
    if (q.artist && q.album) {
      attempts.push({ artist: q.artist, album: q.album, autocorrect: 1 });
    }
    if (q.mbid) {
      attempts.push({ mbid: q.mbid });
    }
    for (const params of attempts) {
      try {
        const data = await this.call<{ album?: LastfmAlbumInfo }>(
          'album.getinfo',
          params
        );
        if (data.album) {
          return data.album;
        }
      } catch {
        // try the next identifier
      }
    }
    return null;
  }

  public async getTagTopAlbums(tag: string, limit = 20): Promise<LastfmTopAlbum[]> {
    try {
      const data = await this.call<{ albums?: { album: LastfmTopAlbum[] } }>(
        'tag.gettopalbums',
        { tag, limit }
      );
      return data.albums?.album ?? [];
    } catch {
      return [];
    }
  }

  // ---- auth + scrobbling (signed) ------------------------------------------

  /** Where to send the user to approve Shufflerr; Last.fm calls `callbackUrl?token=…` back. */
  public getAuthUrl(callbackUrl: string): string {
    const url = new URL(AUTH_URL);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('cb', callbackUrl);
    return url.toString();
  }

  /** Parameters with `api_key` and `api_sig` added, ready to send. */
  public sign(params: Params): Record<string, string> {
    const withKey: Params = { ...params, api_key: this.apiKey };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(withKey)) {
      if (v !== undefined) {
        out[k] = String(v);
      }
    }
    out.api_sig = signLastfmParams(out, this.sharedSecret);
    return out;
  }

  /** Signed GET/POST. Never cached. Throws LastfmError with Last.fm's code and message. */
  public async signedCall<T>(
    method: string,
    params: Params,
    httpMethod: 'GET' | 'POST' = 'POST'
  ): Promise<T> {
    if (!this.apiKey || !this.sharedSecret) {
      throw new LastfmError(
        'Last.fm needs an API key and shared secret. Add them in Settings → MusicBrainz and Last.fm.'
      );
    }
    const signed = { ...this.sign({ method, ...params }), format: 'json' };
    try {
      const response =
        httpMethod === 'GET'
          ? await this.axios.get<T & { error?: number; message?: string }>(
              '/',
              { params: signed }
            )
          : await this.axios.post<T & { error?: number; message?: string }>(
              '/',
              new URLSearchParams(signed).toString(),
              {
                // null drops the instance's default query params: everything travels signed in the body
                params: { api_key: null, format: null },
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
              }
            );
      if (response.data?.error) {
        throw new LastfmError(
          response.data.message ?? 'Last.fm error',
          response.data.error
        );
      }
      return response.data as T;
    } catch (e) {
      if (e instanceof LastfmError) {
        throw e;
      }
      const body = e?.response?.data;
      throw new LastfmError(
        body?.message ?? e.message ?? 'Last.fm request failed',
        body?.error
      );
    }
  }

  /** Exchange the token from the web-auth callback for a session key. */
  public async getSession(token: string): Promise<LastfmSession> {
    const data = await this.signedCall<{ session: LastfmSession }>(
      'auth.getSession',
      { token },
      'GET'
    );
    return data.session;
  }

  public async updateNowPlaying(
    sessionKey: string,
    track: LastfmScrobble
  ): Promise<void> {
    await this.signedCall('track.updateNowPlaying', {
      sk: sessionKey,
      artist: track.artist,
      track: track.track,
      album: track.album,
      albumArtist: track.albumArtist,
      duration: track.duration,
      mbid: track.mbid,
      trackNumber: track.trackNumber,
    });
  }

  /** Scrobble up to 50 plays in one call. Each needs `timestamp` (UNIX seconds). */
  public async scrobble(
    sessionKey: string,
    tracks: LastfmScrobble[]
  ): Promise<LastfmScrobbleResult> {
    if (tracks.length === 0) {
      return { accepted: 0, ignored: 0 };
    }
    if (tracks.length > 50) {
      throw new LastfmError('Last.fm accepts at most 50 scrobbles per call.');
    }
    const params: Params = { sk: sessionKey };
    tracks.forEach((t, i) => {
      params[`artist[${i}]`] = t.artist;
      params[`track[${i}]`] = t.track;
      params[`timestamp[${i}]`] = t.timestamp ?? Math.floor(Date.now() / 1000);
      params[`album[${i}]`] = t.album;
      params[`albumArtist[${i}]`] = t.albumArtist;
      params[`duration[${i}]`] = t.duration;
      params[`mbid[${i}]`] = t.mbid;
      params[`trackNumber[${i}]`] = t.trackNumber;
    });
    const data = await this.signedCall<{
      scrobbles?: { '@attr'?: { accepted: number; ignored: number } };
    }>('track.scrobble', params);
    return {
      accepted: Number(data.scrobbles?.['@attr']?.accepted ?? 0),
      ignored: Number(data.scrobbles?.['@attr']?.ignored ?? 0),
    };
  }
}

export default LastfmAPI;
