// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
//
// Admin settings API (docs/ADMIN_PAGES.md). Sub-routers mounted here:
//   ./lidarr                                   /settings/lidarr…
//   ./plex ./jellyfin ./navidrome ./local      /settings/{plex,jellyfin,navidrome,local}…
//   ./notifications ./sliders
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import AppPassword from '@server/entity/AppPassword';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import Track from '@server/entity/Track';
import { User } from '@server/entity/User';
import type {
  CacheResponse,
  ClientDevice,
  ClientsSettingsResponse,
  ConnectionTestResponse,
  LogMessage,
  LogsResultsResponse,
  SettingsAboutResponse,
  UsersSettingsResponse,
} from '@server/interfaces/api/settingsInterfaces';
import {
  cancelJob,
  cleanImageCache,
  isValidSchedule,
  jobItem,
  runJobNow,
  scheduledJobs,
  setJobSchedule,
} from '@server/job/schedule';
import type { AvailableCacheIds } from '@server/lib/cache';
import cacheManager from '@server/lib/cache';
import { imageSourceTypes } from '@server/lib/imageSources';
import ImageProxy from '@server/lib/imageproxy';
import { Permission } from '@server/lib/permissions';
import type {
  ClientsSettings,
  DiscoverSettings,
  JobId,
  MainSettings,
  MetadataSettings,
  NetworkSettings,
  ScrobbleSettings,
  YoutubeSettings,
} from '@server/lib/settings';
import {
  getSettings,
  maskSecrets,
  mergeWithSecrets,
  resolveSecret,
} from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import sliderSettingRoutes from '@server/routes/settings/sliders';
import { availableLocales } from '@server/types/languages';
import { appDataPath } from '@server/utils/appDataVolume';
import { getAppVersion, getCommitTag } from '@server/utils/appVersion';
import { dnsCache } from '@server/utils/dnsCache';
import type { DnsEntries, DnsStats } from 'dns-caching';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import { escapeRegExp, omit, set } from 'lodash';
import path from 'path';
import { Not } from 'typeorm';
import validator from 'validator';
import {
  testDeezer,
  testFanart,
  testItunes,
  testLastfm,
  testListenBrainz,
  testMusicBrainz,
  testSkiddle,
  testSpotify,
  testTicketmaster,
  testYoutube,
} from './connectionTests';
import jellyfinSettingsRoutes from './jellyfin';
import lidarrSettingsRoutes from './lidarr';
import localSettingsRoutes from './local';
import navidromeSettingsRoutes from './navidrome';
import notificationRoutes from './notifications';
import plexSettingsRoutes from './plex';

const settingsRoutes = Router();

settingsRoutes.use('/notifications', notificationRoutes);
settingsRoutes.use('/sliders', sliderSettingRoutes);
settingsRoutes.use('/lidarr', lidarrSettingsRoutes);
// These four define their full paths (/plex…, /jellyfin…, /navidrome…, /local…)
settingsRoutes.use(plexSettingsRoutes);
settingsRoutes.use(jellyfinSettingsRoutes);
settingsRoutes.use(navidromeSettingsRoutes);
settingsRoutes.use(localSettingsRoutes);

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

/** Thrown by validators; becomes `400 {message}`. */
class SettingsValidationError extends Error {
  public status = 400;
}

const invalid = (message: string): never => {
  throw new SettingsValidationError(message);
};

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

/** Runs a handler and turns validation errors into `400 {message}`. */
const guarded =
  (handler: Handler): Handler =>
  async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (e) {
      if (e instanceof SettingsValidationError) {
        return next({ status: 400, message: e.message });
      }
      logger.error('Something went wrong saving settings', {
        label: 'Settings',
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message:
          "The settings couldn't be saved. Check the logs for the reason.",
      });
    }
  };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Keeps only the keys of `incoming` that exist in `shape` (recursively), so a
 * request can't add unknown keys to settings.json.
 */
export const pickKnown = <T>(shape: T, incoming: unknown): Partial<T> => {
  if (!isPlainObject(shape) || !isPlainObject(incoming)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(incoming)) {
    if (!(key in shape)) {
      continue;
    }
    const target = (shape as Record<string, unknown>)[key];
    out[key] = isPlainObject(target)
      ? pickKnown(target, incoming[key])
      : incoming[key];
  }
  return out as Partial<T>;
};

const isHttpUrl = (value: unknown): boolean =>
  typeof value === 'string' &&
  validator.isURL(value, {
    require_protocol: true,
    require_tld: false,
    protocols: ['http', 'https'],
  });

