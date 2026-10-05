// STREAM(SV1): implement. Mounted at /api/v1/library (see docs/API_CONTRACT.md).
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const router = Router();

// GET /library/artists · signed in
//   in:  query `page`, `pageSize` (48), `sort`=name|added|albums, `q`
//   out: LibraryArtistsResponse
//   Rail → Artists
router.get('/artists', notImplemented('SV1'));

// GET /library/albums · signed in
//   in:  query `page`, `pageSize` (48), `sort`=added|title|artist|year, `filter`=all|available|partial|processing, `q`, `artistMbid`
//   out: LibraryAlbumsResponse
//   Rail → Albums
router.get('/albums', notImplemented('SV1'));

export default router;
