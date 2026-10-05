import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
  RequestScope,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import Track from '@server/entity/Track';
import { ensureMedia, getDiscographyReleaseGroups } from '@server/lib/metadata';
import logger from '@server/logger';
import { In } from 'typeorm';
import type { LibrarySource } from './types';
import { SOURCE_ID_KEY } from './types';

const LABEL = 'Library';

/**
 * The metadata layer (MusicBrainz behind it). Tests replace these so nothing
 * reaches the network.
 */
export const metadataHooks = {
  ensureMedia,
  getDiscographyReleaseGroups,
};

/**
 * Mark APPROVED requests on a release group COMPLETED once what they asked for
 * is in the library: `album` → every track; `tracks` → the requested tracks.
 * Saving through the repository lets the request subscriber send the
 * "available" notification.
 */
export const completeReleaseGroupRequests = async (
  mediaId: number,
  fullyAvailable: boolean
): Promise<number> => {
  const requestRepository = getRepository(MediaRequest);
  const requests = await requestRepository.find({
    where: { media: { id: mediaId }, status: MediaRequestStatus.APPROVED },
  });
  let completed = 0;

  for (const request of requests) {
    const requestedTracks = request.tracks ?? [];
    const done =
      request.scope === RequestScope.TRACKS && requestedTracks.length > 0
        ? requestedTracks.every(
            (item) => item.track?.status === MediaStatus.AVAILABLE
          )
        : request.scope !== RequestScope.DISCOGRAPHY && fullyAvailable;

    if (!done) {
      continue;
    }

    request.status = MediaRequestStatus.COMPLETED;
    request.downloadProgress = 100;
    requestedTracks.forEach((item) => {
      item.status = MediaRequestStatus.COMPLETED;
    });
    await requestRepository.save(request);
    completed++;
    logger.info(
      'Request completed: everything it asked for is in the library',
      {
        label: LABEL,
        requestId: request.id,
        scope: request.scope,
      }
    );
  }

  return completed;
};

const statusFor = (
  current: MediaStatus,
  available: number,
  fullyAvailable: boolean,
  activeStatuses: MediaRequestStatus[]
): MediaStatus => {
  if (current === MediaStatus.BLOCKLISTED) {
    return current;
  }
  if (fullyAvailable) {
    return MediaStatus.AVAILABLE;
  }
  if (activeStatuses.includes(MediaRequestStatus.APPROVED)) {
    return MediaStatus.PROCESSING;
  }
  if (activeStatuses.includes(MediaRequestStatus.PENDING)) {
    return MediaStatus.PENDING;
  }
  return available > 0 ? MediaStatus.PARTIALLY_AVAILABLE : MediaStatus.UNKNOWN;
};

const activeRequestStatuses = async (
  mediaId: number
): Promise<MediaRequestStatus[]> => {
  const rows = await getRepository(MediaRequest)
    .createQueryBuilder('request')
    .select('request.status', 'status')
    .where('request.mediaId = :mediaId', { mediaId })
    .andWhere('request.status IN (:...statuses)', {
      statuses: [MediaRequestStatus.PENDING, MediaRequestStatus.APPROVED],
    })
    .groupBy('request.status')
    .getRawMany<{ status: number }>();

  return rows.map((row) => Number(row.status));
};

/**
 * Recompute an artist row from its release groups: an artist is AVAILABLE when
 * the library holds anything by them. Completes APPROVED discography requests
 * once every release group they cover is fully available.
 */
