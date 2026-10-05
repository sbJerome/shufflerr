// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: server/routes/settings/index.ts at commit 2cfbcf8940225f1597d44f507fd78040887c5597
// Plex as a library source: connection, music libraries, scan panel
// (docs/API_CONTRACT.md §SV3). Paths are relative to /api/v1/settings.
import PlexAPI from '@server/api/plexapi';
import PlexTvAPI from '@server/api/plextv';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import type { PlexConnection } from '@server/interfaces/api/plexInterfaces';
import type { ConnectionTestResponse } from '@server/interfaces/api/settingsInterfaces';
import type { ImportableUser } from '@server/interfaces/api/userInterfaces';
import { Permission } from '@server/lib/permissions';
import { plexFullScanner, plexRecentScanner } from '@server/lib/scanners/plex';
import type { PlexSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import { sortBy } from 'lodash';
import { z } from 'zod';
import { addScanRoutes } from './scanPanel';

const settingsRoutes = Router();

const libraryUpdateSchema = z.object({
  enabled: z.boolean(),
});

const connectionSchema = z
  .object({
    enabled: z.boolean(),
    loginEnabled: z.boolean(),
    name: z.string(),
    ip: z.string().trim(),
    port: z.coerce.number().int().min(1).max(65535),
    useSsl: z.boolean(),
    webAppUrl: z.string().trim(),
  })
  .partial();

const NO_OWNER_TOKEN =
  "Plex isn't linked to the owner account yet. Sign in with Plex as the owner (or link Plex in the owner's profile), then try again.";

const ownerPlexToken = async (): Promise<string | null> => {
  const owner = await getRepository(User).findOne({
    select: { id: true, plexToken: true },
    where: { id: 1 },
  });
  return owner?.plexToken || null;
};

const probe = async (
  plexSettings: PlexSettings,
  token: string
): Promise<ConnectionTestResponse & { machineId?: string }> => {
  if (!plexSettings.ip) {
    return {
      ok: false,
      message: 'Enter the hostname or IP address of the Plex server.',
    };
  }
  try {
    const client = new PlexAPI({
      plexToken: token,
      plexSettings,
      timeout: 8000,
    });
    const result = await client.getStatus();
    const container = result?.MediaContainer as
      | { machineIdentifier?: string; friendlyName?: string; version?: string }
      | undefined;

    if (!container?.machineIdentifier) {
      return {
        ok: false,
        message:
          'That address answered, but not like a Plex server. Check the hostname and port.',
      };
    }
    return {
      ok: true,
      name: container.friendlyName,
      version: container.version,
      machineId: container.machineIdentifier,
    };
  } catch (e) {
    const status = e.response?.status;
    return {
      ok: false,
      message:
        status === 401
          ? "Plex refused the owner's token. Sign in with Plex again as the owner."
          : `Couldn't reach Plex at ${plexSettings.ip}:${plexSettings.port}. Check the hostname, port and the SSL switch.`,
    };
  }
};

settingsRoutes.get('/plex', (_req, res) => {
  res.status(200).json(getSettings().plex);
});

settingsRoutes.post('/plex', async (req, res, next) => {
  const parsed = connectionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return next({
      status: 400,
      message:
        'Check the Plex connection fields: the port must be a number between 1 and 65535.',
    });
  }
  const settings = getSettings();
  const candidate: PlexSettings = { ...settings.plex, ...parsed.data };

  if (candidate.enabled && !candidate.ip) {
    return next({
      status: 400,
      message:
        'Enter the hostname or IP address of the Plex server before turning Plex on.',
    });
  }

  // Validate the connection whenever there is one to validate
  if (candidate.ip) {
    const token = await ownerPlexToken();
    if (!token) {
      if (candidate.enabled) {
        return next({ status: 400, message: NO_OWNER_TOKEN });
      }
    } else {
      const result = await probe(candidate, token);
      if (!result.ok) {
        if (candidate.enabled) {
          return next({ status: 400, message: result.message });
        }
      } else {
        candidate.machineId = result.machineId;
        candidate.name = result.name ?? candidate.name;
      }
    }
  }

  settings.plex = candidate;
  await settings.save();

  return res.status(200).json(settings.plex);
});

settingsRoutes.post('/plex/test', async (req, res, next) => {
  const parsed = connectionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return next({
      status: 400,
      message:
        'Check the Plex connection fields: the port must be a number between 1 and 65535.',
    });
  }
  const token = await ownerPlexToken();
  if (!token) {
    return res.status(200).json({
      ok: false,
      message: NO_OWNER_TOKEN,
    } satisfies ConnectionTestResponse);
  }
  const { ok, name, version, message } = await probe(
    { ...getSettings().plex, ...parsed.data },
    token
  );

  return res
    .status(200)
    .json({ ok, name, version, message } satisfies ConnectionTestResponse);
});

