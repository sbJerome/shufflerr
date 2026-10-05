// Unified MusicBrainz search (artists, release groups, recordings) with
// library status merged from Media/Track.
import { getMusicBrainz } from '@server/api/musicbrainz';
import type { User } from '@server/entity/User';
import {
  canSeeAllRequests,
  mergeAlbumLibrary,
  mergeArtistLibrary,
  mergeTrackLibrary,
} from '@server/lib/metadata/library';
import {
  mapArtist,
  mapRecording,
  mapReleaseGroup,
} from '@server/lib/metadata/mappers';
import logger from '@server/logger';
import type {
  AlbumResult,
  ArtistResult,
  SearchBucket,
  SearchResults,
  TrackResult,
} from '@server/models/music';

export type SearchType = 'all' | 'artist' | 'album' | 'track';

export interface SearchOptions {
  query: string;
  type?: SearchType;
  page?: number;
  pageSize?: number;
  user?: User;
}

const MAX_PAGE_SIZE = 50;
// MusicBrainz refuses offsets past this for searches
const MAX_OFFSET = 10000;

/** Studio albums, then EPs, then singles, then everything with a secondary type. */
const typeRank = (album: AlbumResult): number => {
  const secondary = (album.secondaryTypes ?? []).length > 0 ? 3 : 0;
  switch (album.primaryType) {
    case 'Album':
      return secondary;
    case 'EP':
      return 1 + secondary;
    case 'Single':
      return 2 + secondary;
    default:
      return 6;
  }
};

const empty = <T>(): SearchBucket<T> => ({ total: 0, results: [] });

export const searchMusic = async (
  options: SearchOptions
): Promise<SearchResults> => {
  const query = (options.query ?? '').trim();
  const type: SearchType = options.type ?? 'all';
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(options.pageSize ?? 20))
  );
  const paging = { limit: pageSize, offset: (page - 1) * pageSize };

  const results: SearchResults = {
    query,
    page,
    pageSize,
    artists: empty<ArtistResult>(),
    albums: empty<AlbumResult>(),
    tracks: empty<TrackResult>(),
  };

  if (!query || paging.offset > MAX_OFFSET) {
    return results;
  }

  const mb = getMusicBrainz();
  const wants = (t: SearchType) => type === 'all' || type === t;
  // One failing bucket must not blank the others when searching everything.
  const guard = async <T>(
    bucket: string,
    run: () => Promise<SearchBucket<T>>
  ): Promise<SearchBucket<T>> => {
    try {
      return await run();
    } catch (e) {
      if (type !== 'all') {
        throw e;
      }
      logger.warn(`Search failed for ${bucket}`, {
        label: 'Search',
        query,
        errorMessage: e.message,
      });
      return empty<T>();
    }
  };

  // Artists first: when the words are exactly an artist's name, the album
  // bucket shows that artist's own releases (albums first, newest first)
  // instead of every single that mentions the name in its title.
  let exactArtistMbid: string | undefined;
  const artists =
    wants('artist') || wants('album')
      ? await guard<ArtistResult>('artists', async () => {
          const data = await mb.searchArtists(
            query,
            wants('artist') ? paging : { limit: pageSize, offset: 0 }
          );
          const top = (data.artists ?? [])[0];
          if (
            top &&
            (top.score ?? 0) >= 95 &&
            top.name.trim().toLowerCase() === query.toLowerCase()
          ) {
            exactArtistMbid = top.id;
          }
          if (!wants('artist')) {
            return empty<ArtistResult>();
          }
          return {
            total: data.count ?? 0,
            results: await mergeArtistLibrary(
              (data.artists ?? []).map(mapArtist)
            ),
          };
        })
      : empty<ArtistResult>();

  const [albums, tracks] = await Promise.all([
    wants('album')
      ? guard<AlbumResult>('albums', async () => {
          if (exactArtistMbid) {
            const data = await mb.searchReleaseGroupsRaw(
              `arid:${exactArtistMbid}`,
              { limit: 100, offset: 0 }
            );
            const all = (data['release-groups'] ?? [])
              .map(mapReleaseGroup)
              .sort(
                (a, b) =>
                  typeRank(a) - typeRank(b) ||
                  (b.firstReleaseDate || '').localeCompare(
                    a.firstReleaseDate || ''
                  )
              );
            return {
              total: Math.min(data.count ?? all.length, all.length),
              results: await mergeAlbumLibrary(
                all.slice(paging.offset, paging.offset + pageSize)
              ),
            };
          }
          const data = await mb.searchReleaseGroups(query, paging);
          return {
            total: data.count ?? 0,
            results: await mergeAlbumLibrary(
              (data['release-groups'] ?? []).map(mapReleaseGroup)
            ),
          };
        })
      : empty<AlbumResult>(),
    wants('track')
      ? guard<TrackResult>('tracks', async () => {
          const data = await mb.searchRecordings(query, paging);
          return {
            total: data.count ?? 0,
            results: await mergeTrackLibrary(
              (data.recordings ?? []).map(mapRecording)
            ),
          };
        })
      : empty<TrackResult>(),
  ]);

  // Viewers without request visibility still see that something is requested,
  // but not by whom.
  if (!canSeeAllRequests(options.user)) {
    for (const album of albums.results) {
      if (album.request && album.request.requestedBy.id !== options.user?.id) {
        album.request = {
          ...album.request,
          requestedBy: { id: 0, displayName: '' },
        };
      }
    }
  }

  results.artists = artists;
  results.albums = albums;
  results.tracks = tracks;
  return results;
};
