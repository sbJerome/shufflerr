import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import { proxyRequestInterceptor } from '@server/utils/customProxyAgent';
import { userAgentRequestInterceptor } from '@server/utils/userAgent';
import axios from 'axios';

/** Deezer public API (no key). Errors come back as HTTP 200 with an `error` object. */

export interface DeezerArtistRef {
  id: number;
  name: string;
}

export interface DeezerTrack {
  id: number;
  title: string;
  isrc?: string;
  duration?: number;
  artist?: DeezerArtistRef;
  album?: DeezerAlbum;
}

export interface DeezerAlbum {
  id: number;
  title: string;
  upc?: string;
  cover_medium?: string | null;
  cover_big?: string | null;
  nb_tracks?: number;
  record_type?: string;
  release_date?: string;
  artist?: DeezerArtistRef;
  tracks?: { data: DeezerTrack[] };
}

export interface DeezerPlaylist {
  id: number;
  title: string;
  nb_tracks?: number;
}

interface DeezerError {
  error?: { type?: string; message?: string; code?: number };
}

interface DeezerList<T> {
  data: T[];
  total?: number;
  next?: string;
}

export class DeezerApiError extends Error {
  constructor(
    message: string,
    public code?: number
  ) {
    super(message);
  }
}

const unwrap = <T>(data: T & DeezerError): T => {
  if (data && typeof data === 'object' && data.error) {
    throw new DeezerApiError(
      data.error.message ?? 'Deezer returned an error.',
      data.error.code
    );
  }
  return data;
};

class DeezerAPI extends ExternalAPI {
  constructor() {
    super(
      'https://api.deezer.com',
      {},
      {
        nodeCache: cacheManager.getCache('deezer').data,
        timeout: getSettings().network.apiRequestTimeout,
        // Deezer allows 50 requests per 5 seconds per IP
        rateLimit: { maxRequests: 8, maxRPS: 8 },
      }
    );
  }

  public async getAlbum(id: string | number): Promise<DeezerAlbum> {
    return unwrap(await this.get<DeezerAlbum & DeezerError>(`/album/${id}`));
  }

  public async getTrack(id: string | number): Promise<DeezerTrack> {
    return unwrap(await this.get<DeezerTrack & DeezerError>(`/track/${id}`));
  }

  public async getPlaylist(id: string | number): Promise<DeezerPlaylist> {
    return unwrap(
      await this.get<DeezerPlaylist & DeezerError>(`/playlist/${id}`)
    );
  }

  /** Every track of a playlist (pages of 100, capped). */
  public async getPlaylistTracks(
    id: string | number,
    maxTracks = 1000
  ): Promise<DeezerTrack[]> {
    const tracks: DeezerTrack[] = [];
    for (let index = 0; index < maxTracks; index += 100) {
      const page = unwrap(
        await this.get<DeezerList<DeezerTrack> & DeezerError>(
          `/playlist/${id}/tracks`,
          { params: { index, limit: 100 } }
        )
      );
      tracks.push(...(page.data ?? []));
      if (!page.next || (page.data ?? []).length === 0) {
        break;
      }
    }
    return tracks;
  }

  /**
   * Follow a share link (deezer.page.link, link.deezer.com, dzr.page.link) to
   * the deezer.com URL it points at.
   */
  public async resolveShortLink(url: string): Promise<string> {
    const client = axios.create({
      timeout: getSettings().network.apiRequestTimeout,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
    });
    client.interceptors.request.use(proxyRequestInterceptor);
    client.interceptors.request.use(userAgentRequestInterceptor);
    const response = await client.get(url, { responseType: 'text' });
    const finalUrl: string | undefined =
      response.request?.res?.responseUrl ?? response.config?.url;
    if (finalUrl && /deezer\.com\//.test(finalUrl) && finalUrl !== url) {
      return finalUrl;
    }
    // Some share links answer with an HTML page that redirects in the browser.
    const body = typeof response.data === 'string' ? response.data : '';
    const inPage = body.match(
      /https?:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?(?:album|playlist|track)\/\d+/
    );
    if (inPage) {
      return inPage[0];
    }
    throw new DeezerApiError(
      "That Deezer link didn't lead to an album or playlist. Open it in Deezer and copy the link from the Share menu."
    );
  }
}

export default DeezerAPI;
