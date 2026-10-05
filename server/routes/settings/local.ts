// Local files as a library source. Paths are relative to /api/v1/settings.
import type { LocalFolderCheckResponse } from '@server/interfaces/api/settingsInterfaces';
import { detachSource } from '@server/lib/library/availability';
import { withLibraryLock } from '@server/lib/library/ingest';
import {
  localFilesScanner,
  syncLocalFilesWatcher,
} from '@server/lib/scanners/local';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { addScanRoutes } from './scanPanel';

const router = Router();

const sectionSchema = z
  .object({
    enabled: z.boolean(),
    watch: z.boolean(),
    rescanMinutes: z.coerce.number().int().min(15).max(10080),
  })
  .partial();

const folderSchema = z.object({ path: z.string().trim().min(1) });

/** Why a folder can't be used, or null when it is fine. */
export const checkFolder = async (folder: string): Promise<string | null> => {
  if (!folder.startsWith('/')) {
    return 'Enter the full path, starting with /.';
  }
  let stat;
  try {
    stat = await fs.promises.stat(folder);
  } catch {
    return `${folder} doesn't exist inside Shufflerr's container. Mount the folder first, then add its path here.`;
  }
  if (!stat.isDirectory()) {
    return `${folder} is a file, not a folder.`;
  }
  try {
    await fs.promises.access(folder, fs.constants.R_OK | fs.constants.X_OK);
    await fs.promises.readdir(folder);
  } catch {
    return `Shufflerr isn't allowed to read ${folder}. Check the folder's permissions.`;
  }
  return null;
};

const afterChange = async (): Promise<void> => {
  await syncLocalFilesWatcher();
  if (getSettings().integrations.localFiles) {
    void localFilesScanner.run({ force: true });
  }
};

router.get('/local', (_req, res) => {
  res.status(200).json(getSettings().localFiles);
});

router.post('/local', async (req, res, next) => {
  const parsed = sectionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return next({
      status: 400,
      message: 'The rescan interval must be between 15 minutes and 7 days.',
    });
  }
  const settings = getSettings();
  const wasEnabled = settings.localFiles.enabled;

  Object.assign(settings.localFiles, parsed.data);
  await settings.save();
  await syncLocalFilesWatcher();

  if (!wasEnabled && settings.integrations.localFiles) {
    void localFilesScanner.run({ force: true });
  }

  return res.status(200).json(settings.localFiles);
});

router.post('/local/folders', async (req, res, next) => {
  const parsed = folderSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return next({
      status: 400,
      message: 'Enter the full path, starting with /.',
    });
  }
  const settings = getSettings();
  const folder =
    parsed.data.path.length > 1
      ? path.normalize(parsed.data.path).replace(/\/+$/, '')
      : parsed.data.path;
  const problem = await checkFolder(folder);

  if (problem) {
    return next({ status: 400, message: problem });
  }
  if (settings.localFiles.folders.includes(folder)) {
    return next({ status: 400, message: `${folder} is already in the list.` });
  }

  settings.localFiles.folders = [...settings.localFiles.folders, folder];
  await settings.save();
  await afterChange();

  return res
    .status(200)
    .json({ ok: true, path: folder } satisfies LocalFolderCheckResponse);
});

router.delete('/local/folders', async (req, res, next) => {
  // DELETE bodies get dropped by some proxies, so ?path= works too
  const parsed = folderSchema.safeParse(
    req.body?.path ? req.body : { path: req.query.path }
  );
  if (!parsed.success) {
    return next({ status: 400, message: 'Say which folder to remove.' });
  }
  const settings = getSettings();
  const folder = parsed.data.path;

  if (!settings.localFiles.folders.includes(folder)) {
    return next({ status: 404, message: `${folder} isn't in the list.` });
  }

  settings.localFiles.folders = settings.localFiles.folders.filter(
    (f) => f !== folder
  );
  await settings.save();
  await syncLocalFilesWatcher();

  // Files under the removed folder leave the library index right away
  const remaining = settings.localFiles.folders.map((f) => path.resolve(f));
  withLibraryLock(() =>
    detachSource('local', (filePath) => {
      const resolved = path.resolve(filePath);
      return remaining.some(
        (root) => resolved === root || resolved.startsWith(`${root}${path.sep}`)
      );
    })
  )
    .then(() => localFilesScanner.refreshCounts())
    .catch((e) =>
      logger.error('Could not remove a folder from the library index', {
        label: 'Local Files Scan',
        errorMessage: e.message,
      })
    );

  return res.status(200).json(settings.localFiles);
});

addScanRoutes(router, '/local', localFilesScanner);

export default router;
