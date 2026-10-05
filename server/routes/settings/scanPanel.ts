// "Library scan" panel routes shared by Plex, Jellyfin, Navidrome and local files.
import type {
  ScanCommandBody,
  ScanStatus,
} from '@server/interfaces/api/settingsInterfaces';
import type { SourceScanner } from '@server/lib/library/sourceScanner';
import {
  combinedStatus,
  combinedStatusReady,
} from '@server/lib/library/sourceScanner';
import type { Router } from 'express';
import { z } from 'zod';

const commandSchema = z.object({
  start: z.boolean().optional(),
  cancel: z.boolean().optional(),
  mode: z.enum(['full', 'recent']).optional(),
});

/**
 * GET  <path>/sync → ScanStatus
 * POST <path>/sync → ScanCommandBody → ScanStatus
 */
export const addScanRoutes = (
  router: Router,
  path: string,
  full: SourceScanner,
  recent?: SourceScanner
): void => {
  router.get(`${path}/sync`, async (_req, res) => {
    // counts are read from the database the first time (they do not survive
    // a restart in memory), so the panel never shows "0 albums, 0 tracks"
    const status: ScanStatus = await combinedStatusReady(full, recent);
    res.status(200).json(status);
  });

  router.post(`${path}/sync`, (req, res, next) => {
    const parsed = commandSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return next({
        status: 400,
        message: 'Send { start: true } or { cancel: true }.',
      });
    }
    const body: ScanCommandBody = parsed.data;

    if (body.cancel) {
      full.cancel();
      recent?.cancel();
    } else if (body.start) {
      const scanner = body.mode === 'recent' && recent ? recent : full;
      // runs in the background; the panel polls GET <path>/sync
      void scanner.run({ force: true });
    }

    return res.status(200).json(combinedStatus(full, recent));
  });
};
