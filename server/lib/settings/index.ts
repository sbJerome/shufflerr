// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { MediaServerType } from '@server/constants/server';
import { Permission } from '@server/lib/permissions';
import { runMigrations } from '@server/lib/settings/migrator';
import type { AvailableLocale } from '@server/types/languages';
import { randomBytes, randomUUID } from 'crypto';
import fs from 'fs/promises';
import { mergeWith } from 'lodash';
import path from 'path';
import webpush from 'web-push';

// Prevents stale array entries when incoming data has fewer elements
const mergeSettings = <T>(current: T, incoming: Partial<T>): T =>
  mergeWith({}, current, incoming, (_objValue, srcValue) =>
    Array.isArray(srcValue) ? srcValue : undefined
  ) as T;

export interface Library {
  id: string;
  name: string;
  enabled: boolean;
  /** Plex section type `artist`, Jellyfin CollectionType `music`. Only music libraries are stored. */
  type: 'music';
  lastScan?: number;
}

export interface PlexSettings {
  /** Use Plex as a library source ("Stream from"). */
  enabled: boolean;
  /** Show the "Sign in with Plex" button. */
  loginEnabled: boolean;
  name: string;
  machineId?: string;
  ip: string;
  port: number;
  useSsl?: boolean;
  libraries: Library[];
  webAppUrl?: string;
  /** Epoch ms of the last completed full scan. */
  lastFullScan?: number;
}

export interface JellyfinSettings {
  enabled: boolean;
  loginEnabled: boolean;
  /** Let unknown Jellyfin users create an account on first sign-in. */
  newLogin: boolean;
  name: string;
  ip: string;
  port: number;
  useSsl?: boolean;
  urlBase?: string;
  externalHostname?: string;
  jellyfinForgotPasswordUrl?: string;
  libraries: Library[];
  serverId: string;
  apiKey: string;
  lastFullScan?: number;
}

export interface NavidromeSettings {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
  lastFullScan?: number;
}

export interface LocalFilesSettings {
  enabled: boolean;
  folders: string[];
  watch: boolean;
  rescanMinutes: number;
  lastFullScan?: number;
}

export interface YoutubeSettings {
  enabled: boolean;
  apiKey: string;
  region: string;
  fillMissingWhileDownloading: boolean;
}

export type MobileTranscode = 'original' | 'opus-160' | 'mp3-320' | 'mp3-128';

export interface ClientsSettings {
  openSubsonic: boolean;
  jellyfinApi: boolean;
  allowDownloads: boolean;
  mobileTranscode: MobileTranscode;
}

export interface LidarrSettings {
  id: number;
  name: string;
  hostname: string;
  port: number;
  apiKey: string;
  useSsl: boolean;
  baseUrl?: string;
  isDefault: boolean;
  isHiRes: boolean;
  activeQualityProfileId: number;
  activeQualityProfileName: string;
  activeMetadataProfileId: number;
  activeMetadataProfileName: string;
  activeDirectory: string;
  tags: number[];
  externalUrl?: string;
  syncEnabled: boolean;
  preventSearch: boolean;
  tagRequests?: boolean;
  overrideRule?: number[];
}

export interface MetadataSettings {
  musicbrainz: { url: string; requestsPerSecond: number; contact: string };
  coverArtArchive: { enabled: boolean };
  fanart: { enabled: boolean; apiKey: string };
  lastfm: { enabled: boolean; apiKey: string; sharedSecret: string };
  priority: 'musicbrainz-first' | 'lastfm-first';
}

export interface DiscoverSettings {
  spotify: {
    enabled: boolean;
    clientId: string;
    clientSecret: string;
    savedAlbumsSync: 'daily' | 'hourly' | 'never';
  };
  deezer: { enabled: boolean };
  itunes: { enabled: boolean; country: string };
  ticketmaster: {
    enabled: boolean;
    apiKey: string;
    country: string;
    radiusMiles: number;
  };
  skiddle: { enabled: boolean; apiKey: string };
  listenbrainzTrending: { enabled: boolean };
}

export type ScrobbleRule = 'half-or-4min' | 'end' | '30s';

export interface ScrobbleSettings {
  listenbrainz: { enabled: boolean; url: string };
  lastfm: { enabled: boolean };
  rule: ScrobbleRule;
  sources: {
    plex: boolean;
    jellyfin: boolean;
    navidrome: boolean;
    apps: boolean;
    web: boolean;
  };
}

