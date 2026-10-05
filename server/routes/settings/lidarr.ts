// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: server/routes/settings/radarr.ts at commit 2cfbcf8940225f1597d44f507fd78040887c5597
// Mounted at /api/v1/settings/lidarr (see docs/API_CONTRACT.md, docs/ADMIN_PAGES.md §Lidarr).
import type { QualityProfile } from '@server/api/servarr/base';
import LidarrAPI from '@server/api/servarr/lidarr';
import type {
  LidarrServerStatus,
  LidarrTestResponse,
} from '@server/interfaces/api/serviceInterfaces';
import type { LidarrSettingsResponse } from '@server/interfaces/api/settingsInterfaces';
import type { LidarrSettings } from '@server/lib/settings';
import {
  getSettings,
  isMaskedSecret,
  maskSecret,
  resolveSecret,
} from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

const lidarrRoutes = Router();

type LidarrBody = Partial<LidarrSettings>;

const masked = (server: LidarrSettings): LidarrSettings => ({
  ...server,
  apiKey: maskSecret(server.apiKey),
});

/** Field checks with the copy the settings form shows. Returns the first problem. */
const validate = (body: LidarrBody, apiKey: string): string | null => {
  if (!body.name?.trim()) {
    return 'Enter a name for this server.';
  }
  if (!body.hostname?.trim()) {
    return 'Enter the hostname or IP address of Lidarr.';
  }
  if (/^https?:\/\//i.test(body.hostname.trim())) {
    return 'Enter the hostname without http:// or https://. Use the SSL switch instead.';
  }
  const port = Number(body.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return 'Enter a port between 1 and 65535.';
  }
  if (!apiKey) {
    return "Enter Lidarr's API key. It's under Settings → General in Lidarr.";
  }
  if (
    body.baseUrl &&
    (!body.baseUrl.startsWith('/') || body.baseUrl.endsWith('/'))
  ) {
    return 'The URL base has to start with a slash and not end with one, like /lidarr.';
  }
  if (!Number(body.activeQualityProfileId)) {
    return 'Choose a quality profile. Use Test to load them from Lidarr.';
  }
  if (!Number(body.activeMetadataProfileId)) {
    return 'Choose a metadata profile. Use Test to load them from Lidarr.';
  }
  if (!body.activeDirectory?.trim()) {
    return 'Choose a root folder. Use Test to load them from Lidarr.';
  }
  return null;
};

const build = (
  body: LidarrBody,
  id: number,
  apiKey: string,
  current?: LidarrSettings
): LidarrSettings => ({
  id,
  name: (body.name ?? '').trim(),
  hostname: (body.hostname ?? '').trim(),
  port: Number(body.port),
  apiKey,
  useSsl: !!body.useSsl,
  baseUrl: body.baseUrl?.trim() || '',
  isDefault: !!body.isDefault,
  isHiRes: !!body.isHiRes,
  activeQualityProfileId: Number(body.activeQualityProfileId),
  activeQualityProfileName: body.activeQualityProfileName ?? '',
  activeMetadataProfileId: Number(body.activeMetadataProfileId),
  activeMetadataProfileName: body.activeMetadataProfileName ?? '',
  activeDirectory: (body.activeDirectory ?? '').trim(),
  tags: Array.isArray(body.tags)
    ? body.tags.map(Number).filter(Number.isFinite)
    : [],
  externalUrl: body.externalUrl?.trim() || undefined,
  syncEnabled: body.syncEnabled ?? true,
  preventSearch: !!body.preventSearch,
  tagRequests: body.tagRequests ?? current?.tagRequests,
  overrideRule: current?.overrideRule,
});

/**
 * Exactly one default among the standard servers and at most one default
 * among the hi-res servers. `preferred` wins its class when it is a default.
 */
const normalizeDefaults = (
  servers: LidarrSettings[],
  preferred?: LidarrSettings
): LidarrSettings[] => {
  if (preferred?.isDefault) {
    servers.forEach((server) => {
      if (server.id !== preferred.id && server.isHiRes === preferred.isHiRes) {
        server.isDefault = false;
      }
    });
  }

  for (const isHiRes of [false, true]) {
    const group = servers.filter((server) => server.isHiRes === isHiRes);
    const defaults = group.filter((server) => server.isDefault);
    defaults.slice(1).forEach((server) => {
      server.isDefault = false;
    });
    // Requests need somewhere to go: a standard server is always the default.
    if (!isHiRes && group.length > 0 && defaults.length === 0) {
      group[0].isDefault = true;
    }
  }

  return servers;
};

const checkStatus = async (
  server: LidarrSettings
): Promise<LidarrServerStatus> => {
  try {
    const status = await LidarrAPI.fromSettings(server).getSystemStatus();
    return { id: server.id, connected: true, version: status.version };
  } catch (e) {
    return {
      id: server.id,
      connected: false,
      error: e.message.replace(/^\[Lidarr\]\s*/, ''),
    };
  }
};

// GET / → LidarrSettingsResponse (apiKey masked, live status per server)
lidarrRoutes.get<Record<string, string>, LidarrSettingsResponse>(
  '/',
  async (_req, res) => {
    const servers = getSettings().lidarr;
    const statuses = await Promise.all(servers.map(checkStatus));

    res.status(200).json(
      servers.map((server, index) => ({
        ...masked(server),
        status: statuses[index],
      }))
    );
  }
);

