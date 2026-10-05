// Subsonic / OpenSubsonic client used for Navidrome (docs/INTEGRATIONS.md §Navidrome).
import ExternalAPI from '@server/api/externalapi';
import type { NavidromeSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { createHash, randomBytes } from 'crypto';

const API_VERSION = '1.16.1';
const CLIENT_NAME = 'Shufflerr';

export class SubsonicError extends Error {
  constructor(
    message: string,
    public code?: number
  ) {
    super(message);
  }
}

export interface SubsonicSong {
  id: string;
  title: string;
  album?: string;
  albumId?: string;
  artist?: string;
  artistId?: string;
  track?: number;
  discNumber?: number;
  /** seconds */
  duration?: number;
  bitRate?: number;
  suffix?: string;
  contentType?: string;
  size?: number;
  path?: string;
  year?: number;
  created?: string;
  /** OpenSubsonic: recording MBID */
  musicBrainzId?: string;
  bitDepth?: number;
  samplingRate?: number;
}

export interface SubsonicAlbum {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  songCount?: number;
  /** seconds */
  duration?: number;
  created?: string;
  year?: number;
  coverArt?: string;
  /** OpenSubsonic: release MBID (Navidrome) */
  musicBrainzId?: string;
  /** OpenSubsonic: release-group MBID, when the server exposes it */
  releaseGroupMbid?: string;
  artists?: { id: string; name: string }[];
  song?: SubsonicSong[];
}

export interface SubsonicArtist {
  id: string;
  name: string;
  albumCount?: number;
  musicBrainzId?: string;
  album?: SubsonicAlbum[];
}

export interface SubsonicPing {
  status: string;
  version: string;
  type?: string;
  serverVersion?: string;
  openSubsonic?: boolean;
}

interface Envelope<T> {
  'subsonic-response': {
    status: 'ok' | 'failed';
    version: string;
    type?: string;
    serverVersion?: string;
    openSubsonic?: boolean;
    error?: { code: number; message: string };
  } & T;
}

type Credentials = Pick<NavidromeSettings, 'url' | 'username' | 'password'>;

class SubsonicAPI extends ExternalAPI {
  private credentials: Credentials;

  constructor(credentials: Credentials, timeout = 15000) {
    super(SubsonicAPI.baseUrl(credentials.url), {}, { timeout });
    this.credentials = credentials;
  }

  public static fromSettings(): SubsonicAPI {
    return new SubsonicAPI(getSettings().navidrome);
  }

  private static baseUrl(url: string): string {
    return `${url.replace(/\/+$/, '')}/rest`;
  }

  /** Token auth: t = md5(password + salt), fresh salt per request. */
  public authParams(): Record<string, string> {
    const salt = randomBytes(8).toString('hex');
    return {
      u: this.credentials.username,
      t: createHash('md5')
        .update(`${this.credentials.password}${salt}`)
        .digest('hex'),
      s: salt,
      v: API_VERSION,
      c: CLIENT_NAME,
      f: 'json',
    };
  }

  private async call<T>(
    endpoint: string,
    params: Record<string, string | number> = {}
  ): Promise<Envelope<T>['subsonic-response']> {
    // never cached: the salt changes per call and scans want fresh data
    const response = await this.axios.get<Envelope<T>>(`/${endpoint}`, {
      params: { ...this.authParams(), ...params },
    });
    const body = response.data?.['subsonic-response'];

    if (!body) {
      throw new SubsonicError('The server did not answer like a Subsonic API.');
    }
    if (body.status !== 'ok') {
      throw new SubsonicError(
        body.error?.message ?? 'The Subsonic API reported an error.',
        body.error?.code
      );
    }
    return body;
  }

  public async ping(): Promise<SubsonicPing> {
    const body = await this.call<Record<string, never>>('ping');
    return {
      status: body.status,
      version: body.version,
      type: body.type,
      serverVersion: body.serverVersion,
      openSubsonic: body.openSubsonic,
    };
  }

  public async getArtists(): Promise<SubsonicArtist[]> {
    const body = await this.call<{
      artists?: { index?: { artist?: SubsonicArtist[] }[] };
    }>('getArtists');
    return (body.artists?.index ?? []).flatMap((index) => index.artist ?? []);
  }

  public async getArtist(id: string): Promise<SubsonicArtist | undefined> {
    return (await this.call<{ artist?: SubsonicArtist }>('getArtist', { id }))
      .artist;
  }

  public async getAlbum(id: string): Promise<SubsonicAlbum | undefined> {
    return (await this.call<{ album?: SubsonicAlbum }>('getAlbum', { id }))
      .album;
  }

  public async getAlbumList2(
    type: 'newest' | 'alphabeticalByName' | 'alphabeticalByArtist' | 'recent',
    { size = 500, offset = 0 }: { size?: number; offset?: number } = {}
  ): Promise<SubsonicAlbum[]> {
    const body = await this.call<{ albumList2?: { album?: SubsonicAlbum[] } }>(
      'getAlbumList2',
      { type, size, offset }
    );
    return body.albumList2?.album ?? [];
  }

  public async search3(
    query: string,
    { albumCount = 20, songCount = 20, artistCount = 20 } = {}
  ): Promise<{
    artist: SubsonicArtist[];
    album: SubsonicAlbum[];
    song: SubsonicSong[];
  }> {
    const body = await this.call<{
      searchResult3?: {
        artist?: SubsonicArtist[];
        album?: SubsonicAlbum[];
        song?: SubsonicSong[];
      };
    }>('search3', { query, albumCount, songCount, artistCount });
    return {
      artist: body.searchResult3?.artist ?? [],
      album: body.searchResult3?.album ?? [],
      song: body.searchResult3?.song ?? [],
    };
  }

  private signedUrl(
    endpoint: string,
    params: Record<string, string | number>
  ): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({
      ...this.authParams(),
      ...params,
    })) {
      query.set(key, String(value));
    }
    return `${SubsonicAPI.baseUrl(this.credentials.url)}/${endpoint}?${query}`;
  }

  /** URL of the original file (`format=raw`: no server-side transcoding). */
  public streamUrl(songId: string): string {
    return this.signedUrl('stream', { id: songId, format: 'raw' });
  }

  public coverArtUrl(coverArtId: string, size = 500): string {
    return this.signedUrl('getCoverArt', { id: coverArtId, size });
  }
}

export default SubsonicAPI;