/** A base URL: http(s), no trailing slash. `label` is used in the message. */
const checkBaseUrl = (label: string, value: unknown, required = false) => {
  if (value === '' || value === undefined || value === null) {
    if (required) {
      invalid(`Enter the ${label}.`);
    }
    return;
  }
  if (!isHttpUrl(value)) {
    invalid(
      `The ${label} isn't a valid address. Start it with http:// or https://.`
    );
  }
  if ((value as string).endsWith('/')) {
    invalid(`Remove the slash at the end of the ${label}.`);
  }
};

const checkBoolean = (label: string, value: unknown) => {
  if (value !== undefined && typeof value !== 'boolean') {
    invalid(`"${label}" has to be on or off.`);
  }
};

const checkInt = (label: string, value: unknown, min: number, max: number) => {
  if (value === undefined) {
    return;
  }
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    invalid(`${label} has to be a whole number from ${min} to ${max}.`);
  }
};

const checkOneOf = (
  label: string,
  value: unknown,
  allowed: readonly unknown[]
) => {
  if (value !== undefined && !allowed.includes(value)) {
    invalid(`${label} has to be one of: ${allowed.join(', ')}.`);
  }
};

const checkCountry = (label: string, value: unknown, allowEmpty = false) => {
  if (value === undefined || (allowEmpty && value === '')) {
    return;
  }
  if (typeof value !== 'string' || !/^[A-Z]{2}$/.test(value)) {
    invalid(`${label} has to be a two-letter country code such as US or GB.`);
  }
};

/* ------------------------------------------------------------------ */
/* General                                                             */
/* ------------------------------------------------------------------ */

const filteredMainSettings = (
  user: User | undefined,
  main: MainSettings
): Partial<MainSettings> => {
  // The API key has a Copy button for admins; nobody else gets it.
  if (!user?.hasPermission(Permission.ADMIN)) {
    return omit(main, 'apiKey');
  }

  return main;
};

export const validateMain = (main: Partial<MainSettings>): void => {
  if (
    main.applicationTitle !== undefined &&
    (typeof main.applicationTitle !== 'string' || !main.applicationTitle.trim())
  ) {
    invalid('Enter an application title.');
  }
  checkBaseUrl('application URL', main.applicationUrl);
  if (
    main.locale !== undefined &&
    main.locale !== '' &&
    !(availableLocales as readonly string[]).includes(main.locale)
  ) {
    invalid(
      "Shufflerr doesn't have that display language. Pick one from the list."
    );
  }
  checkCountry('The discover region', main.discoverRegion, true);
  checkBoolean('Allow track requests', main.allowTrackRequests);
  checkBoolean("Hide music that's already available", main.hideAvailable);
  checkBoolean('Cache album art', main.cacheImages);
  checkBoolean('Check for updates', main.versionCheck);
};

settingsRoutes.get('/main', (req, res) => {
  const settings = getSettings();
  return res.status(200).json(filteredMainSettings(req.user, settings.main));
});

settingsRoutes.post(
  '/main',
  guarded(async (req, res) => {
    const settings = getSettings();
    // The API key only changes through /main/regenerate; sign-in methods,
    // limits and default permissions are saved through /users.
    const incoming = omit(pickKnown(settings.main, req.body), [
      'apiKey',
    ]) as Partial<MainSettings>;

    if (typeof incoming.applicationTitle === 'string') {
      incoming.applicationTitle = incoming.applicationTitle.trim();
    }
    if (typeof incoming.applicationUrl === 'string') {
      incoming.applicationUrl = incoming.applicationUrl.trim();
    }
    if (typeof incoming.discoverRegion === 'string') {
      incoming.discoverRegion = incoming.discoverRegion.trim().toUpperCase();
    }
    validateMain(incoming);

    settings.main = { ...settings.main, ...incoming };
    await settings.save();

    return res.status(200).json(filteredMainSettings(req.user, settings.main));
  })
);

settingsRoutes.post('/main/regenerate', async (req, res) => {
  const settings = getSettings();
  const main = await settings.regenerateApiKey();
  return res.status(200).json(filteredMainSettings(req.user, main));
});

/* ------------------------------------------------------------------ */
/* Users: sign-in methods, global limits, default permissions          */
/* ------------------------------------------------------------------ */

const usersSettings = (): UsersSettingsResponse => {
  const settings = getSettings();
  return {
    localLogin: settings.main.localLogin,
    plexLogin: settings.plex.loginEnabled,
    newPlexLogin: settings.main.newPlexLogin,
    jellyfinLogin: settings.jellyfin.loginEnabled,
    newJellyfinLogin: settings.jellyfin.newLogin,
    defaultPermissions: settings.main.defaultPermissions,
    defaultQuotas: settings.main.defaultQuotas,
    discographyAlwaysReview: settings.main.discographyAlwaysReview,
  };
};

