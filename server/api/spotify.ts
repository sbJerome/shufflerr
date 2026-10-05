import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import { proxyRequestInterceptor } from '@server/utils/customProxyAgent';
import { userAgentRequestInterceptor } from '@server/utils/userAgent';
import axios from 'axios';

/**
 * Spotify Web API. Two kinds of access:
 *  - app token (client credentials) for public albums and playlists;
 *  - per-user token (Authorization Code with PKCE) for saved albums and
 *    private playlists. Only the refresh token is stored (encrypted, in
 *    LinkedAccount); access tokens live in memory.
 */

const ACCOUNTS_URL = 'https://accounts.spotify.com';
const API_URL = 'https://api.spotify.com/v1';

export const SPOTIFY_SCOPES = ['playlist-read-private', 'user-library-read'];

export interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface SpotifyProfile {
  id: string;
  display_name?: string | null;
  email?: string;
}

export interface SpotifyImage {
  url: string;
  width?: number | null;
  height?: number | null;
}

export interface SpotifyArtistRef {
  id: string;
  name: string;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  external_ids?: { isrc?: string };
  album?: SpotifyAlbum;
  artists?: SpotifyArtistRef[];
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  album_type?: string;
  total_tracks?: number;
  release_date?: string;
  artists: SpotifyArtistRef[];
  images?: SpotifyImage[];
  external_ids?: { upc?: string };
  tracks?: { items: SpotifyTrack[] };
}

interface SpotifyPaging<T> {
  items: T[];
  next: string | null;
  total: number;
}

export class SpotifyNotConfiguredError extends Error {
  constructor() {
    super(
      'Spotify is not set up. Add a client ID and client secret in Settings → Spotify.'
    );
  }
}

const tokenClient = () => {
  const client = axios.create({
    baseURL: ACCOUNTS_URL,
    timeout: getSettings().network.apiRequestTimeout,
  });
  client.interceptors.request.use(proxyRequestInterceptor);
  client.interceptors.request.use(userAgentRequestInterceptor);
  return client;
};

const credentials = (): { clientId: string; clientSecret: string } => {
  const { clientId, clientSecret } = getSettings().discover.spotify;
  if (!clientId) {
    throw new SpotifyNotConfiguredError();
  }
  return { clientId, clientSecret };
};

