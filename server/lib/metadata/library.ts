import CoverArtArchive from '@server/api/coverartarchive';
import { getArtistImages } from '@server/api/fanart';
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
import type { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import type {
  AlbumResult,
  ArtistResult,
  MediaInfoSummary,
  RequestSummary,
  TrackResult,
} from '@server/models/music';
import { In } from 'typeorm';
import { yearOf } from './mappers';

export const ACTIVE_STATUSES = [
  MediaRequestStatus.PENDING,
  MediaRequestStatus.APPROVED,
];

export const IN_LIBRARY_STATUSES = [
  MediaStatus.PARTIALLY_AVAILABLE,
  MediaStatus.AVAILABLE,
];

const CHUNK = 400;

const chunked = <T>(items: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    out.push(items.slice(i, i + CHUNK));
  }
  return out;
};

export const canSeeAllRequests = (user?: User): boolean =>
  !!user?.hasPermission([Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW], {
    type: 'or',
  });

export const toMediaInfo = (media: Media): MediaInfoSummary => ({
  id: media.id,
  status: media.status,
  trackCount: media.trackCount ?? null,
  tracksAvailable: media.tracksAvailable ?? 0,
  mediaAddedAt: media.mediaAddedAt
    ? new Date(media.mediaAddedAt).toISOString()
    : null,
});

export const toRequestSummary = (request: MediaRequest): RequestSummary => ({
  id: request.id,
  status: request.status,
  scope: request.scope,
  requestedBy: {
    id: request.requestedBy?.id,
    displayName: request.requestedBy?.displayName ?? '',
    ...(request.requestedBy?.avatar
      ? { avatar: request.requestedBy.avatar }
      : {}),
  },
  isAutoApproved: !!request.isAutoApproved,
  downloadProgress: request.downloadProgress ?? null,
  createdAt: new Date(request.createdAt).toISOString(),
  ...(request.scope === RequestScope.TRACKS
    ? {
        trackIds: (request.tracks ?? [])
          .map((t) => t.track?.id)
          .filter((id): id is number => typeof id === 'number'),
      }
    : {}),
});

/** Media rows for MBIDs of one kind, keyed by MBID. */
export const getMediaMap = async (
  mbids: string[],
  mediaType: MediaType
): Promise<Map<string, Media>> => {
  const map = new Map<string, Media>();
  const unique = [...new Set(mbids.filter(Boolean))];
  for (const part of chunked(unique)) {
    const rows = await getRepository(Media).find({
      where: { mbid: In(part), mediaType },
    });
    for (const row of rows) {
      map.set(row.mbid, row);
    }
  }
  return map;
};

/** Active (pending/approved) requests for Media ids, newest first per media. */
export const getActiveRequests = async (
  mediaIds: number[]
): Promise<Map<number, MediaRequest[]>> => {
  const map = new Map<number, MediaRequest[]>();
  const unique = [...new Set(mediaIds)];
  for (const part of chunked(unique)) {
    const rows = await getRepository(MediaRequest).find({
      where: { media: { id: In(part) }, status: In(ACTIVE_STATUSES) },
      order: { id: 'DESC' },
    });
    for (const row of rows) {
      const list = map.get(row.media.id) ?? [];
      list.push(row);
      map.set(row.media.id, list);
    }
  }
  return map;
};

/** How many release groups per artist are (partly) in the library. */
export const getArtistLibraryCounts = async (
  artistMbids: string[]
): Promise<Map<string, number>> => {
  const map = new Map<string, number>();
  const unique = [...new Set(artistMbids.filter(Boolean))];
  for (const part of chunked(unique)) {
    const rows = await getRepository(Media)
      .createQueryBuilder('media')
      .select('media.artistMbid', 'artistMbid')
      .addSelect('COUNT(*)', 'count')
      .where('media.mediaType = :type', { type: MediaType.RELEASE_GROUP })
      .andWhere('media.artistMbid IN (:...mbids)', { mbids: part })
      .andWhere('media.status IN (:...statuses)', {
        statuses: IN_LIBRARY_STATUSES,
      })
      .groupBy('media.artistMbid')
      .getRawMany<{ artistMbid: string; count: string | number }>();
    for (const row of rows) {
      map.set(row.artistMbid, Number(row.count));
    }
  }
  return map;
};

/** Merge library status, counts and the active request into album results (in place). */
export const mergeAlbumLibrary = async (
  albums: AlbumResult[]
): Promise<AlbumResult[]> => {
  if (albums.length === 0) {
    return albums;
  }
  const media = await getMediaMap(
    albums.map((a) => a.mbid),
    MediaType.RELEASE_GROUP
  );
  if (media.size === 0) {
    return albums;
  }
  const requests = await getActiveRequests(
    [...media.values()].map((m) => m.id)
  );
  for (const album of albums) {
    const row = media.get(album.mbid);
    if (!row) {
      continue;
    }
    album.status = row.status;
    album.trackCount = row.trackCount ?? null;
    album.tracksAvailable = row.tracksAvailable ?? 0;
    album.mediaInfo = toMediaInfo(row);
    const active = requests.get(row.id)?.[0];
    if (active) {
      album.request = toRequestSummary(active);
    }
  }
  return albums;
};

