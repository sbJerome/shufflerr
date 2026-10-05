import type {
  MbArtistCredit,
  MbRelease,
  MbReleaseGroup,
} from '@server/api/musicbrainz';
import { getMusicBrainz } from '@server/api/musicbrainz';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import type { ImportMatch } from '@server/interfaces/api/importInterfaces';
import { PersistCache } from '@server/lib/import/persistCache';
import { coverUrlFor } from '@server/lib/metadata';
import logger from '@server/logger';
import type { AlbumResult } from '@server/models/music';
import { In } from 'typeorm';
import jaro from 'wink-jaro-distance';

/** One album as an import source describes it. */
export interface AlbumCandidate {
  /** `<source>:<album id>` — stable key for caches and the job. */
  key: string;
  sourceId: string;
  title: string;
  artist: string;
  upc?: string | null;
  /** ISRCs of some of its tracks (best effort). */
  isrcs?: string[];
  trackCount?: number | null;
  coverUrl?: string | null;
}

/** The slice of a MusicBrainz release group the importer keeps. */
export interface MatchedReleaseGroup {
  mbid: string;
  title: string;
  artistMbid: string;
  artistName: string;
  primaryType?: string;
  secondaryTypes?: string[];
  firstReleaseDate?: string;
}

export interface MatchOutcome {
  matchedBy: ImportMatch['matchedBy'];
  releaseGroup: MatchedReleaseGroup | null;
}

const TITLE_THRESHOLD = 0.9;
const ARTIST_THRESHOLD = 0.85;

/** Matches survive restarts so a daily sync does not ask MusicBrainz twice. */
const matchCache = new PersistCache<MatchOutcome>(
  'import-matches',
  30 * 24 * 60 * 60 * 1000
);
/** A miss is retried after a day (the album may have been added to MusicBrainz). */
const missCache = new PersistCache<true>('import-misses', 24 * 60 * 60 * 1000);

export const clearMatchCaches = (): void => {
  matchCache.clear();
  missCache.clear();
};

