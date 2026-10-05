import { getRepository } from '@server/datasource';
import Track from '@server/entity/Track';
import { User } from '@server/entity/User';
import type { PlayEvent } from '@server/lib/scrobble';
import type { Request } from 'express';

/** Largest webhook body read into memory (Plex attaches a thumbnail to some events). */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const MBID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ---- multipart (Plex) ---------------------------------------------------------

const readBody = (req: Request): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Webhook body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

/** The text of one named field in a multipart/form-data body, or null. */
export const multipartField = (
  body: Buffer,
  contentType: string,
  field: string
): string | null => {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    return null;
  }
  const delimiter = Buffer.from(`--${boundaryMatch[1] ?? boundaryMatch[2]}`);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) {
      break;
    }
    const part = body.subarray(start + delimiter.length, next);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString('utf8');
      if (new RegExp(`name="${field}"`, 'i').test(headers)) {
        let content = part.subarray(headerEnd + 4);
        if (content.subarray(-2).toString() === '\r\n') {
          content = content.subarray(0, -2);
        }
        return content.toString('utf8');
      }
    }
    start = next;
  }
  return null;
};

/** The JSON `payload` field of a Plex webhook (multipart), or the JSON body itself. */
export const readPlexPayload = async (
  req: Request
): Promise<PlexWebhookPayload | null> => {
  const contentType = req.headers['content-type'] ?? '';
  try {
    if (/multipart\/form-data/i.test(contentType)) {
      const text = multipartField(await readBody(req), contentType, 'payload');
      return text ? JSON.parse(text) : null;
    }
    if (typeof req.body?.payload === 'string') {
      return JSON.parse(req.body.payload);
    }
    if (req.body && typeof req.body === 'object' && req.body.event) {
      return req.body;
    }
  } catch {
    return null;
  }
  return null;
};

/** Jellyfin's Webhook plugin posts JSON, as text/plain unless its header is configured. */
export const readJellyfinPayload = async (
  req: Request
): Promise<JellyfinWebhookPayload | null> => {
  try {
    if (typeof req.body === 'string') {
      return JSON.parse(req.body);
    }
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
      return req.body;
    }
    if (req.readableEnded) {
      return null;
    }
    const raw = await readBody(req);
    return raw.length ? JSON.parse(raw.toString('utf8')) : null;
  } catch {
    return null;
  }
};

// ---- shapes ---------------------------------------------------------------------

export interface PlexWebhookPayload {
  event?: string;
  Account?: { id?: number; title?: string };
  Metadata?: {
    type?: string;
    title?: string;
    grandparentTitle?: string;
    originalTitle?: string;
    parentTitle?: string;
    duration?: number;
    viewOffset?: number;
    guid?: string;
    Guid?: { id?: string }[];
  };
}

/** Jellyfin Webhook plugin, "Generic" destination with the default fields. */
export interface JellyfinWebhookPayload {
  NotificationType?: string;
  ItemType?: string;
  Name?: string;
  Artist?: string;
  Album?: string;
  RunTimeTicks?: number;
  PlaybackPositionTicks?: number;
  PlayedToCompletion?: boolean;
  UserId?: string;
  NotificationUsername?: string;
  Provider_musicbrainztrack?: string;
  Provider_musicbrainzrecording?: string;
  Provider_musicbrainzreleasegroup?: string;
}

export interface WebhookPlay {
  kind: 'now-playing' | 'played';
  event: PlayEvent;
}

// ---- users ----------------------------------------------------------------------

const lower = (s?: string | null) => (s ?? '').trim().toLowerCase();

/**
 * The Shufflerr user behind a Plex webhook account. Plex sends the server-local
 * account id (1 = the server owner) and the account name, not the plex.tv id.
 */
export const findPlexUser = async (
  account?: PlexWebhookPayload['Account']
): Promise<User | null> => {
  const repository = getRepository(User);
  const title = lower(account?.title);
  if (title) {
    const user = await repository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.settings', 'settings')
      .where('LOWER(user.plexUsername) = :title', { title })
      .orWhere('LOWER(user.email) = :title', { title })
      .getOne();
    if (user) {
      return user;
    }
  }
  if (account?.id === 1) {
    const owner = await repository.findOne({ where: { id: 1 } });
    if (owner?.plexId) {
      return owner;
    }
  }
  return null;
};

export const findJellyfinUser = async (
  userId?: string,
  username?: string
): Promise<User | null> => {
  const repository = getRepository(User);
  const id = (userId ?? '').replace(/-/g, '').toLowerCase();
  if (id) {
    const user = await repository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.settings', 'settings')
      .where("LOWER(REPLACE(user.jellyfinUserId, '-', '')) = :id", { id })
      .getOne();
    if (user) {
      return user;
    }
  }
  const name = lower(username);
  if (name) {
    return repository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.settings', 'settings')
      .where('LOWER(user.jellyfinUsername) = :name', { name })
      .getOne();
  }
  return null;
};

// ---- tracks ---------------------------------------------------------------------

