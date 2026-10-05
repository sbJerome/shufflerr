// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
/* eslint-disable @typescript-eslint/no-explicit-any */
import ExternalAPI from '@server/api/externalapi';
import { ApiErrorCode } from '@server/constants/error';
import { MediaServerType } from '@server/constants/server';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { ApiError } from '@server/types/error';
import { getAppVersion } from '@server/utils/appVersion';

export interface JellyfinUserResponse {
  Name: string;
  ServerId: string;
  ServerName: string;
  Id: string;
  Configuration: {
    GroupedFolders: string[];
  };
  Policy: {
    IsAdministrator: boolean;
  };
  PrimaryImageTag?: string;
}

export interface JellyfinDevice {
  Id: string;
  Name: string;
  LastUserName: string;
  AppName: string;
  AppVersion: string;
  LastUserId: string;
  DateLastActivity: string;
  Capabilities: Record<string, unknown>;
}

export interface JellyfinDevicesResponse {
  Items: JellyfinDevice[];
  TotalRecordCount: number;
  StartIndex: number;
}

export interface JellyfinLoginResponse {
  User: JellyfinUserResponse;
  AccessToken: string;
}

export interface QuickConnectInitiateResponse {
  Secret: string;
  Code: string;
  DateAdded: string;
}

export interface QuickConnectStatusResponse {
  Authenticated: boolean;
  Secret: string;
  Code: string;
  DeviceId: string;
  DeviceName: string;
  AppName: string;
  AppVersion: string;
  DateAdded: string;
}

export interface JellyfinUserListResponse {
  users: JellyfinUserResponse[];
}

interface JellyfinMediaFolder {
  Name: string;
  Id: string;
  Type: string;
  CollectionType: string;
}

export interface JellyfinLibrary {
  type: 'music';
  key: string;
  title: string;
  agent: string;
}

/** MusicAlbum / Audio items as returned with Fields=ProviderIds,MediaSources,DateCreated. */
export interface JellyfinMusicItem {
  Name: string;
  Id: string;
  Type: 'MusicAlbum' | 'Audio';
  AlbumArtist?: string;
  AlbumArtists?: { Name: string; Id: string }[];
  Artists?: string[];
  Album?: string;
  AlbumId?: string;
  ProductionYear?: number;
  /** Track number */
  IndexNumber?: number;
  /** Disc number */
  ParentIndexNumber?: number;
  RunTimeTicks?: number;
  DateCreated?: string;
  ChildCount?: number;
  Container?: string;
  LocationType?: 'FileSystem' | 'Offline' | 'Remote' | 'Virtual';
  ProviderIds?: {
    MusicBrainzReleaseGroup?: string;
    MusicBrainzAlbum?: string;
    MusicBrainzAlbumArtist?: string;
    MusicBrainzArtist?: string;
    MusicBrainzTrack?: string;
    MusicBrainzRecording?: string;
  };
  MediaSources?: {
    Id: string;
    Container?: string;
    Bitrate?: number;
    MediaStreams?: {
      Type: string;
      Codec?: string;
      BitRate?: number;
      BitDepth?: number;
      SampleRate?: number;
    }[];
  }[];
}

interface JellyfinMusicItemsResponse {
  Items: JellyfinMusicItem[];
  TotalRecordCount: number;
}

class JellyfinAPI extends ExternalAPI {
  private authHeaderValue: string;
  private userId?: string;
  private mediaServerType: MediaServerType;

