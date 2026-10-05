/** Small formatting helpers shared by every page. */

/** `203000` → `3:23`; `3723000` → `1:02:03`. */
export const formatDuration = (ms?: number | null): string => {
  if (ms == null || !isFinite(ms) || ms < 0) {
    return '–:––';
  }
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

/** Seconds → `1:12`. */
export const formatSeconds = (seconds?: number | null): string =>
  formatDuration(seconds == null ? seconds : seconds * 1000);

/** Up to two initials for avatar and artist fallbacks. */
export const initials = (name?: string | null): string => {
  const parts = (name ?? '')
    .trim()
    .split(/[\s._@-]+/)
    .filter(Boolean);
  if (!parts.length) {
    return '?';
  }
  const first = parts[0][0] ?? '';
  const second = parts.length > 1 ? (parts[1][0] ?? '') : (parts[0][1] ?? '');
  return (first + second).toUpperCase();
};

/** Album-art placeholder tints `[background, ink]` from docs/FRONTEND.md. */
export const TINTS: readonly (readonly [string, string])[] = [
  ['#2B3A35', '#7FE0D2'],
  ['#3A2E22', '#F5B83D'],
  ['#232A3A', '#9DB4FF'],
  ['#382328', '#F08C7A'],
  ['#2E3322', '#C8E07A'],
  ['#30263A', '#D2A6F5'],
  ['#1F2E2E', '#E6E8E3'],
  ['#3A3520', '#F2E3A0'],
];

/** Stable tint for an MBID (or any key): the same item always gets the same tint. */
export const tintFor = (
  key?: string | number | null
): readonly [string, string] => {
  const str = String(key ?? '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return TINTS[hash % TINTS.length];
};

/** `2026-03-14` → `2026`. */
export const releaseYear = (date?: string | null): string =>
  date ? date.slice(0, 4) : '';
