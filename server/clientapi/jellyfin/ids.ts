import { getSettings } from '@server/lib/settings';
import { createHash } from 'crypto';

/**
 * Jellyfin clients expect 32-hex-digit item ids (GUIDs without dashes). Ids
 * here are deterministic and reversible: a 2-digit type tag followed by the
 * entity id (or, for artists that only exist as a name, the name hash).
 */
export type JellyfinId =
  | { kind: 'view' }
  | { kind: 'artist'; key: string }
  | { kind: 'album'; id: number }
  | { kind: 'track'; id: number }
  | { kind: 'playlist'; id: number }
  | { kind: 'user'; id: number };

const TAGS = {
  view: 'f0',
  artist: 'a0',
  artistName: 'a1',
  album: 'b0',
  track: 'c0',
  playlist: 'd0',
  user: 'e0',
} as const;

const numeric = (tag: string, id: number): string =>
  tag + id.toString(16).padStart(30, '0');

export const VIEW_ID = TAGS.view + '0'.repeat(29) + '1';

export const artistItemId = (key: string): string =>
  key.startsWith('m')
    ? numeric(TAGS.artist, Number(key.slice(1)))
    : TAGS.artistName + key.slice(1).padStart(30, '0');
export const albumItemId = (mediaId: number): string =>
  numeric(TAGS.album, mediaId);
export const trackItemId = (id: number): string => numeric(TAGS.track, id);
export const playlistItemId = (id: number): string =>
  numeric(TAGS.playlist, id);
export const userItemId = (id: number): string => numeric(TAGS.user, id);

export const parseItemId = (raw: unknown): JellyfinId | null => {
  if (typeof raw !== 'string') {
    return null;
  }
  const hex = raw.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    return null;
  }
  if (hex === VIEW_ID) {
    return { kind: 'view' };
  }
  const tag = hex.slice(0, 2);
  const rest = hex.slice(2);
  if (tag === TAGS.artistName) {
    return { kind: 'artist', key: 'x' + rest.slice(6) };
  }
  const id = parseInt(rest, 16);
  if (!Number.isSafeInteger(id)) {
    return null;
  }
  switch (tag) {
    case TAGS.artist:
      return { kind: 'artist', key: `m${id}` };
    case TAGS.album:
      return { kind: 'album', id };
    case TAGS.track:
      return { kind: 'track', id };
    case TAGS.playlist:
      return { kind: 'playlist', id };
    case TAGS.user:
      return { kind: 'user', id };
    default:
      return null;
  }
};

/** Stable per-installation server id. */
export const serverId = (): string =>
  createHash('sha256')
    .update(`shufflerr-jellyfin-server:${getSettings().clientId}`)
    .digest('hex')
    .slice(0, 32);