export const validateUsers = (body: UsersSettingsResponse): void => {
  checkBoolean('Shufflerr accounts', body.localLogin);
  checkBoolean('Plex sign-in', body.plexLogin);
  checkBoolean('Let new Plex users sign in', body.newPlexLogin);
  checkBoolean('Jellyfin sign-in', body.jellyfinLogin);
  checkBoolean('Let new Jellyfin users sign in', body.newJellyfinLogin);
  checkBoolean(
    'Always review discography requests',
    body.discographyAlwaysReview
  );

  if (!body.localLogin && !body.plexLogin && !body.jellyfinLogin) {
    invalid('At least one sign-in method has to stay on.');
  }

  if (
    typeof body.defaultPermissions !== 'number' ||
    !Number.isInteger(body.defaultPermissions) ||
    body.defaultPermissions < 0
  ) {
    invalid(
      "The default permissions aren't valid. Reload the page and try again."
    );
  }

  const quotas = body.defaultQuotas;
  if (!isPlainObject(quotas?.album) || !isPlainObject(quotas?.track)) {
    invalid('Enter the album and track limits.');
  }
  checkInt('The album limit', quotas.album.quotaLimit ?? 0, 0, 100000);
  checkInt('The album period', quotas.album.quotaDays ?? 7, 1, 365);
  checkInt('The track limit', quotas.track.quotaLimit ?? 0, 0, 100000);
  checkInt('The track period', quotas.track.quotaDays ?? 7, 1, 365);
};

settingsRoutes.get('/users', (_req, res) => {
  return res.status(200).json(usersSettings());
});

settingsRoutes.post(
  '/users',
  guarded(async (req, res) => {
    const settings = getSettings();
    const current = usersSettings();
    const incoming = pickKnown(current, req.body);
    const body: UsersSettingsResponse = {
      ...current,
      ...incoming,
      defaultQuotas: {
        album: {
          ...current.defaultQuotas.album,
          ...incoming.defaultQuotas?.album,
        },
        track: {
          ...current.defaultQuotas.track,
          ...incoming.defaultQuotas?.track,
        },
      },
    };

    validateUsers(body);

    settings.main.localLogin = body.localLogin;
    settings.main.newPlexLogin = body.newPlexLogin;
    settings.main.mediaServerLogin = body.plexLogin || body.jellyfinLogin;
    settings.plex.loginEnabled = body.plexLogin;
    settings.jellyfin.loginEnabled = body.jellyfinLogin;
    settings.jellyfin.newLogin = body.newJellyfinLogin;
    settings.main.defaultPermissions = body.defaultPermissions;
    settings.main.defaultQuotas = body.defaultQuotas;
    settings.main.discographyAlwaysReview = body.discographyAlwaysReview;
    await settings.save();

    return res.status(200).json(usersSettings());
  })
);

/* ------------------------------------------------------------------ */
/* Network                                                             */
/* ------------------------------------------------------------------ */

const NETWORK_SECRETS = ['proxy.password'];

export const validateNetwork = (network: NetworkSettings): void => {
  checkBoolean('CSRF protection', network.csrfProtection);
  checkBoolean('Behind a reverse proxy', network.trustProxy);
  checkBoolean('Prefer IPv4', network.forceIpv4First);
  checkInt('The request timeout', network.apiRequestTimeout, 0, 600000);

  checkBoolean('Cache DNS lookups', network.dnsCache.enabled);
  const { forceMinTtl, forceMaxTtl } = network.dnsCache;
  // -1 on the maximum means "no upper bound" (Seerr semantics).
  checkInt('The minimum DNS TTL', forceMinTtl ?? 0, 0, 86400 * 7);
  checkInt('The maximum DNS TTL', forceMaxTtl ?? -1, -1, 86400 * 7);
  if (
    (forceMaxTtl ?? -1) >= 0 &&
    (forceMinTtl ?? 0) > (forceMaxTtl as number)
  ) {
    invalid("The minimum DNS TTL can't be higher than the maximum.");
  }

  const proxy = network.proxy;
  checkBoolean('Outgoing proxy', proxy.enabled);
  checkBoolean('Use SSL for the proxy', proxy.useSsl);
  checkBoolean(
    'Skip the proxy for local addresses',
    proxy.bypassLocalAddresses
  );
  if (proxy.enabled) {
    if (typeof proxy.hostname !== 'string' || !proxy.hostname.trim()) {
      invalid('Enter the proxy hostname, or turn the outgoing proxy off.');
    }
    if (/^[a-z]+:\/\//i.test(proxy.hostname)) {
      invalid(
        'Enter the proxy hostname without http:// or https://. Use the SSL switch instead.'
      );
    }
    checkInt('The proxy port', proxy.port, 1, 65535);
  }
};

settingsRoutes.get('/network', (_req, res) => {
  return res
    .status(200)
    .json(maskSecrets(getSettings().network, NETWORK_SECRETS));
});

