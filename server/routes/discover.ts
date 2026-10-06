// Mounted at /api/v1/discover (see docs/API_CONTRACT.md).
// Every row is real data: library index, request log, ListenBrainz, the Event cache.
import { getArtistImages } from '@server/api/fanart';
import { getItunesChart } from '@server/api/itunes';
import ListenBrainzAPI from '@server/api/listenbrainz';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Event from '@server/entity/Event';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import ScrobbleQueue from '@server/entity/ScrobbleQueue';
import Track from '@server/entity/Track';
import type { User } from '@server/entity/User';
import type {
  DiscoverAlbumsResponse,
  DiscoverArtistsResponse,
  DiscoverConcertsResponse,
  DiscoverFeaturedResponse,
  DiscoverRecentRequestsResponse,
  DiscoverStatsResponse,
} from '@server/interfaces/api/discoverInterfaces';
import cacheManager from '@server/lib/cache';
import downloadTracker from '@server/lib/downloadtracker';
import type { MatchedReleaseGroup } from '@server/lib/import/match';
import { matchAlbum, toAlbumResults } from '@server/lib/import/match';
import { firstPlayableTrackId } from '@server/lib/metadata/details';
import { coverUrlFor, isMbid } from '@server/lib/metadata/index';
import {
  IN_LIBRARY_STATUSES,
  albumsFromMedia,
  canSeeAllRequests,
  mergeAlbumLibrary,
  mergeArtistLibrary,
} from '@server/lib/metadata/library';
import { yearOf } from '@server/lib/metadata/mappers';
import { Permission } from '@server/lib/permissions';
import { toRequestResults } from '@server/lib/requestResults';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { AlbumResult, ArtistResult } from '@server/models/music';
import { libraryArtistsQuery } from '@server/routes/library';
import { Router } from 'express';
import { In, MoreThanOrEqual } from 'typeorm';

const router = Router();

const takeParam = (value: unknown, fallback: number, max = 50): number =>
  Math.min(max, Math.max(1, Number(value) || fallback));

const recentlyAddedMedia = (take: number): Promise<Media[]> =>
  getRepository(Media).find({
    where: {
      mediaType: MediaType.RELEASE_GROUP,
      status: In(IN_LIBRARY_STATUSES),
    },
    order: { mediaAddedAt: 'DESC', id: 'DESC' },
    take,
  });

/**
 * "Trending new releases": the release groups ListenBrainz users played most
 * this week, with the ones released in the last 60 days first. Real listening
 * data, merged with library status.
 */
const trendingAlbums = async (take: number): Promise<AlbumResult[]> => {
  const lb = new ListenBrainzAPI();
  const sitewide = await lb.getSitewideReleaseGroups('week', 100);
  const fresh = await lb
    .getFreshReleaseIndex(60)
    .then((index) => index.groups)
    .catch((e) => {
      logger.debug('ListenBrainz fresh releases unavailable', {
        label: 'Discover',
        errorMessage: e.message,
      });
      return {} as Record<
        string,
        { date?: string; primaryType?: string; secondaryType?: string }
      >;
    });

  const seen = new Set<string>();
  const recent: AlbumResult[] = [];
  const older: AlbumResult[] = [];
  for (const group of sitewide) {
    const mbid = group.release_group_mbid;
    if (!isMbid(mbid) || seen.has(mbid)) {
      continue;
    }
    seen.add(mbid);
    const info = fresh[mbid];
    const year = yearOf(info?.date);
    const album: AlbumResult = {
      mbid,
      title: group.release_group_name,
      artistMbid: group.artist_mbids?.[0] ?? '',
      artistName: group.artist_name,
      ...(info?.primaryType ? { primaryType: info.primaryType } : {}),
      secondaryTypes: info?.secondaryType ? [info.secondaryType] : [],
      ...(info?.date ? { firstReleaseDate: info.date } : {}),
      ...(year ? { year } : {}),
      coverUrl: coverUrlFor(mbid, 500),
      status: MediaStatus.UNKNOWN,
    };
    (info ? recent : older).push(album);
  }

  // New releases lead; long-running favourites only fill what is left.
  const albums = [...recent, ...older].slice(0, take * 2);
  await mergeAlbumLibrary(albums);
  const visible = getSettings().main.hideAvailable
    ? albums.filter((a) => a.status !== MediaStatus.AVAILABLE)
    : albums;
  return visible.slice(0, take);
};

