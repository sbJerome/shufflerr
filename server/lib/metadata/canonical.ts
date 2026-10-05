import type { MbRelease } from '@server/api/musicbrainz/interfaces';

const WORLDWIDE = new Set(['XW', 'XE']);

export const releaseTrackCount = (release: MbRelease): number =>
  release['track-count'] ??
  (release.media ?? []).reduce((n, m) => n + (m['track-count'] ?? 0), 0);

const isDigital = (release: MbRelease): boolean =>
  (release.media ?? []).length > 0 &&
  (release.media ?? []).every((m) => (m.format ?? '') === 'Digital Media');

/** Sortable date: missing parts sort last within their year/month, no date sorts last overall. */
const dateKey = (date?: string): string => {
  if (!date) {
    return '9999-99-99';
  }
  const [y, m = '99', d = '99'] = date.split('-');
  return `${y}-${m}-${d}`;
};

export interface CanonicalOptions {
  /** A release to use when it belongs to this release group (e.g. the one Lidarr has). */
  preferReleaseMbid?: string | null;
  /** Home country to prefer when several countries tie (settings.main.discoverRegion). */
  preferCountry?: string | null;
}

/**
 * Pick the release (edition) whose tracklist represents a release group.
 * Order (docs/INTEGRATIONS.md §MusicBrainz): the preferred release when given →
 * official releases only → earliest → digital → most common country
 * (worldwide, then the home country, then the country most editions share) →
 * most tracks. Deterministic: the MBID breaks any remaining tie.
 */
export const pickCanonicalRelease = (
  releases: MbRelease[] | undefined,
  options: CanonicalOptions = {}
): MbRelease | null => {
  if (!releases?.length) {
    return null;
  }

  if (options.preferReleaseMbid) {
    const preferred = releases.find((r) => r.id === options.preferReleaseMbid);
    if (preferred) {
      return preferred;
    }
  }

  const official = releases.filter((r) => r.status === 'Official');
  const pool = official.length > 0 ? official : releases;

  const countryCount = new Map<string, number>();
  for (const r of pool) {
    if (r.country) {
      countryCount.set(r.country, (countryCount.get(r.country) ?? 0) + 1);
    }
  }
  const countryRank = (r: MbRelease): number => {
    if (!r.country) {
      return 0;
    }
    if (WORLDWIDE.has(r.country)) {
      return 1000;
    }
    if (options.preferCountry && r.country === options.preferCountry) {
      return 900;
    }
    return countryCount.get(r.country) ?? 0;
  };

  const sorted = [...pool].sort((a, b) => {
    const byDate = dateKey(a.date).localeCompare(dateKey(b.date));
    if (byDate !== 0) {
      return byDate;
    }
    const byDigital = Number(isDigital(b)) - Number(isDigital(a));
    if (byDigital !== 0) {
      return byDigital;
    }
    const byCountry = countryRank(b) - countryRank(a);
    if (byCountry !== 0) {
      return byCountry;
    }
    const byTracks = releaseTrackCount(b) - releaseTrackCount(a);
    if (byTracks !== 0) {
      return byTracks;
    }
    return a.id.localeCompare(b.id);
  });

  return sorted[0];
};
