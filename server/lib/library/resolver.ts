import { getMusicBrainz } from '@server/api/musicbrainz';
import {
  normalizeLoose,
  normalizeText,
  primaryArtist,
  stripQualifiers,
} from './normalize';
import type { ScannedAlbum } from './types';

export interface ReleaseGroupCandidate {
  mbid: string;
  title: string;
  artistName: string;
  /** MusicBrainz search score 0–100 */
  score: number;
  year?: number;
  primaryType?: string | null;
}

/** The slice of MusicBrainz the resolver needs; injected in tests (no live calls). */
export interface MusicBrainzGateway {
  /** Release-group MBID a release belongs to; null when the id is not a release. */
  releaseGroupForRelease(releaseMbid: string): Promise<string | null>;
  /** True when the id is a release group. */
  releaseGroupExists(mbid: string): Promise<boolean>;
  searchReleaseGroups(
    artistName: string,
    albumTitle: string
  ): Promise<ReleaseGroupCandidate[]>;
  /** Editions of a release group, for fitting the tracklist to the files (optional). */
  releasesOfGroup?(releaseGroupMbid: string): Promise<ReleaseEdition[]>;
}

export interface ReleaseEdition {
  mbid: string;
  trackCount: number;
  official: boolean;
  digital: boolean;
  date?: string;
}

const isNotFound = (e: { response?: { status?: number } }): boolean =>
  e?.response?.status === 404 || e?.response?.status === 400;

const luceneQuote = (input: string): string =>
  `"${input.replace(/[\\"]/g, '\\$&')}"`;

/** Goes through SV1's client, so the shared 1 req/s limiter and its cache apply. */
export const musicBrainzGateway: MusicBrainzGateway = {
  async releaseGroupForRelease(releaseMbid) {
    try {
      const release = await getMusicBrainz().getRelease(releaseMbid, [
        'release-groups',
      ]);
      return release['release-group']?.id ?? null;
    } catch (e) {
      if (isNotFound(e)) {
        return null;
      }
      throw e;
    }
  },
  async releaseGroupExists(mbid) {
    try {
      const group = await getMusicBrainz().getReleaseGroup(mbid, []);
      return !!group?.id;
    } catch (e) {
      if (isNotFound(e)) {
        return false;
      }
      throw e;
    }
  },
  async searchReleaseGroups(artistName, albumTitle) {
    const response = await getMusicBrainz().searchReleaseGroupsRaw(
      `releasegroup:${luceneQuote(albumTitle)} AND artist:${luceneQuote(
        artistName
      )}`,
      { limit: 10 }
    );
    return (response['release-groups'] ?? []).map((group) => ({
      mbid: group.id,
      title: group.title,
      artistName: (group['artist-credit'] ?? [])
        .map((credit) => `${credit.name}${credit.joinphrase ?? ''}`)
        .join(''),
      score: group.score ?? 0,
      year: group['first-release-date']
        ? Number(group['first-release-date'].slice(0, 4)) || undefined
        : undefined,
      primaryType: group['primary-type'],
    }));
  },
  async releasesOfGroup(releaseGroupMbid) {
    // same call ensureMedia() makes, so this is answered from the cache
    const group = await getMusicBrainz().getReleaseGroup(releaseGroupMbid);
    return (group.releases ?? []).map((release) => ({
      mbid: release.id,
      trackCount: (release.media ?? []).reduce(
        (sum, medium) => sum + (medium['track-count'] ?? 0),
        0
      ),
      official: release.status === 'Official',
      digital:
        (release.media ?? []).length > 0 &&
        (release.media ?? []).every((m) => m.format === 'Digital Media'),
      date: release.date,
    }));
  },
};

export interface Resolution {
  mbid: string;
  via: 'release-group-id' | 'release-id' | 'search';
  /** The release (edition) the files belong to, when known — preferred for the tracklist. */
  releaseMbid?: string;
}

const MIN_SEARCH_SCORE = 85;

const artistMatches = (wanted: string, candidate: string): boolean => {
  const a = normalizeText(wanted);
  const b = normalizeText(candidate);
  if (!a || !b) {
    return false;
  }
  // joint credits ("A & B" holds "A") and "The X" / "X" spellings
  return (
    a === b ||
    ` ${b} `.includes(` ${a} `) ||
    ` ${a} `.includes(` ${b} `) ||
    a.replace(/^the /, '') === b.replace(/^the /, '')
  );
};

/**
 * Pick the release group for a scanned album from search candidates. A
 * candidate is only accepted when both the title and the artist agree after
 * normalisation; nothing is guessed from a weak score.
 */