/** Lowercase, no accents, no punctuation — for comparing names. */
export const normalizeName = (value: string): string =>
  (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Drop the edition noise stores add to album titles: "(Deluxe Edition)",
 * "[2011 Remaster]", " - Single", " - EP".
 */
export const cleanAlbumTitle = (title: string): string => {
  const cleaned = (title ?? '')
    .replace(/\s+-\s+(single|ep)$/i, '')
    .replace(
      /\s*[([][^)\]]*\b(deluxe|expanded|remaster(ed)?|anniversary|edition|version|bonus|explicit|clean|reissue|special|collector'?s?|super|complete|extended)\b[^)\]]*[)\]]/gi,
      ''
    )
    .trim();
  return cleaned || title;
};

export const similarity = (a: string, b: string): number => {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) {
    return 0;
  }
  if (x === y) {
    return 1;
  }
  return jaro(x, y).similarity;
};

const titleScore = (candidate: string, found: string): number =>
  Math.max(
    similarity(candidate, found),
    similarity(cleanAlbumTitle(candidate), cleanAlbumTitle(found))
  );

const creditName = (credits?: MbArtistCredit[]): string =>
  (credits ?? []).map((c) => `${c.name}${c.joinphrase ?? ''}`).join('');

const artistScore = (candidate: string, credits?: MbArtistCredit[]): number => {
  if (!credits?.length) {
    return 0;
  }
  const names = [
    creditName(credits),
    ...credits.map((c) => c.name),
    ...credits.map((c) => c.artist?.name ?? ''),
  ];
  // "A, B & C" from the store vs. the first credited artist on MusicBrainz
  const firstCandidate = candidate.split(/,|&| feat\.? | x /i)[0];
  return Math.max(
    ...names.map((n) => similarity(candidate, n)),
    ...names.map((n) => similarity(firstCandidate, n))
  );
};

const toMatched = (
  rg: MbReleaseGroup,
  credits?: MbArtistCredit[],
  fallbackDate?: string
): MatchedReleaseGroup => {
  const credit = rg['artist-credit']?.length ? rg['artist-credit'] : credits;
  return {
    mbid: rg.id,
    title: rg.title,
    artistMbid: credit?.[0]?.artist?.id ?? '',
    artistName: creditName(credit) || credit?.[0]?.name || '',
    primaryType: rg['primary-type'] ?? undefined,
    secondaryTypes: rg['secondary-types'] ?? [],
    firstReleaseDate: rg['first-release-date'] || fallbackDate || undefined,
  };
};

const luceneQuote = (value: string): string =>
  `"${value.replace(/["\\]/g, ' ').trim()}"`;

/** UPC-A (12), EAN-13 and zero-stripped spellings of one barcode. */
export const barcodeVariants = (upc: string): string[] => {
  const digits = (upc ?? '').replace(/\D/g, '');
  if (digits.length < 8) {
    return [];
  }
  const bare = digits.replace(/^0+/, '');
  return [
    ...new Set([digits, bare, bare.padStart(12, '0'), bare.padStart(13, '0')]),
  ];
};

const releaseToMatch = (
  release: MbRelease,
  candidate: AlbumCandidate,
  requireTitle: boolean
): MatchedReleaseGroup | null => {
  const rg = release['release-group'];
  if (!rg?.id) {
    return null;
  }
  const withTitle: MbReleaseGroup = { ...rg, title: rg.title || release.title };
  if (
    requireTitle &&
    titleScore(candidate.title, withTitle.title) < TITLE_THRESHOLD &&
    titleScore(candidate.title, release.title) < TITLE_THRESHOLD
  ) {
    return null;
  }
  return toMatched(withTitle, release['artist-credit'], release.date);
};

const byBarcode = async (
  candidate: AlbumCandidate
): Promise<MatchedReleaseGroup | null> => {
  const variants = barcodeVariants(candidate.upc ?? '');
  if (!variants.length) {
    return null;
  }
  const data = await getMusicBrainz().searchReleasesRaw(
    `barcode:(${variants.join(' OR ')})`,
    { limit: 5 }
  );
  for (const release of data.releases ?? []) {
    // The barcode identifies the release exactly; no title check needed.
    const match = releaseToMatch(release, candidate, false);
    if (match) {
      return match;
    }
  }
  return null;
};

const byIsrc = async (
  candidate: AlbumCandidate
): Promise<MatchedReleaseGroup | null> => {
  // Two tracks are enough to find the album; each lookup costs a rate-limited call.
  for (const isrc of (candidate.isrcs ?? []).filter(Boolean).slice(0, 2)) {
    const data = await getMusicBrainz().searchRecordingsRaw(
      `isrc:${isrc.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`,
      { limit: 5 }
    );
    for (const recording of data.recordings ?? []) {
      for (const release of recording.releases ?? []) {
        // A recording sits on compilations too: the album title has to agree.
        const match = releaseToMatch(
          {
            ...release,
            'artist-credit':
              release['artist-credit'] ?? recording['artist-credit'],
          },
          candidate,
          true
        );
        if (match) {
          return match;
        }
      }
    }
  }
  return null;
};

const byName = async (
  candidate: AlbumCandidate
): Promise<MatchedReleaseGroup | null> => {
  const titles = [
    ...new Set([candidate.title, cleanAlbumTitle(candidate.title)]),
  ].filter(Boolean);
  for (const title of titles) {
    const data = await getMusicBrainz().searchReleaseGroupsRaw(
      `releasegroup:${luceneQuote(title)} AND artist:${luceneQuote(
        candidate.artist.split(/,| feat\.? /i)[0]
      )}`,
      { limit: 10 }
    );
    let best: { rg: MbReleaseGroup; score: number } | null = null;
    for (const rg of data['release-groups'] ?? []) {
      const t = titleScore(candidate.title, rg.title);
      const a = artistScore(candidate.artist, rg['artist-credit']);
      if (t < TITLE_THRESHOLD || a < ARTIST_THRESHOLD) {
        continue;
      }
      const score = t + a;
      if (!best || score > best.score) {
        best = { rg, score };
      }
    }
    if (best) {
      return toMatched(best.rg);
    }
  }
  return null;
};

/**
 * Match one store album to a MusicBrainz release group:
 * barcode (UPC) → ISRC of its tracks → artist + title.
 * Throws only when MusicBrainz itself could not be reached.
 */
export const matchAlbum = async (
  candidate: AlbumCandidate
): Promise<MatchOutcome> => {
  const cached = matchCache.get(candidate.key);
  if (cached) {
    return cached;
  }
  if (missCache.has(candidate.key)) {
    return { matchedBy: 'none', releaseGroup: null };
  }

  const steps: [
    ImportMatch['matchedBy'],
    () => Promise<MatchedReleaseGroup | null>,
  ][] = [
    ['upc', () => byBarcode(candidate)],
    ['isrc', () => byIsrc(candidate)],
    ['name', () => byName(candidate)],
  ];

  for (const [matchedBy, run] of steps) {
    const releaseGroup = await run();
    if (releaseGroup) {
      const outcome: MatchOutcome = { matchedBy, releaseGroup };
      matchCache.set(candidate.key, outcome);
      return outcome;
    }
  }

  logger.debug('No MusicBrainz match for imported album', {
    label: 'Import',
    title: candidate.title,
    artist: candidate.artist,
  });
  missCache.set(candidate.key, true);
  return { matchedBy: 'none', releaseGroup: null };
};

/** Matched release groups → AlbumResult with the live library status. */
export const toAlbumResults = async (
  groups: MatchedReleaseGroup[]
): Promise<Map<string, AlbumResult>> => {
  const out = new Map<string, AlbumResult>();
  if (!groups.length) {
    return out;
  }
  const mbids = [...new Set(groups.map((g) => g.mbid))];
  const rows: Media[] = [];
  for (let i = 0; i < mbids.length; i += 200) {
    rows.push(
      ...(await getRepository(Media).find({
        where: {
          mediaType: MediaType.RELEASE_GROUP,
          mbid: In(mbids.slice(i, i + 200)),
        },
      }))
    );
  }
  const byMbid = new Map(rows.map((m) => [m.mbid, m]));
  for (const g of groups) {
    const media = byMbid.get(g.mbid);
    const year = Number((g.firstReleaseDate ?? '').slice(0, 4));
    out.set(g.mbid, {
      mbid: g.mbid,
      title: g.title,
      artistMbid: g.artistMbid,
      artistName: g.artistName,
      primaryType: g.primaryType,
      secondaryTypes: g.secondaryTypes,
      firstReleaseDate: g.firstReleaseDate,
      year: Number.isFinite(year) && year > 0 ? year : undefined,
      coverUrl: coverUrlFor(g.mbid, 500),
      status: media?.status ?? MediaStatus.UNKNOWN,
      trackCount: media?.trackCount ?? null,
      tracksAvailable: media?.tracksAvailable ?? 0,
      mediaInfo: media
        ? {
            id: media.id,
            status: media.status,
            trackCount: media.trackCount ?? null,
            tracksAvailable: media.tracksAvailable ?? 0,
            mediaAddedAt: media.mediaAddedAt
              ? new Date(media.mediaAddedAt).toISOString()
              : null,
          }
        : undefined,
    });
  }
  return out;
};