export const recomputeArtist = async (
  artistMbid: string | null | undefined
): Promise<void> => {
  if (!artistMbid) {
    return;
  }
  const mediaRepository = getRepository(Media);
  const groups = await mediaRepository.find({
    select: {
      id: true,
      mbid: true,
      status: true,
      tracksAvailable: true,
      artistName: true,
      mediaAddedAt: true,
    },
    where: { artistMbid, mediaType: MediaType.RELEASE_GROUP },
  });
  const available = groups.reduce(
    (sum, g) => sum + (g.tracksAvailable ?? 0),
    0
  );

  let artist = await mediaRepository.findOne({
    where: { mbid: artistMbid, mediaType: MediaType.ARTIST },
  });

  if (!artist) {
    if (available === 0) {
      return;
    }
    try {
      artist = await metadataHooks.ensureMedia(artistMbid, MediaType.ARTIST);
    } catch (e) {
      // MusicBrainz unreachable: keep what the release groups already told us
      const name = groups.find((g) => g.artistName)?.artistName;
      if (!name) {
        logger.debug('Artist row postponed until MusicBrainz answers', {
          label: LABEL,
          artistMbid,
          errorMessage: e.message,
        });
        return;
      }
      artist = await mediaRepository.save(
        new Media({
          mediaType: MediaType.ARTIST,
          mbid: artistMbid,
          title: name,
          artistName: name,
          status: MediaStatus.UNKNOWN,
        })
      );
    }
  }

  // Discography requests: complete when every covered release group is in
  const requestRepository = getRepository(MediaRequest);
  const discographyRequests = await requestRepository.find({
    where: {
      media: { id: artist.id },
      status: MediaRequestStatus.APPROVED,
      scope: RequestScope.DISCOGRAPHY,
    },
  });
  if (discographyRequests.length > 0) {
    try {
      const covered =
        await metadataHooks.getDiscographyReleaseGroups(artistMbid);
      const availableMbids = new Set(
        groups
          .filter((g) => g.status === MediaStatus.AVAILABLE)
          .map((g) => g.mbid)
      );
      if (
        covered.length > 0 &&
        covered.every((g) => availableMbids.has(g.mbid))
      ) {
        for (const request of discographyRequests) {
          request.status = MediaRequestStatus.COMPLETED;
          request.downloadProgress = 100;
          await requestRepository.save(request);
          logger.info('Discography request completed', {
            label: LABEL,
            requestId: request.id,
          });
        }
      }
    } catch (e) {
      logger.debug('Could not check a discography request for completion', {
        label: LABEL,
        artistMbid,
        errorMessage: e.message,
      });
    }
  }

  const active = await activeRequestStatuses(artist.id);
  const status = statusFor(artist.status, available, available > 0, active);
  const firstAdded = groups
    .map((g) => g.mediaAddedAt)
    .filter((d): d is Date => !!d)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
  const patch: Partial<Media> = {};

  if (artist.status !== status) {
    patch.status = status;
  }
  if (artist.tracksAvailable !== available) {
    patch.tracksAvailable = available;
  }
  if (!artist.mediaAddedAt && available > 0) {
    patch.mediaAddedAt = firstAdded ?? new Date();
  }
  if (Object.keys(patch).length > 0) {
    await mediaRepository.update(artist.id, patch);
  }
};

/**
 * Recompute a release group from its tracks: tracksAvailable, trackCount,
 * status, mediaAddedAt; then its requests and its artist.
 */
export const recomputeReleaseGroup = async (
  mediaId: number,
  options: { addedAt?: Date; skipArtist?: boolean } = {}
): Promise<Media | null> => {
  const mediaRepository = getRepository(Media);
  const trackRepository = getRepository(Track);
  const media = await mediaRepository.findOne({ where: { id: mediaId } });

  if (!media || media.mediaType !== MediaType.RELEASE_GROUP) {
    return media;
  }

  const total = await trackRepository.count({
    where: { media: { id: mediaId } },
  });
  const available = await trackRepository.count({
    where: { media: { id: mediaId }, status: MediaStatus.AVAILABLE },
  });
  const fullyAvailable = total > 0 && available >= total;

  await completeReleaseGroupRequests(mediaId, fullyAvailable);

  const status = statusFor(
    media.status,
    available,
    fullyAvailable,
    await activeRequestStatuses(mediaId)
  );
  const patch: Partial<Media> = {};

  if (media.status !== status) {
    patch.status = status;
  }
  if (media.tracksAvailable !== available) {
    patch.tracksAvailable = available;
  }
  if (total > 0 && media.trackCount !== total) {
    patch.trackCount = total;
  }
  if (!media.mediaAddedAt && available > 0) {
    patch.mediaAddedAt = options.addedAt ?? new Date();
  }
  if (Object.keys(patch).length > 0) {
    await mediaRepository.update(mediaId, patch);
    Object.assign(media, patch);
  }

  if (!options.skipArtist) {
    await recomputeArtist(media.artistMbid);
  }

  return media;
};

const sourcePattern = (source: LibrarySource): string =>
  `%"${SOURCE_ID_KEY[source]}":%`;

