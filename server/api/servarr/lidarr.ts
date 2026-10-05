// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: server/api/servarr/radarr.ts at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import type { MetadataProfile } from '@server/interfaces/api/serviceInterfaces';
import type { LidarrSettings } from '@server/lib/settings';
import logger from '@server/logger';
import ServarrBase from './base';

export type LidarrMonitorNewItems = 'all' | 'none' | 'new';

export interface LidarrImage {
  url: string;
  coverType: string;
  extension?: string;
  remoteUrl?: string;
}

export interface LidarrStatistics {
  albumCount?: number;
  trackFileCount: number;
  trackCount: number;
  totalTrackCount: number;
  sizeOnDisk: number;
  percentOfTracks: number;
}

export interface LidarrArtist {
  /** Absent on lookup results for artists Lidarr does not have yet. */
  id?: number;
  artistName: string;
  /** MusicBrainz artist MBID */
  foreignArtistId: string;
  status?: string;
  ended?: boolean;
  artistType?: string;
  disambiguation?: string;
  overview?: string;
  path?: string;
  folder?: string;
  rootFolderPath?: string;
  qualityProfileId: number;
  metadataProfileId: number;
  monitored: boolean;
  monitorNewItems: LidarrMonitorNewItems;
  genres?: string[];
  tags: number[];
  images?: LidarrImage[];
  added?: string;
  statistics?: LidarrStatistics;
  addOptions?: {
    monitor: 'all' | 'none' | 'future' | 'missing' | 'existing' | 'first';
    searchForMissingAlbums: boolean;
  };
}

export interface LidarrRelease {
  id: number;
  albumId: number;
  /** MusicBrainz release MBID */
  foreignReleaseId: string;
  title: string;
  status: string;
  trackCount: number;
  mediumCount: number;
  format?: string;
  country?: string[];
  monitored: boolean;
}

export interface LidarrAlbum {
  /** Absent on lookup results for albums Lidarr does not have yet. */
  id?: number;
  title: string;
  disambiguation?: string;
  artistId: number;
  /** MusicBrainz release-group MBID */
  foreignAlbumId: string;
  monitored: boolean;
  anyReleaseOk?: boolean;
  profileId?: number;
  albumType?: string;
  secondaryTypes?: (string | { id: number; name: string })[];
  releaseDate?: string;
  releases?: LidarrRelease[];
  artist?: LidarrArtist;
  statistics?: LidarrStatistics;
  addOptions?: { searchForNewAlbum: boolean };
}

export interface LidarrTrack {
  id: number;
  artistId: number;
  albumId: number;
  foreignTrackId: string;
  /** MusicBrainz recording MBID */
  foreignRecordingId: string;
  trackFileId: number;
  absoluteTrackNumber: number;
  trackNumber: string;
  mediumNumber: number;
  title: string;
  duration: number;
  hasFile: boolean;
}

export interface LidarrTrackFile {
  id: number;
  artistId: number;
  albumId: number;
  path: string;
  size: number;
  dateAdded: string;
  quality?: { quality?: { id: number; name: string } };
  mediaInfo?: {
    audioChannels?: number;
    audioBitRate?: string;
    audioCodec?: string;
    audioBits?: string;
    audioSampleRate?: string;
  };
}

export interface LidarrQueueAppend {
  artistId?: number;
  albumId?: number;
  statusMessages?: { title: string; messages: string[] }[];
  errorMessage?: string;
  trackFileCount?: number;
  trackHasFileCount?: number;
}

export type LidarrQueueItem = Awaited<
  ReturnType<ServarrBase<LidarrQueueAppend>['getQueue']>
>[number];

export interface LidarrHistoryRecord {
  id: number;
  albumId: number;
  artistId: number;
  trackId?: number;
  sourceTitle: string;
  date: string;
  eventType: string;
  downloadId?: string;
  data?: Record<string, string>;
}