settingsRoutes.get('/plex/devices/servers', async (_req, res, next) => {
  try {
    const token = await ownerPlexToken();
    if (!token) {
      return next({ status: 400, message: NO_OWNER_TOKEN });
    }
    const plexTvClient = new PlexTvAPI(token);
    const devices = (await plexTvClient.getDevices())?.filter((device) => {
      return device.provides.includes('server') && device.owned;
    });
    const settings = getSettings();

    if (devices) {
      await Promise.all(
        devices.map(async (device) => {
          const plexDirectConnections: PlexConnection[] = [];

          device.connection.forEach((connection) => {
            const url = new URL(connection.uri);

            if (url.hostname !== connection.address) {
              const plexDirectConnection = { ...connection };
              plexDirectConnection.address = url.hostname;
              plexDirectConnections.push(plexDirectConnection);

              // Connect to IP addresses over HTTP
              connection.protocol = 'http';
            }
          });

          plexDirectConnections.forEach((plexDirectConnection) => {
            device.connection.push(plexDirectConnection);
          });

          await Promise.all(
            device.connection.map(async (connection) => {
              const plexDeviceSettings = {
                ...settings.plex,
                ip: connection.address,
                port: connection.port,
                useSsl: connection.protocol === 'https',
              };
              const plexClient = new PlexAPI({
                plexToken: token,
                plexSettings: plexDeviceSettings,
                timeout: 5000,
              });

              try {
                await plexClient.getStatus();
                connection.status = 200;
                connection.message = 'OK';
              } catch (e) {
                connection.status = 500;
                connection.message = e.message.split(':')[0];
              }
            })
          );
        })
      );
    }
    return res.status(200).json(
      (devices ?? []).map((device) => ({
        ...device,
        machineId: device.clientIdentifier,
        connections: device.connection,
      }))
    );
  } catch (e) {
    logger.error('Something went wrong retrieving Plex server list', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message:
        "Couldn't load your servers from plex.tv. Try again in a moment.",
    });
  }
});

const syncLibraries = async (): Promise<void> => {
  const token = await ownerPlexToken();
  if (!token) {
    throw Object.assign(new Error(NO_OWNER_TOKEN), { statusCode: 400 });
  }
  try {
    await new PlexAPI({ plexToken: token }).syncLibraries();
  } catch (e) {
    throw Object.assign(
      new Error(
        "Couldn't load the libraries from Plex. Check the connection and try again."
      ),
      { statusCode: e.statusCode ?? 502 }
    );
  }
};

settingsRoutes.get('/plex/library', async (req, res, next) => {
  if (req.query.sync) {
    try {
      await syncLibraries();
    } catch (e) {
      return next({ status: e.statusCode ?? 500, message: e.message });
    }
  }

  return res.status(200).json(getSettings().plex.libraries);
});

settingsRoutes.put('/plex/library/:libraryId', async (req, res, next) => {
  const settings = getSettings();
  const bodyResult = libraryUpdateSchema.safeParse(req.body);

  if (!bodyResult.success) {
    return next({
      status: 400,
      message: 'Send { enabled: true } or { enabled: false }.',
    });
  }

  const library = settings.plex.libraries.find(
    (l) => l.id === req.params.libraryId
  );

  if (!library) {
    return next({
      status: 404,
      message: "That library isn't in the list. Sync libraries and try again.",
    });
  }

  library.enabled = bodyResult.data.enabled;
  await settings.save();

  return res.status(200).json(settings.plex.libraries);
});

settingsRoutes.post('/plex/library/sync', async (_req, res, next) => {
  try {
    await syncLibraries();
  } catch (e) {
    return next({ status: e.statusCode ?? 500, message: e.message });
  }

  return res.status(200).json(getSettings().plex.libraries);
});

addScanRoutes(settingsRoutes, '/plex', plexFullScanner, plexRecentScanner);

settingsRoutes.get(
  '/plex/users',
  isAuthenticated(Permission.MANAGE_USERS),
  async (_req, res, next) => {
    const userRepository = getRepository(User);
    const qb = userRepository.createQueryBuilder('user');

    try {
      const token = await ownerPlexToken();
      if (!token) {
        return next({ status: 400, message: NO_OWNER_TOKEN });
      }
      const plexApi = new PlexTvAPI(token);
      const plexUsers = (await plexApi.getUsers()).MediaContainer.User.map(
        (user) => user.$
      ).filter((user) => user.email);

      const unimportedPlexUsers: ImportableUser[] = [];

      const plexIds = plexUsers.map((plexUser) => plexUser.id);
      const plexEmails = plexUsers.map((plexUser) =>
        plexUser.email.toLowerCase()
      );
      if (!plexIds.length) plexIds.push('-1');
      if (!plexEmails.length) plexEmails.push('@');

      const existingUsers = await qb
        .where('user.plexId IN (:...plexIds)', { plexIds })
        .orWhere('user.email IN (:...plexEmails)', { plexEmails })
        .getMany();

      await Promise.all(
        plexUsers.map(async (plexUser) => {
          if (
            !existingUsers.find(
              (user) =>
                user.plexId === parseInt(plexUser.id) ||
                user.email === plexUser.email.toLowerCase()
            ) &&
            (await plexApi.checkUserAccess(parseInt(plexUser.id)))
          ) {
            unimportedPlexUsers.push({
              id: plexUser.id,
              username: plexUser.username || plexUser.title,
              email: plexUser.email,
              thumb: plexUser.thumb,
            });
          }
        })
      );

      return res.status(200).json(sortBy(unimportedPlexUsers, 'username'));
    } catch (e) {
      logger.error('Something went wrong getting unimported Plex users', {
        label: 'API',
        errorMessage: e.message,
      });
      next({
        status: 500,
        message: "Couldn't load the list of Plex users. Try again in a moment.",
      });
    }
  }
);

export default settingsRoutes;
