// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// STREAM(SV5): owns this file. Sub-routers of other streams are mounted here
// already — do not move them:
//   SV2  ./lidarr                      /settings/lidarr…
//   SV3  ./plex ./jellyfin ./navidrome ./local   /settings/{plex,jellyfin,navidrome,local}…
//   SV5  ./notifications ./sliders
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import AppPassword from '@server/entity/AppPassword';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import Track from '@server/entity/Track';
import { User } from '@server/entity/User';
import type {
  ClientDevice,
  ClientsSettingsResponse,
  LogMessage,
  LogsResultsResponse,
  SettingsAboutResponse,
  UsersSettingsResponse,
} from '@server/interfaces/api/settingsInterfaces';
import { runJobNow, scheduledJobs } from '@server/job/schedule';
import type { AvailableCacheIds } from '@server/lib/cache';
import cacheManager from '@server/lib/cache';
import { imageSourceTypes } from '@server/lib/imageSources';
import ImageProxy from '@server/lib/imageproxy';
import { Permission } from '@server/lib/permissions';
import type { JobId, MainSettings } from '@server/lib/settings';
import {
  getSettings,
  maskSecrets,
  mergeWithSecrets,
} from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import sliderSettingRoutes from '@server/routes/settings/sliders';
import { appDataPath } from '@server/utils/appDataVolume';
import { getAppVersion, getCommitTag } from '@server/utils/appVersion';
import { dnsCache } from '@server/utils/dnsCache';
import type { DnsEntries, DnsStats } from 'dns-caching';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import { escapeRegExp, merge, omit, set } from 'lodash';
import { rescheduleJob } from 'node-schedule';
import path from 'path';
import { Not } from 'typeorm';
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

/* ---- Simple sections: GET returns the section (secrets masked), POST merges
 * a partial section, keeping stored secrets when the masked value comes back.
 * STREAM(SV5): add validation + specific copy per docs/ADMIN_PAGES.md. ---- */
type SectionKey = 'youtube' | 'metadata' | 'discover' | 'scrobble';
const SECTION_SECRETS: Record<SectionKey, string[]> = {
  youtube: ['apiKey'],
  metadata: ['fanart.apiKey', 'lastfm.apiKey', 'lastfm.sharedSecret'],
  discover: ['spotify.clientSecret', 'ticketmaster.apiKey', 'skiddle.apiKey'],
  scrobble: [],
};

(Object.keys(SECTION_SECRETS) as SectionKey[]).forEach((key) => {
  settingsRoutes.get(`/${key}`, (_req, res) => {
    const settings = getSettings();
    return res
      .status(200)
      .json(maskSecrets(settings[key] as object, SECTION_SECRETS[key]));
  });

  settingsRoutes.post(`/${key}`, async (req, res) => {
    const settings = getSettings();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (settings as any)[key] = mergeWithSecrets(
      settings[key] as object,
      req.body ?? {},
      SECTION_SECRETS[key]
    );
    await settings.save();
    return res
      .status(200)
      .json(maskSecrets(settings[key] as object, SECTION_SECRETS[key]));
  });
});

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

settingsRoutes.get('/users', (_req, res) => {
  return res.status(200).json(usersSettings());
});

settingsRoutes.post('/users', async (req, res, next) => {
  const settings = getSettings();
  const body = {
    ...usersSettings(),
    ...(req.body ?? {}),
  } as UsersSettingsResponse;

  if (!body.localLogin && !body.plexLogin && !body.jellyfinLogin) {
    return next({
      status: 400,
      message: 'At least one sign-in method has to stay on.',
    });
  }

  settings.main.localLogin = !!body.localLogin;
  settings.main.newPlexLogin = !!body.newPlexLogin;
  settings.main.mediaServerLogin = !!(body.plexLogin || body.jellyfinLogin);
  settings.plex.loginEnabled = !!body.plexLogin;
  settings.jellyfin.loginEnabled = !!body.jellyfinLogin;
  settings.jellyfin.newLogin = !!body.newJellyfinLogin;
  settings.main.defaultPermissions = Number(body.defaultPermissions) || 0;
  settings.main.defaultQuotas = body.defaultQuotas;
  settings.main.discographyAlwaysReview = !!body.discographyAlwaysReview;
  await settings.save();

  return res.status(200).json(usersSettings());
});

const clientsSettings = (origin: string): ClientsSettingsResponse => {
  const settings = getSettings();
  const base = settings.main.applicationUrl || origin;
  return {
    ...settings.clients,
    endpoints: { openSubsonic: `${base}/rest`, jellyfin: `${base}/jellyfin` },
  };
};

settingsRoutes.get('/clients', (req, res) => {
  return res
    .status(200)
    .json(clientsSettings(`${req.protocol}://${req.get('host')}`));
});

settingsRoutes.post('/clients', async (req, res) => {
  const settings = getSettings();
  settings.clients = merge(settings.clients, omit(req.body ?? {}, 'endpoints'));
  await settings.save();
  return res
    .status(200)
    .json(clientsSettings(`${req.protocol}://${req.get('host')}`));
});