export interface AddArtistOptions {
  /** A lookup result (`lookupArtist`) to add. */
  artist: LidarrArtist;
  qualityProfileId: number;
  metadataProfileId: number;
  rootFolderPath: string;
  tags?: number[];
  monitored?: boolean;
  monitorNewItems?: LidarrMonitorNewItems;
  /** Which existing albums to monitor on add. */
  monitor?: 'all' | 'none';
  searchForMissingAlbums?: boolean;
}

export interface AddAlbumOptions {
  /** A lookup result (`lookupAlbum`) to add; its artist must already be in Lidarr. */
  album: LidarrAlbum;
  artist: LidarrArtist;
  monitored?: boolean;
  searchForNewAlbum?: boolean;
}

type LidarrConnection = Pick<
  LidarrSettings,
  'hostname' | 'port' | 'useSsl' | 'baseUrl' | 'apiKey'
>;

const QUEUE_PAGE_SIZE = 200;

/** Lidarr speaks API v1 (Radarr/Sonarr are on v3). */
class LidarrAPI extends ServarrBase<LidarrQueueAppend> {
  static readonly API_PATH = '/api/v1';

  /** Client for a server from settings (or an unsaved one being tested). */
  static fromSettings(server: LidarrConnection): LidarrAPI {
    return new LidarrAPI({
      url: LidarrAPI.buildUrl(server, LidarrAPI.API_PATH),
      apiKey: server.apiKey,
    });
  }

  constructor({ url, apiKey }: { url: string; apiKey: string }) {
    super({ url, apiKey, cacheName: 'lidarr', apiName: 'Lidarr' });
  }

  public getMetadataProfiles = async (): Promise<MetadataProfile[]> => {
    try {
      const data = await this.getRolling<MetadataProfile[]>(
        '/metadataprofile',
        undefined,
        3600
      );

      return data.map((profile) => ({ id: profile.id, name: profile.name }));
    } catch (e) {
      throw new Error(
        `[Lidarr] Failed to retrieve metadata profiles: ${e.message}`,
        { cause: e }
      );
    }
  };

  public getArtists = async (): Promise<LidarrArtist[]> => {
    try {
      const response = await this.axios.get<LidarrArtist[]>('/artist');

      return response.data;
    } catch (e) {
      throw new Error(`[Lidarr] Failed to retrieve artists: ${e.message}`, {
        cause: e,
      });
    }
  };

  public getArtist = async (id: number): Promise<LidarrArtist> => {
    try {
      const response = await this.axios.get<LidarrArtist>(`/artist/${id}`);

      return response.data;
    } catch (e) {
      throw new Error(`[Lidarr] Failed to retrieve artist: ${e.message}`, {
        cause: e,
      });
    }
  };

  /** The artist Lidarr already has for a MusicBrainz artist MBID, if any. */
  public getArtistByMbid = async (
    mbid: string
  ): Promise<LidarrArtist | undefined> => {
    try {
      const response = await this.axios.get<LidarrArtist[]>('/artist', {
        params: { mbId: mbid },
      });

      return response.data.find((artist) => artist.foreignArtistId === mbid);
    } catch (e) {
      throw new Error(`[Lidarr] Failed to retrieve artist: ${e.message}`, {
        cause: e,
      });
    }
  };

  /** Metadata lookup by MusicBrainz artist MBID (`lidarr:<mbid>` search prefix). */
  public lookupArtist = async (
    mbid: string
  ): Promise<LidarrArtist | undefined> => {
    try {
      const response = await this.axios.get<LidarrArtist[]>('/artist/lookup', {
        params: { term: `lidarr:${mbid}` },
      });

      return (
        response.data.find((artist) => artist.foreignArtistId === mbid) ??
        undefined
      );
    } catch (e) {
      throw new Error(`[Lidarr] Failed to look up artist: ${e.message}`, {
        cause: e,
      });
    }
  };