/** The library Track a media-server play refers to: by recording MBID, else by names. */
export const findLibraryTrack = async ({
  recordingMbid,
  title,
  artist,
  album,
}: {
  recordingMbid?: string;
  title?: string;
  artist?: string;
  album?: string;
}): Promise<Track | null> => {
  const repository = getRepository(Track);
  if (recordingMbid) {
    const byMbid = await repository.findOne({
      where: { recordingMbid },
      relations: { media: true },
    });
    if (byMbid) {
      return byMbid;
    }
  }
  if (!title || !artist) {
    return null;
  }
  const query = repository
    .createQueryBuilder('track')
    .leftJoinAndSelect('track.media', 'media')
    .where('LOWER(track.title) = :title', { title: lower(title) })
    .andWhere(
      '(LOWER(media.artistName) = :artist OR LOWER(track.artistCredit) = :artist)',
      { artist: lower(artist) }
    );
  if (album) {
    query.andWhere('LOWER(media.title) = :album', { album: lower(album) });
  }
  return query.getOne();
};

// ---- mapping ----------------------------------------------------------------------

/** Plex `media.play` / `media.resume` → now playing; `media.scrobble` (90 % heard) → a play. */
export const plexPayloadToPlay = async (
  payload: PlexWebhookPayload,
  now = new Date()
): Promise<WebhookPlay | null> => {
  const meta = payload.Metadata;
  if (!meta || meta.type !== 'track' || !meta.title) {
    return null;
  }
  const kind =
    payload.event === 'media.scrobble'
      ? 'played'
      : payload.event === 'media.play' || payload.event === 'media.resume'
        ? 'now-playing'
        : null;
  if (!kind) {
    return null;
  }
  const user = await findPlexUser(payload.Account);
  if (!user) {
    return null;
  }

  const artist = meta.originalTitle || meta.grandparentTitle || '';
  const mbid = [meta.guid, ...(meta.Guid ?? []).map((g) => g.id)]
    .filter((g): g is string => !!g && /^mbid:\/\//i.test(g))
    .map((g) => g.match(MBID)?.[0])
    .find(Boolean);
  const track = await findLibraryTrack({
    recordingMbid: mbid,
    title: meta.title,
    artist: meta.grandparentTitle || artist,
    album: meta.parentTitle,
  });
  const durationMs = meta.duration ?? track?.lengthMs ?? undefined;
  // media.scrobble fires at 90 % of the track: work back to when it started
  const startedAt =
    kind === 'played' && durationMs
      ? new Date(now.getTime() - Math.round(durationMs * 0.9))
      : new Date(now.getTime() - (meta.viewOffset ?? 0));

  return {
    kind,
    event: {
      user,
      source: 'plex',
      trackId: track?.id,
      recordingMbid: track?.recordingMbid ?? undefined,
      releaseGroupMbid: track?.media?.mbid ?? undefined,
      artist,
      track: meta.title,
      album: meta.parentTitle,
      durationMs,
      startedAt,
      // Plex only reports completed plays here; the minimum-length rule still applies
      playedSeconds: undefined,
    },
  };
};

/** Jellyfin PlaybackStart → now playing; PlaybackStop → a play (the rule judges how much was heard). */
export const jellyfinPayloadToPlay = async (
  payload: JellyfinWebhookPayload,
  now = new Date()
): Promise<WebhookPlay | null> => {
  if (payload.ItemType !== 'Audio' || !payload.Name) {
    return null;
  }
  const kind =
    payload.NotificationType === 'PlaybackStop'
      ? 'played'
      : payload.NotificationType === 'PlaybackStart'
        ? 'now-playing'
        : null;
  if (!kind) {
    return null;
  }
  const user = await findJellyfinUser(
    payload.UserId,
    payload.NotificationUsername
  );
  if (!user) {
    return null;
  }

  const recordingMbid = (
    payload.Provider_musicbrainzrecording ?? payload.Provider_musicbrainztrack
  )?.match(MBID)?.[0];
  const track = await findLibraryTrack({
    recordingMbid,
    title: payload.Name,
    artist: payload.Artist,
    album: payload.Album,
  });
  const durationMs = payload.RunTimeTicks
    ? Math.round(payload.RunTimeTicks / 10_000)
    : (track?.lengthMs ?? undefined);
  const playedSeconds =
    typeof payload.PlaybackPositionTicks === 'number'
      ? payload.PlaybackPositionTicks / 10_000_000
      : undefined;

  return {
    kind,
    event: {
      user,
      source: 'jellyfin',
      trackId: track?.id,
      recordingMbid: track?.recordingMbid ?? recordingMbid,
      releaseGroupMbid:
        track?.media?.mbid ??
        payload.Provider_musicbrainzreleasegroup?.match(MBID)?.[0],
      artist: payload.Artist ?? '',
      track: payload.Name,
      album: payload.Album,
      durationMs,
      startedAt: new Date(now.getTime() - (playedSeconds ?? 0) * 1000),
      playedSeconds: payload.PlayedToCompletion ? undefined : playedSeconds,
    },
  };
};
