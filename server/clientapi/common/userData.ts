import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import Playlist from '@server/entity/Playlist';
import PlaylistItem from '@server/entity/PlaylistItem';
import ScrobbleQueue from '@server/entity/ScrobbleQueue';
import Star from '@server/entity/Star';
import Track from '@server/entity/Track';
import type { User } from '@server/entity/User';
import { nowPlaying, recordPlay } from '@server/lib/scrobble';
import logger from '@server/logger';
import type { LibTrack } from './library';

/** Per-user state the client APIs keep: stars, playlists, plays. */

export interface UserStars {
  tracks: Map<number, Date>;
  media: Map<number, Date>;
}

export const getStars = async (userId: number): Promise<UserStars> => {
  const rows = await getRepository(Star).find({
    where: { user: { id: userId } },
  });
  const stars: UserStars = { tracks: new Map(), media: new Map() };
  for (const row of rows) {
    if (row.track) {
      stars.tracks.set(row.track.id, new Date(row.createdAt));
    } else if (row.media) {
      stars.media.set(row.media.id, new Date(row.createdAt));
    }
  }
  return stars;
};

export type StarTarget = { trackId: number } | { mediaId: number };

export const setStar = async (
  user: User,
  target: StarTarget,
  starred: boolean
): Promise<void> => {
  const repository = getRepository(Star);
  const where =
    'trackId' in target
      ? { user: { id: user.id }, track: { id: target.trackId } }
      : { user: { id: user.id }, media: { id: target.mediaId } };
  const existing = await repository.find({ where });

  if (!starred) {
    if (existing.length) {
      await repository.remove(existing);
    }
    return;
  }
  if (existing.length) {
    return;
  }

  if ('trackId' in target) {
    const track = await getRepository(Track).findOne({
      where: { id: target.trackId },
    });
    if (track) {
      await repository.save(
        new Star({ user, track, media: null, createdAt: new Date() })
      );
    }
  } else {
    const media = await getRepository(Media).findOne({
      where: { id: target.mediaId },
    });
    if (media) {
      await repository.save(
        new Star({ user, media, track: null, createdAt: new Date() })
      );
    }
  }
};

/* ---------------------------------------------------------------- playlists */

export const listPlaylists = async (userId: number): Promise<Playlist[]> => {
  const rows = await getRepository(Playlist).find({
    relations: { items: true },
    order: { name: 'ASC' },
  });
  return rows
    .filter((p) => p.user?.id === userId || p.isPublic)
    .map(orderItems);
};

const orderItems = (playlist: Playlist): Playlist => {
  playlist.items = (playlist.items ?? []).sort(
    (a, b) => a.position - b.position || a.id - b.id
  );
  return playlist;
};

/** A playlist the user may read (own or public). */
export const getPlaylist = async (
  userId: number,
  playlistId: number
): Promise<Playlist | null> => {
  const row = await getRepository(Playlist).findOne({
    where: { id: playlistId },
    relations: { items: true },
  });
  if (!row || (row.user?.id !== userId && !row.isPublic)) {
    return null;
  }
  return orderItems(row);
};

export const createPlaylist = async (
  user: User,
  name: string,
  trackIds: number[],
  options: { comment?: string; isPublic?: boolean } = {}
): Promise<Playlist> => {
  const playlist = await getRepository(Playlist).save(
    new Playlist({
      user,
      name: name.trim() || 'Playlist',
      comment: options.comment ?? null,
      isPublic: options.isPublic ?? false,
      createdAt: new Date(),
    })
  );
  await appendPlaylistTracks(playlist.id, trackIds);
  return (await getPlaylist(user.id, playlist.id)) as Playlist;
};

const existingTrackIds = async (trackIds: number[]): Promise<Set<number>> => {
  if (!trackIds.length) {
    return new Set();
  }
  const rows = await getRepository(Track)
    .createQueryBuilder('track')
    .select('track.id')
    .whereInIds([...new Set(trackIds)])
    .getMany();
  return new Set(rows.map((r) => r.id));
};