const postToken = async (
  form: Record<string, string>,
  useBasicAuth: boolean
): Promise<SpotifyTokenResponse> => {
  const { clientId, clientSecret } = credentials();
  const body = new URLSearchParams(form);
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (useBasicAuth && clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(
      `${clientId}:${clientSecret}`
    ).toString('base64')}`;
  } else {
    body.set('client_id', clientId);
  }
  const response = await tokenClient().post<SpotifyTokenResponse>(
    '/api/token',
    body.toString(),
    { headers }
  );
  return response.data;
};

/** Step 1 of Authorization Code with PKCE: where to send the browser. */
export const buildAuthorizeUrl = ({
  clientId,
  redirectUri,
  state,
  codeChallenge,
  scopes = SPOTIFY_SCOPES,
}: {
  clientId?: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string[];
}): string => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId ?? credentials().clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    scope: scopes.join(' '),
  });
  return `${ACCOUNTS_URL}/authorize?${params.toString()}`;
};

/** Step 2: swap the code for tokens (the response carries the refresh token). */
export const exchangeCode = ({
  code,
  codeVerifier,
  redirectUri,
}: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<SpotifyTokenResponse> =>
  postToken(
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    },
    true
  );

/** A new access token; Spotify may also rotate the refresh token. */
export const refreshAccessToken = (
  refreshToken: string
): Promise<SpotifyTokenResponse> =>
  postToken({ grant_type: 'refresh_token', refresh_token: refreshToken }, true);

let appToken: { token: string; expiresAt: number } | null = null;
let appTokenFor = '';

/** Client-credentials token for public content, kept until shortly before it expires. */
export const getAppToken = async (): Promise<string> => {
  const { clientId, clientSecret } = credentials();
  if (!clientSecret) {
    throw new SpotifyNotConfiguredError();
  }
  if (appToken && appTokenFor === clientId && appToken.expiresAt > Date.now()) {
    return appToken.token;
  }
  const data = await postToken({ grant_type: 'client_credentials' }, true);
  appToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  appTokenFor = clientId;
  return appToken.token;
};

class SpotifyAPI extends ExternalAPI {
  constructor(private accessToken: string) {
    super(
      API_URL,
      {},
      {
        nodeCache: cacheManager.getCache('spotify').data,
        timeout: getSettings().network.apiRequestTimeout,
        headers: { Authorization: `Bearer ${accessToken}` },
        rateLimit: { maxRequests: 5, maxRPS: 5 },
      }
    );
  }

  public getProfile(): Promise<SpotifyProfile> {
    // never cached: it identifies whose token this is
    return this.get<SpotifyProfile>('/me', undefined, 0);
  }

  public getAlbum(id: string): Promise<SpotifyAlbum> {
    return this.get<SpotifyAlbum>(`/albums/${id}`);
  }

  public getTrack(id: string): Promise<SpotifyTrack> {
    return this.get<SpotifyTrack>(`/tracks/${id}`);
  }

  /** Full album objects (with UPC) for up to 20 ids per call. */
  public async getAlbums(ids: string[]): Promise<SpotifyAlbum[]> {
    const albums: SpotifyAlbum[] = [];
    for (let i = 0; i < ids.length; i += 20) {
      const data = await this.get<{ albums: (SpotifyAlbum | null)[] }>(
        '/albums',
        { params: { ids: ids.slice(i, i + 20).join(',') } }
      );
      albums.push(...data.albums.filter((a): a is SpotifyAlbum => !!a));
    }
    return albums;
  }

  public getPlaylist(id: string): Promise<{ id: string; name: string }> {
    return this.get<{ id: string; name: string }>(`/playlists/${id}`, {
      params: { fields: 'id,name' },
    });
  }

  /** Every track of a playlist (pages of 100, capped). */
  public async getPlaylistTracks(
    id: string,
    maxTracks = 1000
  ): Promise<SpotifyTrack[]> {
    const tracks: SpotifyTrack[] = [];
    for (let offset = 0; offset < maxTracks; offset += 100) {
      const page = await this.get<SpotifyPaging<{ track: SpotifyTrack | null }>>(
        `/playlists/${id}/tracks`,
        {
          params: {
            limit: 100,
            offset,
            fields:
              'next,total,items(track(id,name,external_ids,artists(id,name),album(id,name,album_type,total_tracks,artists(id,name),images)))',
          },
        }
      );
      tracks.push(
        ...page.items
          .map((item) => item.track)
          .filter((t): t is SpotifyTrack => !!t?.album?.id)
      );
      if (!page.next) {
        break;
      }
    }
    return tracks;
  }

  /** The signed-in user's saved albums, newest first (user token only). */
  public async getSavedAlbums(
    maxAlbums = 500
  ): Promise<{ addedAt: string; album: SpotifyAlbum }[]> {
    const saved: { addedAt: string; album: SpotifyAlbum }[] = [];
    for (let offset = 0; offset < maxAlbums; offset += 50) {
      const page = await this.get<
        SpotifyPaging<{ added_at: string; album: SpotifyAlbum }>
      >('/me/albums', { params: { limit: 50, offset } }, 0);
      saved.push(
        ...page.items.map((item) => ({
          addedAt: item.added_at,
          album: item.album,
        }))
      );
      if (!page.next) {
        break;
      }
    }
    return saved;
  }
}

/** Who a user access token belongs to. */
export const getProfile = (accessToken: string): Promise<SpotifyProfile> =>
  new SpotifyAPI(accessToken).getProfile();

/** Client for public content (app token). */
export const getPublicSpotify = async (): Promise<SpotifyAPI> =>
  new SpotifyAPI(await getAppToken());

export default SpotifyAPI;
