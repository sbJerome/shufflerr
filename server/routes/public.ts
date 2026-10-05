// Mounted at /api/v1/public (see docs/API_CONTRACT.md). No sign-in needed.
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import type { SlideshowResponse } from '@server/interfaces/api/mediaInterfaces';
import { coverUrlFor } from '@server/lib/metadata/index';
import { IN_LIBRARY_STATUSES } from '@server/lib/metadata/library';
import { Router } from 'express';
import { In } from 'typeorm';

const router = Router();

// GET /public/slideshow · public
//   in:  query `take` (70)
//   out: SlideshowResponse — recently added cover URLs only; empty on an empty library
router.get<never, SlideshowResponse>('/slideshow', async (req, res, next) => {
  const take = Math.min(210, Math.max(1, Number(req.query.take) || 70));
  try {
    const rows = await getRepository(Media).find({
      where: {
        mediaType: MediaType.RELEASE_GROUP,
        status: In(IN_LIBRARY_STATUSES),
      },
      order: { mediaAddedAt: 'DESC', id: 'DESC' },
      take,
      select: { id: true, mbid: true },
    });
    const covers: SlideshowResponse['covers'] = [];
    for (const row of rows) {
      const url = coverUrlFor(row.mbid, 250);
      if (url) {
        // Covers only: titles stay private on the sign-in page.
        covers.push({ url });
      }
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ covers });
  } catch (e) {
    return next({ status: 500, message: e.message });
  }
});

export default router;