  public addArtist = async (
    options: AddArtistOptions
  ): Promise<LidarrArtist> => {
    try {
      const response = await this.axios.post<LidarrArtist>('/artist', {
        ...options.artist,
        qualityProfileId: options.qualityProfileId,
        metadataProfileId: options.metadataProfileId,
        rootFolderPath: options.rootFolderPath,
        tags: options.tags ?? [],
        monitored: options.monitored ?? true,
        monitorNewItems: options.monitorNewItems ?? 'none',
        addOptions: {
          monitor: options.monitor ?? 'none',
          searchForMissingAlbums: options.searchForMissingAlbums ?? false,
        },
      });

      logger.info('Lidarr accepted request to add artist', {
        label: 'Lidarr',
        artistId: response.data.id,
        artistName: response.data.artistName,
      });

      return response.data;
    } catch (e) {
      logger.error('Failed to add artist to Lidarr', {
        label: 'Lidarr',
        errorMessage: e.message,
        mbid: options.artist.foreignArtistId,
        response: e?.response?.data,
      });
      throw new Error(`[Lidarr] Failed to add artist: ${e.message}`, {
        cause: e,
      });
    }
  };

  public updateArtist = async (artist: LidarrArtist): Promise<LidarrArtist> => {
    try {
      const response = await this.axios.put<LidarrArtist>(
        `/artist/${artist.id}`,
        artist
      );

      return response.data;
    } catch (e) {
      throw new Error(`[Lidarr] Failed to update artist: ${e.message}`, {
        cause: e,
      });
    }
  };

  /** Remove an artist (and optionally its files) from Lidarr. */
  public deleteArtist = async (
    artistId: number,
    options: { deleteFiles?: boolean } = {}
  ): Promise<void> => {
    try {
      await this.axios.delete(`/artist/${artistId}`, {
        params: {
          deleteFiles: !!options.deleteFiles,
          addImportListExclusion: false,
        },
      });
    } catch (e) {
      throw new Error(`[Lidarr] Failed to remove artist: ${e.message}`, {
        cause: e,
      });
    }
  };

  /** Remove an album (and optionally its files) from Lidarr. */
  public deleteAlbum = async (
    albumId: number,
    options: { deleteFiles?: boolean } = {}
  ): Promise<void> => {
    try {
      await this.axios.delete(`/album/${albumId}`, {
        params: {
          deleteFiles: !!options.deleteFiles,
          addImportListExclusion: false,
        },
      });
    } catch (e) {
      throw new Error(`[Lidarr] Failed to remove album: ${e.message}`, {
        cause: e,
      });
    }
  };

  public getAlbums = async (artistId: number): Promise<LidarrAlbum[]> => {
    try {
      const response = await this.axios.get<LidarrAlbum[]>('/album', {
        params: { artistId, includeAllArtistAlbums: true },
      });

      return response.data;
    } catch (e) {
      throw new Error(`[Lidarr] Failed to retrieve albums: ${e.message}`, {
        cause: e,
      });
    }
  };

  /** The album Lidarr already has for a MusicBrainz release-group MBID, if any. */
  public getAlbumByMbid = async (
    releaseGroupMbid: string
  ): Promise<LidarrAlbum | undefined> => {
    try {
      const response = await this.axios.get<LidarrAlbum[]>('/album', {
        params: { foreignAlbumId: releaseGroupMbid },
      });

      return response.data.find(
        (album) => album.foreignAlbumId === releaseGroupMbid
      );
    } catch (e) {
      throw new Error(`[Lidarr] Failed to retrieve album: ${e.message}`, {
        cause: e,
      });
    }
  };

  /** Metadata lookup by MusicBrainz release-group MBID. */
  public lookupAlbum = async (
    releaseGroupMbid: string
  ): Promise<LidarrAlbum | undefined> => {
    try {
      const response = await this.axios.get<LidarrAlbum[]>('/album/lookup', {
        params: { term: `lidarr:${releaseGroupMbid}` },
      });

      return (
        response.data.find(
          (album) => album.foreignAlbumId === releaseGroupMbid
        ) ?? undefined
      );
    } catch (e) {
      throw new Error(`[Lidarr] Failed to look up album: ${e.message}`, {
        cause: e,
      });
    }
  };

