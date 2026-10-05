/* eslint-disable @typescript-eslint/no-unused-vars -- stub signatures; remove when implemented */
// STREAM(SV6): implement — scrobble pipeline (docs/INTEGRATIONS.md §Scrobble to).
import type { ScrobbleSource } from '@server/entity/ScrobbleQueue';
import type { User } from '@server/entity/User';

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

/** "Now playing" to the user's linked targets (no queue row). */
export const nowPlaying = async (_event: PlayEvent): Promise<void> => undefined;

/**
 * Record a finished play: applies settings.scrobble.rule and the per-source
 * switches, de-duplicates (same user + track within the play duration), writes
 * a ScrobbleQueue row. Returns the targets it was queued for.
 */
export const recordPlay = async (
  _event: PlayEvent
): Promise<('listenbrainz' | 'lastfm')[]> => [];

/** `scrobble-queue` job: submit pending rows with retry/backoff. */
export const processScrobbleQueue = async (): Promise<void> => undefined;