settingsRoutes.post(
  '/network',
  guarded(async (req, res) => {
    const settings = getSettings();
    const merged = mergeWithSecrets(
      settings.network,
      pickKnown(settings.network, req.body),
      NETWORK_SECRETS
    );
    validateNetwork(merged);

    settings.network = merged;
    await settings.save();

    // CSRF, trust proxy and the outgoing proxy apply after a restart;
    // GET /status reports `restartRequired`.
    return res.status(200).json(maskSecrets(settings.network, NETWORK_SECRETS));
  })
);

/* ------------------------------------------------------------------ */
/* Metadata, YouTube, Discover and import, Scrobbling                  */
/* ------------------------------------------------------------------ */

const PUBLIC_MUSICBRAINZ = /^https?:\/\/(www\.|beta\.)?musicbrainz\.org$/i;

export const validateMetadata = (m: MetadataSettings): void => {
  checkBaseUrl('MusicBrainz server URL', m.musicbrainz.url, true);
  if (
    typeof m.musicbrainz.requestsPerSecond !== 'number' ||
    !(m.musicbrainz.requestsPerSecond > 0) ||
    m.musicbrainz.requestsPerSecond > 100
  ) {
    invalid('Requests per second has to be a number from 1 to 100.');
  }
  if (
    PUBLIC_MUSICBRAINZ.test(m.musicbrainz.url) &&
    m.musicbrainz.requestsPerSecond > 1
  ) {
    invalid(
      'The public MusicBrainz server allows 1 request per second. Use your own mirror to go faster.'
    );
  }
  const contact = m.musicbrainz.contact;
  if (typeof contact !== 'string') {
    invalid('Enter a contact email address or URL.');
  }
  if (
    contact &&
    !validator.isEmail(contact, { require_tld: false }) &&
    !isHttpUrl(contact)
  ) {
    invalid(
      'The contact has to be an email address or a URL. MusicBrainz uses it to reach you if something goes wrong.'
    );
  }

  checkBoolean('Cover Art Archive', m.coverArtArchive.enabled);
  checkBoolean('fanart.tv', m.fanart.enabled);
  if (m.fanart.enabled && !m.fanart.apiKey) {
    invalid('Enter the fanart.tv API key, or turn fanart.tv off.');
  }
  checkBoolean('Use Last.fm', m.lastfm.enabled);
  if (m.lastfm.enabled && !m.lastfm.apiKey) {
    invalid('Enter the Last.fm API key, or turn Last.fm off.');
  }
  checkOneOf('The priority', m.priority, ['musicbrainz-first', 'lastfm-first']);
};

export const validateYoutube = (y: YoutubeSettings): void => {
  checkBoolean('Use YouTube', y.enabled);
  checkBoolean(
    'Fill gaps while requests download',
    y.fillMissingWhileDownloading
  );
  if (y.enabled && !y.apiKey) {
    invalid('Enter the YouTube Data API key, or turn YouTube off.');
  }
  // Empty = follow the server's discover region.
  checkCountry('The region', y.region, true);
};

export const validateDiscover = (d: DiscoverSettings): void => {
  checkBoolean('Use Spotify', d.spotify.enabled);
  checkOneOf('The saved-albums check', d.spotify.savedAlbumsSync, [
    'daily',
    'hourly',
    'never',
  ]);
  if (d.spotify.enabled && (!d.spotify.clientId || !d.spotify.clientSecret)) {
    invalid(
      'Enter the Spotify client ID and client secret, or turn Spotify off.'
    );
  }

  checkBoolean('Use Deezer', d.deezer.enabled);

  checkBoolean('Use iTunes', d.itunes.enabled);
  checkCountry('The store country', d.itunes.country);

  checkBoolean('Use Ticketmaster', d.ticketmaster.enabled);
  checkCountry('The Ticketmaster country', d.ticketmaster.country);
  checkInt('The distance', d.ticketmaster.radiusMiles, 1, 500);
  if (d.ticketmaster.enabled && !d.ticketmaster.apiKey) {
    invalid(
      'Enter the Ticketmaster Discovery API key, or turn Ticketmaster off.'
    );
  }

  checkBoolean('Use Skiddle', d.skiddle.enabled);
  if (d.skiddle.enabled && !d.skiddle.apiKey) {
    invalid('Enter the Skiddle API key, or turn Skiddle off.');
  }

  checkBoolean('ListenBrainz trending', d.listenbrainzTrending.enabled);
};

