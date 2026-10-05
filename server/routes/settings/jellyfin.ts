// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: server/routes/settings/index.ts at commit 2cfbcf8940225f1597d44f507fd78040887c5597
// Jellyfin / Emby as a library source: connection, music libraries, scan panel
// (docs/API_CONTRACT.md §SV3). Paths are relative to /api/v1/settings.
import JellyfinAPI from '@server/api/jellyfin';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import type { ConnectionTestResponse } from '@server/interfaces/api/settingsInterfaces';
import type { ImportableUser } from '@server/interfaces/api/userInterfaces';
import { Permission } from '@server/lib/permissions';
import {
  jellyfinFullScanner,
  jellyfinRecentScanner,
} from '@server/lib/scanners/jellyfin';
import type { JellyfinSettings, Library } from '@server/lib/settings';
import {
  getSettings,
  maskSecrets,
  mergeWithSecrets,
} from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { getHostname } from '@server/utils/getHostname';
import { Router } from 'express';
import { z } from 'zod';
import { addScanRoutes } from './scanPanel';

const settingsRoutes = Router();

const SECRET_PATHS = ['apiKey'];

const libraryUpdateSchema = z.object({
  enabled: z.boolean(),
});

const connectionSchema = z
  .object({
    enabled: z.boolean(),
    loginEnabled: z.boolean(),
    newLogin: z.boolean(),
    /** Convenience: a full server URL, split into ip / port / useSsl / urlBase. */
    url: z.string().trim(),
    ip: z.string().trim(),
    port: z.coerce.number().int().min(1).max(65535),
    useSsl: z.boolean(),
    urlBase: z.string().trim(),
    externalHostname: z.string().trim(),
    jellyfinForgotPasswordUrl: z.string().trim(),
    apiKey: z.string().trim(),
  })
  .partial();

type ConnectionBody = z.infer<typeof connectionSchema>;

/** Accept `url` and turn it into Seerr's ip / port / useSsl / urlBase fields. */
const splitUrl = (body: ConnectionBody): Partial<JellyfinSettings> => {
  const { url, ...rest } = body;
  if (url === undefined || url === '') {
    return rest;
  }
  const parsed = new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`);
  const useSsl = parsed.protocol === 'https:';

  return {
    ...rest,
    ip: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : useSsl ? 443 : 8096,
    useSsl,
    urlBase: parsed.pathname.replace(/\/+$/, ''),
  };
};

const owner = (): Promise<User | null> =>
  getRepository(User).findOne({
    select: { id: true, jellyfinUserId: true, jellyfinDeviceId: true },
    where: { id: 1 },
  });

const clientFor = async (
  jellyfinSettings: JellyfinSettings
): Promise<JellyfinAPI> => {
  const admin = await owner();
  const client = new JellyfinAPI(
    getHostname(jellyfinSettings),
    jellyfinSettings.apiKey,
    admin?.jellyfinDeviceId
  );
  if (admin?.jellyfinUserId) {
    client.setUserId(admin.jellyfinUserId);
  }
  return client;
};

const probe = async (
  jellyfinSettings: JellyfinSettings
): Promise<ConnectionTestResponse & { serverId?: string }> => {
  if (!jellyfinSettings.ip) {
    return { ok: false, message: 'Enter the server URL.' };
  }
  if (!jellyfinSettings.apiKey) {
    return {
      ok: false,
      message:
        'Enter an API key. You can make one under Dashboard → API keys in Jellyfin.',
    };
  }
  try {
    const client = await clientFor(jellyfinSettings);
    const info = await client.getSystemInfo();
    if (!info?.Id) {
      return {
        ok: false,
        message:
          'That address answered, but not like a Jellyfin server. Check the server URL.',
      };
    }
    return {
      ok: true,
      name: info.ServerName,
      version: info.Version,
      serverId: info.Id,
    };
  } catch (e) {
    return {
      ok: false,
      message:
        e.statusCode === 401 || e.errorCode === 'INVALID_AUTH_TOKEN'
          ? "The server didn't accept that API key. Check it under Dashboard → API keys."
          : `Couldn't reach the server at ${getHostname(jellyfinSettings)}. Check the server URL.`,
    };
  }
};

const masked = (): JellyfinSettings =>
  maskSecrets(getSettings().jellyfin, SECRET_PATHS);

settingsRoutes.get('/jellyfin', (_req, res) => {
  res.status(200).json(masked());
});

const parseBody = (
  body: unknown
): { data?: Partial<JellyfinSettings>; error?: string } => {
  const parsed = connectionSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return {
      error:
        'Check the server fields: the port must be a number between 1 and 65535.',
    };
  }
  try {
    return { data: splitUrl(parsed.data) };
  } catch {
    return {
      error:
        "That server URL isn't valid. Use something like http://192.168.1.10:8096.",
    };
  }
};