/** Merge library presence (and fanart.tv photos when on) into artist results (in place). */
export const mergeArtistLibrary = async (
  artists: ArtistResult[],
  options: { images?: boolean } = {}
): Promise<ArtistResult[]> => {
  if (artists.length === 0) {
    return artists;
  }
  const counts = await getArtistLibraryCounts(artists.map((a) => a.mbid));
  for (const artist of artists) {
    const count = counts.get(artist.mbid) ?? 0;
    artist.albumsInLibrary = count;
    artist.status = count > 0 ? MediaStatus.AVAILABLE : MediaStatus.UNKNOWN;
  }
  if (options.images !== false) {
    await Promise.all(
      artists.map(async (artist) => {
        if (!artist.imageUrl) {
          artist.imageUrl = (await getArtistImages(artist.mbid)).thumb;
        }
      })
    );
  }
  return artists;
};

export const trackSources = (
  track: Pick<Track, 'sourceIds'>
): ('plex' | 'jellyfin' | 'navidrome' | 'local')[] => {
  const ids = track.sourceIds ?? {};
  const out: ('plex' | 'jellyfin' | 'navidrome' | 'local')[] = [];
  if (ids.localPath) {
    out.push('local');
  }
  if (ids.plex || ids.plexPartKey) {
    out.push('plex');
  }
  if (ids.jellyfin) {
    out.push('jellyfin');
  }
  if (ids.navidrome) {
    out.push('navidrome');
  }
  return out;
};

export const isTrackPlayable = (
  track: Pick<Track, 'status' | 'sourceIds'>
): boolean =>
  track.status === MediaStatus.AVAILABLE && trackSources(track).length > 0;

/** Merge library tracks (by recording MBID) into track results (in place). */
export const mergeTrackLibrary = async (
  tracks: TrackResult[]
): Promise<TrackResult[]> => {
  const mbids = [
    ...new Set(tracks.map((t) => t.recordingMbid).filter(Boolean)),
  ];
  if (mbids.length === 0) {
    return tracks;
  }
  const found = new Map<string, Track>();
  for (const part of chunked(mbids)) {
    const rows = await getRepository(Track).find({
      where: { recordingMbid: In(part) },
      relations: { media: true },
    });
    for (const row of rows) {
      if (!row.recordingMbid) {
        continue;
      }
      const current = found.get(row.recordingMbid);
      // prefer a playable copy when the recording sits on several albums
      if (!current || (!isTrackPlayable(current) && isTrackPlayable(row))) {
        found.set(row.recordingMbid, row);
      }
    }
  }
  for (const track of tracks) {
    const row = found.get(track.recordingMbid);
    if (!row) {
      continue;
    }
    track.trackId = row.id;
    track.status = row.status;
    track.playable = isTrackPlayable(row);
    if (track.playable && row.media) {
      track.album = {
        mbid: row.media.mbid,
        title: row.media.title,
        coverUrl: CoverArtArchive.releaseGroupFront(row.media.mbid, 250),
        ...(yearOf(row.media.firstReleaseDate)
          ? { year: yearOf(row.media.firstReleaseDate) }
          : {}),
      };
    }
  }
  return tracks;
};

/** An AlbumResult built only from a Media row (library lists, no MusicBrainz call). */
export const albumFromMedia = (media: Media): AlbumResult => {
  const year = yearOf(media.firstReleaseDate);
  return {
    mbid: media.mbid,
    title: media.title,
    artistMbid: media.artistMbid ?? '',
    artistName: media.artistName ?? '',
    ...(media.primaryType ? { primaryType: media.primaryType } : {}),
    secondaryTypes: media.secondaryTypes ?? [],
    ...(media.firstReleaseDate
      ? { firstReleaseDate: media.firstReleaseDate }
      : {}),
    ...(year ? { year } : {}),
    coverUrl: CoverArtArchive.releaseGroupFront(media.mbid, 500),
    status: media.status,
    trackCount: media.trackCount ?? null,
    tracksAvailable: media.tracksAvailable ?? 0,
    mediaInfo: toMediaInfo(media),
  };
};

/** AlbumResults for Media rows, with their active request attached. */
export const albumsFromMedia = async (
  rows: Media[]
): Promise<AlbumResult[]> => {
  const albums = rows.map(albumFromMedia);
  const requests = await getActiveRequests(rows.map((m) => m.id));
  rows.forEach((row, i) => {
    const active = requests.get(row.id)?.[0];
    if (active) {
      albums[i].request = toRequestSummary(active);
    }
  });
  return albums;
};
