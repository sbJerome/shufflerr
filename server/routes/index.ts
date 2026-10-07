// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
//
// Every router of every stream is mounted here already. Streams implement
// their own router files and should not need to edit this file.
import PushoverAPI from '@server/api/pushover';
import { MediaStatus, RequestScope } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import DiscoverSlider from '@server/entity/DiscoverSlider';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import type { StatusResponse } from '@server/interfaces/api/settingsInterfaces';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import overrideRuleRoutes from '@server/routes/overrideRule';
import settingsRoutes from '@server/routes/settings';
import watchlistRoutes from '@server/routes/watchlist';
import {
  appDataPath,
  appDataPermissions,
  appDataStatus,
} from '@server/utils/appDataVolume';
import { getAppVersion, getCommitTag } from '@server/utils/appVersion';
import restartFlag from '@server/utils/restartFlag';
import { Router } from 'express';
import artistRoutes from './artist';
import authRoutes from './auth';
import blocklistRoutes from './blocklist';
import callbackRoutes from './callback';
import discoverRoutes from './discover';
import genreRoutes from './genre';
import importRoutes from './import';
import issueRoutes from './issue';
import issueCommentRoutes from './issueComment';
import libraryRoutes from './library';
import mediaRoutes from './media';
import playlistRoutes from './playlist';
import publicRoutes from './public';
import realtimeRoutes from './realtime';
import recordingRoutes from './recording';
import albumRoutes from './release';
import requestRoutes from './request';
import scrobbleRoutes from './scrobble';
import searchRoutes from './search';
import serviceRoutes from './service';
import streamRoutes from './stream';
import user from './user';
import webhookRoutes from './webhooks';
import youtubeRoutes from './youtube';

const router = Router();

router.use(checkUser);

router.get<unknown, StatusResponse>('/status', async (_req, res) => {
  // TODO(decision): no public Shufflerr release feed exists yet, so there is
  // nothing to compare against. `updateAvailable` stays false until one does.
  return res.status(200).json({
    version: getAppVersion(),
    commitTag: getCommitTag(),
    updateAvailable: false,
    commitsBehind: 0,
    restartRequired: restartFlag.isSet(),
  });
});

// Read by the audio-verification sidecar to learn whether direct-grab is on.
// Returns only a boolean (no secrets), so it is intentionally unauthenticated —
// the sidecar has no Shufflerr session or API key.
// The audio-verifier sidecar polls this (unauthenticated: it returns only a
// boolean and a list of integer album ids — no secrets, no names). When direct
// grab is on, `albumIds` scopes it to the albums the user actually requested
// (a pending/processing request), NOT Lidarr's whole monitored-missing catalog.
router.get('/verifier/config', async (_req, res) => {
  const settings = getSettings();
  let albumIds: number[] = [];
  // Per album (Lidarr id): the requested recording MBIDs, ONLY when the album is
  // wanted purely by track scope. An album with an active album/discography
  // request imports in full (absent from trackScopes).
  const trackScopes: Record<number, string[]> = {};
  if (settings.main.musicDirectGrab) {
    try {
      const requests = await getRepository(MediaRequest)
        .createQueryBuilder('request')
        .innerJoinAndSelect('request.media', 'media')
        .leftJoinAndSelect('request.tracks', 'trackRequest')
        .leftJoinAndSelect('trackRequest.track', 'track')
        .where('media.status IN (:...statuses)', {
          statuses: [MediaStatus.PENDING, MediaStatus.PROCESSING],
        })
        .andWhere('media.lidarrAlbumId IS NOT NULL')
        .andWhere('media.lidarrAlbumId != 0')
        .getMany();

      const byAlbum = new Map<number, { fullAlbum: boolean; mbids: Set<string> }>();
      for (const request of requests) {
        const albumId = request.media?.lidarrAlbumId;
        if (typeof albumId !== 'number' || albumId <= 0) {
          continue;
        }
        let entry = byAlbum.get(albumId);
        if (!entry) {
          entry = { fullAlbum: false, mbids: new Set<string>() };
          byAlbum.set(albumId, entry);
        }
        if (
          request.scope === RequestScope.ALBUM ||
          request.scope === RequestScope.DISCOGRAPHY
        ) {
          entry.fullAlbum = true;
        } else if (request.scope === RequestScope.TRACKS) {
          for (const trackRequest of request.tracks ?? []) {
            const mbid = trackRequest.track?.recordingMbid;
            if (mbid) {
              entry.mbids.add(mbid);
            }
          }
        }
      }

      albumIds = [...byAlbum.keys()];
      for (const [albumId, entry] of byAlbum) {
        if (!entry.fullAlbum && entry.mbids.size > 0) {
          trackScopes[albumId] = [...entry.mbids];
        }
      }
    } catch (e) {
      logger.error('Failed to compute direct-grab request album ids', {
        label: 'Verifier',
        errorMessage: e instanceof Error ? e.message : 'unknown',
      });
    }
  }
  return res
    .status(200)
    .json({ enabled: settings.main.musicDirectGrab, albumIds, trackScopes });
});

