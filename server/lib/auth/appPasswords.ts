import { hash, verify } from '@node-rs/argon2';
import { getRepository } from '@server/datasource';
import AppPassword from '@server/entity/AppPassword';
import { User } from '@server/entity/User';
import type { AppPasswordItem } from '@server/interfaces/api/userSettingsInterfaces';
import {
  decryptSecret,
  encryptSecret,
  generateAppPassword,
} from '@server/lib/secrets';
import logger from '@server/logger';

/**
 * App passwords for OpenSubsonic / Jellyfin-compatible clients (docs/AUTH.md).
 *
 * Each password is stored twice:
 * - `hash` (argon2id) verifies plain `p=` / apiKey / AuthenticateByName sign-ins;
 * - `encryptedSecret` (AES-256-GCM with the server secret) exists only because
 *   Subsonic token auth (`t = md5(password + salt)`) needs the plaintext on the
 *   server. Anyone with settings.json AND the database can recover app
 *   passwords; they can't recover account passwords, and an app password only
 *   opens the client APIs.
 */

export interface VerifiedAppPassword {
  user: User;
  appPassword: AppPassword;
}

export interface AppPasswordSecret {
  user: User;
  appPasswordId: number;
  secret: string;
}

/** The name people type into a music app: display name without the email fallback when possible. */
export const clientUsername = (user: User): string =>
  user.username || user.plexUsername || user.jellyfinUsername || user.email;

export const toAppPasswordItem = (row: AppPassword): AppPasswordItem => ({
  id: row.id,
  name: row.name,
  createdAt: new Date(row.createdAt).toISOString(),
  lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
  lastUsedClient: row.lastUsedClient ?? null,
});

/** Users whose client username (or email) matches, case-insensitively. */
export const findUsersByClientUsername = async (
  username: string
): Promise<User[]> => {
  const name = (username ?? '').trim().toLowerCase();
  if (!name) {
    return [];
  }

  const candidates = await getRepository(User)
    .createQueryBuilder('user')
    .where('LOWER(user.username) = :name', { name })
    .orWhere('LOWER(user.plexUsername) = :name', { name })
    .orWhere('LOWER(user.jellyfinUsername) = :name', { name })
    .orWhere('user.email = :name', { name })
    .getMany();

  // Prefer the account whose sign-in name is exactly this one; an email or a
  // shadowed media-server name still works when nobody else claims it.
  const exact = candidates.filter(
    (u) => clientUsername(u).toLowerCase() === name
  );
  return exact.length ? exact : candidates;
};

export const listAppPasswords = async (
  userId: number
): Promise<AppPasswordItem[]> => {
  const rows = await getRepository(AppPassword).find({
    where: { user: { id: userId } },
    order: { createdAt: 'DESC', id: 'DESC' },
  });
  return rows.map(toAppPasswordItem);
};

/** Creates an app password. The plaintext is returned once and never stored. */
export const createAppPassword = async (
  user: User,
  name: string
): Promise<{ item: AppPasswordItem; password: string }> => {
  const password = generateAppPassword();
  const repository = getRepository(AppPassword);

  const row = await repository.save(
    new AppPassword({
      user,
      name: name.trim(),
      hash: await hash(password),
      encryptedSecret: encryptSecret(password),
      createdAt: new Date(),
    })
  );

  return { item: toAppPasswordItem(row), password };
};

/** Revoke = delete. Returns false when the row doesn't belong to the user. */
export const revokeAppPassword = async (
  userId: number,
  appPasswordId: number
): Promise<boolean> => {
  const repository = getRepository(AppPassword);
  const row = await repository.findOne({
    where: { id: appPasswordId, user: { id: userId } },
  });
  if (!row) {
    return false;
  }
  await repository.remove(row);
  return true;
};

const rowsWithSecrets = async (userIds: number[]): Promise<AppPassword[]> => {
  if (!userIds.length) {
    return [];
  }
  return getRepository(AppPassword)
    .createQueryBuilder('appPassword')
    .leftJoinAndSelect('appPassword.user', 'user')
    .addSelect(['appPassword.hash', 'appPassword.encryptedSecret'])
    .where('user.id IN (:...userIds)', { userIds })
    .getMany();
};

/**
 * Checks a username + plaintext app password (Subsonic `p=`, apiKey-style
 * sign-in, Jellyfin AuthenticateByName). Null when nothing matches.
 */
export const verifyAppPassword = async (
  username: string,
  password: string
): Promise<VerifiedAppPassword | null> => {
  if (!username || !password) {
    return null;
  }

  const users = await findUsersByClientUsername(username);
  const rows = await rowsWithSecrets(users.map((u) => u.id));

  for (const row of rows) {
    try {
      if (await verify(row.hash, password)) {
        return { user: row.user, appPassword: row };
      }
    } catch (e) {
      logger.debug('Could not verify an app password hash', {
        label: 'Auth',
        appPasswordId: row.id,
        errorMessage: e.message,
      });
    }
  }

  return null;
};

/**
 * Decrypted app passwords for a username, for Subsonic token auth: the caller
 * compares `md5(secret + salt)` with the client's `t`.
 */
export const getAppPasswordSecrets = async (
  username: string
): Promise<AppPasswordSecret[]> => {
  const users = await findUsersByClientUsername(username);
  const rows = await rowsWithSecrets(users.map((u) => u.id));

  return rows.flatMap((row) => {
    try {
      return [
        {
          user: row.user,
          appPasswordId: row.id,
          secret: decryptSecret(row.encryptedSecret),
        },
      ];
    } catch (e) {
      logger.warn('Could not decrypt an app password', {
        label: 'Auth',
        appPasswordId: row.id,
        errorMessage: e.message,
      });
      return [];
    }
  });
};

/** Records "last used" for the devices list. Writes at most once a minute per row. */
export const touchAppPassword = async (
  appPasswordId: number,
  client?: string | null
): Promise<void> => {
  const repository = getRepository(AppPassword);
  const row = await repository.findOne({ where: { id: appPasswordId } });
  if (!row) {
    return;
  }

  const clientName = client?.trim().slice(0, 120) || row.lastUsedClient || null;
  const recent =
    row.lastUsedAt &&
    Date.now() - new Date(row.lastUsedAt).getTime() < 60 * 1000;
  if (recent && clientName === (row.lastUsedClient ?? null)) {
    return;
  }

  await repository.update(row.id, {
    lastUsedAt: new Date(),
    lastUsedClient: clientName,
  });
};
