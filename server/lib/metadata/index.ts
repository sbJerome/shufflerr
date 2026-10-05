// Shared helpers every other stream calls to turn an MBID into Media/Track rows.
import CoverArtArchive from '@server/api/coverartarchive';
import { getMusicBrainz } from '@server/api/musicbrainz';
import type {
  MbRelease,
  MbReleaseGroup,
} from '@server/api/musicbrainz/interfaces';
import { MediaStatus, MediaType } from '@server/constants/media';
import dataSource, { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import Track from '@server/entity/Track';
import TrackRequest from '@server/entity/TrackRequest';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import AsyncLock from '@server/utils/asyncLock';
import { In } from 'typeorm';
import { pickCanonicalRelease } from './canonical';
import { creditString } from './mappers';

export { pickCanonicalRelease } from './canonical';

export interface EnsureMediaOptions {
  /** Also make sure the canonical tracklist is stored in Track (release groups only). */
  withTracks?: boolean;
  /** Prefer this MusicBrainz release (e.g. the one Lidarr has) as the canonical tracklist. */
  preferReleaseMbid?: string;
}

const lock = new AsyncLock();

const MBID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isMbid = (value: unknown): value is string =>
  typeof value === 'string' && MBID_RE.test(value);

export class InvalidMbidError extends Error {}

/** Release-group types the default ("Standard") discography covers: studio albums only. */
const isStandardDiscographyType = (rg: MbReleaseGroup): boolean =>
  rg['primary-type'] === 'Album' && (rg['secondary-types'] ?? []).length === 0;

/** Copy the cached display fields of a release group onto its Media row. */
const applyReleaseGroup = (media: Media, rg: MbReleaseGroup): void => {
  const credits = rg['artist-credit'];
  media.title = rg.title;
  media.artistMbid = credits?.[0]?.artist.id ?? media.artistMbid ?? null;
  media.artistName = creditString(credits) || media.artistName || null;
  media.primaryType = rg['primary-type'] ?? null;
  media.secondaryTypes = rg['secondary-types'] ?? [];
  media.firstReleaseDate = rg['first-release-date'] || null;
};

/**
 * Find or create the Media row for an artist / release-group MBID, filling the
 * cached display fields (title, artistName, artistMbid, types, dates) from
 * MusicBrainz. Does not change `status`.
 */
export const ensureMedia = async (
  mbid: string,
  mediaType: MediaType,
  options: EnsureMediaOptions = {}
): Promise<Media> => {
  if (!isMbid(mbid)) {
    throw new InvalidMbidError('That is not a MusicBrainz ID.');
  }
  if (
    mediaType !== MediaType.ARTIST &&
    mediaType !== MediaType.RELEASE_GROUP
  ) {
    throw new Error(`ensureMedia() does not store ${mediaType} rows`);
  }
  mbid = mbid.toLowerCase();

  return lock.dispatch(`media:${mediaType}:${mbid}`, async () => {
    const repository = getRepository(Media);
    let media = await repository.findOne({ where: { mbid, mediaType } });

    if (!media || !media.title) {
      const mb = getMusicBrainz();
      media =
        media ?? new Media({ mbid, mediaType, status: MediaStatus.UNKNOWN });
      if (mediaType === MediaType.ARTIST) {
        const artist = await mb.getArtist(mbid);
        media.title = artist.name;
        media.artistName = artist.name;
        media.artistMbid = artist.id;
      } else {
        applyReleaseGroup(media, await mb.getReleaseGroup(mbid));
      }
      media = await repository.save(media);
    }

    if (mediaType === MediaType.RELEASE_GROUP && options.withTracks) {
      const hasTracks =
        (await getRepository(Track).count({
          where: { media: { id: media.id } },
        })) > 0;
      const wantsOtherRelease =
        !!options.preferReleaseMbid &&
        options.preferReleaseMbid !== media.releaseMbid;
      if (!hasTracks || !media.releaseMbid || wantsOtherRelease) {
        media = await syncTracklistUnlocked(media, options);
      }
    }

    return media;
  });
};

interface CanonicalTrack {
  recordingMbid: string | null;
  position: string;
  discNumber: number;
  trackNumber: number;
  title: string;
  artistCredit: string;
  lengthMs: number | null;
}

const normalizeTitle = (title: string): string =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Flatten a MusicBrainz release into Shufflerr's tracklist ("01", or "1-07" for multi-disc). */
export const flattenRelease = (release: MbRelease): CanonicalTrack[] => {
  const media = (release.media ?? []).filter((m) => (m.tracks ?? []).length > 0);
  const multiDisc = media.length > 1;
  const out: CanonicalTrack[] = [];
  media.forEach((medium, index) => {
    const disc = medium.position ?? index + 1;
    for (const track of medium.tracks ?? []) {
      const number = track.position;
      const padded = String(number).padStart(2, '0');
      const credits =
        track['artist-credit'] ??
        track.recording?.['artist-credit'] ??
        release['artist-credit'];
      out.push({
        recordingMbid: track.recording?.id ?? null,
        position: multiDisc ? `${disc}-${padded}` : padded,
        discNumber: disc,
        trackNumber: number,
        title: track.title || track.recording?.title || '',
        artistCredit: creditString(credits),
        lengthMs: track.length ?? track.recording?.length ?? null,
      });
    }
  });
  return out;
};

const syncTracklistUnlocked = async (
  media: Media,
  options: Pick<EnsureMediaOptions, 'preferReleaseMbid'> = {}
): Promise<Media> => {
  const mb = getMusicBrainz();
  const rg = await mb.getReleaseGroup(media.mbid);
  applyReleaseGroup(media, rg);

  // Keep the release we already use (stable Track ids) unless told otherwise.
  const preferred =
    options.preferReleaseMbid ?? media.releaseMbid ?? undefined;
  const picked = pickCanonicalRelease(rg.releases, {
    preferReleaseMbid: preferred,
    preferCountry: getSettings().main.discoverRegion || undefined,
  });

  if (!picked) {
    // A release group without releases has no tracklist yet (announced albums).
    return getRepository(Media).save(media);
  }

  const release = await mb.getRelease(picked.id);
  const canonical = flattenRelease(release);
  if (canonical.length === 0) {
    return getRepository(Media).save(media);
  }

  return dataSource.transaction(async (manager) => {
    const trackRepository = manager.getRepository(Track);
    const existing = await trackRepository.find({
      where: { media: { id: media.id } },
    });

    const unused = new Set(existing);
    const take = (predicate: (t: Track) => boolean): Track | undefined => {
      for (const track of unused) {
        if (predicate(track)) {
          unused.delete(track);
          return track;
        }
      }
      return undefined;
    };

    // Match what is already stored: same recording → same position → same title.
    const matched = new Map<CanonicalTrack, Track>();
    for (const c of canonical) {
      const hit = c.recordingMbid
        ? take((t) => !!t.recordingMbid && t.recordingMbid === c.recordingMbid)
        : undefined;
      if (hit) {
        matched.set(c, hit);
      }
    }
    for (const c of canonical) {
      if (matched.has(c)) {
        continue;
      }
      const hit = take(
        (t) =>
          t.position === c.position &&
          (!t.recordingMbid || !c.recordingMbid) &&
          normalizeTitle(t.title) === normalizeTitle(c.title)
      );
      if (hit) {
        matched.set(c, hit);
      }
    }
    for (const c of canonical) {
      if (matched.has(c)) {
        continue;
      }
      const key = normalizeTitle(c.title);
      const hit = take(
        (t) =>
          !!key &&
          normalizeTitle(t.title) === key &&
          (!t.lengthMs ||
            !c.lengthMs ||
            Math.abs(t.lengthMs - c.lengthMs) <= 3000)
      );
      if (hit) {
        matched.set(c, hit);
      }
    }

    // Leftovers: drop rows nothing depends on; keep library files and requested
    // tracks (as extras outside the canonical positions) so nothing is lost.
    const leftovers = [...unused];
    const requested = new Set<number>();
    if (leftovers.length > 0) {
      const refs = await manager.getRepository(TrackRequest).find({
        where: { track: { id: In(leftovers.map((t) => t.id)) } },
      });
      refs.forEach((r) => requested.add(r.track.id));
    }
    const removable = leftovers.filter(
      (t) => t.status !== MediaStatus.AVAILABLE && !requested.has(t.id)
    );
    const kept = leftovers.filter((t) => !removable.includes(t));
    if (removable.length > 0) {
      await trackRepository.remove(removable);
    }

    // Positions are unique per album: park every row that has to move first.
    const movers = [
      ...[...matched.entries()]
        .filter(([c, t]) => t.position !== c.position)
        .map(([, t]) => t),
      ...kept,
    ];
    for (const track of movers) {
      track.position = `~${track.id}`;
    }
    if (movers.length > 0) {
      await trackRepository.save(movers);
    }

    const toSave: Track[] = [];
    for (const c of canonical) {
      const track =
        matched.get(c) ??
        new Track({ media, status: MediaStatus.UNKNOWN, sourceIds: null });
      track.media = media;
      track.recordingMbid = c.recordingMbid;
      track.position = c.position;
      track.discNumber = c.discNumber;
      track.trackNumber = c.trackNumber;
      track.title = c.title;
      track.artistCredit = c.artistCredit;
      track.lengthMs = c.lengthMs ?? track.lengthMs ?? null;
      toSave.push(track);
    }
    kept.forEach((track, index) => {
      track.position = `x-${String(index + 1).padStart(2, '0')}`;
      track.discNumber = 0;
      toSave.push(track);
    });
    await trackRepository.save(toSave);

    media.releaseMbid = release.id;
    media.trackCount = canonical.length;
    media.tracksAvailable = Math.min(
      canonical.length,
      toSave.filter(
        (t) => t.discNumber !== 0 && t.status === MediaStatus.AVAILABLE
      ).length
    );
    const saved = await manager.getRepository(Media).save(media);
    logger.debug('Synced tracklist', {
      label: 'Metadata',
      releaseGroup: media.mbid,
      release: release.id,
      tracks: canonical.length,
      removed: removable.length,
      extras: kept.length,
    });
    return saved;
  });
};

/**
 * (Re)sync the canonical tracklist of a release group into Track rows,
 * preserving ids, status, sourceIds and peaks of tracks that still match.
 * Canonical release pick: the one Lidarr has → official, earliest, digital,
 * most tracks (docs/INTEGRATIONS.md §MusicBrainz).
 */
export const syncTracklist = async (
  media: Media,
  options: Pick<EnsureMediaOptions, 'preferReleaseMbid'> = {}
): Promise<Media> => {
  if (media.mediaType !== MediaType.RELEASE_GROUP) {
    throw new Error('syncTracklist() needs a release group');
  }
  return lock.dispatch(`media:${media.mediaType}:${media.mbid}`, () =>
    syncTracklistUnlocked(media, options)
  );
};

/** Release-group MBIDs in an artist's discography after the metadata-profile style type filter. */
export const getDiscographyReleaseGroups = async (
  artistMbid: string
): Promise<{ mbid: string; title: string; primaryType?: string }[]> => {
  if (!isMbid(artistMbid)) {
    throw new InvalidMbidError('That is not a MusicBrainz ID.');
  }
  const groups = await getMusicBrainz().getAllReleaseGroups(artistMbid);
  return groups.filter(isStandardDiscographyType).map((rg) => ({
    mbid: rg.id,
    title: rg.title,
    ...(rg['primary-type'] ? { primaryType: rg['primary-type'] } : {}),
  }));
};

/** Image-proxy URL for a release group's cover, or null when Cover Art Archive is off. */
export const coverUrlFor = (
  releaseGroupMbid: string,
  size: 250 | 500 | 1200 = 500
): string | null => CoverArtArchive.releaseGroupFront(releaseGroupMbid, size);