settingsRoutes.post('/jellyfin', async (req, res, next) => {
  const { data, error } = parseBody(req.body);
  if (!data) {
    return next({ status: 400, message: error });
  }
  const settings = getSettings();
  const candidate = mergeWithSecrets(settings.jellyfin, data, SECRET_PATHS);

  if (candidate.enabled && !candidate.ip) {
    return next({
      status: 400,
      message: 'Enter the server URL before turning this on.',
    });
  }

  // Validate the connection whenever there is one to validate
  if (candidate.ip && candidate.apiKey) {
    const result = await probe(candidate);
    if (result.ok) {
      candidate.serverId = result.serverId ?? candidate.serverId;
      candidate.name = result.name ?? candidate.name;
    } else if (candidate.enabled) {
      return next({ status: 400, message: result.message });
    }
  } else if (candidate.enabled) {
    return next({
      status: 400,
      message:
        'Enter an API key before turning this on. You can make one under Dashboard → API keys in Jellyfin.',
    });
  }

  settings.jellyfin = candidate;
  await settings.save();

  return res.status(200).json(masked());
});

settingsRoutes.post('/jellyfin/test', async (req, res, next) => {
  const { data, error } = parseBody(req.body);
  if (!data) {
    return next({ status: 400, message: error });
  }
  const { ok, name, version, message } = await probe(
    mergeWithSecrets(getSettings().jellyfin, data, SECRET_PATHS)
  );

  return res
    .status(200)
    .json({ ok, name, version, message } satisfies ConnectionTestResponse);
});

const syncLibraries = async (): Promise<Library[]> => {
  const settings = getSettings();
  const client = await clientFor(settings.jellyfin);
  let libraries;

  try {
    libraries = await client.getLibraries();
  } catch (e) {
    throw Object.assign(
      new Error(
        "Couldn't load the libraries from the server. Check the connection and try again."
      ),
      { statusCode: e.statusCode ?? 502 }
    );
  }

  settings.jellyfin.libraries = libraries.map((library) => {
    const existing = settings.jellyfin.libraries.find(
      (l) => l.id === library.key
    );

    return {
      id: library.key,
      name: library.title,
      enabled: existing?.enabled ?? false,
      type: 'music' as const,
      lastScan: existing?.lastScan,
    };
  });
  await settings.save();

  return settings.jellyfin.libraries;
};

settingsRoutes.get('/jellyfin/library', async (req, res, next) => {
  if (req.query.sync) {
    try {
      await syncLibraries();
    } catch (e) {
      return next({ status: e.statusCode ?? 500, message: e.message });
    }
  }

  return res.status(200).json(getSettings().jellyfin.libraries);
});

settingsRoutes.put('/jellyfin/library/:libraryId', async (req, res, next) => {
  const settings = getSettings();
  const bodyResult = libraryUpdateSchema.safeParse(req.body);

  if (!bodyResult.success) {
    return next({
      status: 400,
      message: 'Send { enabled: true } or { enabled: false }.',
    });
  }

  const library = settings.jellyfin.libraries.find(
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

  return res.status(200).json(settings.jellyfin.libraries);
});

settingsRoutes.post('/jellyfin/library/sync', async (_req, res, next) => {
  try {
    return res.status(200).json(await syncLibraries());
  } catch (e) {
    return next({ status: e.statusCode ?? 500, message: e.message });
  }
});

settingsRoutes.get(
  '/jellyfin/users',
  isAuthenticated(Permission.MANAGE_USERS),
  async (_req, res, next) => {
    try {
      const client = await clientFor(getSettings().jellyfin);
      const resp = await client.getUsers();
      const existing = new Set(
        (
          await getRepository(User).find({
            select: { id: true, jellyfinUserId: true },
          })
        )
          .map((user) => user.jellyfinUserId)
          .filter(Boolean)
      );
      const users: ImportableUser[] = resp.users
        .filter((user) => !existing.has(user.Id))
        .map((user) => ({
          id: user.Id,
          username: user.Name,
          thumb: `/avatarproxy/${user.Id}`,
        }));

      return res.status(200).json(users);
    } catch (e) {
      logger.error('Something went wrong getting unimported Jellyfin users', {
        label: 'API',
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message:
          "Couldn't load the list of users from the server. Check the connection and try again.",
      });
    }
  }
);

addScanRoutes(
  settingsRoutes,
  '/jellyfin',
  jellyfinFullScanner,
  jellyfinRecentScanner
);

export default settingsRoutes;