// GET /discover/stats · signed in → DiscoverStatsResponse (real counts from the library index)
router.get<never, DiscoverStatsResponse>('/stats', async (_req, res, next) => {
  try {
    const mediaRepository = getRepository(Media);
    const [albums, artistRow, tracks] = await Promise.all([
      mediaRepository.count({
        where: {
          mediaType: MediaType.RELEASE_GROUP,
          status: In(IN_LIBRARY_STATUSES),
        },
      }),
      mediaRepository
        .createQueryBuilder('media')
        .select('COUNT(DISTINCT media.artistMbid)', 'count')
        .where('media.mediaType = :type', { type: MediaType.RELEASE_GROUP })
        .andWhere('media.status IN (:...statuses)', {
          statuses: IN_LIBRARY_STATUSES,
        })
        .getRawOne<{ count: string | number }>(),
      getRepository(Track).count({ where: { status: MediaStatus.AVAILABLE } }),
    ]);
    // Only what Lidarr's queue really holds right now; an approved request
    // that Lidarr has not started is not "downloading".
    return res.status(200).json({
      albums,
      artists: Number(artistRow?.count ?? 0),
      tracks,
      downloading: downloadTracker.getDownloadingCount(),
    });
  } catch (e) {
    return next({ status: 500, message: e.message });
  }
});

// GET /discover/featured · signed in → DiscoverFeaturedResponse
//   Most recently added album that still has gaps → most recently added → top trending → null.
router.get<never, DiscoverFeaturedResponse>(
  '/featured',
  async (req, res, next) => {
    try {
      const canSeeRecent = req.user?.hasPermission(Permission.RECENT_VIEW);
      let album: DiscoverFeaturedResponse['album'] = null;

      if (canSeeRecent) {
        const recent = await recentlyAddedMedia(12);
        const pick =
          recent.find((m) => m.status === MediaStatus.PARTIALLY_AVAILABLE) ??
          recent[0];
        if (pick) {
          const [withRequest] = await albumsFromMedia([pick]);
          const images = pick.artistMbid
            ? await getArtistImages(pick.artistMbid)
            : null;
          const firstTrack = await firstPlayableTrackId(pick.id);
          album = {
            ...withRequest,
            artistImageUrl: images?.background ?? images?.thumb ?? null,
            source: 'recently-added',
            ...(firstTrack !== undefined
              ? { firstPlayableTrackId: firstTrack }
              : {}),
          };
        }
      }

      if (!album && getSettings().discover.listenbrainzTrending.enabled) {
        try {
          const [top] = await trendingAlbums(1);
          if (top) {
            const images = top.artistMbid
              ? await getArtistImages(top.artistMbid)
              : null;
            album = {
              ...top,
              artistImageUrl: images?.background ?? images?.thumb ?? null,
              source: 'trending',
            };
          }
        } catch (e) {
          logger.debug('No trending release to feature', {
            label: 'Discover',
            errorMessage: e.message,
          });
        }
      }

      return res.status(200).json({ album });
    } catch (e) {
      return next({ status: 500, message: e.message });
    }
  }
);

// GET /discover/recently-added · signed in (RECENT_VIEW; otherwise `enabled:false`)
router.get<never, DiscoverAlbumsResponse>(
  '/recently-added',
  async (req, res, next) => {
    if (!req.user?.hasPermission(Permission.RECENT_VIEW)) {
      return res.status(200).json({
        enabled: false,
        reason: 'Your account cannot see recently added music.',
        results: [],
      });
    }
    try {
      const rows = await recentlyAddedMedia(takeParam(req.query.take, 20));
      return res
        .status(200)
        .json({ enabled: true, results: await albumsFromMedia(rows) });
    } catch (e) {
      return next({ status: 500, message: e.message });
    }
  }
);

/**
 * iTunes most-played chart matched to MusicBrainz, for when ListenBrainz
 * trending is off. Matching costs MusicBrainz calls (1 req/s), so it runs in
 * the background, is remembered for 6 hours, and a request waits for it only
 * briefly: the row fills in as matches arrive (matchAlbum persists each one).
 */
const ITUNES_TRENDING_TTL = 6 * 60 * 60;
let itunesTrendingBuild: Promise<AlbumResult[]> | undefined;

const buildItunesTrending = async (): Promise<AlbumResult[]> => {
  const chart = await getItunesChart(30);
  const groups: MatchedReleaseGroup[] = [];
  const seen = new Set<string>();
  for (const entry of chart) {
    try {
      const outcome = await matchAlbum({
        key: `itunes:${entry.id}`,
        sourceId: entry.id,
        title: entry.title,
        artist: entry.artistName,
      });
      if (outcome.releaseGroup && !seen.has(outcome.releaseGroup.mbid)) {
        seen.add(outcome.releaseGroup.mbid);
        groups.push(outcome.releaseGroup);
      }
    } catch (e) {
      logger.debug('Could not match an iTunes chart album', {
        label: 'Discover',
        errorMessage: e.message,
      });
    }
  }
  const byMbid = await toAlbumResults(groups);
  return groups
    .map((g) => byMbid.get(g.mbid))
    .filter((a): a is AlbumResult => !!a)
    .map((a) => ({ ...a, coverUrl: a.coverUrl ?? coverUrlFor(a.mbid, 500) }));
};

