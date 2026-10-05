import CoverArtArchive from '@server/api/coverartarchive';
import type {
  MbArtist,
  MbArtistCredit,
  MbRecording,
  MbRelease,
  MbReleaseGroup,
  MbUrlRelation,
} from '@server/api/musicbrainz/interfaces';
import { MediaStatus } from '@server/constants/media';
import type {
  AlbumResult,
  ArtistCredit,
  ArtistResult,
  ExternalLink,
  TrackResult,
} from '@server/models/music';

export const creditString = (credits?: MbArtistCredit[]): string =>
  (credits ?? []).map((c) => `${c.name}${c.joinphrase ?? ''}`).join('');

export const mapCredits = (credits?: MbArtistCredit[]): ArtistCredit[] =>
  (credits ?? []).map((c) => ({
    mbid: c.artist.id,
    name: c.name || c.artist.name,
    ...(c.joinphrase ? { joinPhrase: c.joinphrase } : {}),
  }));

export const yearOf = (date?: string | null): number | undefined => {
  const year = Number((date ?? '').slice(0, 4));
  return Number.isInteger(year) && year > 0 ? year : undefined;
};

const topTags = (
  artist: Pick<MbArtist, 'genres' | 'tags'>,
  max = 6
): string[] => {
  const source = artist.genres?.length ? artist.genres : (artist.tags ?? []);
  return [...source]
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, max)
    .map((t) => t.name);
};

export const mapArtist = (artist: MbArtist): ArtistResult => {
  const areaName = artist['begin-area']?.name ?? artist.area?.name;
  const area =
    areaName && artist.country && areaName !== artist.area?.name
      ? `${areaName}, ${artist.country}`
      : (areaName ?? undefined);
  const tags = topTags(artist);
  return {
    mbid: artist.id,
    name: artist.name,
    sortName: artist['sort-name'],
    ...(artist.disambiguation ? { disambiguation: artist.disambiguation } : {}),
    ...(artist.type ? { type: artist.type } : {}),
    ...(artist.country ? { country: artist.country } : {}),
    ...(area ? { area } : {}),
    imageUrl: null,
    ...(tags.length ? { tags } : {}),
    status: MediaStatus.UNKNOWN,
    ...(artist.score !== undefined ? { score: artist.score } : {}),
  };
};

export const mapReleaseGroup = (rg: MbReleaseGroup): AlbumResult => {
  const credits = rg['artist-credit'];
  const year = yearOf(rg['first-release-date']);
  return {
    mbid: rg.id,
    title: rg.title,
    artistMbid: credits?.[0]?.artist.id ?? '',
    artistName: creditString(credits),
    artistCredit: mapCredits(credits),
    ...(rg['primary-type'] ? { primaryType: rg['primary-type'] } : {}),
    secondaryTypes: rg['secondary-types'] ?? [],
    ...(rg['first-release-date']
      ? { firstReleaseDate: rg['first-release-date'] }
      : {}),
    ...(year ? { year } : {}),
    coverUrl: CoverArtArchive.releaseGroupFront(rg.id, 500),
    status: MediaStatus.UNKNOWN,
    ...(rg.score !== undefined ? { score: rg.score } : {}),
  };
};

/** The release group a recording is best shown under: an official album first, else the earliest. */
export const bestReleaseGroupOf = (
  recording: MbRecording
): MbReleaseGroup | undefined => {
  const releases = (recording.releases ?? []).filter((r) => r['release-group']);
  if (releases.length === 0) {
    return undefined;
  }
  const rank = (r: MbRelease): number => {
    const rg = r['release-group'] as MbReleaseGroup;
    const secondary = rg['secondary-types'] ?? [];
    let score = 0;
    if (r.status === 'Official' || r.status === undefined) {
      score += 4;
    }
    if (secondary.length === 0) {
      score += 3;
    }
    if (rg['primary-type'] === 'Album') {
      score += 2;
    } else if (rg['primary-type'] === 'EP') {
      score += 1;
    }
    return score;
  };
  const sorted = [...releases].sort((a, b) => {
    const byRank = rank(b) - rank(a);
    if (byRank !== 0) {
      return byRank;
    }
    return (a.date || '9999').localeCompare(b.date || '9999');
  });
  const best = sorted[0];
  return {
    ...(best['release-group'] as MbReleaseGroup),
    'first-release-date':
      best['release-group']?.['first-release-date'] ?? best.date,
  };
};

export const mapRecording = (recording: MbRecording): TrackResult => {
  const credits = recording['artist-credit'];
  const rg = bestReleaseGroupOf(recording);
  const year = yearOf(rg?.['first-release-date'] ?? recording['first-release-date']);
  return {
    recordingMbid: recording.id,
    title: recording.title,
    artistMbid: credits?.[0]?.artist.id,
    artistName: creditString(credits),
    artistCredit: mapCredits(credits),
    lengthMs: recording.length ?? null,
    ...(rg
      ? {
          album: {
            mbid: rg.id,
            title: rg.title,
            coverUrl: CoverArtArchive.releaseGroupFront(rg.id, 250),
            ...(year ? { year } : {}),
          },
        }
      : {}),
    status: MediaStatus.UNKNOWN,
    playable: false,
    ...(recording.score !== undefined ? { score: recording.score } : {}),
  };
};

const LINK_HOSTS: [RegExp, ExternalLink['type']][] = [
  [/(^|\.)last\.fm$/, 'lastfm'],
  [/(^|\.)discogs\.com$/, 'discogs'],
  [/(^|\.)spotify\.com$/, 'spotify'],
  [/(^|\.)bandcamp\.com$/, 'bandcamp'],
  [/(^|\.)music\.apple\.com$/, 'apple'],
  [/(^|\.)itunes\.apple\.com$/, 'apple'],
];

/** Useful outbound links from MusicBrainz URL relationships (one per kind). */
export const mapUrlRelations = (relations?: MbUrlRelation[]): ExternalLink[] => {
  const links: ExternalLink[] = [];
  const seen = new Set<string>();
  for (const rel of relations ?? []) {
    const resource = rel.url?.resource;
    if (!resource || rel.ended) {
      continue;
    }
    let host: string;
    try {
      host = new URL(resource).hostname;
    } catch {
      continue;
    }
    let type: ExternalLink['type'] | undefined = LINK_HOSTS.find(([re]) =>
      re.test(host)
    )?.[1];
    if (!type && rel.type === 'official homepage') {
      type = 'official';
    }
    if (!type || seen.has(type)) {
      continue;
    }
    seen.add(type);
    links.push({ type, url: resource });
  }
  return links;
};