export const appendPlaylistTracks = async (
  playlistId: number,
  trackIds: number[]
): Promise<void> => {
  if (!trackIds.length) {
    return;
  }
  const repository = getRepository(PlaylistItem);
  const known = await existingTrackIds(trackIds);
  const last = await repository
    .createQueryBuilder('item')
    .select('MAX(item.position)', 'max')
    .where('item.playlistId = :playlistId', { playlistId })
    .getRawOne<{ max: number | null }>();
  let position = (last?.max ?? -1) + 1;

  const items = trackIds
    .filter((id) => known.has(id))
    .map(
      (id) =>
        new PlaylistItem({
          playlist: { id: playlistId } as Playlist,
          track: { id } as Track,
          position: position++,
        })
    );
  if (items.length) {
    await repository.save(items);
  }
  await touchPlaylist(playlistId);
};

/** Replace the whole track list (Subsonic createPlaylist with playlistId, Jellyfin update). */
export const replacePlaylistTracks = async (
  playlistId: number,
  trackIds: number[]
): Promise<void> => {
  await getRepository(PlaylistItem)
    .createQueryBuilder()
    .delete()
    .where('playlistId = :playlistId', { playlistId })
    .execute();
  await appendPlaylistTracks(playlistId, trackIds);
};

/** Remove by index in the ordered list (Subsonic songIndexToRemove). */
export const removePlaylistIndexes = async (
  playlist: Playlist,
  indexes: number[]
): Promise<void> => {
  const wanted = new Set(indexes);
  const doomed = playlist.items.filter((_, i) => wanted.has(i));
  if (doomed.length) {
    await getRepository(PlaylistItem).remove(doomed);
    await touchPlaylist(playlist.id);
  }
};

/** Remove by PlaylistItem id (Jellyfin EntryIds). */
export const removePlaylistEntries = async (
  playlist: Playlist,
  entryIds: number[]
): Promise<void> => {
  const wanted = new Set(entryIds);
  const doomed = playlist.items.filter((item) => wanted.has(item.id));
  if (doomed.length) {
    await getRepository(PlaylistItem).remove(doomed);
    await touchPlaylist(playlist.id);
  }
};

export const updatePlaylistMeta = async (
  playlistId: number,
  changes: { name?: string; comment?: string; isPublic?: boolean }
): Promise<void> => {
  const update: Partial<Playlist> = {};
  if (changes.name !== undefined && changes.name.trim()) {
    update.name = changes.name.trim();
  }
  if (changes.comment !== undefined) {
    update.comment = changes.comment;
  }
  if (changes.isPublic !== undefined) {
    update.isPublic = changes.isPublic;
  }
  if (Object.keys(update).length) {
    await getRepository(Playlist).update(playlistId, update);
  }
};

const touchPlaylist = async (playlistId: number): Promise<void> => {
  await getRepository(Playlist).update(playlistId, { updatedAt: new Date() });
};

export const deletePlaylist = async (playlistId: number): Promise<void> => {
  await getRepository(Playlist).delete(playlistId);
};

/* -------------------------------------------------------------------- plays */

export interface PlayStats {
  count: number;
  lastPlayed: Date;
}

/** Play counts per Track id for one user, from the play history. */
export const getPlayStats = async (
  userId: number
): Promise<Map<number, PlayStats>> => {
  const rows = await getRepository(ScrobbleQueue)
    .createQueryBuilder('play')
    .select('play.trackId', 'trackId')
    .addSelect('COUNT(*)', 'count')
    .addSelect('MAX(play.playedAt)', 'lastPlayed')
    .where('play.userId = :userId', { userId })
    .andWhere('play.trackId IS NOT NULL')
    .groupBy('play.trackId')
    .getRawMany<{
      trackId: number;
      count: string;
      lastPlayed: string | Date;
    }>();

  return new Map(
    rows.map((r) => [
      Number(r.trackId),
      { count: Number(r.count), lastPlayed: rawDate(r.lastPlayed) },
    ])
  );
};

