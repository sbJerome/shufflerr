// Navidrome (Subsonic API) as a library source. Paths are relative to /api/v1/settings.
import SubsonicAPI, { SubsonicError } from '@server/api/subsonic';
import type { ConnectionTestResponse } from '@server/interfaces/api/settingsInterfaces';
import { navidromeScanner } from '@server/lib/scanners/subsonic';
import type { NavidromeSettings } from '@server/lib/settings';
import {
  getSettings,
  maskSecrets,
  mergeWithSecrets,
} from '@server/lib/settings';
import { Router } from 'express';
import { z } from 'zod';
import { addScanRoutes } from './scanPanel';

const router = Router();

const SECRET_PATHS = ['password'];

const bodySchema = z
  .object({
    enabled: z.boolean(),
    url: z.string().trim(),
    username: z.string().trim(),
    password: z.string(),
  })
  .partial();

const masked = (): NavidromeSettings =>
  maskSecrets(getSettings().navidrome, SECRET_PATHS);

const validUrl = (url: string): boolean => {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

const probe = async (
  navidrome: NavidromeSettings
): Promise<ConnectionTestResponse> => {
  if (!navidrome.url || !validUrl(navidrome.url)) {
    return {
      ok: false,
      message: 'Enter the server URL, starting with http:// or https://.',
    };
  }
  if (!navidrome.username || !navidrome.password) {
    return { ok: false, message: 'Enter the Navidrome username and password.' };
  }
  try {
    const ping = await new SubsonicAPI(navidrome, 8000).ping();
    return {
      ok: true,
      name: ping.type ?? 'Subsonic server',
      version: ping.serverVersion ?? ping.version,
    };
  } catch (e) {
    if (e instanceof SubsonicError) {
      return {
        ok: false,
        message:
          e.code === 40
            ? "Navidrome didn't accept that username and password."
            : `Navidrome answered with an error: ${e.message}`,
      };
    }
    return {
      ok: false,
      message: `Couldn't reach Navidrome at ${navidrome.url}. Check the server URL.`,
    };
  }
};

router.get('/navidrome', (_req, res) => {
  res.status(200).json(masked());
});

router.post('/navidrome', async (req, res, next) => {
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return next({
      status: 400,
      message: 'Check the Navidrome fields and try again.',
    });
  }
  const settings = getSettings();
  const candidate = mergeWithSecrets(
    settings.navidrome,
    parsed.data,
    SECRET_PATHS
  );
  candidate.url = candidate.url.replace(/\/+$/, '');

  if (candidate.url && !validUrl(candidate.url)) {
    return next({
      status: 400,
      message: 'Enter the server URL, starting with http:// or https://.',
    });
  }
  if (candidate.enabled) {
    const result = await probe(candidate);
    if (!result.ok) {
      return next({ status: 400, message: result.message });
    }
  }

  settings.navidrome = candidate;
  await settings.save();

  return res.status(200).json(masked());
});

router.post('/navidrome/test', async (req, res, next) => {
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return next({
      status: 400,
      message: 'Check the Navidrome fields and try again.',
    });
  }

  return res
    .status(200)
    .json(
      await probe(
        mergeWithSecrets(getSettings().navidrome, parsed.data, SECRET_PATHS)
      )
    );
});

addScanRoutes(router, '/navidrome', navidromeScanner);

export default router;