interface Quota {
  quotaLimit?: number;
  quotaDays?: number;
}

export interface ProxySettings {
  enabled: boolean;
  hostname: string;
  port: number;
  useSsl: boolean;
  user: string;
  password: string;
  bypassFilter: string;
  bypassLocalAddresses: boolean;
}

export interface MainSettings {
  apiKey: string;
  applicationTitle: string;
  applicationUrl: string;
  cacheImages: boolean;
  defaultPermissions: number;
  defaultQuotas: {
    album: Quota;
    track: Quota;
  };
  discographyAlwaysReview: boolean;
  allowTrackRequests: boolean;
  hideAvailable: boolean;
  /**
   * When true, the audio-verification sidecar selects releases and submits them
   * straight to the download client, using Lidarr only to tag/organize on
   * import (bypassing Lidarr's release matcher). Indexers and download clients
   * are still configured in Lidarr; Shufflerr reads them from there.
   */
  musicDirectGrab: boolean;
  /** Shufflerr accounts (email + password). */
  localLogin: boolean;
  /** Seerr's master switch for media-server sign-in; per-server switches are plex.loginEnabled / jellyfin.loginEnabled. */
  mediaServerLogin: boolean;
  newPlexLogin: boolean;
  discoverRegion: string;
  /** Media server the owner signed in with during setup (Seerr semantics). Library sources are enabled independently. */
  mediaServerType: number;
  locale: string;
  versionCheck: boolean;
}

export interface DnsCacheSettings {
  enabled: boolean;
  forceMinTtl?: number;
  forceMaxTtl?: number;
}

export interface NetworkSettings {
  csrfProtection: boolean;
  forceIpv4First: boolean;
  trustProxy: boolean;
  proxy: ProxySettings;
  dnsCache: DnsCacheSettings;
  apiRequestTimeout: number;
}

interface PublicSettings {
  initialized: boolean;
}

/** Which integrations are switched on (and configured enough to use). Drives what the UI shows. */
export interface EnabledIntegrations {
  lidarr: boolean;
  plex: boolean;
  jellyfin: boolean;
  navidrome: boolean;
  localFiles: boolean;
  youtube: boolean;
  youtubeFill: boolean;
  spotify: boolean;
  deezer: boolean;
  itunes: boolean;
  ticketmaster: boolean;
  skiddle: boolean;
  listenbrainzTrending: boolean;
  listenbrainz: boolean;
  lastfm: boolean;
  lastfmScrobble: boolean;
  fanart: boolean;
  openSubsonic: boolean;
  jellyfinApi: boolean;
}

export interface FullPublicSettings extends PublicSettings {
  applicationTitle: string;
  applicationUrl: string;
  hideAvailable: boolean;
  allowTrackRequests: boolean;
  discographyAlwaysReview: boolean;
  localLogin: boolean;
  mediaServerLogin: boolean;
  plexLoginEnabled: boolean;
  jellyfinLoginEnabled: boolean;
  newPlexLogin: boolean;
  newJellyfinLogin: boolean;
  discoverRegion: string;
  mediaServerType: number;
  jellyfinExternalHost?: string;
  jellyfinForgotPasswordUrl?: string;
  jellyfinServerName?: string;
  cacheImages: boolean;
  vapidPublic: string;
  enablePushRegistration: boolean;
  locale: string;
  emailEnabled: boolean;
  userEmailRequired: boolean;
  versionCheck: boolean;
  plexClientIdentifier: string;
  integrations: EnabledIntegrations;
  /** True when at least one import source (Spotify, Deezer, iTunes) is on. */
  importEnabled: boolean;
  /** True when Ticketmaster or Skiddle is on. */
  concertsEnabled: boolean;
}

export interface NotificationAgentConfig {
  enabled: boolean;
  embedPoster: boolean;
  types?: number;
  options: Record<string, unknown>;
}
export interface NotificationAgentDiscord extends NotificationAgentConfig {
  options: {
    botUsername?: string;
    botAvatarUrl?: string;
    webhookUrl: string;
    webhookRoleId?: string;
    webhookThreadId?: string;
    enableMentions: boolean;
    locale: AvailableLocale;
    useUserLocale: boolean;
  };
}

export interface NotificationAgentSlack extends NotificationAgentConfig {
  options: {
    webhookUrl: string;
    locale: AvailableLocale;
  };
}

