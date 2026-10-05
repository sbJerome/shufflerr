import ExternalAPI from '@server/api/externalapi';
import { getRepository } from '@server/datasource';
import type { LinkedAccountProvider } from '@server/entity/LinkedAccount';
import LinkedAccount from '@server/entity/LinkedAccount';
import type { User } from '@server/entity/User';
import { decryptSecret, encryptSecret } from '@server/lib/secrets';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { createHash, randomBytes } from 'crypto';
import type { Request } from 'express';

/**
 * Per-user links to Last.fm, ListenBrainz and Spotify (docs/USER_SYSTEM.md
 * §Linked accounts). Plex and Jellyfin links live on the User row as in Seerr.
 * Secrets are encrypted at rest with server/lib/secrets.ts and never returned
 * by the API or logged.
 */

export const SPOTIFY_SCOPES = 'playlist-read-private user-library-read';
export const LINK_PROVIDERS: LinkedAccountProvider[] = [
  'lastfm',
  'listenbrainz',
  'spotify',
];

export const isLinkProvider = (value: string): value is LinkedAccountProvider =>
  (LINK_PROVIDERS as string[]).includes(value);

/** `<applicationUrl>` without a trailing slash, falling back to the request origin. */
export const getBaseUrl = (req?: Request): string => {
  const configured = getSettings().main.applicationUrl?.replace(/\/+$/, '');
  if (configured) {
    return configured;
  }
  if (req) {
    return `${req.protocol}://${req.get('host')}`;
  }
  return '';
};

/** Redirect URI to register with the provider: `<applicationUrl>/api/v1/callback/<provider>`. */
export const getCallbackUrl = (
  provider: 'lastfm' | 'spotify',
  req?: Request
): string => `${getBaseUrl(req)}/api/v1/callback/${provider}`;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export const getLinkedAccount = async (
  userId: number,
  provider: LinkedAccountProvider
): Promise<LinkedAccount | null> =>
  getRepository(LinkedAccount).findOne({
    where: { user: { id: userId }, provider },
  });

export const getLinkedAccounts = async (
  userId: number
): Promise<LinkedAccount[]> =>
  getRepository(LinkedAccount).find({ where: { user: { id: userId } } });

/**
 * Decrypted secret for a linked account (Last.fm session key, ListenBrainz
 * user token, Spotify refresh token), or null when the user hasn't linked it.
 */
export const getLinkedSecret = async (
  userId: number,
  provider: LinkedAccountProvider
): Promise<string | null> => {
  const row = await getRepository(LinkedAccount)
    .createQueryBuilder('account')
    .addSelect('account.secret')
    .where('account.userId = :userId', { userId })
    .andWhere('account.provider = :provider', { provider })
    .getOne();

  if (!row?.secret) {
    return null;
  }

  try {
    return decryptSecret(row.secret);
  } catch (e) {
    logger.warn('Could not decrypt a linked account secret', {
      label: 'Auth',
      userId,
      provider,
      errorMessage: e.message,
    });
    return null;
  }
};

export interface LinkedAccountInput {
  externalUsername: string;
  secret: string;
  scopes?: string | null;
  expiresAt?: Date | null;
}

/** Creates or replaces the user's link for a provider. */
export const setLinkedAccount = async (
  userId: number,
  provider: LinkedAccountProvider,
  input: LinkedAccountInput
): Promise<LinkedAccount> => {
  const repository = getRepository(LinkedAccount);
  const existing = await getLinkedAccount(userId, provider);

  const row =
    existing ??
    new LinkedAccount({
      user: { id: userId } as User,
      provider,
      createdAt: new Date(),
    });
  row.externalUsername = input.externalUsername ?? '';
  row.secret = encryptSecret(input.secret);
  row.scopes = input.scopes ?? null;
  row.expiresAt = input.expiresAt ?? null;
  if (existing) {
    row.createdAt = new Date();
  }

  return repository.save(row);
};

