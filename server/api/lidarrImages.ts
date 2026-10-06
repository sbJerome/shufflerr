import type { ArtistImages } from '@server/api/fanart';
import type { LidarrImage } from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import ImageProxy from '@server/lib/imageproxy';
import { registerImageSource } from '@server/lib/imageSources';
import type { LidarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

const NONE: ArtistImages = { thumb: null, background: null, logo: null };
const FANART_CDN = /https?:\/\/assets\.fanart\.tv\/(.+)$/;
const LOCAL_COVER = /\/MediaCover\/(\d+)\/([\w.-]+)/;
const HIT_TTL = 24 * 3600 * 1000;

const defaultServer = (): LidarrSettings | undefined => {
  const servers = getSettings().lidarr;
  return servers.find((s) => s.isDefault && !s.isHiRes) ?? servers[0];
};

// `/imageproxy/lidarr/artist/<id>/poster.jpg` → the default Lidarr server's own
// cover store, for artists whose art Lidarr holds locally.
let proxy: { key: string; instance: ImageProxy } | undefined;
registerImageSource(
  'lidarr',
  () => {
    const server = defaultServer();
    if (!server) {
      return null;
    }
    const baseUrl = `${server.useSsl ? 'https' : 'http'}://${server.hostname}:${
      server.port
    }${server.baseUrl ?? ''}/api/v1/mediacover`;
    const key = `${baseUrl}|${server.apiKey}`;
    if (proxy?.key !== key) {
      proxy = {
        key,
        instance: new ImageProxy('lidarr', baseUrl, {
          headers: { 'X-Api-Key': server.apiKey },
          rateLimitOptions: { maxRequests: 20, maxRPS: 50 },
        }),
      };
    }
    return proxy.instance;
  },
  { internal: true }
);

const proxyPath = (image?: LidarrImage): string | null => {
  if (!image) {
    return null;
  }
  // Lidarr's metadata images are fanart.tv CDN files behind its cache prefix.
  const remote = image.remoteUrl?.match(FANART_CDN);
  if (remote) {
    return `/imageproxy/fanart/${remote[1]}`;
  }
  const local = (image.url ?? '').match(LOCAL_COVER);
  if (local) {
    return `/imageproxy/lidarr/artist/${local[1]}/${local[2]}`;
  }
  return null;
};

const cache = new Map<string, { at: number; images: ArtistImages }>();

/**
 * Artist photos by MBID through the default Lidarr server's metadata lookup.
 * Needs no extra API key. All-null when no Lidarr is set up or it has nothing.
 * Never throws.
 */
export const getLidarrArtistImages = async (
  mbid: string
): Promise<ArtistImages> => {
  const server = defaultServer();
  if (!server || !mbid) {
    return NONE;
  }
  const cached = cache.get(mbid);
  if (cached && Date.now() - cached.at < HIT_TTL) {
    return cached.images;
  }
  let images = NONE;
  try {
    const artist = await LidarrAPI.fromSettings(server).lookupArtist(mbid);
    const byType = (type: string) =>
      proxyPath(artist?.images?.find((i) => i.coverType === type));
    images = {
      thumb: byType('poster'),
      background: byType('fanart'),
      logo: byType('clearlogo') ?? byType('logo'),
    };
  } catch (e) {
    logger.debug('Lidarr artist image lookup failed', {
      label: 'Lidarr',
      mbid,
      errorMessage: e.message,
    });
    return NONE;
  }
  if (cache.size > 5000) {
    cache.clear();
  }
  cache.set(mbid, { at: Date.now(), images });
  return images;
};
