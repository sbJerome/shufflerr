import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';

/**
 * iTunes Search/Lookup API and Apple's marketing RSS charts (both keyless).
 * UPCs are not exposed, so albums from here are matched by artist + title.
 */

export interface ItunesCollection {
  wrapperType: 'collection';
  collectionId: number;
  collectionName: string;
  artistName: string;
  artworkUrl100?: string;
  trackCount?: number;
  releaseDate?: string;
  collectionViewUrl?: string;
}

export interface ItunesSong {
  wrapperType: 'track';
  kind?: string;
  trackId: number;
  trackName: string;
  artistName: string;
  collectionId: number;
  collectionName: string;
  trackTimeMillis?: number;
}

interface ItunesLookupResponse {
  resultCount: number;
  results: (ItunesCollection | ItunesSong)[];
}

export interface ItunesChartAlbum {
  /** Apple collection id */
  id: string;
  title: string;
  artistName: string;
  releaseDate?: string;
  /** Apple Music page (attribution link). */
  url: string;
  /** Image-proxy path, or null. */
  coverUrl: string | null;
}

interface ItunesChartFeed {
  feed: {
    title?: string;
    country?: string;
    results: {
      id: string;
      name: string;
      artistName: string;
      releaseDate?: string;
      url: string;
      artworkUrl100?: string;
    }[];
  };
}

/** mzstatic artwork URL → image-proxy path (the proxy only fetches is1-ssl.mzstatic.com). */
export const itunesArtworkToProxy = (
  url?: string | null,
  size = 500
): string | null => {
  if (!url) {
    return null;
  }
  const match = url.match(/^https?:\/\/is\d-ssl\.mzstatic\.com\/(.+)$/);
  if (!match) {
    return null;
  }
  const path = match[1].replace(
    /\/\d+x\d+(bb|cc)?\.(jpg|png|webp)$/,
    `/${size}x${size}bb.jpg`
  );
  return `/imageproxy/itunes/${path}`;
};

class ItunesAPI extends ExternalAPI {
  constructor() {
    super(
      'https://itunes.apple.com',
      {},
      {
        nodeCache: cacheManager.getCache('itunes').data,
        timeout: getSettings().network.apiRequestTimeout,
        // The Search API allows roughly 20 calls a minute
        rateLimit: { maxRequests: 1, maxRPS: 1 },
      }
    );
  }

  /** An album and its songs. Returns null when the id is unknown in that store. */
  public async lookupAlbum(
    collectionId: string,
    country?: string
  ): Promise<{ album: ItunesCollection; songs: ItunesSong[] } | null> {
    const data = await this.get<ItunesLookupResponse>('/lookup', {
      params: {
        id: collectionId,
        entity: 'song',
        country: (
          country ||
          getSettings().discover.itunes.country ||
          'US'
        ).toUpperCase(),
        limit: 200,
      },
    });
    const album = data.results.find(
      (r): r is ItunesCollection => r.wrapperType === 'collection'
    );
    if (!album) {
      return null;
    }
    return {
      album,
      songs: data.results.filter(
        (r): r is ItunesSong => r.wrapperType === 'track'
      ),
    };
  }

  /** Most-played albums in a store (Apple marketing RSS). */
  public async getChart(
    country?: string,
    limit = 50
  ): Promise<ItunesChartAlbum[]> {
    const cc = (
      country ||
      getSettings().discover.itunes.country ||
      'US'
    ).toLowerCase();
    const data = await this.get<ItunesChartFeed>(
      `https://rss.marketingtools.apple.com/api/v2/${cc}/music/most-played/${Math.min(
        Math.max(limit, 1),
        100
      )}/albums.json`,
      undefined,
      21600
    );
    return (data.feed?.results ?? []).map((r) => ({
      id: r.id,
      title: r.name,
      artistName: r.artistName,
      releaseDate: r.releaseDate,
      url: r.url,
      coverUrl: itunesArtworkToProxy(r.artworkUrl100),
    }));
  }
}

/**
 * The iTunes most-played albums chart for settings.discover.itunes.country.
 * Empty when iTunes is switched off. For the Discover page (SV1); match an
 * entry to MusicBrainz with `matchAlbum()` from server/lib/import/match.
 */
export const getItunesChart = async (
  limit = 50,
  country?: string
): Promise<ItunesChartAlbum[]> => {
  if (!getSettings().discover.itunes.enabled) {
    return [];
  }
  return new ItunesAPI().getChart(country, limit);
};

export default ItunesAPI;
