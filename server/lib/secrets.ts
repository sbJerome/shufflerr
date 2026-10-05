import { getSettings } from '@server/lib/settings';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

/**
 * Encryption at rest for LinkedAccount.secret and AppPassword.encryptedSecret.
 * AES-256-GCM with a key derived (HKDF-SHA256) from settings.serverSecret.
 * Format: `v1:<iv b64>:<tag b64>:<ciphertext b64>`.
 */
const VERSION = 'v1';
let cachedKey: { secret: string; key: Buffer } | undefined;

const getKey = (): Buffer => {
  const secret = getSettings().serverSecret;
  if (!secret) {
    throw new Error('Server secret is not initialised yet.');
  }
  if (!cachedKey || cachedKey.secret !== secret) {
    cachedKey = {
      secret,
      key: Buffer.from(
        hkdfSync('sha256', secret, 'shufflerr', 'secrets-at-rest', 32)
      ),
    };
  }
  return cachedKey.key;
};

export const encryptSecret = (plaintext: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    data.toString('base64'),
  ].join(':');
};

export const decryptSecret = (payload: string): string => {
  const [version, iv, tag, data] = payload.split(':');
  if (version !== VERSION || !iv || !tag || data === undefined) {
    throw new Error('Unrecognised secret format.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    getKey(),
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};

/** Constant-time string comparison (hashes both sides so lengths don't leak). */
export const safeEqual = (a: string, b: string): boolean =>
  timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest()
  );

/** App password in the documented `xxxxxx-xxxxxx-xxxxxx` base36 shape. */
export const generateAppPassword = (): string => {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const group = () =>
    Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
  return `${group()}-${group()}-${group()}`;
};