// POST / → create server
lidarrRoutes.post<Record<string, string>, LidarrSettings, LidarrBody>(
  '/',
  async (req, res, next) => {
    const settings = getSettings();
    const body = req.body ?? {};
    const apiKey = isMaskedSecret(body.apiKey)
      ? ''
      : (body.apiKey ?? '').trim();

    const problem = validate(body, apiKey);
    if (problem) {
      return next({ status: 400, message: problem });
    }

    const lastItem = settings.lidarr[settings.lidarr.length - 1];
    const server = build(body, lastItem ? lastItem.id + 1 : 0, apiKey);

    settings.lidarr = normalizeDefaults([...settings.lidarr, server], server);
    await settings.save();

    return res.status(201).json(masked(server));
  }
);

// POST /test → LidarrTestResponse { profiles, metadataProfiles, rootFolders, tags }
lidarrRoutes.post<
  Record<string, string>,
  LidarrTestResponse,
  Pick<LidarrBody, 'hostname' | 'port' | 'apiKey' | 'useSsl' | 'baseUrl' | 'id'>
>('/test', async (req, res, next) => {
  const body = req.body ?? {};
  const stored =
    body.id !== undefined
      ? getSettings().lidarr.find((s) => s.id === Number(body.id))
      : undefined;
  const apiKey = resolveSecret(body.apiKey, stored?.apiKey).trim();
  const hostname = (body.hostname ?? stored?.hostname ?? '').trim();
  const port = Number(body.port ?? stored?.port);

  if (!hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    return next({
      status: 400,
      message: 'Enter a hostname and port before testing the connection.',
    });
  }
  if (!apiKey) {
    return next({
      status: 400,
      message: "Enter Lidarr's API key before testing the connection.",
    });
  }

  try {
    const lidarr = LidarrAPI.fromSettings({
      hostname,
      port,
      apiKey,
      useSsl: body.useSsl ?? stored?.useSsl ?? false,
      baseUrl: body.baseUrl ?? stored?.baseUrl ?? '',
    });

    const status = await lidarr.getSystemStatus();
    const [profiles, metadataProfiles, rootFolders, tags] = await Promise.all([
      lidarr.getProfiles(),
      lidarr.getMetadataProfiles(),
      lidarr.getRootFolders(),
      lidarr.getTags(),
    ]);

    return res.status(200).json({
      profiles: profiles.map((p) => ({ id: p.id, name: p.name })),
      metadataProfiles,
      rootFolders: rootFolders.map((folder) => ({
        id: folder.id,
        path: folder.path,
      })),
      tags,
      urlBase: status.urlBase,
      version: status.version,
    });
  } catch (e) {
    logger.error('Failed to test Lidarr', {
      label: 'Lidarr',
      message: e.message,
    });

    next({
      status: 500,
      message: `Couldn't connect to Lidarr. Check the address, port, SSL setting and API key. (${e.message.replace(
        /^\[Lidarr\]\s*/,
        ''
      )})`,
    });
  }
});

// PUT /:id → update
lidarrRoutes.put<{ id: string }, LidarrSettings, LidarrBody>(
  '/:id',
  async (req, res, next) => {
    const settings = getSettings();
    const index = settings.lidarr.findIndex(
      (s) => s.id === Number(req.params.id)
    );

    if (index === -1) {
      return next({
        status: 404,
        message: "That Lidarr server doesn't exist any more.",
      });
    }

    const current = settings.lidarr[index];
    const body = req.body ?? {};
    // A masked or absent key keeps the stored one.
    const apiKey = resolveSecret(body.apiKey, current.apiKey).trim();

    const problem = validate(body, apiKey);
    if (problem) {
      return next({ status: 400, message: problem });
    }

    const server = build(body, current.id, apiKey, current);
    const servers = [...settings.lidarr];
    servers[index] = server;

    settings.lidarr = normalizeDefaults(servers, server);
    await settings.save();

    return res.status(200).json(masked(server));
  }
);

// GET /:id/profiles → QualityProfile[]
lidarrRoutes.get<{ id: string }, QualityProfile[]>(
  '/:id/profiles',
  async (req, res, next) => {
    const server = getSettings().lidarr.find(
      (s) => s.id === Number(req.params.id)
    );

    if (!server) {
      return next({
        status: 404,
        message: "That Lidarr server doesn't exist any more.",
      });
    }

    try {
      const profiles = await LidarrAPI.fromSettings(server).getProfiles();

      return res
        .status(200)
        .json(
          profiles.map((profile) => ({ id: profile.id, name: profile.name }))
        );
    } catch (e) {
      next({
        status: 500,
        message: `Couldn't load quality profiles from Lidarr (${server.name}). ${e.message.replace(
          /^\[Lidarr\]\s*/,
          ''
        )}`,
      });
    }
  }
);

// DELETE /:id → remove
lidarrRoutes.delete<{ id: string }, LidarrSettings>(
  '/:id',
  async (req, res, next) => {
    const settings = getSettings();
    const index = settings.lidarr.findIndex(
      (s) => s.id === Number(req.params.id)
    );

    if (index === -1) {
      return next({
        status: 404,
        message: "That Lidarr server doesn't exist any more.",
      });
    }

    const servers = [...settings.lidarr];
    const [removed] = servers.splice(index, 1);

    settings.lidarr = normalizeDefaults(servers);
    await settings.save();

    return res.status(200).json(masked(removed));
  }
);

export default lidarrRoutes;
