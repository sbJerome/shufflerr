import { getArtistImages } from '@server/api/fanart';
import LastfmAPI, { cleanLastfmText } from '@server/api/lastfm';
import { getMusicBrainz } from '@server/api/musicbrainz';
import type {
  MbRelease,
  MbReleaseGroup,
} from '@server/api/musicbrainz/interfaces';
import LidarrAPI from '@server/api/servarr/lidarr';
import { IssueStatus } from '@server/constants/issue';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
  RequestScope,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Issue from '@server/entity/Issue';
import type Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import Track from '@server/entity/Track';
import type { User } from '@server/entity/User';
import cacheManager from '@server/lib/cache';
import { Permission } from '@server/lib/permissions';
import type { LidarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type {
  AlbumDetails,
  AlbumTrack,
  ArtistDetails,
  ArtistResult,
  ExternalLink,
  RequestSummary,
  TrackResult,
} from '@server/models/music';
import { In, IsNull, Not } from 'typeorm';
import { ensureMedia, isMbid } from './index';
import {
  ACTIVE_STATUSES,
  IN_LIBRARY_STATUSES,
  albumFromMedia,
  canSeeAllRequests,
  getActiveRequests,
  isTrackPlayable,
  mergeAlbumLibrary,
  mergeArtistLibrary,
  mergeTrackLibrary,
  toMediaInfo,
  toRequestSummary,
  trackSources,
} from './library';
import {
  mapArtist,
  mapRecording,
  mapReleaseGroup,
  mapUrlRelations,
} from './mappers';

const musicBrainzSite = (): string => {
  const url =
    getSettings().metadata.musicbrainz.url || 'https://musicbrainz.org';
  // links always point at the public site: a private mirror is not reachable for viewers
  return /musicbrainz\.org/.test(url)
    ? url.replace(/\/+$/, '')
    : 'https://musicbrainz.org';
};

const lidarrServer = (id?: number | null): LidarrSettings | undefined => {
  const servers = getSettings().lidarr;
  if (id !== null && id !== undefined) {
    return servers.find((s) => s.id === id);
  }
  return servers.find((s) => s.isDefault && !s.isHiRes) ?? servers[0];
};

const lidarrBaseUrl = (server: LidarrSettings): string => {
  const defaultPort = server.useSsl ? 443 : 80;
  const port = Number(server.port) === defaultPort ? '' : `:${server.port}`;
  return `${server.useSsl ? 'https' : 'http'}://${server.hostname}${port}${
    server.baseUrl ?? ''
  }`;
};

/** Address a person can open (the configured external URL when set). */
const lidarrWebUrl = (server: LidarrSettings): string =>
  (server.externalUrl || lidarrBaseUrl(server)).replace(/\/+$/, '');

const requestsVisibleTo = (
  requests: MediaRequest[],
  user?: User
): MediaRequest[] =>
  canSeeAllRequests(user)
    ? requests
    : requests.filter(
        (r) =>
          r.requestedBy?.id === user?.id || ACTIVE_STATUSES.includes(r.status)
      );

/** Active discography request for an artist, if one exists. */
export const getDiscographyRequest = async (
  artistMbid?: string | null
): Promise<RequestSummary | undefined> => {
  if (!artistMbid) {
    return undefined;
  }
  const request = await getRepository(MediaRequest).findOne({
    where: {
      scope: RequestScope.DISCOGRAPHY,
      status: In(ACTIVE_STATUSES),
      media: { mbid: artistMbid, mediaType: MediaType.ARTIST },
    },
    order: { id: 'DESC' },
  });
  return request ? toRequestSummary(request) : undefined;
};

// ---------------------------------------------------------------------------
// Album
// ---------------------------------------------------------------------------

export const getAlbumDetails = async (
  mbid: string,
  user?: User
): Promise<AlbumDetails> => {
  const media = await ensureMedia(mbid, MediaType.RELEASE_GROUP, {
    withTracks: true,
  });
  const mb = getMusicBrainz();

  // Both are cached by ensureMedia's own calls; tolerate MusicBrainz being down
  // when the album is already in the database.
  let rg: MbReleaseGroup | null = null;
  let release: MbRelease | null = null;
  try {
    rg = await mb.getReleaseGroup(media.mbid);
    release = media.releaseMbid ? await mb.getRelease(media.releaseMbid) : null;
  } catch (e) {
    logger.debug('Serving album from the database, MusicBrainz lookup failed', {
      label: 'Metadata',
      mbid: media.mbid,
      errorMessage: e.message,
    });
  }

  const trackRepository = getRepository(Track);
  const [rows, withPeaks, requests, openIssues, discographyRequest] =
    await Promise.all([
      trackRepository.find({ where: { media: { id: media.id } } }),
      trackRepository.find({
        where: { media: { id: media.id }, peaks: Not(IsNull()) },
        select: { id: true },
      }),
      getRepository(MediaRequest).find({
        where: { media: { id: media.id } },
        order: { id: 'DESC' },
      }),
      getRepository(Issue)
        .count({ where: { media: { id: media.id }, status: IssueStatus.OPEN } })
        .catch(() => 0),
      getDiscographyRequest(media.artistMbid),
    ]);

  const peakIds = new Set(withPeaks.map((t) => t.id));
  const active = requests.filter((r) => ACTIVE_STATUSES.includes(r.status));
  const coveredByAlbumRequest = active.find(
    (r) => r.scope === RequestScope.ALBUM
  );
  const trackRequestStatus = new Map<number, MediaRequestStatus>();
  for (const request of active) {
    if (request.scope !== RequestScope.TRACKS) {
      continue;
    }
    for (const tr of request.tracks ?? []) {
      if (tr.track?.id !== undefined && !trackRequestStatus.has(tr.track.id)) {
        trackRequestStatus.set(tr.track.id, request.status);
      }
    }
  }

  const tracks: AlbumTrack[] = rows
    .sort(
      (a, b) =>
        // extras (disc 0) go last
        (a.discNumber || 999) - (b.discNumber || 999) ||
        a.trackNumber - b.trackNumber ||
        a.position.localeCompare(b.position)
    )
    .map((t) => {
      const requestStatus =
        trackRequestStatus.get(t.id) ??
        (t.status !== MediaStatus.AVAILABLE
          ? (coveredByAlbumRequest?.status ??
            (discographyRequest ? discographyRequest.status : undefined))
          : undefined);
      return {
        id: t.id,
        recordingMbid: t.recordingMbid ?? null,
        position: t.position,
        discNumber: t.discNumber,
        trackNumber: t.trackNumber,
        title: t.title,
        artistCredit: t.artistCredit,
        lengthMs: t.lengthMs ?? null,
        status: t.status,
        fileFormat: t.fileFormat ?? null,
        playable: isTrackPlayable(t),
        hasPeaks: peakIds.has(t.id),
        ...(requestStatus !== undefined ? { requestStatus } : {}),
        sources: trackSources(t),
      };
    });

  const base = rg ? mapReleaseGroup(rg) : albumFromMedia(media);
  const visible = requestsVisibleTo(requests, user);
  const activeVisible = visible.find((r) => ACTIVE_STATUSES.includes(r.status));

  const links: ExternalLink[] = [
    {
      type: 'musicbrainz',
      url: `${musicBrainzSite()}/release-group/${media.mbid}`,
    },
  ];
  const server =
    media.lidarrAlbumId !== null && media.lidarrAlbumId !== undefined
      ? lidarrServer(media.lidarrServerId)
      : undefined;
  if (server && canSeeAllRequests(user)) {
    links.push({
      type: 'lidarr',
      url: `${lidarrWebUrl(server)}/album/${media.mbid}`,
      label: server.name,
    });
  }

  const discs = new Set(
    tracks.filter((t) => t.discNumber > 0).map((t) => t.discNumber)
  );
  const genres = [...(rg?.genres?.length ? rg.genres : (rg?.tags ?? []))]
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, 6)
    .map((g) => g.name);
  const label = release?.['label-info']?.find((l) => l.label?.name)?.label
    ?.name;
  const totalLengthMs = tracks.reduce((n, t) => n + (t.lengthMs ?? 0), 0);

  return {
    ...base,
    status: media.status,
    trackCount: media.trackCount ?? tracks.length,
    tracksAvailable: media.tracksAvailable ?? 0,
    mediaInfo: toMediaInfo(media),
    ...(activeVisible ? { request: toRequestSummary(activeVisible) } : {}),
    releaseMbid: media.releaseMbid ?? null,
    ...(label ? { label } : {}),
    discCount: Math.max(1, discs.size),
    ...(totalLengthMs > 0 ? { totalLengthMs } : {}),
    ...(genres.length ? { genres } : {}),
    tracks,
    requests: visible.map(toRequestSummary),
    ...(discographyRequest ? { discographyRequest } : {}),
    links,
    lidarr:
      media.lidarrAlbumId !== null && media.lidarrAlbumId !== undefined
        ? {
            serverId: media.lidarrServerId ?? server?.id ?? 0,
            albumId: media.lidarrAlbumId,
            artistId: media.lidarrArtistId ?? null,
            monitored: await lidarrAlbumMonitored(media),
            canRemove: !!user?.hasPermission(Permission.MANAGE_REQUESTS),
          }
        : null,
    openIssues,
  };
};