export const validateScrobble = (
  s: ScrobbleSettings,
  metadata: MetadataSettings
): void => {
  checkBoolean('ListenBrainz', s.listenbrainz.enabled);
  checkBaseUrl('ListenBrainz server URL', s.listenbrainz.url, true);
  checkBoolean('Last.fm', s.lastfm.enabled);
  if (
    s.lastfm.enabled &&
    (!metadata.lastfm.apiKey || !metadata.lastfm.sharedSecret)
  ) {
    invalid(
      'Add the Last.fm API key and shared secret under Metadata first. Scrobbling uses the same key.'
    );
  }
  checkOneOf('The scrobble rule', s.rule, ['half-or-4min', 'end', '30s']);
  for (const [source, on] of Object.entries(s.sources)) {
    checkBoolean(`Plays from ${source}`, on);
  }
};

/** Saved-albums check cadence ↔ the job's schedule. */
const SPOTIFY_SYNC_SCHEDULE = {
  daily: '0 0 6 * * *',
  hourly: '0 0 * * * *',
} as const;

type SectionKey = 'youtube' | 'metadata' | 'discover' | 'scrobble';

interface SectionSpec<T> {
  secrets: string[];
  validate: (section: T) => void;
  /** Runs after a successful save. */
  afterSave?: (previous: T, saved: T) => Promise<void> | void;
}

const SECTIONS: {
  youtube: SectionSpec<YoutubeSettings>;
  metadata: SectionSpec<MetadataSettings>;
  discover: SectionSpec<DiscoverSettings>;
  scrobble: SectionSpec<ScrobbleSettings>;
} = {
  youtube: { secrets: ['apiKey'], validate: validateYoutube },
  metadata: {
    secrets: ['fanart.apiKey', 'lastfm.apiKey', 'lastfm.sharedSecret'],
    validate: validateMetadata,
    afterSave: (previous, saved) => {
      // Cached lookups belong to the server they came from.
      if (previous.musicbrainz.url !== saved.musicbrainz.url) {
        cacheManager.getCache('musicbrainz')?.flush();
      }
    },
  },
  discover: {
    secrets: ['spotify.clientSecret', 'ticketmaster.apiKey', 'skiddle.apiKey'],
    validate: validateDiscover,
    afterSave: async (previous, saved) => {
      const cadence = saved.spotify.savedAlbumsSync;
      if (cadence !== previous.spotify.savedAlbumsSync && cadence !== 'never') {
        await setJobSchedule(
          'spotify-saved-albums-sync',
          SPOTIFY_SYNC_SCHEDULE[cadence]
        );
      }
    },
  },
  scrobble: {
    secrets: [],
    validate: (s) => validateScrobble(s, getSettings().metadata),
  },
};

(Object.keys(SECTIONS) as SectionKey[]).forEach((key) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spec = SECTIONS[key] as SectionSpec<any>;

  settingsRoutes.get(`/${key}`, (_req, res) => {
    const settings = getSettings();
    return res.status(200).json(maskSecrets(settings[key], spec.secrets));
  });

  settingsRoutes.post(
    `/${key}`,
    guarded(async (req, res) => {
      const settings = getSettings();
      const previous = structuredClone(settings[key]);
      const merged = mergeWithSecrets(
        settings[key] as object,
        pickKnown(settings[key] as object, req.body),
        spec.secrets
      );
      spec.validate(merged);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (settings as any)[key] = merged;
      await settings.save();
      await spec.afterSave?.(previous, merged);

      return res.status(200).json(maskSecrets(settings[key], spec.secrets));
    })
  );
});

/* ---- "Test" buttons. Bodies carry the unsaved form values; a masked secret
 * (or a missing one) means "use the stored one". ---- */

const sendTest = (res: Response, result: ConnectionTestResponse) =>
  res.status(200).json(result);

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value.trim() : fallback;

settingsRoutes.post<{ service: string }>(
  '/metadata/test/:service',
  async (req, res, next) => {
    const stored = getSettings().metadata;
    const body = isPlainObject(req.body) ? req.body : {};
    switch (req.params.service) {
      case 'musicbrainz': {
        const url = text(body.url, stored.musicbrainz.url).replace(/\/+$/, '');
        if (!isHttpUrl(url)) {
          return sendTest(res, {
            ok: false,
            message:
              "The MusicBrainz server URL isn't a valid address. Start it with http:// or https://.",
          });
        }
        return sendTest(
          res,
          await testMusicBrainz(
            url,
            text(body.contact, stored.musicbrainz.contact)
          )
        );
      }
      case 'fanart':
        return sendTest(
          res,
          await testFanart(
            resolveSecret(body.apiKey as string, stored.fanart.apiKey)
          )
        );
      case 'lastfm':
        return sendTest(
          res,
          await testLastfm(
            resolveSecret(body.apiKey as string, stored.lastfm.apiKey)
          )
        );
      default:
        return next({ status: 404, message: 'Nothing to test by that name.' });
    }
  }
);

settingsRoutes.post('/youtube/test', async (req, res) => {
  const stored = getSettings().youtube;
  return sendTest(
    res,
    await testYoutube(resolveSecret(req.body?.apiKey, stored.apiKey))
  );
});

