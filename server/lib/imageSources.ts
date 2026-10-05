import ImageProxy from '@server/lib/imageproxy';

/**
 * Registry of image proxy sources: `/imageproxy/<type>/<path>` fetches
 * `<baseUrl>/<path>`. Only hosts registered here can be proxied (allow-list).
 * Streams add dynamic sources (plex, jellyfin, navidrome — whose base URL and
 * auth headers come from settings) with registerImageSource() at module load.
 */
type SourceFactory = () => ImageProxy | null;

const rate = { maxRequests: 20, maxRPS: 50 };
const cache: Record<string, ImageProxy> = {};

const fixed =
  (key: string, baseUrl: string): SourceFactory =>
  () => {
    if (!cache[key]) {
      cache[key] = new ImageProxy(key, baseUrl, { rateLimitOptions: rate });
    }
    return cache[key];
  };

const sources: Record<string, SourceFactory> = {
  // Cover Art Archive — 307s to *.archive.org, which axios follows
  caa: fixed('caa', 'https://coverartarchive.org'),
  archive: fixed('archive', 'https://archive.org'),
  fanart: fixed('fanart', 'https://assets.fanart.tv'),
  lastfm: fixed('lastfm', 'https://lastfm.freetls.fastly.net'),
  spotify: fixed('spotify', 'https://i.scdn.co'),
  deezer: fixed('deezer', 'https://cdn-images.dzcdn.net'),
  itunes: fixed('itunes', 'https://is1-ssl.mzstatic.com'),
  ticketmaster: fixed('ticketmaster', 'https://s1.ticketm.net'),
  skiddle: fixed('skiddle', 'https://d1plawd8huk6hh.cloudfront.net'),
  youtube: fixed('youtube', 'https://i.ytimg.com'),
};

export const registerImageSource = (
  type: string,
  factory: SourceFactory
): void => {
  sources[type] = factory;
};

export const getImageSource = (type: string): ImageProxy | null =>
  sources[type]?.() ?? null;

export const imageSourceTypes = (): string[] => Object.keys(sources);
