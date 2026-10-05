// Mounted at /api/v1/album (see docs/API_CONTRACT.md).
import { getAlbumDetails } from '@server/lib/metadata/details';
import { metadataError } from '@server/lib/metadata/errors';
import type { AlbumDetails } from '@server/models/music';
import { Router } from 'express';

const router = Router();

// GET /album/:mbid · signed in → AlbumDetails
//   Release-group MBID. Syncs the canonical tracklist into Track rows so every track has an `id`.
router.get<{ mbid: string }, AlbumDetails>('/:mbid', async (req, res, next) => {
  try {
    return res
      .status(200)
      .json(await getAlbumDetails(req.params.mbid, req.user));
  } catch (e) {
    return metadataError(e, next, 'album');
  }
});

export default router;
