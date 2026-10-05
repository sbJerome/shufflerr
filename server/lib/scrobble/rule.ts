import type { ScrobbleRule } from '@server/lib/settings';

/** Tracks shorter than this never scrobble (Last.fm's rule, applied to every target). */
export const MIN_TRACK_SECONDS = 30;

/**
 * Does a play count as a scrobble?
 *  - `half-or-4min`: half the track or four minutes, whichever comes first (Last.fm standard)
 *  - `end`: the track finished (within the last few seconds)
 *  - `30s`: thirty seconds were heard
 * `playedSeconds` undefined means the source only reports completed plays
 * (a Plex "media.scrobble" webhook, a Subsonic `scrobble` call), so only the
 * minimum length is checked.
 */
export const shouldScrobble = (
  rule: ScrobbleRule,
  durationMs: number | null | undefined,
  playedSeconds: number | undefined
): boolean => {
  const duration =
    typeof durationMs === 'number' && durationMs > 0 ? durationMs / 1000 : null;

  if (duration !== null && duration < MIN_TRACK_SECONDS) {
    return false;
  }
  if (playedSeconds === undefined) {
    return true;
  }
  if (!Number.isFinite(playedSeconds) || playedSeconds < 0) {
    return false;
  }

  switch (rule) {
    case '30s':
      return playedSeconds >= 30;
    case 'end':
      // without a known length "finished" cannot be judged
      return duration !== null && playedSeconds >= duration - 5;
    case 'half-or-4min':
    default:
      return duration !== null
        ? playedSeconds >= Math.min(duration / 2, 240)
        : playedSeconds >= 240;
  }
};