// ---------------------------------------------------------------------------
// Artist
// ---------------------------------------------------------------------------

const artistStateCacheKey = (artistMbid: string): string =>
  `artist-state:${artistMbid}`;

/** Forget the cached Lidarr state of an artist (after a write to Lidarr). */
export const invalidateLidarrArtistState = (artistMbid: string): void => {
  cacheManager.getCache('lidarr').data.del(artistStateCacheKey(artistMbid));
};

/**
 * What Lidarr knows about an artist (monitoring, profiles, folder). Read-only
 * and cached for a minute; null when no server is configured, the artist is
 * not in Lidarr, or Lidarr cannot be reached.
 */
export const getLidarrArtistState = async (
  artistMbid: string
): Promise<ArtistDetails['lidarr']> => {
  const servers = getSettings().lidarr;
  if (servers.length === 0) {
    return null;
  }
  const cache = cacheManager.getCache('lidarr').data;
  const cacheKey = artistStateCacheKey(artistMbid);
  const cached = cache.get<{ value: ArtistDetails['lidarr'] }>(cacheKey);
  if (cached) {
    return cached.value;
  }

  let value: ArtistDetails['lidarr'] = null;
  const ordered = [...servers].sort(
    (a, b) => Number(b.isDefault) - Number(a.isDefault)
  );
  for (const server of ordered) {
    const lidarr = LidarrAPI.fromSettings(server);
    try {
      const artist = await lidarr.getArtistByMbid(artistMbid);
      if (!artist?.id) {
        continue;
      }
      const [quality, metadata] = await Promise.all([
        lidarr.getProfiles().catch(() => []),
        lidarr.getMetadataProfiles().catch(() => []),
      ]);
      value = {
        serverId: server.id,
        artistId: artist.id,
        monitored: !!artist.monitored,
        monitorNewItems: (artist.monitorNewItems ?? 'none') !== 'none',
        qualityProfileName: quality.find(
          (p) => p.id === artist.qualityProfileId
        )?.name,
        metadataProfileName: metadata.find(
          (p) => p.id === artist.metadataProfileId
        )?.name,
        rootFolder: artist.rootFolderPath ?? artist.path,
      };
      break;
    } catch (e) {
      logger.debug('Could not read the artist from Lidarr', {
        label: 'Metadata',
        server: server.name,
        errorMessage: e.message,
      });
    }
  }
  cache.set(cacheKey, { value }, 60);
  return value;
};