export interface NotificationAgentEmail extends NotificationAgentConfig {
  options: {
    userEmailRequired: boolean;
    emailFrom: string;
    smtpHost: string;
    smtpPort: number;
    secure: boolean;
    ignoreTls: boolean;
    requireTls: boolean;
    authUser?: string;
    authPass?: string;
    allowSelfSigned: boolean;
    senderName: string;
    usePublicLogo: boolean;
    pgpPrivateKey?: string;
    pgpPassword?: string;
  };
}

export interface NotificationAgentTelegram extends NotificationAgentConfig {
  options: {
    botUsername?: string;
    botAPI: string;
    chatId: string;
    messageThreadId: string;
    sendSilently: boolean;
  };
}

export interface NotificationAgentPushbullet extends NotificationAgentConfig {
  options: {
    accessToken: string;
    channelTag?: string;
  };
}

export interface NotificationAgentPushover extends NotificationAgentConfig {
  options: {
    accessToken: string;
    userToken: string;
    sound: string;
  };
}

export interface NotificationAgentWebhook extends NotificationAgentConfig {
  options: {
    webhookUrl: string;
    jsonPayload: string;
    authHeader?: string;
    customHeaders?: { key: string; value: string }[];
    supportVariables?: boolean;
  };
}

export interface NotificationAgentGotify extends NotificationAgentConfig {
  options: {
    url: string;
    token: string;
    priority: number;
    locale: AvailableLocale;
  };
}

export interface NotificationAgentNtfy extends NotificationAgentConfig {
  options: {
    url: string;
    topic: string;
    tags?: string;
    authMethodUsernamePassword?: boolean;
    username?: string;
    password?: string;
    authMethodToken?: boolean;
    token?: string;
    priority?: number;
    locale: AvailableLocale;
  };
}

export enum NotificationAgentKey {
  DISCORD = 'discord',
  EMAIL = 'email',
  GOTIFY = 'gotify',
  NTFY = 'ntfy',
  PUSHBULLET = 'pushbullet',
  PUSHOVER = 'pushover',
  SLACK = 'slack',
  TELEGRAM = 'telegram',
  WEBHOOK = 'webhook',
  WEBPUSH = 'webpush',
}

interface NotificationAgents {
  discord: NotificationAgentDiscord;
  email: NotificationAgentEmail;
  gotify: NotificationAgentGotify;
  ntfy: NotificationAgentNtfy;
  pushbullet: NotificationAgentPushbullet;
  pushover: NotificationAgentPushover;
  slack: NotificationAgentSlack;
  telegram: NotificationAgentTelegram;
  webhook: NotificationAgentWebhook;
  webpush: NotificationAgentConfig;
}

interface NotificationSettings {
  agents: NotificationAgents;
}

interface JobSettings {
  schedule: string;
}

export type JobId =
  | 'plex-recently-added-scan'
  | 'plex-full-scan'
  | 'plex-refresh-token'
  | 'jellyfin-recently-added-scan'
  | 'jellyfin-full-scan'
  | 'navidrome-scan'
  | 'local-files-scan'
  | 'lidarr-scan'
  | 'download-sync'
  | 'download-sync-reset'
  | 'availability-sync'
  | 'spotify-saved-albums-sync'
  | 'scrobble-queue'
  | 'concerts-refresh'
  | 'image-cache-cleanup';

export interface AllSettings {
  clientId: string;
  /** Used to derive the key that encrypts linked-account secrets and app passwords. */
  serverSecret: string;
  sessionSecret?: string;
  vapidPublic: string;
  vapidPrivate: string;
  main: MainSettings;
  plex: PlexSettings;
  jellyfin: JellyfinSettings;
  navidrome: NavidromeSettings;
  localFiles: LocalFilesSettings;
  youtube: YoutubeSettings;
  clients: ClientsSettings;
  lidarr: LidarrSettings[];
  metadata: MetadataSettings;
  discover: DiscoverSettings;
  scrobble: ScrobbleSettings;
  public: PublicSettings;
  notifications: NotificationSettings;
  jobs: Record<JobId, JobSettings>;
  network: NetworkSettings;
  migrations: string[];
}

const SETTINGS_PATH = process.env.CONFIG_DIRECTORY
  ? `${process.env.CONFIG_DIRECTORY}/settings.json`
  : path.join(__dirname, '../../../config/settings.json');

class Settings {
  private data: AllSettings;
  private saveLock: Promise<void> = Promise.resolve();

