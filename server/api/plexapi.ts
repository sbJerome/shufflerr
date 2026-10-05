// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import ExternalAPI from '@server/api/externalapi';
import { ApiErrorCode } from '@server/constants/error';
import type { Library, PlexSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { ApiError } from '@server/types/error';

interface PlexStatusResponse {
  MediaContainer: {
    machineIdentifier: string;
    friendlyName: string;
  };
}

interface PlexGuid {
  id: string;
}

export interface PlexPart {
  id: number;
  key: string;
  file?: string;
  size?: number;
  container?: string;
}

export interface PlexAudioMedia {
  id: number;
  duration?: number;
  bitrate?: number;
  audioChannels?: number;
  audioCodec?: string;
  container?: string;
  Part?: PlexPart[];
}

/** An album (Plex type 9) in a music section. */
export interface PlexAlbum {
  ratingKey: string;
  /** Artist rating key */
  parentRatingKey?: string;
  title: string;
  /** Album artist */
  parentTitle?: string;
  guid: string;
  parentGuid?: string;
  year?: number;
  originallyAvailableAt?: string;
  leafCount?: number;
  addedAt: number;
  updatedAt?: number;
  thumb?: string;
  Guid?: PlexGuid[];
  type: 'album';
}

/** A track (Plex type 10). */
export interface PlexTrack {
  ratingKey: string;
  parentRatingKey?: string;
  grandparentRatingKey?: string;
  title: string;
  /** Track artist when it differs from the album artist */
  originalTitle?: string;
  grandparentTitle?: string;
  guid: string;
  /** Track number */
  index?: number;
  /** Disc number */
  parentIndex?: number;
  duration?: number;
  addedAt?: number;
  updatedAt?: number;
  Guid?: PlexGuid[];
  Media?: PlexAudioMedia[];
  type: 'track';
}

interface PlexContainer<T> {
  MediaContainer: {
    totalSize?: number;
    size?: number;
    Metadata?: T[];
  };
}

export interface PlexLibrary {
  type: 'show' | 'movie' | 'artist' | 'photo';
  key: string;
  title: string;
  agent: string;
}

interface PlexLibrariesResponse {
  MediaContainer: {
    Directory: PlexLibrary[];
  };
}

class PlexAPI extends ExternalAPI {
  constructor({
    plexToken,
    plexSettings,
    timeout,
  }: {
    plexToken?: string | null;
    plexSettings?: PlexSettings;
    timeout?: number;
  }) {
    const settings = getSettings();
    const settingsPlex = plexSettings ?? settings.plex;

    const protocol = settingsPlex.useSsl ? 'https' : 'http';
    const baseUrl = `${protocol}://${settingsPlex.ip}:${settingsPlex.port}`;

    super(
      baseUrl,
      {},
      {
        timeout,
        headers: {
          'X-Plex-Token': plexToken ?? '',
          'X-Plex-Client-Identifier': settings.clientId,
          'X-Plex-Product': 'Shufflerr',
          'X-Plex-Device-Name': 'Shufflerr',
          'X-Plex-Platform': 'Shufflerr',
        },
      }
    );
  }

  public async getStatus(): Promise<PlexStatusResponse> {
    return await this.get('/');
  }

  public async getLibraries(): Promise<PlexLibrary[]> {
    const response = await this.get<PlexLibrariesResponse>('/library/sections');

    return response.MediaContainer.Directory;
  }

  public async syncLibraries(): Promise<void> {
    const settings = getSettings();

    try {
      const libraries = await this.getLibraries();

      const newLibraries: Library[] = libraries
        // Shufflerr only cares about music libraries (Plex section type `artist`)
        .filter((library) => library.type === 'artist')
        .map((library) => {
          const existing = settings.plex.libraries.find(
            (l) => l.id === library.key
          );

          return {
            id: library.key,
            name: library.title,
            enabled: existing?.enabled ?? false,
            type: 'music' as const,
            lastScan: existing?.lastScan,
          };
        });

      settings.plex.libraries = newLibraries;
    } catch (e) {
      logger.error('Failed to fetch Plex libraries', {
        label: 'Plex API',
        message: e.message,
      });

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.Unknown);
    }

    await settings.save();
  }

  /** Albums of a music section, paged. `addedSince` (epoch ms) limits to recently added. */
  public async getAlbums(
    sectionId: string,
    {
      offset = 0,
      size = 100,
      addedSince,
    }: { offset?: number; size?: number; addedSince?: number } = {}
  ): Promise<{ totalSize: number; items: PlexAlbum[] }> {
    const response = await this.get<PlexContainer<PlexAlbum>>(
      `/library/sections/${sectionId}/all?type=9&includeGuids=1&sort=addedAt%3Adesc${
        addedSince ? `&addedAt>>=${Math.floor(addedSince / 1000)}` : ''
      }`,
      {
        headers: {
          'X-Plex-Container-Start': `${offset}`,
          'X-Plex-Container-Size': `${size}`,
        },
      },
      0
    );
    const items = response.MediaContainer.Metadata ?? [];

    return {
      totalSize: response.MediaContainer.totalSize ?? items.length,
      items,
    };
  }

  /** Tracks of an album with their GUIDs and media parts. */
  public async getAlbumTracks(albumRatingKey: string): Promise<PlexTrack[]> {
    const response = await this.get<PlexContainer<PlexTrack>>(
      `/library/metadata/${albumRatingKey}/children?includeGuids=1`,
      undefined,
      0
    );

    return response.MediaContainer.Metadata ?? [];
  }

  public async getTrack(ratingKey: string): Promise<PlexTrack | undefined> {
    const response = await this.get<PlexContainer<PlexTrack>>(
      `/library/metadata/${ratingKey}`,
      undefined,
      0
    );

    return response.MediaContainer.Metadata?.[0];
  }

  /** The Part key (`/library/parts/...`) used to stream a track's original file. */
  public async getTrackPartKey(ratingKey: string): Promise<string | undefined> {
    const track = await this.getTrack(ratingKey);

    return track?.Media?.[0]?.Part?.[0]?.key;
  }
}

export default PlexAPI;
