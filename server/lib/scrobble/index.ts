import { getRepository } from '@server/datasource';
import type {
  ScrobbleSource,
  ScrobbleTargets,
} from '@server/entity/ScrobbleQueue';
import ScrobbleQueue from '@server/entity/ScrobbleQueue';
import Track from '@server/entity/Track';
import type { User } from '@server/entity/User';
import { getLinked, getLinkedProviders } from '@server/lib/scrobble/linked';
import { shouldScrobble } from '@server/lib/scrobble/rule';
import type { Listen } from '@server/lib/scrobble/targets';
import {
  lastfmNowPlaying,
  lastfmScrobble,
  listenBrainzNowPlaying,
  listenBrainzScrobble,
  ScrobbleAuthError,
} from '@server/lib/scrobble/targets';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Between, Like } from 'typeorm';

export type ScrobbleTarget = 'listenbrainz' | 'lastfm';

export interface PlayEvent {
  user: User;
  source: ScrobbleSource;
  /** Track row id when known */
  trackId?: number;
  recordingMbid?: string;
  releaseGroupMbid?: string;
  artist: string;
  track: string;
  album?: string;
  durationMs?: number;
  /** When playback started */
  startedAt: Date;
  /** Seconds listened; the scrobble rule decides whether it counts. */
  playedSeconds?: number;
}

/** Give up on a play after this many failed submissions. */
export const MAX_ATTEMPTS = 8;
/** Rows handled per run of the queue job. */
const QUEUE_BATCH = 500;
/** Plays closer together than this are the same play when the length is unknown. */
const MIN_DEDUPE_WINDOW_MS = 30_000;

/** Retry delay after `attempts` failures: 1 min, 2, 4 … capped at 6 hours. */
export const backoffMs = (attempts: number): number =>
  Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60 * 1000);

const nextAttemptAt = new Map<number, number>();

/** Fill the gaps of an event from the Track row it points at. */
const enrich = async (event: PlayEvent): Promise<PlayEvent> => {
  if (!event.trackId) {
    return event;
  }
  const track = await getRepository(Track).findOne({
    where: { id: event.trackId },
    relations: { media: true },
  });
  if (!track) {
    return event;
  }
  return {
    ...event,
    artist: event.artist || track.artistCredit || track.media?.artistName || '',
    track: event.track || track.title,
    album: event.album || track.media?.title || undefined,
    durationMs: event.durationMs ?? track.lengthMs ?? undefined,
    recordingMbid: event.recordingMbid ?? track.recordingMbid ?? undefined,
    releaseGroupMbid: event.releaseGroupMbid ?? track.media?.mbid ?? undefined,
  };
};

const toListen = (event: PlayEvent): Listen => ({
  artist: event.artist,
  track: event.track,
  album: event.album,
  recordingMbid: event.recordingMbid,
  releaseGroupMbid: event.releaseGroupMbid,
  durationMs: event.durationMs,
  playedAt: event.startedAt,
  source: event.source,
});

/**
 * Where a user's plays go: a target counts when it is switched on server-side,
 * the user linked the account, and they did not turn scrobbling off.
 */
export const getUserTargets = async (user: User): Promise<ScrobbleTarget[]> => {
  const settings = getSettings();
  if (user.settings && user.settings.scrobbleEnabled === false) {
    return [];
  }
  const serverTargets: ScrobbleTarget[] = [];
  if (settings.scrobble.listenbrainz.enabled) {
    serverTargets.push('listenbrainz');
  }
  if (settings.integrations.lastfmScrobble) {
    serverTargets.push('lastfm');
  }
  if (!serverTargets.length) {
    return [];
  }
  const linked = await getLinkedProviders(user.id);
  return serverTargets.filter((t) => linked.has(t));
};

const sameTrack = (row: ScrobbleQueue, event: PlayEvent): boolean => {
  if (row.trackId && event.trackId) {
    return row.trackId === event.trackId;
  }
  if (row.recordingMbid && event.recordingMbid) {
    return row.recordingMbid === event.recordingMbid;
  }
  const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();
  return (
    norm(row.track) === norm(event.track) &&
    norm(row.artist) === norm(event.artist)
  );
};

/**
 * Is this play already recorded? The same user cannot play the same track
 * twice within its own length, so a second report inside that window is the
 * same play seen through another source (the web player and a Plex webhook,
 * or a media server that also scrobbles by itself and reports back).
 */
const isDuplicate = async (event: PlayEvent): Promise<boolean> => {
  const window = Math.max(event.durationMs ?? 0, MIN_DEDUPE_WINDOW_MS);
  const at = event.startedAt.getTime();
  const near = await getRepository(ScrobbleQueue).find({
    where: {
      user: { id: event.user.id },
      playedAt: Between(new Date(at - window), new Date(at + window)),
    },
  });
  return near.some((row) => sameTrack(row, event));
};

/** "Now playing" to the user's linked targets (no queue row). */
export const nowPlaying = async (raw: PlayEvent): Promise<void> => {
  try {
    if (!getSettings().scrobble.sources[raw.source]) {
      return;
    }
    const targets = await getUserTargets(raw.user);
    if (!targets.length) {
      return;
    }
    const event = await enrich(raw);
    if (!event.artist || !event.track) {
      return;
    }
    const listen = toListen(event);
    await Promise.all(
      targets.map(async (target) => {
        try {
          const linked = await getLinked(event.user.id, target);
          if (!linked) {
            return;
          }
          if (target === 'listenbrainz') {
            await listenBrainzNowPlaying(linked.secret, listen);
          } else {
            await lastfmNowPlaying(linked.secret, listen);
          }
        } catch (e) {
          logger.debug('Could not send now playing', {
            label: 'Scrobbler',
            target,
            userId: event.user.id,
            errorMessage: e.message,
          });
        }
      })
    );
  } catch (e) {
    logger.debug('Now playing failed', {
      label: 'Scrobbler',
      errorMessage: e.message,
    });
  }
};