settingsRoutes.post<{ service: string }>(
  '/discover/test/:service',
  async (req, res, next) => {
    const stored = getSettings().discover;
    const body = isPlainObject(req.body) ? req.body : {};
    switch (req.params.service) {
      case 'spotify':
        return sendTest(
          res,
          await testSpotify(
            text(body.clientId, stored.spotify.clientId),
            resolveSecret(
              body.clientSecret as string,
              stored.spotify.clientSecret
            )
          )
        );
      case 'deezer':
        return sendTest(res, await testDeezer());
      case 'itunes':
        return sendTest(
          res,
          await testItunes(text(body.country, stored.itunes.country))
        );
      case 'ticketmaster':
        return sendTest(
          res,
          await testTicketmaster(
            resolveSecret(body.apiKey as string, stored.ticketmaster.apiKey),
            text(body.country, stored.ticketmaster.country)
          )
        );
      case 'skiddle':
        return sendTest(
          res,
          await testSkiddle(
            resolveSecret(body.apiKey as string, stored.skiddle.apiKey)
          )
        );
      default:
        return next({ status: 404, message: 'Nothing to test by that name.' });
    }
  }
);

settingsRoutes.post<{ service: string }>(
  '/scrobble/test/:service',
  async (req, res, next) => {
    const settings = getSettings();
    const body = isPlainObject(req.body) ? req.body : {};
    switch (req.params.service) {
      case 'listenbrainz': {
        const url = text(body.url, settings.scrobble.listenbrainz.url).replace(
          /\/+$/,
          ''
        );
        if (!isHttpUrl(url)) {
          return sendTest(res, {
            ok: false,
            message:
              "The ListenBrainz server URL isn't a valid address. Start it with http:// or https://.",
          });
        }
        return sendTest(res, await testListenBrainz(url));
      }
      case 'lastfm':
        return sendTest(res, await testLastfm(settings.metadata.lastfm.apiKey));
      default:
        return next({ status: 404, message: 'Nothing to test by that name.' });
    }
  }
);

/* ------------------------------------------------------------------ */
/* Apps and devices                                                    */
/* ------------------------------------------------------------------ */

const clientsSettings = (origin: string): ClientsSettingsResponse => {
  const settings = getSettings();
  const base = settings.main.applicationUrl || origin;
  return {
    ...settings.clients,
    endpoints: { openSubsonic: `${base}/rest`, jellyfin: `${base}/jellyfin` },
  };
};

export const validateClients = (c: ClientsSettings): void => {
  checkBoolean('OpenSubsonic API', c.openSubsonic);
  checkBoolean('Jellyfin API', c.jellyfinApi);
  checkBoolean('Allow downloads for offline listening', c.allowDownloads);
  checkOneOf('Streaming quality on mobile data', c.mobileTranscode, [
    'original',
    'opus-160',
    'mp3-320',
    'mp3-128',
  ]);
};

settingsRoutes.get('/clients', (req, res) => {
  return res
    .status(200)
    .json(clientsSettings(`${req.protocol}://${req.get('host')}`));
});

settingsRoutes.post(
  '/clients',
  guarded(async (req, res) => {
    const settings = getSettings();
    const merged: ClientsSettings = {
      ...settings.clients,
      ...pickKnown(settings.clients, req.body),
    };
    validateClients(merged);

    settings.clients = merged;
    await settings.save();
    return res
      .status(200)
      .json(clientsSettings(`${req.protocol}://${req.get('host')}`));
  })
);

settingsRoutes.get('/clients/devices', async (_req, res) => {
  const devices = await getRepository(AppPassword).find({
    relations: { user: true },
    order: { lastUsedAt: 'DESC', createdAt: 'DESC' },
  });
  return res.status(200).json(
    devices.map(
      (d): ClientDevice => ({
        id: d.id,
        name: d.name,
        user: {
          id: d.user.id,
          displayName: d.user.displayName,
          avatar: d.user.avatar,
        },
        createdAt: new Date(d.createdAt).toISOString(),
        lastUsedAt: d.lastUsedAt ? new Date(d.lastUsedAt).toISOString() : null,
        lastUsedClient: d.lastUsedClient,
      })
    )
  );
});

settingsRoutes.delete<{ id: string }>(
  '/clients/devices/:id',
  async (req, res, next) => {
    const repo = getRepository(AppPassword);
    const id = Number(req.params.id);
    const device = Number.isInteger(id)
      ? await repo.findOne({ where: { id } })
      : null;
    if (!device) {
      return next({
        status: 404,
        message: 'That app password no longer exists.',
      });
    }
    // Revoke = delete the row; the app fails on its next request.
    await repo.remove(device);
    return res.status(204).send();
  }
);

