// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { MediaServerType } from '@server/constants/server';
import type { PublicSettingsResponse } from '@server/interfaces/api/settingsInterfaces';
import React from 'react';
import useSWR from 'swr';

export interface SettingsContextProps {
  currentSettings: PublicSettingsResponse;
  children?: React.ReactNode;
}

/** Safe defaults used before `/api/v1/settings/public` answers. */
export const defaultPublicSettings: PublicSettingsResponse = {
  initialized: false,
  applicationTitle: 'Shufflerr',
  applicationUrl: '',
  hideAvailable: false,
  allowTrackRequests: true,
  discographyAlwaysReview: true,
  localLogin: true,
  mediaServerLogin: true,
  plexLoginEnabled: false,
  jellyfinLoginEnabled: false,
  newPlexLogin: false,
  newJellyfinLogin: false,
  discoverRegion: '',
  mediaServerType: MediaServerType.NOT_CONFIGURED,
  cacheImages: false,
  vapidPublic: '',
  enablePushRegistration: false,
  locale: 'en',
  emailEnabled: false,
  userEmailRequired: false,
  versionCheck: true,
  plexClientIdentifier: '',
  integrations: {
    lidarr: false,
    plex: false,
    jellyfin: false,
    navidrome: false,
    localFiles: false,
    youtube: false,
    youtubeFill: false,
    spotify: false,
    deezer: false,
    itunes: false,
    ticketmaster: false,
    skiddle: false,
    listenbrainzTrending: false,
    listenbrainz: false,
    lastfm: false,
    lastfmScrobble: false,
    fanart: false,
    openSubsonic: false,
    jellyfinApi: false,
  },
  importEnabled: false,
  concertsEnabled: false,
};

const defaultSettings = defaultPublicSettings;

export const SettingsContext = React.createContext<SettingsContextProps>({
  currentSettings: defaultSettings,
});

export const SettingsProvider = ({
  children,
  currentSettings,
}: SettingsContextProps) => {
  const { data, error } = useSWR<PublicSettingsResponse>(
    '/api/v1/settings/public',
    { fallbackData: currentSettings }
  );

  let newSettings: PublicSettingsResponse = defaultSettings;

  if (data && !error) {
    newSettings = data;
  }

  return (
    <SettingsContext.Provider value={{ currentSettings: newSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};