settingsRoutes.get('/clients/devices', async (_req, res) => {
  const devices = await getRepository(AppPassword).find({
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
    const device = await repo.findOne({ where: { id: Number(req.params.id) } });
    if (!device) {
      return next({
        status: 404,
        message: 'That app password no longer exists.',
      });
    }
    await repo.remove(device);
    return res.status(204).send();
  }
);

const filteredMainSettings = (
  user: User,
  main: MainSettings
): Partial<MainSettings> => {
  if (!user?.hasPermission(Permission.ADMIN)) {
    return omit(main, 'apiKey');
  }

  return main;
};

settingsRoutes.get('/main', (req, res, next) => {
  const settings = getSettings();

  if (!req.user) {
    return next({ status: 400, message: 'User missing from request.' });
  }

  res.status(200).json(filteredMainSettings(req.user, settings.main));
});

settingsRoutes.post('/main', async (req, res) => {
  const settings = getSettings();

  settings.main = merge(settings.main, req.body);
  await settings.save();

  return res.status(200).json(settings.main);
});

settingsRoutes.get('/network', (req, res) => {
  const settings = getSettings();

  res.status(200).json(settings.network);
});

settingsRoutes.post('/network', async (req, res) => {
  const settings = getSettings();

  settings.network = merge(settings.network, req.body);
  await settings.save();

  return res.status(200).json(settings.network);
});

settingsRoutes.post('/main/regenerate', async (req, res, next) => {
  const settings = getSettings();

  const main = await settings.regenerateApiKey();

  if (!req.user) {
    return next({ status: 500, message: 'User missing from request.' });
  }

  return res.status(200).json(filteredMainSettings(req.user, main));
});

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

settingsRoutes.get('/jobs', (_req, res) => {
  return res.status(200).json(
    scheduledJobs.map((job) => ({
      id: job.id,
      name: job.name,
      type: job.type,
      interval: job.interval,
      cronSchedule: job.cronSchedule,
      nextExecutionTime: job.job.nextInvocation(),
      running: job.running ? job.running() : false,
    }))
  );
});

settingsRoutes.post<{ jobId: string }>('/jobs/:jobId/run', (req, res, next) => {
  const scheduledJob = scheduledJobs.find((job) => job.id === req.params.jobId);

  if (!scheduledJob) {
    return next({ status: 404, message: 'Job not found.' });
  }

  runJobNow(scheduledJob.id);

  return res.status(200).json({
    id: scheduledJob.id,
    name: scheduledJob.name,
    type: scheduledJob.type,
    interval: scheduledJob.interval,
    cronSchedule: scheduledJob.cronSchedule,
    nextExecutionTime: scheduledJob.job.nextInvocation(),
    running: scheduledJob.running ? scheduledJob.running() : false,
  });
});

settingsRoutes.post<{ jobId: JobId }>(
  '/jobs/:jobId/cancel',
  (req, res, next) => {
    const scheduledJob = scheduledJobs.find(
      (job) => job.id === req.params.jobId
    );

    if (!scheduledJob) {
      return next({ status: 404, message: 'Job not found.' });
    }

    if (scheduledJob.cancelFn) {
      scheduledJob.cancelFn();
    }

    return res.status(200).json({
      id: scheduledJob.id,
      name: scheduledJob.name,
      type: scheduledJob.type,
      interval: scheduledJob.interval,
      cronSchedule: scheduledJob.cronSchedule,
      nextExecutionTime: scheduledJob.job.nextInvocation(),
      running: scheduledJob.running ? scheduledJob.running() : false,
    });
  }
);

settingsRoutes.post<{ jobId: JobId }>(
  '/jobs/:jobId/schedule',
  async (req, res, next) => {
    const scheduledJob = scheduledJobs.find(
      (job) => job.id === req.params.jobId
    );

    if (!scheduledJob) {
      return next({ status: 404, message: 'Job not found.' });
    }

    const result = rescheduleJob(scheduledJob.job, req.body.schedule);
    const settings = getSettings();

    if (result) {
      settings.jobs[scheduledJob.id].schedule = req.body.schedule;
      await settings.save();

      scheduledJob.cronSchedule = req.body.schedule;

      return res.status(200).json({
        id: scheduledJob.id,
        name: scheduledJob.name,
        type: scheduledJob.type,
        interval: scheduledJob.interval,
        cronSchedule: scheduledJob.cronSchedule,
        nextExecutionTime: scheduledJob.job.nextInvocation(),
        running: scheduledJob.running ? scheduledJob.running() : false,
      });
    } else {
      return next({ status: 400, message: 'Invalid job schedule.' });
    }
  }
);

settingsRoutes.get('/cache', async (_req, res) => {
  const cacheManagerCaches = cacheManager.getAllCaches();

  const apiCaches = Object.values(cacheManagerCaches).map((cache) => ({
    id: cache.id,
    name: cache.name,
    stats: cache.getStats(),
  }));

  const imageCache: Record<string, { size: number; imageCount: number }> = {};
  for (const key of [...imageSourceTypes(), 'avatar']) {
    const imageStats = await ImageProxy.getImageStats(key);
    if (imageStats.imageCount > 0 || key === 'caa' || key === 'avatar') {
      imageCache[key] = imageStats;
    }
  }

  const stats: DnsStats | undefined = dnsCache?.getStats();
  const entries: DnsEntries | undefined = dnsCache?.getCacheEntries();

  return res.status(200).json({
    apiCaches,
    imageCache,
    dnsCache: {
      stats,
      entries,
    },
  });
});

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

  return res.status(200).json({
    version: getAppVersion(),
    commitTag: getCommitTag(),
    totalMediaItems,
    totalArtists,
    totalTracks,
    totalRequests,
    totalUsers,
    tz: process.env.TZ,
    appDataPath: appDataPath(),
  } as SettingsAboutResponse);
});

export default settingsRoutes;