/* ------------------------------------------------------------------ */
/* Logs                                                                */
/* ------------------------------------------------------------------ */

settingsRoutes.get(
  '/logs',
  rateLimit({ windowMs: 60 * 1000, max: 50 }),
  (req, res, next) => {
    const pageSize = req.query.take ? Number(req.query.take) : 25;
    const skip = req.query.skip ? Number(req.query.skip) : 0;
    const search = (req.query.search as string) ?? '';
    const searchRegexp = new RegExp(escapeRegExp(search), 'i');

    let filter: string[] = [];
    switch (req.query.filter) {
      case 'debug':
        filter.push('debug');
      // falls through
      case 'info':
        filter.push('info');
      // falls through
      case 'warn':
        filter.push('warn');
      // falls through
      case 'error':
        filter.push('error');
        break;
      default:
        filter = ['debug', 'info', 'warn', 'error'];
    }

    const logFile = process.env.CONFIG_DIRECTORY
      ? `${process.env.CONFIG_DIRECTORY}/logs/.machinelogs.json`
      : path.join(__dirname, '../../../config/logs/.machinelogs.json');
    const logs: LogMessage[] = [];
    const logMessageProperties = [
      'timestamp',
      'level',
      'label',
      'message',
      'data',
    ];

    const deepValueStrings = (obj: Record<string, unknown>): string[] => {
      const values = [];

      for (const val of Object.values(obj)) {
        if (typeof val === 'string') {
          values.push(val);
        } else if (typeof val === 'number') {
          values.push(val.toString());
        } else if (val !== null && typeof val === 'object') {
          values.push(...deepValueStrings(val as Record<string, unknown>));
        }
      }

      return values;
    };

    try {
      fs.readFileSync(logFile, 'utf-8')
        .split('\n')
        .forEach((line) => {
          if (!line.length) return;

          const logMessage = JSON.parse(line);

          if (!filter.includes(logMessage.level)) {
            return;
          }

          if (
            !Object.keys(logMessage).every((key) =>
              logMessageProperties.includes(key)
            )
          ) {
            Object.keys(logMessage)
              .filter((prop) => !logMessageProperties.includes(prop))
              .forEach((prop) => {
                set(logMessage, `data.${prop}`, logMessage[prop]);
              });
          }

          if (req.query.search) {
            if (
              // label and data are sometimes undefined
              !searchRegexp.test(logMessage.label ?? '') &&
              !searchRegexp.test(logMessage.message) &&
              !deepValueStrings(logMessage.data ?? {}).some((val) =>
                searchRegexp.test(val)
              )
            ) {
              return;
            }
          }

          logs.push(logMessage);
        });

      const displayedLogs = logs.reverse().slice(skip, skip + pageSize);

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(logs.length / pageSize),
          pageSize,
          results: logs.length,
          page: Math.ceil(skip / pageSize) + 1,
        },
        results: displayedLogs,
      } as LogsResultsResponse);
    } catch (error) {
      logger.error('Something went wrong while retrieving logs', {
        label: 'Logs',
        errorMessage: error.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve logs.',
      });
    }
  }
);

/* ------------------------------------------------------------------ */
/* Jobs and cache                                                      */
/* ------------------------------------------------------------------ */

const findJob = (jobId: string) =>
  scheduledJobs.find((job) => job.id === jobId);

settingsRoutes.get('/jobs', (_req, res) => {
  return res.status(200).json(scheduledJobs.map(jobItem));
});

settingsRoutes.post<{ jobId: string }>('/jobs/:jobId/run', (req, res, next) => {
  const scheduledJob = findJob(req.params.jobId);
  if (!scheduledJob) {
    return next({ status: 404, message: 'Job not found.' });
  }

  // The body starts on the next tick; report it as running right away.
  const alreadyRunning = scheduledJob.running();
  runJobNow(scheduledJob.id);

  return res
    .status(200)
    .json({ ...jobItem(scheduledJob), running: true, alreadyRunning });
});

settingsRoutes.post<{ jobId: string }>(
  '/jobs/:jobId/cancel',
  (req, res, next) => {
    const scheduledJob = findJob(req.params.jobId);
    if (!scheduledJob) {
      return next({ status: 404, message: 'Job not found.' });
    }

    if (scheduledJob.running() && !cancelJob(scheduledJob.id)) {
      return next({
        status: 400,
        message: `${scheduledJob.name} can't be stopped once it has started. It finishes on its own.`,
      });
    }

    return res.status(200).json(jobItem(scheduledJob));
  }
);