  constructor(initialSettings?: AllSettings) {
    this.data = {
      clientId: randomUUID(),
      serverSecret: '',
      sessionSecret: '',
      vapidPrivate: '',
      vapidPublic: '',
      main: {
        apiKey: '',
        applicationTitle: 'Shufflerr',
        applicationUrl: '',
        cacheImages: true,
        defaultPermissions: Permission.REQUEST | Permission.AUTO_APPROVE_TRACK,
        defaultQuotas: {
          album: { quotaLimit: 10, quotaDays: 7 },
          track: { quotaLimit: 50, quotaDays: 7 },
        },
        discographyAlwaysReview: true,
        allowTrackRequests: true,
        hideAvailable: false,
        musicDirectGrab: false,
        localLogin: true,
        mediaServerLogin: true,
        newPlexLogin: true,
        discoverRegion: '',
        mediaServerType: MediaServerType.NOT_CONFIGURED,
        locale: 'en',
        // TODO(decision): Shufflerr has no public release feed yet, so the
        // update check stays off until one exists.
        versionCheck: false,
      },
      plex: {
        enabled: false,
        loginEnabled: true,
        name: '',
        ip: '',
        port: 32400,
        useSsl: false,
        libraries: [],
      },
      jellyfin: {
        enabled: false,
        loginEnabled: false,
        newLogin: false,
        name: '',
        ip: '',
        port: 8096,
        useSsl: false,
        urlBase: '',
        externalHostname: '',
        jellyfinForgotPasswordUrl: '',
        libraries: [],
        serverId: '',
        apiKey: '',
      },
      navidrome: {
        enabled: false,
        url: '',
        username: '',
        password: '',
      },
      localFiles: {
        enabled: false,
        folders: [],
        watch: true,
        rescanMinutes: 15,
      },
      youtube: {
        enabled: false,
        apiKey: '',
        region: '',
        fillMissingWhileDownloading: true,
      },
      clients: {
        openSubsonic: false,
        jellyfinApi: false,
        allowDownloads: true,
        mobileTranscode: 'opus-160',
      },
      lidarr: [],
      metadata: {
        musicbrainz: {
          url: 'https://musicbrainz.org',
          requestsPerSecond: 1,
          contact: '',
        },
        coverArtArchive: { enabled: true },
        fanart: { enabled: false, apiKey: '' },
        lastfm: { enabled: false, apiKey: '', sharedSecret: '' },
        priority: 'musicbrainz-first',
      },
      discover: {
        spotify: {
          enabled: false,
          clientId: '',
          clientSecret: '',
          savedAlbumsSync: 'daily',
        },
        deezer: { enabled: false },
        itunes: { enabled: false, country: 'US' },
        ticketmaster: {
          enabled: false,
          apiKey: '',
          country: 'US',
          radiusMiles: 50,
        },
        skiddle: { enabled: false, apiKey: '' },
        listenbrainzTrending: { enabled: false },
      },
      scrobble: {
        listenbrainz: { enabled: false, url: 'https://api.listenbrainz.org' },
        lastfm: { enabled: false },
        rule: 'half-or-4min',
        sources: {
          plex: true,
          jellyfin: true,
          navidrome: true,
          apps: true,
          web: true,
        },
      },
      public: {
        initialized: false,
      },
      notifications: {
        agents: {
          email: {
            enabled: false,
            embedPoster: true,
            options: {
              userEmailRequired: false,
              emailFrom: '',
              smtpHost: '',
              smtpPort: 587,
              secure: false,
              ignoreTls: false,
              requireTls: false,
              allowSelfSigned: false,
              senderName: 'Shufflerr',
              usePublicLogo: false,
            },
          },
          discord: {
            enabled: false,
            embedPoster: true,
            types: 0,
            options: {
              webhookUrl: '',
              webhookRoleId: '',
              enableMentions: true,
              locale: 'en',
              useUserLocale: true,
            },
          },
          slack: {
            enabled: false,
            embedPoster: true,
            types: 0,
            options: {
              webhookUrl: '',
              locale: 'en',
            },
          },
          telegram: {
            enabled: false,
            embedPoster: true,
            types: 0,
            options: {
              botAPI: '',
              chatId: '',
              messageThreadId: '',
              sendSilently: false,
            },
          },
          pushbullet: {
            enabled: false,
            embedPoster: false,
            types: 0,
            options: {
              accessToken: '',
            },
          },
          pushover: {
            enabled: false,
            embedPoster: true,
            types: 0,
            options: {
              accessToken: '',
              userToken: '',
              sound: '',
            },
          },
          webhook: {
            enabled: false,
            embedPoster: true,
            types: 0,
            options: {
              webhookUrl: '',
              jsonPayload:
                'IntcbiAgXCJub3RpZmljYXRpb25fdHlwZVwiOiBcInt7bm90aWZpY2F0aW9uX3R5cGV9fVwiLFxuICBcImV2ZW50XCI6IFwie3tldmVudH19XCIsXG4gIFwic3ViamVjdFwiOiBcInt7c3ViamVjdH19XCIsXG4gIFwibWVzc2FnZVwiOiBcInt7bWVzc2FnZX19XCIsXG4gIFwiaW1hZ2VcIjogXCJ7e2ltYWdlfX1cIixcbiAgXCJ7e21lZGlhfX1cIjoge1xuICAgIFwibWVkaWFfdHlwZVwiOiBcInt7bWVkaWFfdHlwZX19XCIsXG4gICAgXCJtYmlkXCI6IFwie3ttZWRpYV9tYmlkfX1cIixcbiAgICBcInRpdGxlXCI6IFwie3ttZWRpYV90aXRsZX19XCIsXG4gICAgXCJhcnRpc3RcIjogXCJ7e21lZGlhX2FydGlzdH19XCIsXG4gICAgXCJzdGF0dXNcIjogXCJ7e21lZGlhX3N0YXR1c319XCJcbiAgfSxcbiAgXCJ7e3JlcXVlc3R9fVwiOiB7XG4gICAgXCJyZXF1ZXN0X2lkXCI6IFwie3tyZXF1ZXN0X2lkfX1cIixcbiAgICBcInNjb3BlXCI6IFwie3tyZXF1ZXN0X3Njb3BlfX1cIixcbiAgICBcInRyYWNrX2NvdW50XCI6IFwie3tyZXF1ZXN0X3RyYWNrX2NvdW50fX1cIixcbiAgICBcInJlbGVhc2VfY291bnRcIjogXCJ7e3JlcXVlc3RfcmVsZWFzZV9jb3VudH19XCIsXG4gICAgXCJyZXF1ZXN0ZWRCeV9lbWFpbFwiOiBcInt7cmVxdWVzdGVkQnlfZW1haWx9fVwiLFxuICAgIFwicmVxdWVzdGVkQnlfdXNlcm5hbWVcIjogXCJ7e3JlcXVlc3RlZEJ5X3VzZXJuYW1lfX1cIixcbiAgICBcInJlcXVlc3RlZEJ5X2F2YXRhclwiOiBcInt7cmVxdWVzdGVkQnlfYXZhdGFyfX1cIlxuICB9LFxuICBcInt7ZXh0cmF9fVwiOiBbXVxufSI=',
            },
          },
          webpush: {
            enabled: false,
            embedPoster: true,
            options: {},
          },
          gotify: {
            enabled: false,
            embedPoster: false,
            types: 0,
            options: {
              url: '',
              token: '',
              priority: 0,
              locale: 'en',
            },
          },
          ntfy: {
            enabled: false,
            embedPoster: true,
            types: 0,
            options: {
              url: '',
              topic: '',
              tags: '',
              priority: 3,
              locale: 'en',
            },
          },
        },
      },
      jobs: {
        'plex-recently-added-scan': { schedule: '0 */5 * * * *' },
        'plex-full-scan': { schedule: '0 0 3 * * *' },
        'plex-refresh-token': { schedule: '0 0 5 * * *' },
        'jellyfin-recently-added-scan': { schedule: '0 */5 * * * *' },
        'jellyfin-full-scan': { schedule: '0 30 3 * * *' },
        'navidrome-scan': { schedule: '0 */15 * * * *' },
        'local-files-scan': { schedule: '0 */15 * * * *' },
        'lidarr-scan': { schedule: '0 0 4 * * *' },
        'download-sync': { schedule: '0 * * * * *' },
        'download-sync-reset': { schedule: '0 0 1 * * *' },
        'availability-sync': { schedule: '0 0 0 * * *' },
        'spotify-saved-albums-sync': { schedule: '0 0 6 * * *' },
        'scrobble-queue': { schedule: '*/30 * * * * *' },
        'concerts-refresh': { schedule: '0 0 7 * * *' },
        'image-cache-cleanup': { schedule: '0 0 2 * * *' },
      },
      network: {
        csrfProtection: false,
        forceIpv4First: false,
        trustProxy: false,
        proxy: {
          enabled: false,
          hostname: '',
          port: 8080,
          useSsl: false,
          user: '',
          password: '',
          bypassFilter: '',
          bypassLocalAddresses: true,
        },
        dnsCache: {
          enabled: false,
          forceMinTtl: 0,
          forceMaxTtl: -1,
        },
        apiRequestTimeout: 10000,
      },
      migrations: [],
    };
    if (initialSettings) {
      this.data = mergeSettings(this.data, initialSettings);
    }
  }