export const pickCandidate = (
  album: Pick<ScannedAlbum, 'artistName' | 'albumTitle' | 'year'>,
  candidates: ReleaseGroupCandidate[]
): ReleaseGroupCandidate | undefined => {
  const exact = normalizeText(album.albumTitle);
  const loose = normalizeLoose(album.albumTitle);

  const acceptable = candidates.filter(
    (candidate) =>
      candidate.score >= MIN_SEARCH_SCORE &&
      artistMatches(album.artistName, candidate.artistName) &&
      (normalizeText(candidate.title) === exact ||
        normalizeLoose(candidate.title) === loose)
  );

  const rank = (candidate: ReleaseGroupCandidate): number =>
    (normalizeText(candidate.title) === exact ? 100 : 0) +
    (album.year && candidate.year === album.year ? 40 : 0) +
    (candidate.primaryType === 'Album' ? 5 : 0) +
    candidate.score / 100;

  return acceptable.sort((a, b) => rank(b) - rank(a))[0];
};

/**
 * Resolve a scanned album to a MusicBrainz release group.
 * Order: release-group id from the source → release id → ambiguous id (tried
 * as release, then as release group) → artist + title search.
 * Returns null when MusicBrainz has no acceptable match. Network errors
 * propagate so the caller can defer instead of recording "no match".
 */
export const resolveReleaseGroup = async (
  album: ScannedAlbum,
  gateway: MusicBrainzGateway = musicBrainzGateway
): Promise<Resolution | null> => {
  if (album.releaseGroupMbid) {
    return {
      mbid: album.releaseGroupMbid,
      via: 'release-group-id',
      releaseMbid: album.releaseMbid ?? undefined,
    };
  }

  if (album.releaseMbid) {
    const group = await gateway.releaseGroupForRelease(album.releaseMbid);
    if (group) {
      return { mbid: group, via: 'release-id', releaseMbid: album.releaseMbid };
    }
  }

  if (album.ambiguousMbid) {
    const group = await gateway.releaseGroupForRelease(album.ambiguousMbid);
    if (group) {
      return {
        mbid: group,
        via: 'release-id',
        releaseMbid: album.ambiguousMbid,
      };
    }
    if (await gateway.releaseGroupExists(album.ambiguousMbid)) {
      return { mbid: album.ambiguousMbid, via: 'release-group-id' };
    }
  }

  for (const attempt of searchAttempts(album)) {
    const picked = pickCandidate(
      { ...attempt, year: album.year },
      await gateway.searchReleaseGroups(attempt.artistName, attempt.albumTitle)
    );
    if (picked) {
      return { mbid: picked.mbid, via: 'search' };
    }
  }

  return null;
};

const MAX_SEARCHES = 5;

/**
 * The artist/title pairs worth searching, most trustworthy first: the tags as
 * they are, the source's own aliases (folder names), the first credited artist
 * of a joint credit, and the title without packaging qualifiers. Each is a
 * spelling the source really has — nothing is made up — and every hit still
 * has to pass pickCandidate().
 */
export const searchAttempts = (
  album: Pick<ScannedAlbum, 'artistName' | 'albumTitle' | 'aliases'>
): { artistName: string; albumTitle: string }[] => {
  const artist = album.artistName.trim();
  const title = album.albumTitle.trim();
  const aliases = album.aliases ?? [];
  const candidates = [
    { artistName: artist, albumTitle: title },
    ...aliases,
    ...aliases.map((alias) => ({
      artistName: alias.artistName,
      albumTitle: title,
    })),
    { artistName: primaryArtist(artist), albumTitle: title },
    { artistName: artist, albumTitle: stripQualifiers(title) },
    ...aliases.map((alias) => ({
      artistName: alias.artistName,
      albumTitle: stripQualifiers(title),
    })),
    {
      artistName: primaryArtist(artist),
      albumTitle: stripQualifiers(title),
    },
  ];
  const seen = new Set<string>();

  return candidates
    .map((c) => ({
      artistName: c.artistName.trim(),
      albumTitle: c.albumTitle.trim(),
    }))
    .filter((c) => {
      const key = `${normalizeText(c.artistName)}|${normalizeText(c.albumTitle)}`;
      if (!c.artistName || !c.albumTitle || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SEARCHES);
};

/**
 * Editions of a release group worth trying when the canonical tracklist does
 * not hold all scanned tracks: same number of tracks as the files first, then
 * the nearest larger edition; official and digital editions first.
 */
export const editionsToTry = (
  editions: ReleaseEdition[],
  scannedTracks: number,
  currentReleaseMbid: string | null | undefined,
  limit = 2
): string[] =>
  editions
    .filter(
      (e) => e.mbid !== currentReleaseMbid && e.trackCount >= scannedTracks
    )
    .sort(
      (a, b) =>
        a.trackCount - b.trackCount ||
        Number(b.official) - Number(a.official) ||
        Number(b.digital) - Number(a.digital) ||
        (a.date ?? '9999').localeCompare(b.date ?? '9999') ||
        a.mbid.localeCompare(b.mbid)
    )
    .slice(0, limit)
    .map((e) => e.mbid);
