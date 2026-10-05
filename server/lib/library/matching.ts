import type Track from '@server/entity/Track';
import {
  durationClose,
  normalizeLoose,
  normalizeLoosest,
  normalizeText,
} from './normalize';
import type { ScannedTrack } from './types';

type TrackLike = Pick<
  Track,
  'id' | 'recordingMbid' | 'title' | 'lengthMs' | 'discNumber' | 'trackNumber'
>;

const DURATION_TOLERANCE_MS = 3000;
/** Wider window used only when title AND disc/track number agree. */
const POSITION_TOLERANCE_MS = 10000;

const samePosition = (track: TrackLike, scanned: ScannedTrack): boolean =>
  !!scanned.trackNumber &&
  scanned.trackNumber === track.trackNumber &&
  (scanned.discNumber ?? 1) === (track.discNumber || 1);

/**
 * Match scanned tracks to the canonical tracklist. Order of evidence
 * (docs/INTEGRATIONS.md §Plex): recording MBID → normalised title + duration
 * (±3 s) → looser title (qualifiers dropped) + duration → title without a
 * trailing unbracketed guest credit, durations required. When title and
 * disc/track number both agree the duration window widens to ±10 s, because
 * editions of the same album differ slightly in track length.
 *
 * Every Track and every scanned track is used at most once.
 * Returns Track id → scanned track.
 */
export const matchTracks = <T extends TrackLike>(
  tracks: T[],
  scanned: ScannedTrack[]
): Map<number, ScannedTrack> => {
  const result = new Map<number, ScannedTrack>();
  const usedScanned = new Set<ScannedTrack>();

  const take = (track: T, candidate: ScannedTrack) => {
    result.set(track.id, candidate);
    usedScanned.add(candidate);
  };

  // 1. MusicBrainz ids
  for (const track of tracks) {
    if (!track.recordingMbid) {
      continue;
    }
    const mbid = track.recordingMbid.toLowerCase();
    const candidate = scanned.find(
      (s) =>
        !usedScanned.has(s) &&
        (s.recordingMbid?.toLowerCase() === mbid ||
          s.otherMbids?.some((o) => o.toLowerCase() === mbid))
    );
    if (candidate) {
      take(track, candidate);
    }
  }

  const byTitle = (
    normalize: (input: string) => string,
    requireDuration = false
  ) => {
    for (const track of tracks) {
      if (result.has(track.id)) {
        continue;
      }
      const title = normalize(track.title);
      if (!title) {
        continue;
      }
      if (requireDuration && !track.lengthMs) {
        continue;
      }
      const candidates = scanned.filter(
        (s) =>
          !usedScanned.has(s) &&
          normalize(s.title) === title &&
          (!requireDuration || !!s.durationMs)
      );
      if (candidates.length === 0) {
        continue;
      }
      const positioned = candidates.find(
        (s) =>
          samePosition(track, s) &&
          durationClose(track.lengthMs, s.durationMs, POSITION_TOLERANCE_MS)
      );
      const timed = candidates
        .filter((s) =>
          durationClose(track.lengthMs, s.durationMs, DURATION_TOLERANCE_MS)
        )
        // closest duration first so two versions of a song land on the right rows
        .sort(
          (a, b) =>
            Math.abs((a.durationMs ?? 0) - (track.lengthMs ?? 0)) -
            Math.abs((b.durationMs ?? 0) - (track.lengthMs ?? 0))
        )[0];
      const candidate = positioned ?? timed;
      if (candidate) {
        take(track, candidate);
      }
    }
  };

  // 2. exact normalised title, 3. loose title
  byTitle(normalizeText);
  byTitle(normalizeLoose);
  // 4. guest credit written into the title — only with both durations known
  byTitle(normalizeLoosest, true);

  return result;
};