/**
 * Record a finished play: applies settings.scrobble.rule and the per-source
 * switches, de-duplicates (same user + track within the play duration), writes
 * a ScrobbleQueue row. Returns the targets it was queued for.
 *
 * The row is written even when the user has no scrobble target, because the
 * same table is the play history behind "Recently played".
 */
export const recordPlay = async (
  raw: PlayEvent
): Promise<ScrobbleTarget[]> => {
  const settings = getSettings();
  if (!settings.scrobble.sources[raw.source]) {
    return [];
  }
  const event = await enrich(raw);
  if (!event.artist || !event.track) {
    return [];
  }
  if (
    !shouldScrobble(settings.scrobble.rule, event.durationMs, event.playedSeconds)
  ) {
    return [];
  }
  if (await isDuplicate(event)) {
    return [];
  }

  const targets = await getUserTargets(event.user);
  const targetState: ScrobbleTargets = {};
  targets.forEach((t) => {
    targetState[t] = 'pending';
  });

  await getRepository(ScrobbleQueue).save(
    new ScrobbleQueue({
      user: event.user,
      trackId: event.trackId ?? null,
      recordingMbid: event.recordingMbid ?? null,
      releaseGroupMbid: event.releaseGroupMbid ?? null,
      artist: event.artist,
      track: event.track,
      album: event.album ?? null,
      durationMs: event.durationMs ?? null,
      playedAt: event.startedAt,
      source: event.source,
      targets: targetState,
      attempts: 0,
    })
  );
  return targets;
};

const rowToListen = (row: ScrobbleQueue): Listen => ({
  artist: row.artist,
  track: row.track,
  album: row.album,
  recordingMbid: row.recordingMbid,
  releaseGroupMbid: row.releaseGroupMbid,
  durationMs: row.durationMs,
  playedAt: new Date(row.playedAt),
  source: row.source,
});

let queueRunning = false;

/** `scrobble-queue` job: submit pending rows with retry/backoff. */
export const processScrobbleQueue = async (): Promise<void> => {
  if (queueRunning) {
    return;
  }
  queueRunning = true;
  try {
    const repository = getRepository(ScrobbleQueue);
    const rows = await repository.find({
      where: { targets: Like('%"pending"%') as never },
      relations: { user: true },
      order: { playedAt: 'ASC' },
      take: QUEUE_BATCH,
    });
    if (!rows.length) {
      return;
    }
    const now = Date.now();
    const due = rows.filter((r) => (nextAttemptAt.get(r.id) ?? 0) <= now);
    const settings = getSettings();

    const byUser = new Map<number, ScrobbleQueue[]>();
    for (const row of due) {
      if (!row.user) {
        continue;
      }
      byUser.set(row.user.id, [...(byUser.get(row.user.id) ?? []), row]);
    }

    for (const [userId, userRows] of byUser) {
      const failed = new Map<number, string>();

      for (const target of ['listenbrainz', 'lastfm'] as ScrobbleTarget[]) {
        const pending = userRows.filter((r) => r.targets?.[target] === 'pending');
        if (!pending.length) {
          continue;
        }
        const serverOn =
          target === 'listenbrainz'
            ? settings.scrobble.listenbrainz.enabled
            : settings.integrations.lastfmScrobble;
        const linked = serverOn ? await getLinked(userId, target) : null;
        if (!linked) {
          // switched off or unlinked since the play: nothing to send it to
          pending.forEach((r) => {
            r.targets = { ...r.targets, [target]: 'skipped' };
          });
          continue;
        }
        try {
          const listens = pending.map(rowToListen);
          if (target === 'listenbrainz') {
            await listenBrainzScrobble(linked.secret, listens);
          } else {
            await lastfmScrobble(linked.secret, listens);
          }
          pending.forEach((r) => {
            r.targets = { ...r.targets, [target]: 'sent' };
          });
        } catch (e) {
          const permanent = e instanceof ScrobbleAuthError;
          pending.forEach((r) => {
            failed.set(r.id, e.message);
            if (permanent || r.attempts + 1 >= MAX_ATTEMPTS) {
              r.targets = { ...r.targets, [target]: 'failed' };
            }
          });
          logger.warn('Scrobble submission failed', {
            label: 'Scrobbler',
            target,
            userId,
            plays: pending.length,
            willRetry: !permanent,
            errorMessage: e.message,
          });
        }
      }

      for (const row of userRows) {
        const error = failed.get(row.id);
        if (error) {
          row.attempts += 1;
          row.lastError = error.slice(0, 250);
          nextAttemptAt.set(row.id, Date.now() + backoffMs(row.attempts));
        } else {
          row.lastError = null;
          nextAttemptAt.delete(row.id);
        }
      }
      await repository.save(userRows);
    }
  } catch (e) {
    logger.error('Scrobble queue run failed', {
      label: 'Scrobbler',
      errorMessage: e.message,
    });
  } finally {
    queueRunning = false;
  }
};

/** Test hook: forget retry timers. */
export const resetScrobbleBackoff = (): void => nextAttemptAt.clear();