  get main(): MainSettings {
    return this.data.main;
  }

  set main(data: MainSettings) {
    this.data.main = mergeSettings(this.data.main, data);
  }

  get plex(): PlexSettings {
    return this.data.plex;
  }

  set plex(data: PlexSettings) {
    this.data.plex = mergeSettings(this.data.plex, data);
  }

  get jellyfin(): JellyfinSettings {
    return this.data.jellyfin;
  }

  set jellyfin(data: JellyfinSettings) {
    this.data.jellyfin = mergeSettings(this.data.jellyfin, data);
  }

  get navidrome(): NavidromeSettings {
    return this.data.navidrome;
  }

  set navidrome(data: NavidromeSettings) {
    this.data.navidrome = mergeSettings(this.data.navidrome, data);
  }

  get localFiles(): LocalFilesSettings {
    return this.data.localFiles;
  }

  set localFiles(data: LocalFilesSettings) {
    this.data.localFiles = mergeSettings(this.data.localFiles, data);
  }

  get youtube(): YoutubeSettings {
    return this.data.youtube;
  }

  set youtube(data: YoutubeSettings) {
    this.data.youtube = mergeSettings(this.data.youtube, data);
  }

  get clients(): ClientsSettings {
    return this.data.clients;
  }

  set clients(data: ClientsSettings) {
    this.data.clients = mergeSettings(this.data.clients, data);
  }

