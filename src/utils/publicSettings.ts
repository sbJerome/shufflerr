import { MediaServerType } from '@server/constants/server';
import type { PublicSettingsResponse } from '@server/interfaces/api/settingsInterfaces';

/** True when at least one import source (Spotify, Deezer, iTunes) is enabled. */
export const importEnabled = (settings: PublicSettingsResponse): boolean =>
  !!settings.importEnabled;

export interface LoginMethods {
  local: boolean;
  plex: boolean;
  /** New Plex users with access to the owner's server get an account on first sign-in. */
  newPlex: boolean;
  jellyfin: boolean;
  newJellyfin: boolean;
  /** 'Jellyfin' or 'Emby'. */
  jellyfinName: string;
}

/** Which sign-in buttons to show (docs/AUTH.md §Sign-in methods). */
export const loginMethods = (
  settings: PublicSettingsResponse
): LoginMethods => ({
  local: settings.localLogin,
  plex: !!settings.plexLoginEnabled,
  newPlex: !!settings.newPlexLogin,
  jellyfin: !!settings.jellyfinLoginEnabled,
  newJellyfin: !!settings.newJellyfinLogin,
  jellyfinName:
    settings.mediaServerType === MediaServerType.EMBY ? 'Emby' : 'Jellyfin',
});