router.get('/status/appdata', isAuthenticated(), (_req, res) => {
  return res.status(200).json({
    appData: appDataStatus(),
    appDataPath: appDataPath(),
    appDataPermissions: appDataPermissions(),
  });
});

router.use('/user', isAuthenticated(), user);
router.get('/settings/public', async (req, res) => {
  const settings = getSettings();

  if (!(req.user?.settings?.notificationTypes.webpush ?? true)) {
    return res
      .status(200)
      .json({ ...settings.fullPublicSettings, enablePushRegistration: false });
  } else {
    return res.status(200).json(settings.fullPublicSettings);
  }
});
router.get('/settings/sliders', isAuthenticated(), async (_req, res) => {
  const sliderRepository = getRepository(DiscoverSlider);

  const sliders = await sliderRepository.find({ order: { order: 'ASC' } });

  return res.json(sliders);
});
router.get(
  '/settings/notifications/pushover/sounds',
  isAuthenticated(Permission.MANAGE_SETTINGS),
  async (req, res, next) => {
    const pushoverApi = new PushoverAPI();

    try {
      // The settings page only ever sees the masked token; when the query
      // carries the mask (or nothing), use the stored token instead.
      const given = String(req.query.token ?? '');
      const stored =
        getSettings().notifications.agents.pushover.options.accessToken;
      const token = !given || given.includes('•') ? stored : given;
      if (!token) {
        throw new Error('Pushover application token missing from request');
      }

      const sounds = await pushoverApi.getSounds(token);
      res.status(200).json(sounds);
    } catch (e) {
      logger.debug('Something went wrong retrieving Pushover sounds', {
        label: 'API',
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve Pushover sounds.',
      });
    }
  }
);
// Importable-user lists are needed by the Users page (MANAGE_USERS without
// MANAGE_SETTINGS); the routers themselves check the permission.
router.use(
  '/settings',
  isAuthenticated([Permission.MANAGE_SETTINGS, Permission.MANAGE_USERS], {
    type: 'or',
  }),
  (req, res, next) => {
    if (
      req.user?.hasPermission(Permission.MANAGE_SETTINGS) ||
      /^\/(plex|jellyfin)\/users\/?$/.test(req.path)
    ) {
      return next();
    }
    return res.status(403).json({
      status: 403,
      error: 'You do not have permission to access this endpoint',
    });
  },
  settingsRoutes
);

// Public (no session needed)
router.use('/public', publicRoutes);
router.use('/auth', authRoutes);
// Authenticated by apikey query (Plex / Jellyfin cannot send a session)
router.use('/webhooks', webhookRoutes);
// OAuth / web-auth returns for linked accounts. The one-shot `state` from the
// authorize route identifies the user, so this works even when the session
// cookie is withheld on the cross-site return (SameSite=Strict with CSRF on).
router.use('/callback', callbackRoutes);

router.use('/search', isAuthenticated(), searchRoutes);
router.use('/discover', isAuthenticated(), discoverRoutes);
router.use('/library', isAuthenticated(), libraryRoutes);
router.use('/artist', isAuthenticated(), artistRoutes);
router.use('/genre', isAuthenticated(), genreRoutes);
router.use('/album', isAuthenticated(), albumRoutes);
router.use('/recording', isAuthenticated(), recordingRoutes);
router.use('/request', isAuthenticated(), requestRoutes);
router.use('/media', isAuthenticated(), mediaRoutes);
// The service route exposes a Lidarr server's root-folder paths, disk space and
// profiles — infrastructure detail. Only people who can pick those in a request
// (REQUEST_ADVANCED / MANAGE_REQUESTS) or configure servers (MANAGE_SETTINGS)
// may read it; ADMIN passes too.
router.use(
  '/service',
  isAuthenticated(
    [
      Permission.MANAGE_REQUESTS,
      Permission.REQUEST_ADVANCED,
      Permission.MANAGE_SETTINGS,
    ],
    { type: 'or' }
  ),
  serviceRoutes
);
router.use('/realtime', isAuthenticated(), realtimeRoutes);
router.use('/stream', isAuthenticated(), streamRoutes);
router.use('/import', isAuthenticated(), importRoutes);
router.use('/scrobble', isAuthenticated(), scrobbleRoutes);
router.use('/youtube', isAuthenticated(), youtubeRoutes);
router.use('/watchlist', isAuthenticated(), watchlistRoutes);
router.use('/playlist', isAuthenticated(), playlistRoutes);
router.use('/blocklist', isAuthenticated(), blocklistRoutes);
router.use('/issue', isAuthenticated(), issueRoutes);
router.use('/issueComment', isAuthenticated(), issueCommentRoutes);
router.use('/overrideRule', isAuthenticated(), overrideRuleRoutes);

router.get('/', (_req, res) => {
  return res.status(200).json({
    api: 'Shufflerr API',
    version: '1.0',
  });
});

export default router;
