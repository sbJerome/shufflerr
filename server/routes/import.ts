import {
  getImportJob,
  getImportSources,
  getSpotifySaved,
  ImportLinkError,
  listImportJobs,
  requestImport,
  resolveImport,
} from '@server/lib/import';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

// Mounted at /api/v1/import (signed in). See docs/API_CONTRACT.md §SV6.
const router = Router();

const MAX_MBIDS = 200;
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/sources', async (req, res, next) => {
  try {
    if (!req.user) {
      return next({ status: 403, message: 'Sign in to import music.' });
    }
    return res.status(200).json(await getImportSources(req.user));
  } catch (e) {
    return next({ status: 500, message: e.message });
  }
});

router.post('/resolve', async (req, res, next) => {
  if (!req.user) {
    return next({ status: 403, message: 'Sign in to import music.' });
  }
  if (
    !req.user.hasPermission([Permission.REQUEST, Permission.REQUEST_ALBUM], {
      type: 'or',
    })
  ) {
    return next({
      status: 403,
      message: "You don't have permission to request albums.",
    });
  }
  const { spotify, deezer, itunes } = getSettings().integrations;
  if (!spotify && !deezer && !itunes) {
    return next({
      status: 400,
      message:
        'Importing is switched off. An admin can turn on Spotify, Deezer or iTunes in Settings.',
    });
  }
  const url = typeof req.body?.url === 'string' ? req.body.url : '';
  try {
    return res.status(200).json(await resolveImport(url, req.user));
  } catch (e) {
    if (e instanceof ImportLinkError) {
      return next({ status: 400, message: e.message });
    }
    logger.error('Could not read an import link', {
      label: 'Import',
      errorMessage: e.message,
    });
    return next({
      status: 502,
      message:
        "The music service behind that link didn't answer. Try again in a minute.",
    });
  }
});

router.post('/request', async (req, res, next) => {
  if (!req.user) {
    return next({ status: 403, message: 'Sign in to import music.' });
  }
  const mbids: unknown = req.body?.mbids;
  if (
    !Array.isArray(mbids) ||
    mbids.length === 0 ||
    !mbids.every((m) => typeof m === 'string' && MBID.test(m))
  ) {
    return next({
      status: 400,
      message: 'Check at least one album to request.',
    });
  }
  if (mbids.length > MAX_MBIDS) {
    return next({
      status: 400,
      message: `Request up to ${MAX_MBIDS} albums at a time.`,
    });
  }
  try {
    const jobId = Number(req.body?.jobId);
    return res.status(200).json(
      await requestImport(req.user, {
        jobId: Number.isInteger(jobId) && jobId > 0 ? jobId : undefined,
        mbids: mbids as string[],
      })
    );
  } catch (e) {
    logger.error('Import request failed', {
      label: 'Import',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'The albums could not be requested. Try again.',
    });
  }
});

router.get('/spotify/saved', async (req, res, next) => {
  if (!req.user) {
    return next({ status: 403, message: 'Sign in to import music.' });
  }
  try {
    return res.status(200).json(await getSpotifySaved(req.user));
  } catch (e) {
    logger.warn('Could not load Spotify saved albums', {
      label: 'Import',
      userId: req.user.id,
      errorMessage: e.message,
    });
    const revoked = [400, 401].includes(e.response?.status);
    return next({
      status: 502,
      message: revoked
        ? 'Spotify no longer accepts your link. Unlink Spotify in your profile settings and link it again.'
        : "Spotify didn't answer. Try again in a minute.",
    });
  }
});

router.get('/jobs', async (req, res, next) => {
  if (!req.user) {
    return next({ status: 403, message: 'Sign in to import music.' });
  }
  try {
    return res.status(200).json(await listImportJobs(req.user));
  } catch (e) {
    return next({ status: 500, message: e.message });
  }
});

router.get('/jobs/:id', async (req, res, next) => {
  if (!req.user) {
    return next({ status: 403, message: 'Sign in to import music.' });
  }
  try {
    const job = await getImportJob(Number(req.params.id), req.user);
    if (!job) {
      return next({ status: 404, message: 'That import no longer exists.' });
    }
    return res.status(200).json(job);
  } catch (e) {
    return next({ status: 500, message: e.message });
  }
});

export default router;