/** Replaces only the stored secret (e.g. Spotify rotated the refresh token). */
export const updateLinkedSecret = async (
  userId: number,
  provider: LinkedAccountProvider,
  secret: string
): Promise<void> => {
  const existing = await getLinkedAccount(userId, provider);
  if (!existing) {
    return;
  }
  await getRepository(LinkedAccount).update(existing.id, {
    secret: encryptSecret(secret),
    lastUsedAt: new Date(),
  });
};

export const touchLinkedAccount = async (
  userId: number,
  provider: LinkedAccountProvider
): Promise<void> => {
  const existing = await getLinkedAccount(userId, provider);
  if (existing) {
    await getRepository(LinkedAccount).update(existing.id, {
      lastUsedAt: new Date(),
    });
  }
};

export const removeLinkedAccount = async (
  userId: number,
  provider: LinkedAccountProvider
): Promise<boolean> => {
  const repository = getRepository(LinkedAccount);
  const existing = await getLinkedAccount(userId, provider);
  if (!existing) {
    return false;
  }
  await repository.remove(existing);
  return true;
};

// ---------------------------------------------------------------------------
// Pending link attempts (OAuth `state`)
// ---------------------------------------------------------------------------

interface PendingLink {
  userId: number;
  provider: 'lastfm' | 'spotify';
  codeVerifier?: string;
  redirectUri: string;
  /** Where to send the browser afterwards (own profile or /users/:id). */
  returnPath: string;
  expiresAt: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000;
const pendingLinks = new Map<string, PendingLink>();

const prunePending = () => {
  const now = Date.now();
  for (const [state, pending] of pendingLinks) {
    if (pending.expiresAt <= now) {
      pendingLinks.delete(state);
    }
  }
};

const base64url = (buffer: Buffer): string =>
  buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export const createPendingLink = (
  input: Omit<PendingLink, 'expiresAt'>
): string => {
  prunePending();
  const state = base64url(randomBytes(24));
  pendingLinks.set(state, { ...input, expiresAt: Date.now() + PENDING_TTL_MS });
  return state;
};

/** One-shot: a state can only be redeemed once. */
export const consumePendingLink = (
  state: string,
  provider: 'lastfm' | 'spotify'
): PendingLink | null => {
  prunePending();
  const pending = pendingLinks.get(state);
  if (!pending || pending.provider !== provider) {
    return null;
  }
  pendingLinks.delete(state);
  return pending;
};

// ---------------------------------------------------------------------------
// Provider calls (only what linking needs; scrobbling/import live in their
// own API clients)
// ---------------------------------------------------------------------------

class LinkHttp extends ExternalAPI {
  constructor(baseUrl: string) {
    super(
      baseUrl,
      {},
      { timeout: getSettings().network.apiRequestTimeout || 10000 }
    );
  }

  public async getJson<T>(
    endpoint: string,
    params?: Record<string, string>,
    headers?: Record<string, string>
  ): Promise<T> {
    return (await this.axios.get<T>(endpoint, { params, headers })).data;
  }

  public async postForm<T>(
    endpoint: string,
    form: Record<string, string>,
    headers?: Record<string, string>
  ): Promise<T> {
    return (
      await this.axios.post<T>(endpoint, new URLSearchParams(form).toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...headers,
        },
      })
    ).data;
  }
}

/** Last.fm signature: md5 of the sorted `name + value` pairs followed by the shared secret. */
export const lastfmSignature = (
  params: Record<string, string>,
  sharedSecret: string
): string =>
  createHash('md5')
    .update(
      Object.keys(params)
        .filter((key) => key !== 'format' && key !== 'callback')
        .sort()
        .map((key) => `${key}${params[key]}`)
        .join('') + sharedSecret,
      'utf8'
    )
    .digest('hex');

export const pkceChallenge = (verifier: string): string =>
  base64url(createHash('sha256').update(verifier).digest());

export interface LinkResult {
  externalUsername: string;
  secret: string;
  scopes?: string | null;
  expiresAt?: Date | null;
}

/**
 * Outbound calls, kept on one object so tests can stub them
 * (`mock.method(linkProviders, 'lastfmGetSession', …)`).
 */
