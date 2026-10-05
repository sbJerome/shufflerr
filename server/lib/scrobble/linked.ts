import { getRepository } from '@server/datasource';
import type { LinkedAccountProvider } from '@server/entity/LinkedAccount';
import LinkedAccount from '@server/entity/LinkedAccount';
import { decryptSecret, encryptSecret } from '@server/lib/secrets';
import logger from '@server/logger';

export interface LinkedSecret {
  id: number;
  externalUsername: string;
  /** Decrypted: Last.fm session key / ListenBrainz user token / Spotify refresh token. */
  secret: string;
  createdAt: Date;
}

/** A user's linked account with its decrypted secret, or null when not linked. */
export const getLinked = async (
  userId: number,
  provider: LinkedAccountProvider
): Promise<LinkedSecret | null> => {
  const account = await getRepository(LinkedAccount)
    .createQueryBuilder('linked')
    .addSelect('linked.secret')
    .where('linked.userId = :userId', { userId })
    .andWhere('linked.provider = :provider', { provider })
    .getOne();
  if (!account?.secret) {
    return null;
  }
  try {
    return {
      id: account.id,
      externalUsername: account.externalUsername,
      secret: decryptSecret(account.secret),
      createdAt: new Date(account.createdAt),
    };
  } catch (e) {
    logger.warn('A linked account secret could not be read. Link it again.', {
      label: 'Linked accounts',
      provider,
      userId,
      errorMessage: e.message,
    });
    return null;
  }
};

/** Which of the given providers a user has linked. */
export const getLinkedProviders = async (
  userId: number
): Promise<Map<LinkedAccountProvider, string>> => {
  const accounts = await getRepository(LinkedAccount)
    .createQueryBuilder('linked')
    .where('linked.userId = :userId', { userId })
    .getMany();
  return new Map(accounts.map((a) => [a.provider, a.externalUsername]));
};

/** Store a rotated secret (Spotify may hand out a new refresh token). */
export const saveLinkedSecret = async (
  id: number,
  secret: string
): Promise<void> => {
  await getRepository(LinkedAccount).update(id, {
    secret: encryptSecret(secret),
    lastUsedAt: new Date(),
  });
};

export const touchLinked = async (id: number): Promise<void> => {
  await getRepository(LinkedAccount).update(id, { lastUsedAt: new Date() });
};
