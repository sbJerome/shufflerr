import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';

/** Ticketmaster Discovery API v2. Default quota: 5,000 calls a day, 5 a second. */

export interface TicketmasterAttraction {
  id: string;
  name: string;
  url?: string;
  externalLinks?: { musicbrainz?: { id: string }[] };
}

export interface TicketmasterEvent {
  id: string;
  name: string;
  url: string;
  dates?: {
    start?: { dateTime?: string; localDate?: string; localTime?: string };
    status?: { code?: string };
  };
  images?: { url: string; width?: number; height?: number; ratio?: string }[];
  _embedded?: {
    venues?: {
      name?: string;
      city?: { name?: string };
      country?: { countryCode?: string };
    }[];
  };
}

interface AttractionsResponse {
  _embedded?: { attractions?: TicketmasterAttraction[] };
}

interface EventsResponse {
  _embedded?: { events?: TicketmasterEvent[] };
}

class TicketmasterAPI extends ExternalAPI {
  constructor(apiKey: string) {
    super(
      'https://app.ticketmaster.com/discovery/v2',
      { apikey: apiKey },
      {
        nodeCache: cacheManager.getCache('ticketmaster').data,
        timeout: getSettings().network.apiRequestTimeout,
        rateLimit: { maxRequests: 4, maxRPS: 4 },
      }
    );
  }

  /** Music attractions matching a name, best first. */
  public async searchAttractions(
    keyword: string
  ): Promise<TicketmasterAttraction[]> {
    const data = await this.get<AttractionsResponse>(
      '/attractions.json',
      { params: { keyword, classificationName: 'music', size: 10 } },
      43200
    );
    return data._embedded?.attractions ?? [];
  }

  /** Upcoming events of an attraction in one country, soonest first. */
  public async getEvents(
    attractionId: string,
    countryCode: string
  ): Promise<TicketmasterEvent[]> {
    const data = await this.get<EventsResponse>(
      '/events.json',
      {
        params: {
          attractionId,
          countryCode: countryCode.toUpperCase(),
          classificationName: 'music',
          size: 50,
          sort: 'date,asc',
        },
      },
      43200
    );
    return data._embedded?.events ?? [];
  }
}

export default TicketmasterAPI;