  /**
   * Add a single album for an artist Lidarr already has (used when the
   * artist's metadata profile filtered the release group out).
   */
  public addAlbum = async (options: AddAlbumOptions): Promise<LidarrAlbum> => {
    try {
      const response = await this.axios.post<LidarrAlbum>('/album', {
        ...options.album,
        artistId: options.artist.id,
        artist: options.artist,
        monitored: options.monitored ?? true,
        addOptions: { searchForNewAlbum: options.searchForNewAlbum ?? false },
      });

      return response.data;
    } catch (e) {
      logger.error('Failed to add album to Lidarr', {
        label: 'Lidarr',
        errorMessage: e.message,
        mbid: options.album.foreignAlbumId,
        response: e?.response?.data,
      });
      throw new Error(`[Lidarr] Failed to add album: ${e.message}`, {
        cause: e,
      });
    }
  };

  public monitorAlbums = async (
    albumIds: number[],
    monitored: boolean
  ): Promise<void> => {
    if (albumIds.length === 0) {
      return;
    }

    try {
      await this.axios.put('/album/monitor', { albumIds, monitored });
    } catch (e) {
      throw new Error(
        `[Lidarr] Failed to change album monitoring: ${e.message}`,
        { cause: e }
      );
    }
  };

  public searchAlbums = async (albumIds: number[]): Promise<void> => {
    logger.info('Executing album search command', {
      label: 'Lidarr API',
      albumIds,
    });

    await this.runCommand('AlbumSearch', { albumIds });
  };

  public searchArtist = async (artistId: number): Promise<void> => {
    logger.info('Executing artist search command', {
      label: 'Lidarr API',
      artistId,
    });

    await this.runCommand('ArtistSearch', { artistId });
  };

  public refreshArtist = async (artistId: number): Promise<void> => {
    await this.runCommand('RefreshArtist', { artistId });
  };

  /** Every record in the queue (all pages), with artist/album ids. */
  public getQueue = async (): Promise<LidarrQueueItem[]> => {
    try {
      const records: LidarrQueueItem[] = [];
      let page = 1;
      let total = 0;

      do {
        const response = await this.axios.get<{
          totalRecords: number;
          records: LidarrQueueItem[];
        }>('/queue', {
          params: {
            page,
            pageSize: QUEUE_PAGE_SIZE,
            includeUnknownArtistItems: false,
          },
        });

        total = response.data.totalRecords ?? 0;
        records.push(...(response.data.records ?? []));
        page++;

        if ((response.data.records ?? []).length === 0) {
          break;
        }
      } while (records.length < total);

      return records;
    } catch (e) {
      throw new Error(`[Lidarr] Failed to retrieve queue: ${e.message}`, {
        cause: e,
      });
    }
  };

  public getHistory = async (options: {
    albumId?: number;
    artistId?: number;
    pageSize?: number;
  }): Promise<LidarrHistoryRecord[]> => {
    try {
      const response = await this.axios.get<{
        records: LidarrHistoryRecord[];
      }>('/history', {
        params: {
          page: 1,
          pageSize: options.pageSize ?? 50,
          sortKey: 'date',
          sortDirection: 'descending',
          ...(options.albumId ? { albumId: options.albumId } : {}),
          ...(options.artistId ? { artistId: options.artistId } : {}),
        },
      });

      return response.data.records ?? [];
    } catch (e) {
      throw new Error(`[Lidarr] Failed to retrieve history: ${e.message}`, {
        cause: e,
      });
    }
  };

  public getTracks = async (albumId: number): Promise<LidarrTrack[]> => {
    try {
      const response = await this.axios.get<LidarrTrack[]>('/track', {
        params: { albumId },
      });

      return response.data;
    } catch (e) {
      throw new Error(`[Lidarr] Failed to retrieve tracks: ${e.message}`, {
        cause: e,
      });
    }
  };

  public getTrackFiles = async (
    albumId: number
  ): Promise<LidarrTrackFile[]> => {
    try {
      const response = await this.axios.get<LidarrTrackFile[]>('/trackfile', {
        params: { albumId },
      });

      return response.data;
    } catch (e) {
      throw new Error(`[Lidarr] Failed to retrieve track files: ${e.message}`, {
        cause: e,
      });
    }
  };
}

export default LidarrAPI;
