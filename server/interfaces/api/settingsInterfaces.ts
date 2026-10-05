// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type { NotificationTypeKey } from '@server/lib/notifications/types';
import type {
  ClientsSettings,
  DiscoverSettings,
  FullPublicSettings,
  JellyfinSettings,
  JobId,
  LidarrSettings,
  LocalFilesSettings,
  MainSettings,
  MetadataSettings,
  NavidromeSettings,
  NetworkSettings,
  PlexSettings,
  ScrobbleSettings,
  YoutubeSettings,
} from '@server/lib/settings';
import type { DnsEntries, DnsStats } from 'dns-caching';
import type { PaginatedResponse } from './common';
import type { LidarrServerStatus } from './serviceInterfaces';

/* Secrets in every GET below are masked (`••••` + last 4). POST the masked value back
 * unchanged to keep the stored secret; send a new value to replace it; '' clears it. */

export type LogMessage = {
  timestamp: string;
  level: string;
  label?: string;
  message: string;
  data?: Record<string, unknown>;
};

export interface LogsResultsResponse extends PaginatedResponse {
  results: LogMessage[];
}

export interface SettingsAboutResponse {
  version: string;
  commitTag?: string;
  totalRequests: number;
  /** Release groups (albums) in the library index. */
  totalMediaItems: number;
  totalArtists: number;
  totalTracks: number;
  totalUsers: number;
  tz?: string;
  appDataPath: string;
}

export type PublicSettingsResponse = FullPublicSettings;

export interface CacheItem {
  id: string;
  name: string;
  stats: {
    hits: number;
    misses: number;
    keys: number;
    ksize: number;
    vsize: number;
  };
}

export interface CacheResponse {
  apiCaches: CacheItem[];
  /** Keyed by image proxy type (caa, fanart, avatar, …). */
  imageCache: Record<string, { size: number; imageCount: number }>;
  dnsCache: {
    stats: DnsStats | undefined;
    entries: DnsEntries | undefined;
  };
}

export interface StatusResponse {
  version: string;
  commitTag: string;
  updateAvailable?: boolean;
  commitsBehind?: number;
  restartRequired: boolean;
}

/** GET /settings/jobs item */
export interface JobItem {
  id: JobId;
  name: string;
  type: 'process' | 'command';
  interval: 'seconds' | 'minutes' | 'hours' | 'days' | 'fixed';
  cronSchedule: string;
  /** `cronSchedule` in words, e.g. "Every 5 minutes". */
  scheduleText?: string;
  nextExecutionTime: string | null;
  running: boolean;
  /** False while the integration behind the job is off: scheduled ticks are skipped ("Run now" still works). */
  enabled?: boolean;
  /** True when a running job can be stopped with POST …/cancel. */
  cancellable?: boolean;
}

/** GET|POST /settings/main (apiKey unmasked for admins: it has Copy). */
export type MainSettingsResponse = MainSettings;

/** GET|POST /settings/users — sign-in methods, global limits, default permissions. */
export interface UsersSettingsResponse {
  localLogin: boolean;
  plexLogin: boolean;
  newPlexLogin: boolean;
  jellyfinLogin: boolean;
  newJellyfinLogin: boolean;
  defaultPermissions: number;
  defaultQuotas: MainSettings['defaultQuotas'];
  discographyAlwaysReview: boolean;
}

export type NetworkSettingsResponse = NetworkSettings;
export type PlexSettingsResponse = PlexSettings;
export type JellyfinSettingsResponse = JellyfinSettings;
export type NavidromeSettingsResponse = NavidromeSettings;
export type LocalFilesSettingsResponse = LocalFilesSettings;
export type YoutubeSettingsResponse = YoutubeSettings;
export type MetadataSettingsResponse = MetadataSettings;
export type DiscoverSettingsResponse = DiscoverSettings;
export type ScrobbleSettingsResponse = ScrobbleSettings;
export type LidarrSettingsResponse = (LidarrSettings & {
  status?: LidarrServerStatus;
})[];

/** GET /settings/plex/devices/servers — servers on plex.tv for the owner token. */
export interface PlexServerPreset {
  name: string;
  machineId: string;
  connections: {
    protocol: string;
    address: string;
    port: number;
    uri: string;
    local: boolean;
    /** Result of a live connectivity probe. */
    status?: number;
    message?: string;
  }[];
}

/** POST /settings/{plex,jellyfin,navidrome}/test */
export interface ConnectionTestResponse {
  ok: boolean;
  /** Server name / version on success. */
  name?: string;
  version?: string;
  /** What went wrong and how to fix it. */
  message?: string;
}

/** GET /settings/{plex,jellyfin,navidrome,local}/sync — Library scan panel. */
export interface ScanStatus {
  running: boolean;
  /** 0–100 while running. */
  progress: number;
  /** Items processed / total in the current run. */
  current?: number;
  total?: number;
  currentLibrary?: { id: string; name: string } | null;
  /** Epoch ms the last full scan finished; undefined = never. */
  lastFullScan?: number;
  /** Totals this source currently contributes to the library index. */
  albums: number;
  tracks: number;
  /** Last scan error, if the last run failed. */
  error?: string;
}

/** POST /settings/{source}/sync body */
export interface ScanCommandBody {
  start?: boolean;
  cancel?: boolean;
  /** 'recent' = recently added only (Plex/Jellyfin). Default 'full'. */
  mode?: 'full' | 'recent';
}

/** POST /settings/local/folders { path } validation result */
export interface LocalFolderCheckResponse {
  ok: boolean;
  path: string;
  message?: string;
}

/** GET /settings/clients */
export interface ClientsSettingsResponse extends ClientsSettings {
  /** `<applicationUrl>/rest` and `<applicationUrl>/jellyfin` */
  endpoints: { openSubsonic: string; jellyfin: string };
}

/** GET /settings/clients/devices — every app password across users. */
export interface ClientDevice {
  id: number;
  name: string;
  user: { id: number; displayName: string; avatar?: string };
  createdAt: string;
  lastUsedAt?: string | null;
  lastUsedClient?: string | null;
}

/** GET|POST /settings/notifications/:agent — `types` are string keys here. */
export interface NotificationAgentResponse {
  enabled: boolean;
  embedPoster?: boolean;
  types: NotificationTypeKey[];
  options: Record<string, unknown>;
}

/** GET /settings/notifications — pills. */
export interface NotificationAgentsOverview {
  agents: { key: string; name: string; enabled: boolean }[];
}