  get lidarr(): LidarrSettings[] {
    return this.data.lidarr;
  }

  set lidarr(data: LidarrSettings[]) {
    this.data.lidarr = data;
  }

  get metadata(): MetadataSettings {
    return this.data.metadata;
  }

  set metadata(data: MetadataSettings) {
    this.data.metadata = mergeSettings(this.data.metadata, data);
  }

  get discover(): DiscoverSettings {
    return this.data.discover;
  }

  set discover(data: DiscoverSettings) {
    this.data.discover = mergeSettings(this.data.discover, data);
  }

  get scrobble(): ScrobbleSettings {
    return this.data.scrobble;
  }

  set scrobble(data: ScrobbleSettings) {
    this.data.scrobble = mergeSettings(this.data.scrobble, data);
  }

  get public(): PublicSettings {
    return this.data.public;
  }

  set public(data: PublicSettings) {
    this.data.public = mergeSettings(this.data.public, data);
  }

  /** Which integrations are on and configured enough to be usable. */
  get integrations(): EnabledIntegrations {
    const d = this.data;
    const lastfm = d.metadata.lastfm.enabled && !!d.metadata.lastfm.apiKey;
    return {
      lidarr: d.lidarr.length > 0,
      plex: d.plex.enabled && !!d.plex.ip,
      jellyfin: d.jellyfin.enabled && !!d.jellyfin.ip,
      navidrome: d.navidrome.enabled && !!d.navidrome.url,
      localFiles: d.localFiles.enabled && d.localFiles.folders.length > 0,
      youtube: d.youtube.enabled && !!d.youtube.apiKey,
      youtubeFill:
        d.youtube.enabled &&
        !!d.youtube.apiKey &&
        d.youtube.fillMissingWhileDownloading,
      spotify:
        d.discover.spotify.enabled &&
        !!d.discover.spotify.clientId &&
        !!d.discover.spotify.clientSecret,
      deezer: d.discover.deezer.enabled,
      itunes: d.discover.itunes.enabled,
      ticketmaster:
        d.discover.ticketmaster.enabled && !!d.discover.ticketmaster.apiKey,
      skiddle: d.discover.skiddle.enabled && !!d.discover.skiddle.apiKey,
      listenbrainzTrending: d.discover.listenbrainzTrending.enabled,
      listenbrainz: d.scrobble.listenbrainz.enabled,
      lastfm,
      lastfmScrobble:
        lastfm && d.scrobble.lastfm.enabled && !!d.metadata.lastfm.sharedSecret,
      fanart: d.metadata.fanart.enabled && !!d.metadata.fanart.apiKey,
      openSubsonic: d.clients.openSubsonic,
      jellyfinApi: d.clients.jellyfinApi,
    };
  }

