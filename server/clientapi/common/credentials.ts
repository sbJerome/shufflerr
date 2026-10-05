import { getRepository } from '@server/datasource';
import AppPassword from '@server/entity/AppPassword';
import type { User } from '@server/entity/User';
import {
  clientUsername,
  getAppPasswordSecrets,
  touchAppPassword,
  verifyAppPassword,
} from '@server/lib/auth/appPasswords';
import { decryptSecret, safeEqual } from '@server/lib/secrets';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { createHash, createHmac } from 'crypto';

/**
 * Sign-in for the client APIs. People authenticate with their username and an
 * app password (docs/AUTH.md §App passwords); account passwords never work
 * here. Verification itself lives in server/lib/auth/appPasswords.ts — this
 * file adds what both protocols need on top: a short verification cache
 * (Subsonic clients resend credentials with every request and argon2 is
 * deliberately slow), API-key lookup, and the signed Jellyfin access token.
 */

export interface ClientIdentity {
  user: User;
  appPasswordId: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { appPasswordId: number; expires: number }>();

const cacheKey = (...parts: string[]): string =>
  createHash('sha256').update(parts.join('\u0000')).digest('hex');

/** Re-read the row so a revoked app password stops working immediately. */
const identityFor = async (
  appPasswordId: number
): Promise<ClientIdentity | null> => {
  const row = await getRepository(AppPassword).findOne({
    where: { id: appPasswordId },
  });
  return row?.user ? { user: row.user, appPasswordId: row.id } : null;
};

const fromCache = async (key: string): Promise<ClientIdentity | null> => {
  const hit = cache.get(key);
  if (!hit) {
    return null;
  }
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  const identity = await identityFor(hit.appPasswordId);
  if (!identity) {
    cache.delete(key);
  }
  return identity;
};

const remember = (key: string, appPasswordId: number): void => {
  if (cache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expires < now) {
        cache.delete(k);
      }
    }
    if (cache.size > 2000) {
      cache.clear();
    }
  }
  cache.set(key, { appPasswordId, expires: Date.now() + CACHE_TTL_MS });
};

export const clearCredentialCache = (): void => cache.clear();

/** Username + plaintext app password (Subsonic `p=`, Jellyfin AuthenticateByName). */
export const signInWithPassword = async (
  username: string,
  password: string
): Promise<ClientIdentity | null> => {
  if (!username || !password) {
    return null;
  }
  const key = cacheKey('p', username.toLowerCase(), password);
  const cached = await fromCache(key);
  if (cached) {
    return cached;
  }

  const verified = await verifyAppPassword(username, password);
  if (!verified) {
    return null;
  }
  remember(key, verified.appPassword.id);
  return { user: verified.user, appPasswordId: verified.appPassword.id };
};

/**
 * Subsonic token auth: `t = md5(appPassword + salt)`. Needs the plaintext,
 * which is why app passwords are also stored encrypted.
 * Returns 'unavailable' when the user has app passwords but none can be decrypted.
 */
export const signInWithToken = async (
  username: string,
  token: string,
  salt: string
): Promise<ClientIdentity | 'unavailable' | null> => {
  if (!username || !token || !salt) {
    return null;
  }
  const wanted = token.toLowerCase();
  const secrets = await getAppPasswordSecrets(username);

  for (const entry of secrets) {
    const expected = createHash('md5')
      .update(entry.secret + salt)
      .digest('hex');
    if (safeEqual(expected, wanted)) {
      return { user: entry.user, appPasswordId: entry.appPasswordId };
    }
  }

  if (!secrets.length) {
    const rows = await getRepository(AppPassword)
      .createQueryBuilder('appPassword')
      .leftJoin('appPassword.user', 'user')
      .where(
        'LOWER(user.username) = :name OR LOWER(user.plexUsername) = :name OR LOWER(user.jellyfinUsername) = :name OR user.email = :name',
        { name: username.trim().toLowerCase() }
      )
      .getCount();
    if (rows > 0) {
      return 'unavailable';
    }
  }
  return null;
};

/**
 * OpenSubsonic `apiKey` extension: the app password on its own identifies the
 * user, so every row has to be checked. Cached after the first hit.
 */
export const signInWithApiKey = async (
  apiKey: string
): Promise<ClientIdentity | null> => {
  if (!apiKey) {
    return null;
  }
  const key = cacheKey('k', apiKey);
  const cached = await fromCache(key);
  if (cached) {
    return cached;
  }

  const rows = await getRepository(AppPassword)
    .createQueryBuilder('appPassword')
    .leftJoinAndSelect('appPassword.user', 'user')
    .addSelect('appPassword.encryptedSecret')
    .getMany();

  for (const row of rows) {
    try {
      if (safeEqual(decryptSecret(row.encryptedSecret), apiKey)) {
        remember(key, row.id);
        return { user: row.user, appPasswordId: row.id };
      }
    } catch (e) {
      logger.debug('Could not decrypt an app password', {
        label: 'Client API',
        appPasswordId: row.id,
        errorMessage: e.message,
      });
    }
  }
  return null;
};

const tokenMac = (appPasswordId: number, createdAt: Date | string): string =>
  createHmac('sha256', `shufflerr-jellyfin-token:${getSettings().serverSecret}`)
    .update(`${appPasswordId}:${new Date(createdAt).getTime()}`)
    .digest('hex')
    .slice(0, 48);

/**
 * Jellyfin access token for an app password: its id plus an HMAC over the row
 * (keyed with the server secret). Nothing is stored — the token dies with the
 * row when the app password is revoked.
 */
export const issueAccessToken = async (
  appPasswordId: number
): Promise<string> => {
  const row = await getRepository(AppPassword).findOneOrFail({
    where: { id: appPasswordId },
  });
  return (
    appPasswordId.toString(16).padStart(8, '0') +
    tokenMac(row.id, row.createdAt)
  );
};

export const signInWithAccessToken = async (
  token: string
): Promise<ClientIdentity | null> => {
  if (!token || !/^[0-9a-f]{56}$/i.test(token) || !getSettings().serverSecret) {
    return null;
  }
  const appPasswordId = parseInt(token.slice(0, 8), 16);
  const row = await getRepository(AppPassword).findOne({
    where: { id: appPasswordId },
  });
  if (!row?.user) {
    return null;
  }
  return safeEqual(
    tokenMac(row.id, row.createdAt),
    token.slice(8).toLowerCase()
  )
    ? { user: row.user, appPasswordId: row.id }
    : null;
};

/** "Last used" for the devices list; never blocks or fails a request. */
export const noteClientUse = (
  identity: ClientIdentity,
  client?: string | null
): void => {
  touchAppPassword(identity.appPasswordId, client).catch((e) =>
    logger.debug('Could not record app password use', {
      label: 'Client API',
      errorMessage: e.message,
    })
  );
};

export const usernameOf = (user: User): string => clientUsername(user);