  constructor(
    jellyfinHost: string,
    authToken?: string | null,
    deviceId?: string | null
  ) {
    const settings = getSettings();
    const safeDeviceId =
      deviceId && deviceId.length > 0
        ? deviceId
        : Buffer.from('BOT_shufflerr').toString('base64');

    const version =
      settings.main.mediaServerType === MediaServerType.EMBY
        ? '1.0.0'
        : getAppVersion();

    let authHeaderVal = `MediaBrowser Client="Shufflerr", Device="Shufflerr", DeviceId="${safeDeviceId}", Version="${version}"`;
    if (authToken) {
      authHeaderVal += `, Token="${authToken}"`;
    }

    super(
      jellyfinHost,
      {},
      {
        headers: {
          Authorization: authHeaderVal,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }
    );

    this.mediaServerType = settings.main.mediaServerType;
    this.authHeaderValue = authHeaderVal;
  }

  /** Headers for fetching a stream or image straight from the server. */
  public authHeaders(): Record<string, string> {
    return { Authorization: this.authHeaderValue };
  }

  public async login(
    Username?: string,
    Password?: string,
    ClientIP?: string
  ): Promise<JellyfinLoginResponse> {
    const authenticate = async (useHeaders: boolean) => {
      const headers =
        useHeaders && ClientIP ? { 'X-Forwarded-For': ClientIP } : {};

      return this.post<JellyfinLoginResponse>(
        '/Users/AuthenticateByName',
        {
          Username,
          Pw: Password,
        },
        { headers }
      );
    };

    try {
      return await authenticate(true);
    } catch (e) {
      logger.debug('Failed to authenticate with headers', {
        label: 'Jellyfin API',
        error: e.response?.statusText,
        ip: ClientIP,
      });

      if (!e.response?.status) {
        throw new ApiError(404, ApiErrorCode.InvalidUrl);
      }

      if (e.response?.status === 401) {
        throw new ApiError(e.response?.status, ApiErrorCode.InvalidCredentials);
      }
    }

    try {
      return await authenticate(false);
    } catch (e) {
      if (e.response?.status === 401) {
        throw new ApiError(e.response?.status, ApiErrorCode.InvalidCredentials);
      }

      logger.error(
        `Something went wrong while authenticating with the Jellyfin server: ${e.message}`,
        {
          label: 'Jellyfin API',
          error: e.response?.status,
          ip: ClientIP,
        }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.Unknown);
    }
  }

  public async initiateQuickConnect(): Promise<QuickConnectInitiateResponse> {
    try {
      const response = await this.post<QuickConnectInitiateResponse>(
        '/QuickConnect/Initiate'
      );

      return response;
    } catch (e) {
      logger.error(
        `Something went wrong while initiating Quick Connect: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.Unknown);
    }
  }

  public async checkQuickConnect(
    secret: string
  ): Promise<QuickConnectStatusResponse> {
    try {
      const response = await this.get<QuickConnectStatusResponse>(
        '/QuickConnect/Connect',
        { params: { secret } }
      );

      return response;
    } catch (e) {
      logger.error(
        `Something went wrong while getting Quick Connect status: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.Unknown);
    }
  }

  public async authenticateQuickConnect(
    secret: string
  ): Promise<JellyfinLoginResponse> {
    try {
      const response = await this.post<JellyfinLoginResponse>(
        '/Users/AuthenticateWithQuickConnect',
        { Secret: secret }
      );
      return response;
    } catch (e) {
      logger.error(
        `Something went wrong while authenticating with Quick Connect: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.Unknown);
    }
  }

  public setUserId(userId: string): void {
    this.userId = userId;
    return;
  }

  public async getSystemInfo(): Promise<any> {
    try {
      const systemInfoResponse = await this.get<any>('/System/Info');

      return systemInfoResponse;
    } catch (e) {
      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getServerName(): Promise<string> {
    try {
      const serverResponse = await this.get<JellyfinUserResponse>(
        '/System/Info/Public'
      );

      return serverResponse.ServerName;
    } catch (e) {
      logger.error(
        `Something went wrong while getting the server name from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.Unknown);
    }
  }

  public async getUsers(): Promise<JellyfinUserListResponse> {
    try {
      const userReponse = await this.get<JellyfinUserResponse[]>(`/Users`);

      return { users: userReponse };
    } catch (e) {
      logger.error(
        `Something went wrong while getting the account from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getUser(): Promise<JellyfinUserResponse> {
    try {
      const userReponse = await this.get<JellyfinUserResponse>(
        `/Users/${this.userId ?? 'Me'}`
      );
      return userReponse;
    } catch (e) {
      logger.error(
        `Something went wrong while getting the account from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getLibraries(): Promise<JellyfinLibrary[]> {
    try {
      const mediaFolderResponse = await this.get<any>(`/Library/MediaFolders`);

      return this.mapLibraries(mediaFolderResponse.Items);
    } catch {
      // fallback to user views to get libraries
      // this only and maybe/depending on factors affects LDAP users
      try {
        const mediaFolderResponse = await this.get<any>(
          `/Users/${this.userId ?? 'Me'}/Views`
        );

        return this.mapLibraries(mediaFolderResponse.Items);
      } catch (e) {
        logger.error(
          `Something went wrong while getting libraries from the Jellyfin server: ${e.message}`,
          {
            label: 'Jellyfin API',
            error: e.response?.status,
          }
        );

        if (!e.response) {
          throw new ApiError(502, ApiErrorCode.ConnectionError);
        }

        return [];
      }
    }
  }

  private mapLibraries(mediaFolders: JellyfinMediaFolder[]): JellyfinLibrary[] {
    // Shufflerr only uses music libraries (CollectionType `music`)
    return mediaFolders
      .filter(
        (Item: JellyfinMediaFolder) =>
          Item.Type === 'CollectionFolder' && Item.CollectionType === 'music'
      )
      .map((Item: JellyfinMediaFolder) => {
        return <JellyfinLibrary>{
          key: Item.Id,
          title: Item.Name,
          type: 'music',
          agent: 'jellyfin',
        };
      });
  }

  private itemsEndpoint(): string {
    // Emby only lists items below a user; Jellyfin accepts both
    return this.mediaServerType === MediaServerType.EMBY && this.userId
      ? `/Users/${this.userId}/Items`
      : '/Items';
  }

  /** Albums of a music library, paged. `addedSince` limits to recently created items. */
  public async getMusicAlbums(
    libraryId: string,
    {
      startIndex = 0,
      limit = 200,
      recentFirst = false,
    }: { startIndex?: number; limit?: number; recentFirst?: boolean } = {}
  ): Promise<{ total: number; items: JellyfinMusicItem[] }> {
    const response = await this.get<JellyfinMusicItemsResponse>(
      this.itemsEndpoint(),
      {
        params: {
          ParentId: libraryId,
          IncludeItemTypes: 'MusicAlbum',
          Recursive: true,
          Fields: 'ProviderIds,DateCreated,ChildCount',
          SortBy: recentFirst ? 'DateCreated' : 'SortName',
          SortOrder: recentFirst ? 'Descending' : 'Ascending',
          StartIndex: startIndex,
          Limit: limit,
          ...(this.userId ? { UserId: this.userId } : {}),
        },
      },
      0
    );

    return {
      total: response.TotalRecordCount ?? response.Items?.length ?? 0,
      items: response.Items ?? [],
    };
  }

  /** Audio items of an album with provider ids and media sources. */
  public async getAlbumTracks(albumId: string): Promise<JellyfinMusicItem[]> {
    const response = await this.get<JellyfinMusicItemsResponse>(
      this.itemsEndpoint(),
      {
        params: {
          ParentId: albumId,
          IncludeItemTypes: 'Audio',
          Recursive: true,
          Fields: 'ProviderIds,MediaSources,DateCreated',
          SortBy: 'ParentIndexNumber,IndexNumber,SortName',
          ...(this.userId ? { UserId: this.userId } : {}),
        },
      },
      0
    );

    return (response.Items ?? []).filter(
      (item) => item.LocationType !== 'Virtual'
    );
  }

  public async createApiToken(appName: string): Promise<string> {
    try {
      await this.post(`/Auth/Keys?App=${appName}`);
      const apiKeys = await this.get<any>(`/Auth/Keys`);
      return apiKeys.Items.reverse().find(
        (item: any) => item.AppName === appName
      ).AccessToken;
    } catch (e) {
      logger.error(
        `Something went wrong while creating an API key from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.InvalidAuthToken);
    }
  }
}

export default JellyfinAPI;