  get fullPublicSettings(): FullPublicSettings {
    const integrations = this.integrations;
    return {
      ...this.data.public,
      applicationTitle: this.data.main.applicationTitle,
      applicationUrl: this.data.main.applicationUrl,
      hideAvailable: this.data.main.hideAvailable,
      allowTrackRequests: this.data.main.allowTrackRequests,
      discographyAlwaysReview: this.data.main.discographyAlwaysReview,
      localLogin: this.data.main.localLogin,
      mediaServerLogin: this.data.main.mediaServerLogin,
      plexLoginEnabled:
        this.data.main.mediaServerLogin && this.data.plex.loginEnabled,
      jellyfinLoginEnabled:
        this.data.main.mediaServerLogin &&
        this.data.jellyfin.loginEnabled &&
        !!this.data.jellyfin.ip,
      newPlexLogin: this.data.main.newPlexLogin,
      newJellyfinLogin: this.data.jellyfin.newLogin,
      jellyfinExternalHost: this.data.jellyfin.externalHostname,
      jellyfinForgotPasswordUrl: this.data.jellyfin.jellyfinForgotPasswordUrl,
      jellyfinServerName: this.data.jellyfin.name,
      discoverRegion: this.data.main.discoverRegion,
      mediaServerType: this.main.mediaServerType,
      cacheImages: this.data.main.cacheImages,
      vapidPublic: this.vapidPublic,
      enablePushRegistration: this.data.notifications.agents.webpush.enabled,
      locale: this.data.main.locale,
      emailEnabled: this.data.notifications.agents.email.enabled,
      userEmailRequired:
        this.data.notifications.agents.email.options.userEmailRequired,
      versionCheck: this.data.main.versionCheck,
      plexClientIdentifier: this.data.clientId,
      integrations,
      importEnabled:
        integrations.spotify || integrations.deezer || integrations.itunes,
      concertsEnabled: integrations.ticketmaster || integrations.skiddle,
    };
  }

  get notifications(): NotificationSettings {
    return this.data.notifications;
  }

  set notifications(data: NotificationSettings) {
    this.data.notifications = mergeSettings(this.data.notifications, data);
  }

  get jobs(): Record<JobId, JobSettings> {
    return this.data.jobs;
  }

  set jobs(data: Record<JobId, JobSettings>) {
    this.data.jobs = mergeSettings(this.data.jobs, data);
  }

  get network(): NetworkSettings {
    return this.data.network;
  }

  set network(data: NetworkSettings) {
    this.data.network = mergeSettings(this.data.network, data);
  }

  get migrations(): string[] {
    return this.data.migrations;
  }

  set migrations(data: string[]) {
    this.data.migrations = data;
  }

  get clientId(): string {
    return this.data.clientId;
  }

  get serverSecret(): string {
    return this.data.serverSecret;
  }

  get sessionSecret(): string {
    return this.data.sessionSecret!;
  }

  get vapidPublic(): string {
    return this.data.vapidPublic;
  }

  get vapidPrivate(): string {
    return this.data.vapidPrivate;
  }

  public async regenerateApiKey(): Promise<MainSettings> {
    this.main.apiKey = this.generateApiKey();
    await this.save();
    return this.main;
  }

  private generateApiKey(): string {
    if (process.env.API_KEY) {
      return process.env.API_KEY;
    } else {
      return Buffer.from(`${Date.now()}${randomUUID()}`).toString('base64');
    }
  }