const itunesTrendingAlbums = async (
  take: number
): Promise<{ results: AlbumResult[]; building: boolean }> => {
  const cache = cacheManager.getCache('itunes').data;
  const cacheKey = `trending:${getSettings().discover.itunes.country}`;
  let albums = cache.get<AlbumResult[]>(cacheKey);
  let building = false;

  if (!albums) {
    itunesTrendingBuild ??= buildItunesTrending()
      .then((built) => {
        cache.set(cacheKey, built, ITUNES_TRENDING_TTL);
        return built;
      })
      .finally(() => {
        itunesTrendingBuild = undefined;
      });
    const pending = itunesTrendingBuild;
    pending.catch(() => undefined);
    albums = await Promise.race([
      pending,
      new Promise<undefined>((resolve) => {
        setTimeout(() => resolve(undefined), 8000).unref();
      }),
    ]);
    building = !albums;
  }

  const results = [...(albums ?? [])];
  await mergeAlbumLibrary(results);
  const visible = getSettings().main.hideAvailable
    ? results.filter((a) => a.status !== MediaStatus.AVAILABLE)
    : results;
  return { results: visible.slice(0, take), building };
};

// GET /discover/trending · signed in → ListenBrainz most-played new releases;
//   falls back to the iTunes chart when ListenBrainz trending is off and
//   iTunes is on; `enabled:false` when both are off.
router.get<never, DiscoverAlbumsResponse>('/trending', async (req, res) => {
  const { listenbrainzTrending, itunes } = getSettings().discover;
  const take = takeParam(req.query.take, 20);

  if (!listenbrainzTrending.enabled && itunes.enabled) {
    try {
      const { results, building } = await itunesTrendingAlbums(take);
      return res.status(200).json({
        enabled: true,
        ...(building
          ? {
              reason:
                'Matching the iTunes chart to MusicBrainz. The row fills in within a minute.',
            }
          : {}),
        results,
      });
    } catch (e) {
      logger.warn('Could not load the iTunes chart', {
        label: 'Discover',
        errorMessage: e.message,
      });
      return res.status(200).json({
        enabled: true,
        reason:
          'The iTunes chart could not be reached. The row fills in when it responds again.',
        results: [],
      });
    }
  }
  if (!listenbrainzTrending.enabled) {
    return res.status(200).json({
      enabled: false,
      reason:
        'ListenBrainz trending is off. Turn it on in Settings to see new releases here.',
      results: [],
    });
  }
  try {
    return res.status(200).json({
      enabled: true,
      results: await trendingAlbums(take),
    });
  } catch (e) {
    logger.warn('Could not load trending releases from ListenBrainz', {
      label: 'Discover',
      errorMessage: e.message,
    });
    return res.status(200).json({
      enabled: true,
      reason:
        'ListenBrainz could not be reached. The row fills in when it responds again.',
      results: [],
    });
  }
});

