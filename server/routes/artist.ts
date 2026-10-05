// Mounted at /api/v1/artist (see docs/API_CONTRACT.md).
import { getArtistDetails } from '@server/lib/metadata/details';
import { metadataError } from '@server/lib/metadata/errors';
import { InvalidMbidError, isMbid } from '@server/lib/metadata/index';
import type { ArtistDetails } from '@server/models/music';
import { Router } from 'express';

const router = Router();

// GET /artist/:mbid · signed in → ArtistDetails
router.get<{ mbid: string }, ArtistDetails>('/:mbid', async (req, res, next) => {
  try {
    if (!isMbid(req.params.mbid)) {
      throw new InvalidMbidError('That is not a MusicBrainz ID.');
    }
    return res.status(200).json(await getArtistDetails(req.params.mbid, req.user));
  } catch (e) {
    return metadataError(e, next, 'artist');
  }
});

export default router;
