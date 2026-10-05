// Mounted at /api/v1/recording (see docs/API_CONTRACT.md).
import { getRecordingDetails } from '@server/lib/metadata/details';
import { metadataError } from '@server/lib/metadata/errors';
import { InvalidMbidError, isMbid } from '@server/lib/metadata/index';
import type { TrackResult } from '@server/models/music';
import { Router } from 'express';

const router = Router();

// GET /recording/:mbid · signed in → TrackResult
router.get<{ mbid: string }, TrackResult>('/:mbid', async (req, res, next) => {
  try {
    if (!isMbid(req.params.mbid)) {
      throw new InvalidMbidError('That is not a MusicBrainz ID.');
    }
    return res.status(200).json(await getRecordingDetails(req.params.mbid));
  } catch (e) {
    return metadataError(e, next, 'track');
  }
});

export default router;