/** Library artists ranked by plays (90 days), requests and albums held. */
const popularLibraryArtists = async (take: number): Promise<ArtistResult[]> => {
  const artists = await libraryArtistsQuery().getRawMany<{
    mbid: string;
    name: string | null;
    albums: string | number;
  }>();
  if (artists.length === 0) {
    return [];
  }

  const [requestRows, playRows] = await Promise.all([
    getRepository(MediaRequest)
      .createQueryBuilder('request')
      .innerJoin('request.media', 'media')
      .select('media.artistMbid', 'mbid')
      .addSelect('COUNT(*)', 'count')
      .where('media.artistMbid IS NOT NULL')
      .groupBy('media.artistMbid')
      .getRawMany<{ mbid: string; count: string | number }>(),
    getRepository(ScrobbleQueue)
      .createQueryBuilder('play')
      .select('LOWER(play.artist)', 'artist')
      .addSelect('COUNT(*)', 'count')
      .where('play.playedAt >= :since', {
        since: new Date(Date.now() - 90 * 86400 * 1000),
      })
      .groupBy('LOWER(play.artist)')
      .getRawMany<{ artist: string; count: string | number }>(),
  ]);
  const requests = new Map(requestRows.map((r) => [r.mbid, Number(r.count)]));
  const plays = new Map(playRows.map((r) => [r.artist, Number(r.count)]));

  const ranked = artists
    .map((a) => {
      const name = a.name ?? '';
      // track credits may list several artists: count plays that start with this one
      let played = plays.get(name.toLowerCase()) ?? 0;
      if (name) {
        for (const [credit, count] of plays) {
          if (
            credit !== name.toLowerCase() &&
            credit.startsWith(`${name.toLowerCase()},`)
          ) {
            played += count;
          }
        }
      }
      return {
        mbid: a.mbid,
        name,
        albums: Number(a.albums),
        score: played * 3 + (requests.get(a.mbid) ?? 0) * 2 + Number(a.albums),
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, take);

  return Promise.all(
    ranked.map(async (a) => ({
      mbid: a.mbid,
      name: a.name,
      imageUrl: (await getArtistImages(a.mbid, a.name)).thumb,
      status: MediaStatus.AVAILABLE,
      albumsInLibrary: a.albums,
    }))
  );
};

// GET /discover/popular-artists · signed in
//   Library artists ranked by plays/requests; ListenBrainz sitewide when on.
router.get<never, DiscoverArtistsResponse>(
  '/popular-artists',
  async (req, res, next) => {
    const take = takeParam(req.query.take, 20);
    try {
      if (getSettings().discover.listenbrainzTrending.enabled) {
        try {
          const sitewide = await new ListenBrainzAPI().getSitewideArtists(
            'week',
            Math.min(100, take * 2)
          );
          const results: ArtistResult[] = sitewide
            .filter((a) => isMbid(a.artist_mbid))
            .slice(0, take)
            .map((a) => ({
              mbid: a.artist_mbid as string,
              name: a.artist_name,
              imageUrl: null,
              status: MediaStatus.UNKNOWN,
            }));
          if (results.length > 0) {
            return res.status(200).json({
              enabled: true,
              results: await mergeArtistLibrary(results),
            });
          }
        } catch (e) {
          logger.debug(
            'ListenBrainz sitewide artists failed, using the library',
            {
              label: 'Discover',
              errorMessage: e.message,
            }
          );
        }
      }
      return res
        .status(200)
        .json({ enabled: true, results: await popularLibraryArtists(take) });
    } catch (e) {
      return next({ status: 500, message: e.message });
    }
  }
);

// GET /discover/recent-requests · signed in → own requests unless REQUEST_VIEW / MANAGE_REQUESTS
router.get<never, DiscoverRecentRequestsResponse>(
  '/recent-requests',
  async (req, res, next) => {
    const user = req.user as User;
    const ownOnly = !canSeeAllRequests(user);
    try {
      const requests = await getRepository(MediaRequest).find({
        where: ownOnly ? { requestedBy: { id: user.id } } : {},
        order: { id: 'DESC' },
        take: takeParam(req.query.take, 10),
      });
      return res.status(200).json({
        enabled: true,
        ownOnly,
        results: (await toRequestResults(requests, user)).results,
      });
    } catch (e) {
      return next({ status: 500, message: e.message });
    }
  }
);

// GET /discover/concerts · signed in → the Event cache, filtered by the viewer's region
router.get<never, DiscoverConcertsResponse>(
  '/concerts',
  async (req, res, next) => {
    const settings = getSettings();
    const { ticketmaster, skiddle } = settings.discover;
    const providers: ('ticketmaster' | 'skiddle')[] = [];
    if (ticketmaster.enabled && ticketmaster.apiKey) {
      providers.push('ticketmaster');
    }
    if (skiddle.enabled && skiddle.apiKey) {
      providers.push('skiddle');
    }
    if (providers.length === 0) {
      return res.status(200).json({
        enabled: false,
        reason:
          'No concert source is on. Add Ticketmaster or Skiddle in Settings.',
        results: [],
        attribution: [],
      });
    }

    const region = (
      req.user?.settings?.discoverRegion ||
      settings.main.discoverRegion ||
      ''
    ).toUpperCase();

    try {
      const events = await getRepository(Event).find({
        where: {
          provider: In(providers),
          startsAt: MoreThanOrEqual(new Date()),
          ...(region ? { country: region } : {}),
        },
        order: { startsAt: 'ASC' },
        take: takeParam(req.query.take, 20),
      });
      return res.status(200).json({
        enabled: true,
        results: events.map((e) => ({
          id: e.id,
          provider: e.provider,
          artistMbid: e.artistMbid ?? null,
          artistName: e.artistName,
          name: e.name ?? null,
          venue: e.venue ?? null,
          city: e.city ?? null,
          country: e.country ?? null,
          startsAt: new Date(e.startsAt).toISOString(),
          url: e.url,
          imageUrl: e.imageUrl ?? null,
        })),
        attribution: [...new Set(events.map((e) => e.provider))],
      });
    } catch (e) {
      return next({ status: 500, message: e.message });
    }
  }
);

export default router;
