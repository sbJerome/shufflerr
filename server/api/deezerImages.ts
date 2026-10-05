import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import axios from 'axios';

const HIT_TTL = 24 * 3600 * 1000;
const CDN =
  /^https:\/\/cdn-images\.dzcdn\.net\/(images\/artist\/([0-9a-f]+)\/.+)$/;

interface DeezerArtistHit {
  name: string;
  nb_fan?: number;
  picture_xl?: string;
}

/** "Jung Kook" and "Jungkook" are the same act; punctuation and case never matter. */
const normalize = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

const cache = new Map<string, { at: number; path: string | null }>();

/**
 * Artist photo from Deezer's public search, as an image-proxy path, or null.
 * Deezer has no MusicBrainz ids, so only an exact name match (ignoring case,
 * spacing and punctuation) is accepted; the most-followed match wins.
 * Off when the Deezer integration is switched off. Never throws.
 */
export const getDeezerArtistImage = async (
  name?: string | null
): Promise<string | null> => {
  const wanted = normalize(name ?? '');
  if (!wanted || !getSettings().discover.deezer.enabled) {
    return null;
  }
  const cached = cache.get(wanted);
  if (cached && Date.now() - cached.at < HIT_TTL) {
    return cached.path;
  }
  let path: string | null = null;
  try {
    const response = await axios.get<{ data?: DeezerArtistHit[] }>(
      'https://api.deezer.com/search/artist',
      {
        params: { q: name, limit: 8 },
        timeout: getSettings().network.apiRequestTimeout,
      }
    );
    const match = (response.data.data ?? [])
      .filter((hit) => normalize(hit.name) === wanted)
      .sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0))
      // Deezer's "no picture" placeholder has an empty hash segment.
      .find((hit) => CDN.test(hit.picture_xl ?? ''));
    const parts = match?.picture_xl?.match(CDN);
    path = parts ? `/imageproxy/deezer/${parts[1]}` : null;
  } catch (e) {
    logger.debug('Deezer artist image lookup failed', {
      label: 'Deezer',
      name,
      errorMessage: e.message,
    });
    return null;
  }
  if (cache.size > 5000) {
    cache.clear();
  }
  cache.set(wanted, { at: Date.now(), path });
  return path;
};
