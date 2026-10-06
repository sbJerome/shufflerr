import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import Track from '@server/entity/Track';
import { ensureMedia } from '@server/lib/metadata';
import logger from '@server/logger';
import { recomputeReleaseGroup } from './availability';
import type { LidarrFolderHint } from './lidarrHints';
import { lidarrHintForFolder, withLidarrHint } from './lidarrHints';
import { matchTracks } from './matching';
import type { MusicBrainzGateway } from './resolver';
import {
  editionsToTry,
  musicBrainzGateway,
  resolveReleaseGroup,
} from './resolver';
import type { IngestOutcome, ScannedAlbum, ScannedTrack } from './types';
import { SOURCE_ID_KEY } from './types';

const LABEL = 'Library';

export interface IngestDeps {
  gateway?: MusicBrainzGateway;
  ensure?: typeof ensureMedia;
  /** Lidarr folder lookup for tag-less local albums; `false` turns it off (tests). */
  lidarrHint?: ((folder: string) => Promise<LidarrFolderHint | null>) | false;
}

/** Serialises library writes: SQLite has one writer and MusicBrainz one request per second. */
let chain: Promise<unknown> = Promise.resolve();
export const withLibraryLock = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
};

export interface ApplyResult {
  matched: number;
  unmatched: ScannedTrack[];
  /** Source ids now attached to tracks of this release group. */
  attachedIds: string[];
}

/**
 * Attach a scanned album's tracks to the canonical tracklist of a release
 * group and recompute availability. Tracks that matched nothing stay out of
 * the index (they are reported, never forced onto a wrong row).
 *
 * This never detaches: removal is the scanners' end-of-run sweep
 * (availability.detachSource), because several source albums (standard and
 * deluxe folders, say) may feed one release group.
 */
export const applyAlbumToMedia = async (
  mediaId: number,
  album: ScannedAlbum
): Promise<ApplyResult> => {
  const trackRepository = getRepository(Track);
  const mediaRepository = getRepository(Media);
  const key = SOURCE_ID_KEY[album.source];
  const tracks = await trackRepository.find({
    where: { media: { id: mediaId } },
  });
  const matches = matchTracks(tracks, album.tracks);
  const attachedIds: string[] = [];

  for (const track of tracks) {
    const scanned = matches.get(track.id);
    if (!scanned) {
      continue;
    }
    const previous = track.sourceIds ?? {};
    const ids = { ...previous, [key]: scanned.sourceId };
    if (album.source === 'plex' && scanned.plexPartKey) {
      ids.plexPartKey = scanned.plexPartKey;
    }
    // The local file is what the web player serves first, so its format wins
    const fileFormat =
      scanned.fileFormat && (album.source === 'local' || !track.fileFormat)
        ? scanned.fileFormat
        : track.fileFormat;
    const fileChanged =
      album.source === 'local' && previous.localPath !== scanned.sourceId;

    if (
      track.status !== MediaStatus.AVAILABLE ||
      JSON.stringify(previous) !== JSON.stringify(ids) ||
      fileFormat !== track.fileFormat
    ) {
      await trackRepository.update(track.id, {
        status: MediaStatus.AVAILABLE,
        sourceIds: ids,
        fileFormat: fileFormat ?? null,
        // peaks describe the previous file
        ...(fileChanged ? { peaks: null } : {}),
      });
    }
    attachedIds.push(scanned.sourceId);
  }

  const patch: Partial<Media> = { lastScanAt: new Date() };
  switch (album.source) {
    case 'plex':
      patch.plexRatingKey = album.sourceAlbumId;
      break;
    case 'jellyfin':
      patch.jellyfinItemId = album.sourceAlbumId;
      break;
    case 'navidrome':
      patch.navidromeId = album.sourceAlbumId;
      break;
    case 'local':
      patch.localPath = album.localPath ?? album.sourceAlbumId;
      break;
  }
  await mediaRepository.update(mediaId, patch);
  await recomputeReleaseGroup(mediaId, { addedAt: album.addedAt });

  const matchedScanned = new Set(matches.values());

  return {
    matched: matches.size,
    unmatched: album.tracks.filter((t) => !matchedScanned.has(t)),
    attachedIds,
  };
};

const availableCount = (mediaId: number): Promise<number> =>
  getRepository(Track).count({
    where: { media: { id: mediaId }, status: MediaStatus.AVAILABLE },
  });