export const linkProviders = {
  /** Last.fm `auth.getSession`: web-auth token → session key. */
  async lastfmGetSession(token: string): Promise<LinkResult> {
    const { apiKey, sharedSecret } = getSettings().metadata.lastfm;
    const params: Record<string, string> = {
      method: 'auth.getSession',
      api_key: apiKey,
      token,
    };
    const data = await new LinkHttp('https://ws.audioscrobbler.com').getJson<{
      session?: { name: string; key: string };
      error?: number;
      message?: string;
    }>('/2.0/', {
      ...params,
      api_sig: lastfmSignature(params, sharedSecret),
      format: 'json',
    });

    if (!data.session?.key) {
      throw new Error(data.message || 'Last.fm did not return a session.');
    }
    return { externalUsername: data.session.name, secret: data.session.key };
  },

  /** ListenBrainz `validate-token`. */
  async listenbrainzValidate(token: string): Promise<LinkResult> {
    const baseUrl = (
      getSettings().scrobble.listenbrainz.url || 'https://api.listenbrainz.org'
    ).replace(/\/+$/, '');
    const data = await new LinkHttp(baseUrl).getJson<{
      valid?: boolean;
      user_name?: string;
    }>('/1/validate-token', undefined, { Authorization: `Token ${token}` });

    if (!data.valid || !data.user_name) {
      throw new InvalidLinkTokenError();
    }
    return { externalUsername: data.user_name, secret: token };
  },

  /** Spotify Authorization Code + PKCE exchange, then the profile for the display name. */
  async spotifyExchange(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<LinkResult> {
    const { clientId, clientSecret } = getSettings().discover.spotify;
    const token = await new LinkHttp('https://accounts.spotify.com').postForm<{
      access_token: string;
      refresh_token?: string;
      scope?: string;
      expires_in?: number;
    }>(
      '/api/token',
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      },
      {
        Authorization: `Basic ${Buffer.from(
          `${clientId}:${clientSecret}`
        ).toString('base64')}`,
      }
    );

    if (!token.refresh_token) {
      throw new Error('Spotify did not return a refresh token.');
    }

    const profile = await new LinkHttp('https://api.spotify.com').getJson<{
      id: string;
      display_name?: string | null;
    }>('/v1/me', undefined, { Authorization: `Bearer ${token.access_token}` });

    return {
      externalUsername: profile.display_name || profile.id,
      secret: token.refresh_token,
      scopes: token.scope ?? SPOTIFY_SCOPES,
      // The refresh token itself doesn't expire; this is the access token's
      // lifetime at link time and is informational only.
      expiresAt: null,
    };
  },
};

export class InvalidLinkTokenError extends Error {
  constructor() {
    super("ListenBrainz didn't accept that token.");
  }
}

// ---------------------------------------------------------------------------
// Authorize URLs
// ---------------------------------------------------------------------------

export const buildLastfmAuthorizeUrl = (
  userId: number,
  returnPath: string,
  req?: Request
): string => {
  const redirectUri = getCallbackUrl('lastfm', req);
  const state = createPendingLink({
    userId,
    provider: 'lastfm',
    redirectUri,
    returnPath,
  });
  const url = new URL('https://www.last.fm/api/auth/');
  url.searchParams.set('api_key', getSettings().metadata.lastfm.apiKey);
  // Last.fm appends `token` to the callback and keeps our own query string.
  url.searchParams.set('cb', `${redirectUri}?state=${state}`);
  return url.toString();
};

export const buildSpotifyAuthorizeUrl = (
  userId: number,
  returnPath: string,
  req?: Request
): string => {
  const redirectUri = getCallbackUrl('spotify', req);
  const codeVerifier = base64url(randomBytes(48));
  const state = createPendingLink({
    userId,
    provider: 'spotify',
    codeVerifier,
    redirectUri,
    returnPath,
  });
  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('client_id', getSettings().discover.spotify.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', pkceChallenge(codeVerifier));
  url.searchParams.set('scope', SPOTIFY_SCOPES);
  url.searchParams.set('state', state);
  return url.toString();
};
