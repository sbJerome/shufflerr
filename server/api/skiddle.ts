import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';

/** Skiddle events API (UK and Ireland listings). */

export interface SkiddleEvent {
  id: string | number;
  eventname: string;
  link: string;
  date?: string;
  startdate?: string;
  cancelled?: string | number;
  largeimageurl?: string;
  imageurl?: string;
  venue?: { name?: string; town?: string; country?: string };
  artists?: { artistid?: string | number; name: string }[];
}

interface SkiddleResponse {
  error?: number;
  errormessage?: string;
  totalcount?: string | number;
  results?: SkiddleEvent[];
}

class SkiddleAPI extends ExternalAPI {
  constructor(apiKey: string) {
    super(
      'https://www.skiddle.com/api/v1',
      { api_key: apiKey },
      {
        nodeCache: cacheManager.getCache('skiddle').data,
        timeout: getSettings().network.apiRequestTimeout,
        rateLimit: { maxRequests: 2, maxRPS: 2 },
      }
    );
  }

  /** Upcoming events whose listing mentions the artist, soonest first. */
  public async searchEvents(keyword: string): Promise<SkiddleEvent[]> {
    const data = await this.get<SkiddleResponse>(
      '/events/search/',
      {
        params: {
          keyword,
          order: 'date',
          description: 0,
          limit: 50,
        },
      },
      43200
    );
    if (data.error) {
      throw new Error(data.errormessage ?? 'Skiddle returned an error.');
    }
    return data.results ?? [];
  }
}

export default SkiddleAPI;