/**
 * Whether Lidarr is monitoring an album. Cached for a minute; falls back to
 * true (Shufflerr only stores a lidarrAlbumId for albums it monitors) when
 * Lidarr cannot be asked.
 */
const lidarrAlbumMonitored = async (media: Media): Promise<boolean> => {
  const server = lidarrServer(media.lidarrServerId);
  if (!server) {
    return true;
  }
  const cache = cacheManager.getCache('lidarr').data;
  const cacheKey = `album-monitored:${media.mbid}`;
  const cached = cache.get<{ value: boolean }>(cacheKey);
  if (cached) {
    return cached.value;
  }
  let value = true;
  try {
    const album = await LidarrAPI.fromSettings(server).getAlbumByMbid(
      media.mbid
    );
    value = album ? !!album.monitored : false;
  } catch (e) {
    logger.debug('Could not read the album from Lidarr', {
      label: 'Metadata',
      errorMessage: e.message,
    });
  }
  cache.set(cacheKey, { value }, 60);
  return value;
};

const similarArtists = async (
  mbid: string,
  name: string
): Promise<ArtistResult[]> => {
  if (!LastfmAPI.enabled()) {
    return [];
  }
  try {
    const similar = await new LastfmAPI().getSimilarArtists(
      { mbid, artist: name },
      12
    );
    // Only artists Last.fm can tie to MusicBrainz are linkable in Shufflerr.
    const results: ArtistResult[] = similar
      .filter((s) => isMbid(s.mbid))
      .map((s) => ({
        mbid: (s.mbid as string).toLowerCase(),
        name: s.name,
        imageUrl: null,
        status: MediaStatus.UNKNOWN,
      }));
    return await mergeArtistLibrary(results);
  } catch (e) {
    logger.debug('Last.fm similar artists failed', {
      label: 'Metadata',
      errorMessage: e.message,
    });
    return [];
  }
};