/**
 * Aggregates bypass TypeORM's column transformers: SQLite hands back its UTC
 * text form ("2026-06-02 10:00:00.000") with no zone, Postgres a Date.
 */
const rawDate = (value: string | Date): Date => {
  if (value instanceof Date) {
    return value;
  }
  const text = String(value).trim().replace(' ', 'T');
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`);
};

interface NowPlayingEntry {
  user: User;
  track: LibTrack;
  client: string;
  startedAt: Date;
  positionMs: number;
  updatedAt: number;
}

const NOW_PLAYING_TTL_MS = 10 * 60 * 1000;
const nowPlayingByClient = new Map<string, NowPlayingEntry>();

const clientKey = (userId: number, client: string): string =>
  `${userId}:${client}`;

export const getNowPlayingEntries = (): NowPlayingEntry[] => {
  const cutoff = Date.now() - NOW_PLAYING_TTL_MS;
  for (const [key, entry] of nowPlayingByClient) {
    if (entry.updatedAt < cutoff) {
      nowPlayingByClient.delete(key);
    }
  }
  return [...nowPlayingByClient.values()];
};

export const clearNowPlaying = (): void => nowPlayingByClient.clear();

const playEvent = (
  user: User,
  track: LibTrack,
  startedAt: Date,
  playedSeconds?: number
) => ({
  user,
  source: 'apps' as const,
  trackId: track.id,
  recordingMbid: track.recordingMbid,
  releaseGroupMbid: track.album.mbid,
  artist: track.artist,
  track: track.title,
  album: track.album.name,
  durationMs: track.durationMs || undefined,
  startedAt,
  playedSeconds,
});

/** A client started (or is still) playing a track. */
export const reportNowPlaying = async (
  user: User,
  track: LibTrack,
  client: string,
  positionMs = 0
): Promise<void> => {
  const key = clientKey(user.id, client);
  const previous = nowPlayingByClient.get(key);
  const sameTrack = previous?.track.id === track.id;

  nowPlayingByClient.set(key, {
    user,
    track,
    client,
    startedAt: sameTrack ? previous.startedAt : new Date(),
    positionMs,
    updatedAt: Date.now(),
  });

  if (sameTrack) {
    return;
  }
  try {
    await nowPlaying(playEvent(user, track, new Date()));
  } catch (e) {
    logger.debug('Could not send "now playing"', {
      label: 'Client API',
      errorMessage: e.message,
    });
  }
};

export const reportProgress = (
  user: User,
  track: LibTrack,
  client: string,
  positionMs: number
): void => {
  const key = clientKey(user.id, client);
  const previous = nowPlayingByClient.get(key);
  nowPlayingByClient.set(key, {
    user,
    track,
    client,
    startedAt:
      previous?.track.id === track.id ? previous.startedAt : new Date(),
    positionMs,
    updatedAt: Date.now(),
  });
};

/**
 * A client finished (or stopped) a track. The scrobble pipeline decides
 * whether the play counts (settings.scrobble.rule) and where it goes.
 */
export const reportPlayed = async (
  user: User,
  track: LibTrack,
  client: string,
  options: { playedAt?: Date; playedSeconds?: number } = {}
): Promise<void> => {
  const key = clientKey(user.id, client);
  const previous = nowPlayingByClient.get(key);
  if (previous?.track.id === track.id) {
    nowPlayingByClient.delete(key);
  }

  const playedSeconds =
    options.playedSeconds ??
    (track.durationMs ? Math.round(track.durationMs / 1000) : undefined);
  const startedAt =
    options.playedAt ??
    (previous?.track.id === track.id
      ? previous.startedAt
      : new Date(Date.now() - (playedSeconds ?? 0) * 1000));

  try {
    await recordPlay(playEvent(user, track, startedAt, playedSeconds));
  } catch (e) {
    logger.warn('Could not record a play from a music app', {
      label: 'Client API',
      errorMessage: e.message,
    });
  }
};