/** Tracks (with their media) that currently carry an id from this source. */
export const tracksOfSource = (source: LibrarySource): Promise<Track[]> =>
  getRepository(Track)
    .createQueryBuilder('track')
    .leftJoinAndSelect('track.media', 'media')
    .where('track.sourceIds LIKE :pattern', { pattern: sourcePattern(source) })
    .getMany();

/** Albums and tracks a source currently contributes to the library index. */
export const countSource = async (
  source: LibrarySource
): Promise<{ albums: number; tracks: number }> => {
  const row = await getRepository(Track)
    .createQueryBuilder('track')
    .leftJoin('track.media', 'media')
    .select('COUNT(track.id)', 'tracks')
    .addSelect('COUNT(DISTINCT media.id)', 'albums')
    .where('track.sourceIds LIKE :pattern', { pattern: sourcePattern(source) })
    .getRawOne<{ tracks: string; albums: string }>();

  return { albums: Number(row?.albums ?? 0), tracks: Number(row?.tracks ?? 0) };
};

const hasAnySource = (ids: Track['sourceIds']): boolean =>
  !!ids && (!!ids.localPath || !!ids.plex || !!ids.jellyfin || !!ids.navidrome);

/**
 * Detach a source's id from tracks. `keep` decides per track (true = the id is
 * still valid). Tracks left without any source step back to "Not in library";
 * affected release groups and artists are recomputed.
 * Returns the number of tracks that lost the source.
 */
export const detachSource = async (
  source: LibrarySource,
  keep: (sourceId: string, track: Track) => boolean | Promise<boolean>
): Promise<number> => {
  const trackRepository = getRepository(Track);
  const key = SOURCE_ID_KEY[source];
  const affectedMedia = new Set<number>();
  let removed = 0;

  for (const track of await tracksOfSource(source)) {
    const sourceId = track.sourceIds?.[key];
    if (!sourceId || (await keep(sourceId, track))) {
      continue;
    }
    const ids = { ...(track.sourceIds ?? {}) };
    delete ids[key];
    if (source === 'plex') {
      delete ids.plexPartKey;
    }
    const stillThere = hasAnySource(ids);
    await trackRepository.update(track.id, {
      sourceIds: stillThere ? ids : null,
      ...(stillThere
        ? {}
        : { status: MediaStatus.UNKNOWN, fileFormat: null, peaks: null }),
      // local peaks belong to the file that just went away
      ...(stillThere && source === 'local' ? { peaks: null } : {}),
    });
    removed++;
    if (track.media?.id) {
      affectedMedia.add(track.media.id);
    }
  }

  const artists = new Set<string>();
  for (const mediaId of affectedMedia) {
    const media = await recomputeReleaseGroup(mediaId, { skipArtist: true });
    if (media?.artistMbid) {
      artists.add(media.artistMbid);
    }
  }
  for (const artistMbid of artists) {
    await recomputeArtist(artistMbid);
  }

  if (removed > 0) {
    logger.info(`Removed ${removed} tracks that are no longer in ${source}`, {
      label: LABEL,
      albums: affectedMedia.size,
    });
  }

  return removed;
};

/** Recompute every release group that has tracks, then every artist. */
export const recomputeAll = async (
  shouldContinue: () => boolean = () => true
): Promise<{ albums: number; artists: number }> => {
  const mediaRepository = getRepository(Media);
  const groups = await mediaRepository.find({
    select: { id: true, artistMbid: true },
    where: {
      mediaType: MediaType.RELEASE_GROUP,
      status: In([
        MediaStatus.PENDING,
        MediaStatus.PROCESSING,
        MediaStatus.PARTIALLY_AVAILABLE,
        MediaStatus.AVAILABLE,
      ]),
    },
  });
  const artists = new Set<string>();
  let albums = 0;

  for (const group of groups) {
    if (!shouldContinue()) {
      break;
    }
    await recomputeReleaseGroup(group.id, { skipArtist: true });
    albums++;
    if (group.artistMbid) {
      artists.add(group.artistMbid);
    }
  }
  for (const artistMbid of artists) {
    if (!shouldContinue()) {
      break;
    }
    await recomputeArtist(artistMbid);
  }

  return { albums, artists: artists.size };
};
