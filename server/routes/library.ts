// Mounted at /api/v1/library (see docs/API_CONTRACT.md).
import { getArtistImages } from '@server/api/fanart';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import type {
  LibraryAlbumsResponse,
  LibraryArtistsResponse,
} from '@server/interfaces/api/mediaInterfaces';
import {
  IN_LIBRARY_STATUSES,
  albumsFromMedia,
} from '@server/lib/metadata/library';
import type { ArtistResult } from '@server/models/music';
import { Router } from 'express';

const router = Router();

const paging = (query: Record<string, unknown>, fallbackSize = 48) => {
  const pageSize = Math.min(
    200,
    Math.max(1, Number(query.pageSize) || fallbackSize)
  );
  const page = Math.max(1, Number(query.page) || 1);
  return { page, pageSize, skip: (page - 1) * pageSize };
};

const like = (q: string): string =>
  `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Artists that have at least one release group (partly) in the library.
 * The name is the artist row's own title (the artist's MusicBrainz name); an
 * album's credit phrase ("A, B & C") is only the fallback when no artist row
 * exists yet.
 */
export const libraryArtistsQuery = (q?: string) => {
  const qb = getRepository(Media)
    .createQueryBuilder('media')
    .leftJoin(
      Media,
      'artist',
      'artist.mbid = media.artistMbid AND artist.mediaType = :artistType',
      { artistType: MediaType.ARTIST }
    )
    .select('media.artistMbid', 'mbid')
    .addSelect(`COALESCE(MAX(artist.title), MAX(media.artistName))`, 'name')
    .addSelect('COUNT(*)', 'albums')
    .addSelect('MAX(media.mediaAddedAt)', 'added')
    .where('media.mediaType = :type', { type: MediaType.RELEASE_GROUP })
    .andWhere('media.status IN (:...statuses)', {
      statuses: IN_LIBRARY_STATUSES,
    })
    .andWhere('media.artistMbid IS NOT NULL')
    .andWhere("media.artistMbid != ''")
    .groupBy('media.artistMbid');
  if (q) {
    qb.andWhere(
      "(LOWER(artist.title) LIKE :q ESCAPE '\\' OR LOWER(media.artistName) LIKE :q ESCAPE '\\')",
      { q: like(q) }
    );
  }
  return qb;
};

// GET /library/artists · signed in
//   in:  query `page`, `pageSize` (48), `sort`=name|added|albums, `q`
//   out: LibraryArtistsResponse
router.get<never, LibraryArtistsResponse>(
  '/artists',
  async (req, res, next) => {
    const { page, pageSize, skip } = paging(req.query);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const sort = String(req.query.sort ?? 'name');

    try {
      const qb = libraryArtistsQuery(q);
      switch (sort) {
        case 'added':
          qb.orderBy('added', 'DESC');
          break;
        case 'albums':
          qb.orderBy('albums', 'DESC');
          break;
        default:
          qb.orderBy(
            'LOWER(COALESCE(MAX(artist.title), MAX(media.artistName)))',
            'ASC'
          );
      }
      qb.addOrderBy('media.artistMbid', 'ASC');

      const all = await qb.getRawMany<{
        mbid: string;
        name: string | null;
        albums: string | number;
      }>();
      const total = all.length;
      const pageRows = all.slice(skip, skip + pageSize);

      const results: ArtistResult[] = await Promise.all(
        pageRows.map(async (row) => ({
          mbid: row.mbid,
          name: row.name ?? '',
          imageUrl: (await getArtistImages(row.mbid)).thumb,
          status: MediaStatus.AVAILABLE,
          albumsInLibrary: Number(row.albums),
        }))
      );

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(total / pageSize),
          page,
          results: total,
          pageSize,
        },
        results,
      });
    } catch (e) {
      return next({ status: 500, message: e.message });
    }
  }
);

// GET /library/albums · signed in
//   in:  query `page`, `pageSize` (48), `sort`=added|title|artist|year,
//        `filter`=all|available|partial|processing, `q`, `artistMbid`
//   out: LibraryAlbumsResponse
router.get<never, LibraryAlbumsResponse>('/albums', async (req, res, next) => {
  const { page, pageSize, skip } = paging(req.query);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const artistMbid =
    typeof req.query.artistMbid === 'string' ? req.query.artistMbid : '';
  const sort = String(req.query.sort ?? 'added');
  const filter = String(req.query.filter ?? 'all');

  try {
    const qb = getRepository(Media)
      .createQueryBuilder('media')
      .where('media.mediaType = :type', { type: MediaType.RELEASE_GROUP });

    switch (filter) {
      case 'available':
        qb.andWhere('media.status = :status', {
          status: MediaStatus.AVAILABLE,
        });
        break;
      case 'partial':
        qb.andWhere('media.status = :status', {
          status: MediaStatus.PARTIALLY_AVAILABLE,
        });
        break;
      case 'processing':
        qb.andWhere('media.status = :status', {
          status: MediaStatus.PROCESSING,
        });
        break;
      default:
        // "all" = everything the library holds or is fetching
        qb.andWhere('media.status IN (:...statuses)', {
          statuses: [...IN_LIBRARY_STATUSES, MediaStatus.PROCESSING],
        });
    }
    if (artistMbid) {
      qb.andWhere('media.artistMbid = :artistMbid', { artistMbid });
    }
    if (q) {
      qb.andWhere(
        "(LOWER(media.title) LIKE :q ESCAPE '\\' OR LOWER(media.artistName) LIKE :q ESCAPE '\\')",
        { q: like(q) }
      );
    }

    switch (sort) {
      case 'title':
        qb.orderBy('LOWER(media.title)', 'ASC');
        break;
      case 'artist':
        qb.orderBy('LOWER(media.artistName)', 'ASC').addOrderBy(
          'media.firstReleaseDate',
          'ASC'
        );
        break;
      case 'year':
        qb.orderBy('media.firstReleaseDate', 'DESC');
        break;
      default:
        qb.orderBy('media.mediaAddedAt', 'DESC');
    }
    qb.addOrderBy('media.id', 'DESC');

    const [rows, total] = await qb.take(pageSize).skip(skip).getManyAndCount();

    return res.status(200).json({
      pageInfo: {
        pages: Math.ceil(total / pageSize),
        page,
        results: total,
        pageSize,
      },
      results: await albumsFromMedia(rows),
    });
  } catch (e) {
    return next({ status: 500, message: e.message });
  }
});

export default router;