const fitEdition = async (
  media: Media,
  album: ScannedAlbum,
  current: ApplyResult,
  deps: IngestDeps
): Promise<ApplyResult> => {
  const gateway = deps.gateway ?? musicBrainzGateway;
  const ensure = deps.ensure ?? ensureMedia;
  const originalRelease = media.releaseMbid;
  let best = current;
  let bestAvailable = await availableCount(media.id);
  let bestRelease = originalRelease;

  try {
    const editions = (await gateway.releasesOfGroup?.(media.mbid)) ?? [];

    for (const releaseMbid of editionsToTry(
      editions,
      album.tracks.length,
      originalRelease
    )) {
      await ensure(media.mbid, MediaType.RELEASE_GROUP, {
        withTracks: true,
        preferReleaseMbid: releaseMbid,
      });
      const attempt = await applyAlbumToMedia(media.id, album);
      const available = await availableCount(media.id);

      if (available > bestAvailable) {
        best = attempt;
        bestAvailable = available;
        bestRelease = releaseMbid;
      }
      if (attempt.unmatched.length === 0) {
        break;
      }
    }

    // settle on the best edition seen (the last one tried may not be it)
    const now = await getRepository(Media).findOne({
      select: { id: true, releaseMbid: true },
      where: { id: media.id },
    });
    if (bestRelease && now?.releaseMbid !== bestRelease) {
      await ensure(media.mbid, MediaType.RELEASE_GROUP, {
        withTracks: true,
        preferReleaseMbid: bestRelease,
      });
      best = await applyAlbumToMedia(media.id, album);
    }
    if (bestRelease !== originalRelease) {
      logger.debug('Tracklist switched to the edition the files belong to', {
        label: LABEL,
        album: `${album.artistName} – ${album.albumTitle}`,
        release: bestRelease,
        matched: best.matched,
      });
    }
  } catch (e) {
    logger.debug('Could not try other editions of an album', {
      label: LABEL,
      album: `${album.artistName} – ${album.albumTitle}`,
      errorMessage: e.message,
    });
  }

  return best;
};

/**
 * Resolve a scanned album to its MusicBrainz release group, make sure the
 * Media row and canonical tracklist exist, and attach the tracks.
 */
export const ingestAlbum = async (
  scanned: ScannedAlbum,
  deps: IngestDeps = {}
): Promise<IngestOutcome & { apply?: ApplyResult }> => {
  let album = scanned;
  // Files Lidarr imported often carry no MusicBrainz ids in their tags, but
  // Lidarr knows exactly which album they are: ask it before guessing by name.
  if (
    album.source === 'local' &&
    album.localPath &&
    !album.releaseGroupMbid &&
    !album.releaseMbid &&
    !album.ambiguousMbid &&
    deps.lidarrHint !== false
  ) {
    const hint = await (deps.lidarrHint ?? lidarrHintForFolder)(
      album.localPath
    );
    if (hint) {
      album = withLidarrHint(album, hint);
    }
  }

  let resolution;
  try {
    resolution = await resolveReleaseGroup(album, deps.gateway);
  } catch (e) {
    return {
      result: 'deferred',
      reason: `MusicBrainz lookup failed: ${e.message}`,
    };
  }

  if (!resolution) {
    logger.debug('MusicBrainz has no match for a scanned album yet', {
      label: LABEL,
      source: album.source,
      artist: album.artistName,
      album: album.albumTitle,
    });
    return { result: 'unresolved' };
  }

  let media: Media;
  try {
    media = await (deps.ensure ?? ensureMedia)(
      resolution.mbid,
      MediaType.RELEASE_GROUP,
      { withTracks: true, preferReleaseMbid: resolution.releaseMbid }
    );
  } catch (e) {
    return {
      result: 'deferred',
      reason: `Metadata not available: ${e.message}`,
    };
  }

  let apply = await applyAlbumToMedia(media.id, album);

  // The files may be another edition than the canonical one (deluxe, remixes
  // single, …). When the source did not name its release, try the editions
  // whose size fits the files and keep one only if it puts more of the library
  // on the tracklist.
  if (apply.unmatched.length > 0 && !resolution.releaseMbid) {
    apply = await fitEdition(media, album, apply, deps);
  }

  if (apply.unmatched.length > 0) {
    logger.debug('Some scanned tracks are not on the canonical tracklist', {
      label: LABEL,
      source: album.source,
      album: `${album.artistName} – ${album.albumTitle}`,
      unmatched: apply.unmatched.map((t) => t.title),
    });
  }

  return {
    result: 'ingested',
    mediaId: media.id,
    mbid: resolution.mbid,
    matched: apply.matched,
    apply,
  };
};
