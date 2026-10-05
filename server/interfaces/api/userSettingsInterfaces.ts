// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type { LinkedAccountProvider } from '@server/entity/LinkedAccount';
import type { NotificationTypeKey } from '@server/lib/notifications/types';
import type { NotificationAgentKey } from '@server/lib/settings';

/** GET|POST /user/:id/settings/main */
export interface UserSettingsGeneralResponse {
  username?: string;
  email?: string;
  locale?: string;
  discoverRegion?: string;
  /** Per-user overrides; null/undefined = follow the global limits. */
  albumQuotaLimit?: number | null;
  albumQuotaDays?: number | null;
  trackQuotaLimit?: number | null;
  trackQuotaDays?: number | null;
  globalAlbumQuotaLimit?: number;
  globalAlbumQuotaDays?: number;
  globalTrackQuotaLimit?: number;
  globalTrackQuotaDays?: number;
  /** "Request albums I save on Spotify" (needs AUTO_REQUEST / AUTO_REQUEST_ALBUM and linked Spotify). */
  autoRequestSpotifySaved?: boolean;
  scrobbleEnabled?: boolean;
}

/** GET /user/:id/settings/password */
export interface UserSettingsPasswordResponse {
  hasPassword: boolean;
}

/** POST /user/:id/settings/password */
export interface UserSettingsPasswordBody {
  /** Required when changing your own existing password. */
  currentPassword?: string;
  newPassword: string;
  confirmPassword?: string;
}

/** Stored representation (Seerr bitmask per agent). */
export type NotificationAgentTypes = Record<NotificationAgentKey, number>;

/** One per-user channel on the Notifications tab. */
export interface UserNotificationChannel {
  /** The agent is enabled server-side (channel is offered at all). */
  available: boolean;
  /** "Send me <channel> notifications" */
  enabled: boolean;
  types: NotificationTypeKey[];
}

/** GET|POST /user/:id/settings/notifications */
export interface UserSettingsNotificationsResponse {
  /** Types the user may pick (manager-only types are omitted for non-managers). */
  availableTypes: NotificationTypeKey[];
  channels: {
    email: UserNotificationChannel & { pgpKey?: string };
    webpush: UserNotificationChannel;
    discord: UserNotificationChannel & { discordIds?: string[] };
    telegram: UserNotificationChannel & {
      telegramBotUsername?: string;
      telegramChatId?: string;
      telegramMessageThreadId?: string;
      telegramSendSilently?: boolean;
    };
    pushbullet: UserNotificationChannel & { pushbulletAccessToken?: string };
    pushover: UserNotificationChannel & {
      pushoverApplicationToken?: string;
      pushoverUserKey?: string;
      pushoverSound?: string;
    };
  };
}

/** GET|POST /user/:id/settings/permissions */
export interface UserSettingsPermissionsResponse {
  permissions: number;
}

export type LinkableProvider = 'plex' | 'jellyfin' | LinkedAccountProvider;

/** One row on the Linked accounts tab. */
export interface LinkedAccountStatus {
  provider: LinkableProvider;
  /** Integration is enabled server-side; rows with false are hidden. */
  available: boolean;
  linked: boolean;
  /** "Linked as <username>" */
  externalUsername?: string;
  /** False when this is the account's sign-in method (can't unlink). */
  canUnlink: boolean;
  /**
   * How linking starts:
   * - plex: client runs the Plex PIN flow, then POST {authToken}
   * - jellyfin: POST {username, password}
   * - listenbrainz: POST {token}
   * - lastfm / spotify: GET …/linked-accounts/<provider>/authorize → {url}; the
   *   provider redirects to /api/v1/callback/<provider>, which redirects back
   *   to the profile.
   */
  flow: 'plex-pin' | 'credentials' | 'token' | 'oauth';
  linkedAt?: string;
}

/** GET /user/:id/settings/linked-accounts */
export interface UserSettingsLinkedAccountsResponse {
  accounts: LinkedAccountStatus[];
}

/** GET /user/:id/settings/linked-accounts/:provider/authorize */
export interface LinkAuthorizeResponse {
  url: string;
}

export interface AppPasswordItem {
  id: number;
  name: string;
  createdAt: string;
  lastUsedAt?: string | null;
  lastUsedClient?: string | null;
}

/** GET /user/:id/settings/app-passwords */
export interface UserSettingsAppPasswordsResponse {
  /** `<applicationUrl>` (falls back to the request origin). */
  serverUrl: string;
  /** Username clients sign in with. */
  username: string;
  openSubsonicEnabled: boolean;
  jellyfinApiEnabled: boolean;
  passwords: AppPasswordItem[];
}

/** POST /user/:id/settings/app-passwords { name } → shown once */
export interface AppPasswordCreatedResponse extends AppPasswordItem {
  password: string;
}
