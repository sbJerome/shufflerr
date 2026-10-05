// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type { QualityProfile, RootFolder, Tag } from '@server/api/servarr/base';

export interface MetadataProfile {
  id: number;
  name: string;
}

/** A Lidarr server as the request modal sees it (no secrets). */
export interface ServiceCommonServer {
  id: number;
  name: string;
  isHiRes: boolean;
  isDefault: boolean;
  activeQualityProfileId: number;
  activeMetadataProfileId: number;
  activeDirectory: string;
  activeTags: number[];
}

export interface ServiceCommonServerWithDetails {
  server: ServiceCommonServer;
  profiles: QualityProfile[];
  metadataProfiles: MetadataProfile[];
  rootFolders: Partial<RootFolder>[];
  tags: Tag[];
}

/** POST /settings/lidarr/test response */
export interface LidarrTestResponse {
  profiles: QualityProfile[];
  metadataProfiles: MetadataProfile[];
  rootFolders: Partial<RootFolder>[];
  tags: Tag[];
  urlBase?: string;
  version?: string;
}

/** GET /settings/lidarr item: LidarrSettings (apiKey masked) plus live status. */
export interface LidarrServerStatus {
  id: number;
  connected: boolean;
  version?: string;
  error?: string;
}
