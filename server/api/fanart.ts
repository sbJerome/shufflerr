import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

interface FanartImage {
  id: string;
  url: string;
  likes?: string;
}

export interface FanartArtistResponse {
  name?: string;
  mbid_id?: string;
  artistthumb?: FanartImage[];
  artistbackground?: FanartImage[];
  hdmusiclogo?: FanartImage[];
  musiclogo?: FanartImage[];
  musicbanner?: FanartImage[];
}

export interface ArtistImages {
  /** Square-ish artist photo, image-proxy path */
  thumb: string | null;
  /** Wide background, image-proxy path */
  background: string | null;
  logo: string | null;
}

const NONE: ArtistImages = { thumb: null, background: null, logo: null };
const FANART_HOST = 'https://assets.fanart.tv';

/** Turn an assets.fanart.tv URL into an image-proxy path; anything else is dropped. */
export const fanartProxyPath = (url?: string): string | null => {
  if (!url) {
    return null;
  }
  const normalized = url.replace(/^http:\/\//, 'https://');
  if (!normalized.startsWith(`${FANART_HOST}/`)) {
    return null;
  }
  return `/imageproxy/fanart${normalized.slice(FANART_HOST.length)}`;
};

const best = (images?: FanartImage[]): string | null => {
  if (!images?.length) {
    return null;
  }
  const sorted = [...images].sort(
    (a, b) => Number(b.likes ?? 0) - Number(a.likes ?? 0)
  );
  return fanartProxyPath(sorted[0].url);
};

/** fanart.tv artist photos by MBID. Optional: needs the switch and an API key. */
class FanartAPI extends ExternalAPI {
  constructor(apiKey?: string) {
    super(
      'https://webservice.fanart.tv/v3',
      { api_key: apiKey ?? getSettings().metadata.fanart.apiKey },
      {
        nodeCache: cacheManager.getCache('fanart').data,
        timeout: getSettings().network.apiRequestTimeout,
      }
    );
  }

  public static enabled(): boolean {
    const { fanart } = getSettings().metadata;
    return fanart.enabled && !!fanart.apiKey;
  }

  public async getArtist(mbid: string): Promise<FanartArtistResponse | null> {
    try {
      return await this.get<FanartArtistResponse>(
        `/music/${mbid}`,
        undefined,
        86400
      );
    } catch (e) {
      // 404 = fanart.tv has nothing for this artist
      if (e?.response?.status !== 404) {
        logger.debug('fanart.tv lookup failed', {
          label: 'Fanart',
          mbid,
          errorMessage: e.message,
        });
      }
      return null;
    }
  }

  public async getArtistImages(mbid: string): Promise<ArtistImages> {
    const data = await this.getArtist(mbid);
    if (!data) {
      return NONE;
    }
    return {
      thumb: best(data.artistthumb),
      background: best(data.artistbackground),
      logo: best(data.hdmusiclogo) ?? best(data.musiclogo),
    };
  }
}

// Artists without art are looked up again and again by lists; remember the misses.
const missCache = new Map<string, number>();
const MISS_TTL = 6 * 3600 * 1000;

/** Artist images, or all-null when fanart.tv is off or has nothing. Never throws. */
export const getArtistImages = async (mbid: string): Promise<ArtistImages> => {
  if (!FanartAPI.enabled() || !mbid) {
    return NONE;
  }
  const missedAt = missCache.get(mbid);
  if (missedAt && Date.now() - missedAt < MISS_TTL) {
    return NONE;
  }
  const images = await new FanartAPI().getArtistImages(mbid);
  if (!images.thumb && !images.background && !images.logo) {
    if (missCache.size > 5000) {
      missCache.clear();
    }
    missCache.set(mbid, Date.now());
  }
  return images;
};

export default FanartAPI;