const artistBio = async (
  mbid: string,
  name: string
): Promise<ArtistDetails['bio']> => {
  if (!LastfmAPI.enabled()) {
    return null;
  }
  try {
    const info = await new LastfmAPI().getArtistInfo({ mbid, artist: name });
    const text = cleanLastfmText(info?.bio?.summary);
    if (!info || !text) {
      return null;
    }
    return { text, url: info.url, source: 'lastfm' };
  } catch {
    return null;
  }
};

export const getArtistDetails = async (
  mbid: string,
  user?: User
): Promise<ArtistDetails> => {
  if (!isMbid(mbid)) {
    throw new Error('That is not a MusicBrainz ID.');
  }
  mbid = mbid.toLowerCase();
  const mb = getMusicBrainz();
  const artist = await mb.getArtist(mbid);
  const groups = await mb.getAllReleaseGroups(mbid);

  const base = mapArtist(artist);
  const discography = await mergeAlbumLibrary(
    groups
      .map(mapReleaseGroup)
      .sort((a, b) =>
        (b.firstReleaseDate || '0000').localeCompare(
          a.firstReleaseDate || '0000'
        )
      )
  );

  const [images, bio, similar, lidarr, discographyRequest] = await Promise.all([
    getArtistImages(mbid, artist.name),
    artistBio(mbid, artist.name),
    similarArtists(mbid, artist.name),
    getLidarrArtistState(mbid),
    getDiscographyRequest(mbid),
  ]);

  // Hide other people's requests from viewers who may not see them.
  if (!canSeeAllRequests(user)) {
    for (const album of discography) {
      if (album.request && album.request.requestedBy.id !== user?.id) {
        album.request = {
          ...album.request,
          requestedBy: { id: 0, displayName: '' },
        };
      }
    }
  }

  const inLibrary = discography.filter((a) =>
    IN_LIBRARY_STATUSES.includes(a.status)
  ).length;
  const downloading = discography.filter(
    (a) =>
      a.status === MediaStatus.PROCESSING ||
      a.request?.status === MediaRequestStatus.APPROVED
  ).length;

  const links: ExternalLink[] = [
    { type: 'musicbrainz', url: `${musicBrainzSite()}/artist/${mbid}` },
    ...mapUrlRelations(artist.relations),
  ];
  if (lidarr && canSeeAllRequests(user)) {
    const server = lidarrServer(lidarr.serverId);
    if (server) {
      links.push({
        type: 'lidarr',
        url: `${lidarrWebUrl(server)}/artist/${mbid}`,
        label: server.name,
      });
    }
  }

  const span = artist['life-span'];

  return {
    ...base,
    imageUrl: images.thumb,
    status: inLibrary > 0 ? MediaStatus.AVAILABLE : MediaStatus.UNKNOWN,
    albumsInLibrary: inLibrary,
    backgroundUrl: images.background,
    bio,
    ...(span && (span.begin || span.end)
      ? {
          lifeSpan: {
            ...(span.begin ? { begin: span.begin } : {}),
            ...(span.end ? { end: span.end } : {}),
            ended: !!span.ended,
          },
        }
      : {}),
    facts: {
      releases: discography.length,
      inLibrary,
      downloading,
      albums: discography.filter((a) => a.primaryType === 'Album').length,
    },
    lidarr: lidarr
      ? {
          ...lidarr,
          canRemove: !!user?.hasPermission(Permission.MANAGE_REQUESTS),
        }
      : null,
    discography,
    similar,
    links,
    ...(discographyRequest ? { discographyRequest } : {}),
  };
};

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export const getRecordingDetails = async (
  mbid: string
): Promise<TrackResult> => {
  if (!isMbid(mbid)) {
    throw new Error('That is not a MusicBrainz ID.');
  }
  const recording = await getMusicBrainz().getRecording(mbid.toLowerCase());
  const [track] = await mergeTrackLibrary([mapRecording(recording)]);
  return track;
};

/** Lowest-numbered playable track of an album, for "Play from library". */
export const firstPlayableTrackId = async (
  mediaId: number
): Promise<number | undefined> => {
  const rows = await getRepository(Track).find({
    where: { media: { id: mediaId }, status: MediaStatus.AVAILABLE },
  });
  return rows
    .filter(isTrackPlayable)
    .sort(
      (a, b) =>
        (a.discNumber || 999) - (b.discNumber || 999) ||
        a.trackNumber - b.trackNumber
    )[0]?.id;
};

export { getActiveRequests };
export type { Media };
