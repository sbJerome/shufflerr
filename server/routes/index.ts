// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
//
// Every router of every stream is mounted here already. Streams implement
// their own router files and should not need to edit this file.
import PushoverAPI from '@server/api/pushover';
import { getRepository } from '@server/datasource';
import DiscoverSlider from '@server/entity/DiscoverSlider';
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
import importRoutes from './import';
import issueRoutes from './issue';
import issueCommentRoutes from './issueComment';
import libraryRoutes from './library';
import mediaRoutes from './media';
import publicRoutes from './public';
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

router.get('/status/appdata', (_req, res) => {
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
  isAuthenticated(),
  async (req, res, next) => {
    const pushoverApi = new PushoverAPI();

    try {
      if (!req.query.token) {
        throw new Error('Pushover application token missing from request');
      }

      const sounds = await pushoverApi.getSounds(req.query.token as string);
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
// OAuth / web-auth returns for linked accounts (session cookie identifies the user)
router.use('/callback', isAuthenticated(), callbackRoutes);

router.use('/search', isAuthenticated(), searchRoutes);
router.use('/discover', isAuthenticated(), discoverRoutes);
router.use('/library', isAuthenticated(), libraryRoutes);
router.use('/artist', isAuthenticated(), artistRoutes);
router.use('/album', isAuthenticated(), albumRoutes);
router.use('/recording', isAuthenticated(), recordingRoutes);
router.use('/request', isAuthenticated(), requestRoutes);
router.use('/media', isAuthenticated(), mediaRoutes);
router.use('/service', isAuthenticated(), serviceRoutes);
router.use('/stream', isAuthenticated(), streamRoutes);
router.use('/import', isAuthenticated(), importRoutes);
router.use('/scrobble', isAuthenticated(), scrobbleRoutes);
router.use('/youtube', isAuthenticated(), youtubeRoutes);
router.use('/watchlist', isAuthenticated(), watchlistRoutes);
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