  /**
   * Settings Load
   *
   * This will load settings from file unless an optional argument of the object structure
   * is passed in.
   * @param overrideSettings If passed in, will override all existing settings with these
   * @param raw If true, will load the settings without running migrations or generating missing
   * values
   */
  public async load(
    overrideSettings?: AllSettings,
    raw = false
  ): Promise<Settings> {
    if (overrideSettings) {
      this.data = overrideSettings;
      return this;
    }

    let data;
    try {
      data = await fs.readFile(SETTINGS_PATH, 'utf-8');
    } catch {
      await this.save();
    }

    let change = false;
    if (data && !raw) {
      const parsedJson = JSON.parse(data);
      const migratedData = await runMigrations(parsedJson, SETTINGS_PATH);
      const merged = mergeSettings(this.data, migratedData);

      if (JSON.stringify(merged) !== JSON.stringify(migratedData)) {
        change = true;
      }

      this.data = merged;
    } else if (data) {
      this.data = JSON.parse(data);
    }

    // generate keys and ids if it's missing
    if (!this.data.main.apiKey) {
      this.data.main.apiKey = this.generateApiKey();
      change = true;
    } else if (process.env.API_KEY) {
      if (this.main.apiKey != process.env.API_KEY) {
        this.main.apiKey = process.env.API_KEY;
      }
    }
    if (!this.data.clientId) {
      this.data.clientId = randomUUID();
      change = true;
    }
    if (!this.data.serverSecret) {
      this.data.serverSecret = randomBytes(32).toString('hex');
      change = true;
    }
    if (!this.data.sessionSecret) {
      this.data.sessionSecret = randomBytes(32).toString('hex');
      change = true;
    }
    if (!this.data.vapidPublic || !this.data.vapidPrivate) {
      const vapidKeys = webpush.generateVAPIDKeys();
      this.data.vapidPrivate = vapidKeys.privateKey;
      this.data.vapidPublic = vapidKeys.publicKey;
      change = true;
    }
    if (change) {
      await this.save();
    }

    return this;
  }

  public async save(): Promise<void> {
    const savePromise = this.saveLock.then(async () => {
      const tmp = SETTINGS_PATH + '.tmp';
      // settings.json holds secrets (API keys, serverSecret): owner-only
      await fs.writeFile(tmp, JSON.stringify(this.data, undefined, ' '), {
        mode: 0o600,
      });
      await fs.rename(tmp, SETTINGS_PATH);
      await fs.chmod(SETTINGS_PATH, 0o600).catch(() => undefined);
    });

    this.saveLock = savePromise.catch(() => {
      // Keep the chain alive so future saves aren't blocked by past failures
    });

    return savePromise;
  }
}

let settings: Settings | undefined;

export const getSettings = (initialSettings?: AllSettings): Settings => {
  if (!settings) {
    settings = new Settings(initialSettings);
  }

  return settings;
};

export default Settings;

/* ---------- secret masking helpers (used by settings routes) ---------- */

const MASK_PREFIX = '••••';

/** `••••` + last 4 characters; empty stays empty. */
export const maskSecret = (value?: string | null): string => {
  if (!value) {
    return '';
  }
  return `${MASK_PREFIX}${value.length > 8 ? value.slice(-4) : ''}`;
};

export const isMaskedSecret = (value?: unknown): boolean =>
  typeof value === 'string' && value.startsWith(MASK_PREFIX);

/**
 * The value to store for a secret field coming back from the UI: the stored
 * value when the field is untouched (still masked, or undefined), otherwise
 * the new value ('' clears it).
 */
export const resolveSecret = (
  incoming: string | undefined | null,
  current: string | undefined | null
): string => {
  if (incoming === undefined || incoming === null || isMaskedSecret(incoming)) {
    return current ?? '';
  }
  return incoming;
};

/** Returns a deep copy of `section` with the listed dot-paths masked. */
export const maskSecrets = <T>(section: T, paths: string[]): T => {
  const copy = structuredClone(section) as Record<string, unknown>;
  for (const p of paths) {
    const parts = p.split('.');
    let node: Record<string, unknown> | undefined = copy;
    for (let i = 0; i < parts.length - 1 && node; i++) {
      node = node[parts[i]] as Record<string, unknown> | undefined;
    }
    const last = parts[parts.length - 1];
    if (node && typeof node[last] === 'string') {
      node[last] = maskSecret(node[last] as string);
    }
  }
  return copy as T;
};

/**
 * Merges `incoming` over `current`, keeping the stored value for any listed
 * secret path that is still masked/absent in `incoming`.
 */
export const mergeWithSecrets = <T>(
  current: T,
  incoming: Partial<T>,
  paths: string[]
): T => {
  const merged = mergeSettings(current, incoming) as Record<string, unknown>;
  for (const p of paths) {
    const parts = p.split('.');
    let m: Record<string, unknown> | undefined = merged;
    let c: Record<string, unknown> | undefined = current as Record<
      string,
      unknown
    >;
    for (let i = 0; i < parts.length - 1; i++) {
      m = m?.[parts[i]] as Record<string, unknown> | undefined;
      c = c?.[parts[i]] as Record<string, unknown> | undefined;
    }
    const last = parts[parts.length - 1];
    if (m) {
      m[last] = resolveSecret(
        m[last] as string | undefined,
        c?.[last] as string | undefined
      );
    }
  }
  return merged as T;
};
