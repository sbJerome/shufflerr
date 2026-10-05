// Mounted at /api/v1/genre.
import { getMusicBrainz } from '@server/api/musicbrainz';
import type { GenreResponse } from '@server/interfaces/api/discoverInterfaces';
import { metadataError } from '@server/lib/metadata/errors';
import {
  mergeAlbumLibrary,
  mergeArtistLibrary,
} from '@server/lib/metadata/library';
import { mapArtist, mapReleaseGroup } from '@server/lib/metadata/mappers';
import { Router } from 'express';

const router = Router();

/** MusicBrainz's special-purpose "Various Artists" entry is not an artist to browse. */
const VARIOUS_ARTISTS = '89ad4ac3-39f7-470e-963a-56509c546377';

/** A genre is a MusicBrainz tag: keep it to a plain phrase before quoting it. */
const cleanGenre = (raw: string): string =>
  raw
    .replace(/["\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 80);

// GET /genre/:name · signed in
//   in:  query `page` (1), `pageSize` (24, max 50)
//   out: GenreResponse — albums and EPs tagged with the genre (paged), plus
//        tagged artists on the first page
router.get<{ name: string }, GenreResponse>(
  '/:name',
  async (req, res, next) => {
    const genre = cleanGenre(req.params.name);
    if (!genre) {
      return next({ status: 400, message: 'Pick a genre to browse.' });
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(
      50,
      Math.max(1, Number(req.query.pageSize) || 24)
    );
    const tag = `tag:"${genre}"`;

    try {
      const mb = getMusicBrainz();
      const [albumSearch, artistSearch] = await Promise.all([
        mb.searchReleaseGroupsRaw(
          `${tag} AND (primarytype:album OR primarytype:ep)`,
          { limit: pageSize, offset: (page - 1) * pageSize }
        ),
        page === 1 ? mb.searchArtistsRaw(tag, { limit: 20 }) : null,
      ]);

      const albums = await mergeAlbumLibrary(
        (albumSearch['release-groups'] ?? []).map(mapReleaseGroup)
      );
      const artists = artistSearch
        ? await mergeArtistLibrary(
            (artistSearch.artists ?? [])
              .filter((artist) => artist.id !== VARIOUS_ARTISTS)
              .map(mapArtist)
          )
        : [];

      return res.status(200).json({
        genre,
        page,
        pageSize,
        albums: { total: albumSearch.count ?? albums.length, results: albums },
        artists: { total: artistSearch?.count ?? 0, results: artists },
      });
    } catch (e) {
      return metadataError(e, next, 'search');
    }
  }
);

export default router;