settingsRoutes.post<{ jobId: string }>(
  '/jobs/:jobId/schedule',
  async (req, res, next) => {
    const scheduledJob = findJob(req.params.jobId);
    if (!scheduledJob) {
      return next({ status: 404, message: 'Job not found.' });
    }

    const cron = req.body?.schedule;
    if (
      !isValidSchedule(cron) ||
      !(await setJobSchedule(scheduledJob.id as JobId, cron))
    ) {
      return next({
        status: 400,
        message:
          "That schedule isn't valid. Use six cron fields: second, minute, hour, day of month, month, day of week.",
      });
    }

    return res.status(200).json(jobItem(scheduledJob));
  }
);

/** Display names for the cache table (docs/ADMIN_PAGES.md §Jobs and cache). */
const CACHE_NAMES: Partial<Record<AvailableCacheIds, string>> = {
  musicbrainz: 'MusicBrainz',
  coverart: 'Cover Art Archive',
  fanart: 'fanart.tv',
  lastfm: 'Last.fm',
  listenbrainz: 'ListenBrainz',
  spotify: 'Spotify',
  deezer: 'Deezer',
  itunes: 'iTunes',
  ticketmaster: 'Ticketmaster',
  skiddle: 'Skiddle',
  youtube: 'YouTube',
  lidarr: 'Lidarr',
  plex: 'Plex',
  jellyfin: 'Jellyfin',
  navidrome: 'Navidrome',
  plextv: 'plex.tv',
  plexwatchlist: 'Plex playlists',
};

settingsRoutes.get('/cache', async (_req, res) => {
  const apiCaches = Object.values(cacheManager.getAllCaches()).map((cache) => ({
    id: cache.id,
    name: CACHE_NAMES[cache.id as AvailableCacheIds] ?? cache.name,
    stats: cache.getStats(),
  }));

  const imageCache: CacheResponse['imageCache'] = {};
  for (const key of [...imageSourceTypes(), 'avatar']) {
    const imageStats = await ImageProxy.getImageStats(key);
    if (imageStats.imageCount > 0 || key === 'caa' || key === 'avatar') {
      imageCache[key] = imageStats;
    }
  }

  const stats: DnsStats | undefined = dnsCache?.getStats();
  const entries: DnsEntries | undefined = dnsCache?.getCacheEntries();

  const response: CacheResponse = {
    apiCaches,
    imageCache,
    dnsCache: { stats, entries },
  };
  return res.status(200).json(response);
});

// Registered before /cache/:cacheId/flush so "images" and "dns" aren't taken for cache ids.
settingsRoutes.post('/cache/images/cleanup', async (_req, res, next) => {
  try {
    await cleanImageCache();
    return res.status(204).send();
  } catch (e) {
    logger.error('Something went wrong cleaning the image cache', {
      label: 'Image Cache',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message:
        "The image cache couldn't be cleaned up. Check the logs for the reason.",
    });
  }
});

settingsRoutes.post<{ dnsEntry: string }>(
  '/cache/dns/:dnsEntry/flush',
  (req, res, next) => {
    const dnsEntry = req.params.dnsEntry;

    if (dnsCache) {
      dnsCache.clear(dnsEntry);
      return res.status(204).send();
    }

    next({ status: 404, message: 'Cache not found.' });
  }
);

settingsRoutes.post<{ cacheId: AvailableCacheIds }>(
  '/cache/:cacheId/flush',
  (req, res, next) => {
    const cache = cacheManager.getCache(req.params.cacheId);

    if (cache) {
      cache.flush();
      return res.status(204).send();
    }

    next({ status: 404, message: 'Cache not found.' });
  }
);

/* ------------------------------------------------------------------ */
/* Setup and About                                                     */
/* ------------------------------------------------------------------ */

settingsRoutes.post(
  '/initialize',
  isAuthenticated(Permission.ADMIN),
  async (_req, res) => {
    const settings = getSettings();

    settings.public.initialized = true;
    await settings.save();

    return res.status(200).json(settings.public);
  }
);

settingsRoutes.get('/about', async (_req, res) => {
  const mediaRepository = getRepository(Media);

  const [
    totalMediaItems,
    totalArtists,
    totalTracks,
    totalRequests,
    totalUsers,
  ] = await Promise.all([
    mediaRepository.count({
      where: {
        mediaType: MediaType.RELEASE_GROUP,
        status: Not(MediaStatus.UNKNOWN),
      },
    }),
    mediaRepository.count({ where: { mediaType: MediaType.ARTIST } }),
    getRepository(Track).count({ where: { status: MediaStatus.AVAILABLE } }),
    getRepository(MediaRequest).count(),
    getRepository(User).count(),
  ]);

  const response: SettingsAboutResponse = {
    version: getAppVersion(),
    commitTag: getCommitTag(),
    totalMediaItems,
    totalArtists,
    totalTracks,
    totalRequests,
    totalUsers,
    tz: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    appDataPath: appDataPath(),
  };
  return res.status(200).json(response);
});

export default settingsRoutes;
