import type { SkiddleEvent } from '@server/api/skiddle';
import SkiddleAPI from '@server/api/skiddle';
import type {
  TicketmasterAttraction,
  TicketmasterEvent,
} from '@server/api/ticketmaster';
import TicketmasterAPI from '@server/api/ticketmaster';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import type { EventProvider } from '@server/entity/Event';
import Event from '@server/entity/Event';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import ScrobbleQueue from '@server/entity/ScrobbleQueue';
import { UserSettings } from '@server/entity/UserSettings';
import { normalizeName, similarity } from '@server/lib/import/match';
import { toProxyUrl } from '@server/lib/import/sources';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { In, LessThan, MoreThan } from 'typeorm';

/** Artists looked up per run (Ticketmaster allows 5,000 calls a day). */
export const MAX_ARTISTS = 100;
/** Countries looked up per artist. */
const MAX_COUNTRIES = 4;
/** Listings are refreshed daily and never kept longer than this without a refresh. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Skiddle only lists these countries. */
const SKIDDLE_COUNTRIES = new Set(['GB', 'IE']);
const PLAY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const REQUEST_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

export interface ConcertArtist {
  mbid?: string | null;
  name: string;
}

type EventFields = Pick<
  Event,
  | 'provider'
  | 'externalId'
  | 'artistMbid'
  | 'artistName'
  | 'name'
  | 'venue'
  | 'city'
  | 'country'
  | 'startsAt'
  | 'url'
  | 'imageUrl'
>;

/** The Ticketmaster attraction that is this artist (MusicBrainz link first, then the name). */
export const pickAttraction = (
  attractions: TicketmasterAttraction[],
  artist: ConcertArtist
): TicketmasterAttraction | null => {
  if (artist.mbid) {
    const linked = attractions.find((a) =>
      a.externalLinks?.musicbrainz?.some((m) => m.id === artist.mbid)
    );
    if (linked) {
      return linked;
    }
  }
  return (
    attractions.find(
      (a) => normalizeName(a.name) === normalizeName(artist.name)
    ) ??
    attractions.find((a) => similarity(a.name, artist.name) >= 0.95) ??
    null
  );
};

export const mapTicketmasterEvent = (
  event: TicketmasterEvent,
  artist: ConcertArtist
): EventFields | null => {
  const start = event.dates?.start;
  const when = start?.dateTime ?? (start?.localDate ? `${start.localDate}T${start.localTime ?? '00:00:00'}` : null);
  const startsAt = when ? new Date(when) : null;
  if (!event.id || !event.url || !startsAt || Number.isNaN(startsAt.getTime())) {
    return null;
  }
  if (['cancelled', 'canceled'].includes(event.dates?.status?.code ?? '')) {
    return null;
  }
  const venue = event._embedded?.venues?.[0];
  const image =
    (event.images ?? [])
      .filter((i) => i.ratio === '16_9' && (i.width ?? 0) >= 640)
      .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0] ?? event.images?.[0];
  return {
    provider: 'ticketmaster',
    externalId: event.id,
    artistMbid: artist.mbid ?? null,
    artistName: artist.name,
    name: event.name ?? null,
    venue: venue?.name ?? null,
    city: venue?.city?.name ?? null,
    country: venue?.country?.countryCode?.toUpperCase() ?? null,
    startsAt,
    url: event.url,
    imageUrl: toProxyUrl(image?.url),
  };
};

/** Skiddle searches by keyword, so only keep events that really bill the artist. */
export const skiddleEventFeatures = (
  event: SkiddleEvent,
  artist: ConcertArtist
): boolean => {
  const wanted = normalizeName(artist.name);
  if (!wanted) {
    return false;
  }
  if ((event.artists ?? []).some((a) => normalizeName(a.name) === wanted)) {
    return true;
  }
  return ` ${normalizeName(event.eventname)} `.includes(` ${wanted} `);
};

export const mapSkiddleEvent = (
  event: SkiddleEvent,
  artist: ConcertArtist
): EventFields | null => {
  const when = event.startdate ?? event.date;
  const startsAt = when ? new Date(when) : null;
  if (!event.id || !event.link || !startsAt || Number.isNaN(startsAt.getTime())) {
    return null;
  }
  if (String(event.cancelled ?? '0') === '1') {
    return null;
  }
  return {
    provider: 'skiddle',
    externalId: String(event.id),
    artistMbid: artist.mbid ?? null,
    artistName: artist.name,
    name: event.eventname ?? null,
    venue: event.venue?.name ?? null,
    city: event.venue?.town ?? null,
    country: (event.venue?.country ?? 'GB').toUpperCase(),
    startsAt,
    url: event.link,
    imageUrl: toProxyUrl(event.largeimageurl ?? event.imageurl),
  };
};

/**
 * Artists to look up: the ones with albums in the library, those people have
 * recently played or requested first, then the most recently added.
 */
export const getConcertArtists = async (
  limit = MAX_ARTISTS
): Promise<ConcertArtist[]> => {
  const inLibrary = await getRepository(Media).find({
    where: {
      mediaType: MediaType.RELEASE_GROUP,
      status: In([MediaStatus.AVAILABLE, MediaStatus.PARTIALLY_AVAILABLE]),
    },
    select: {
      id: true,
      artistMbid: true,
      artistName: true,
      mediaAddedAt: true,
    },
  });

  const artists = new Map<
    string,
    ConcertArtist & { activity: number; addedAt: number }
  >();
  for (const media of inLibrary) {
    if (!media.artistName) {
      continue;
    }
    const key = media.artistMbid || normalizeName(media.artistName);
    const addedAt = media.mediaAddedAt
      ? new Date(media.mediaAddedAt).getTime()
      : 0;
    const existing = artists.get(key);
    if (existing) {
      existing.addedAt = Math.max(existing.addedAt, addedAt);
    } else {
      artists.set(key, {
        mbid: media.artistMbid ?? null,
        name: media.artistName,
        activity: 0,
        addedAt,
      });
    }
  }
  if (!artists.size) {
    return [];
  }
  const byName = new Map(
    [...artists.values()].map((a) => [normalizeName(a.name), a])
  );

  const plays = await getRepository(ScrobbleQueue).find({
    where: { playedAt: MoreThan(new Date(Date.now() - PLAY_WINDOW_MS)) },
    select: { id: true, artist: true },
  });
  for (const play of plays) {
    // "A, B & C" credits: the first name is the album artist more often than not
    const artist =
      byName.get(normalizeName(play.artist)) ??
      byName.get(normalizeName(play.artist.split(/,|&| feat\.? /i)[0]));
    if (artist) {
      artist.activity += 1;
    }
  }

  const requests = await getRepository(MediaRequest).find({
    where: { createdAt: MoreThan(new Date(Date.now() - REQUEST_WINDOW_MS)) },
    relations: { media: true },
  });
  for (const request of requests) {
    const media = request.media;
    if (!media) {
      continue;
    }
    const key =
      media.mediaType === MediaType.ARTIST
        ? media.mbid
        : media.artistMbid || normalizeName(media.artistName ?? '');
    const artist = artists.get(key);
    if (artist) {
      artist.activity += 3;
    }
  }

  return [...artists.values()]
    .sort((a, b) => b.activity - a.activity || b.addedAt - a.addedAt)
    .slice(0, limit)
    .map(({ mbid, name }) => ({ mbid, name }));
};

/** Countries people browse from: the Ticketmaster setting, the server region, every user's region. */
export const getConcertCountries = async (): Promise<string[]> => {
  const settings = getSettings();
  const userRegions = await getRepository(UserSettings)
    .createQueryBuilder('settings')
    .select('DISTINCT settings.discoverRegion', 'region')
    .getRawMany<{ region: string | null }>();
  const all = [
    settings.discover.ticketmaster.country,
    settings.main.discoverRegion,
    ...userRegions.map((r) => r.region),
  ]
    .map((c) => (c ?? '').trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  return [...new Set(all)].slice(0, MAX_COUNTRIES);
};

const upsertEvents = async (found: EventFields[]): Promise<number> => {
  if (!found.length) {
    return 0;
  }
  const repository = getRepository(Event);
  const unique = new Map(
    found.map((e) => [`${e.provider}:${e.externalId}`, e])
  );
  const byProvider = new Map<EventProvider, EventFields[]>();
  for (const event of unique.values()) {
    byProvider.set(event.provider, [
      ...(byProvider.get(event.provider) ?? []),
      event,
    ]);
  }
  const now = new Date();
  for (const [provider, events] of byProvider) {
    const existing = new Map<string, Event>();
    for (let i = 0; i < events.length; i += 200) {
      const rows = await repository.find({
        where: {
          provider,
          externalId: In(events.slice(i, i + 200).map((e) => e.externalId)),
        },
      });
      rows.forEach((row) => existing.set(row.externalId, row));
    }
    await repository.save(
      events.map((event) =>
        Object.assign(existing.get(event.externalId) ?? new Event(), event, {
          fetchedAt: now,
        })
      ),
      { chunk: 100 }
    );
  }
  return unique.size;
};

let running = false;

/**
 * `concerts-refresh` job: Ticketmaster and Skiddle events for artists in the
 * library, cached in Event. Past events, listings not refreshed within a week
 * and listings of a provider that was switched off are purged.
 */
export const refreshConcerts = async (): Promise<void> => {
  if (running) {
    return;
  }
  running = true;
  try {
    const settings = getSettings();
    const repository = getRepository(Event);
    const useTicketmaster = settings.integrations.ticketmaster;
    const useSkiddle = settings.integrations.skiddle;

    if (!useTicketmaster) {
      await repository.delete({ provider: 'ticketmaster' });
    }
    if (!useSkiddle) {
      await repository.delete({ provider: 'skiddle' });
    }
    await repository.delete({
      startsAt: LessThan(new Date(Date.now() - 12 * 60 * 60 * 1000)),
    });
    if (!useTicketmaster && !useSkiddle) {
      return;
    }

    const artists = await getConcertArtists();
    const countries = await getConcertCountries();
    const found: EventFields[] = [];
    let failures = 0;

    if (useTicketmaster && countries.length) {
      const api = new TicketmasterAPI(settings.discover.ticketmaster.apiKey);
      for (const artist of artists) {
        try {
          const attraction = pickAttraction(
            await api.searchAttractions(artist.name),
            artist
          );
          if (!attraction) {
            continue;
          }
          for (const country of countries) {
            const events = await api.getEvents(attraction.id, country);
            found.push(
              ...events
                .map((e) => mapTicketmasterEvent(e, artist))
                .filter((e): e is EventFields => !!e)
            );
          }
        } catch (e) {
          failures++;
          logger.debug('Ticketmaster lookup failed', {
            label: 'Concerts',
            artist: artist.name,
            errorMessage: e.message,
          });
          if (e.response?.status === 401 || e.response?.status === 429) {
            // wrong key or out of quota: stop asking for today
            logger.warn(
              e.response.status === 401
                ? 'Ticketmaster rejected the API key. Check it in Settings → Ticketmaster.'
                : 'Ticketmaster quota is used up for now. Concerts will refresh on the next run.',
              { label: 'Concerts' }
            );
            break;
          }
        }
      }
    }

    if (useSkiddle && countries.some((c) => SKIDDLE_COUNTRIES.has(c))) {
      const api = new SkiddleAPI(settings.discover.skiddle.apiKey);
      for (const artist of artists) {
        try {
          const events = await api.searchEvents(artist.name);
          found.push(
            ...events
              .filter((e) => skiddleEventFeatures(e, artist))
              .map((e) => mapSkiddleEvent(e, artist))
              .filter((e): e is EventFields => !!e)
          );
        } catch (e) {
          failures++;
          logger.debug('Skiddle lookup failed', {
            label: 'Concerts',
            artist: artist.name,
            errorMessage: e.message,
          });
          if (e.response?.status === 401 || e.response?.status === 403) {
            logger.warn(
              'Skiddle rejected the API key. Check it in Settings → Skiddle.',
              { label: 'Concerts' }
            );
            break;
          }
        }
      }
    }

    const upcoming = found.filter((e) => e.startsAt.getTime() > Date.now());
    const saved = await upsertEvents(upcoming);
    // anything a provider no longer returns ages out
    await repository.delete({
      fetchedAt: LessThan(new Date(Date.now() - MAX_AGE_MS)),
    });

    logger.info('Concert listings refreshed', {
      label: 'Concerts',
      artists: artists.length,
      countries,
      events: saved,
      failures,
    });
  } catch (e) {
    logger.error('Concert refresh failed', {
      label: 'Concerts',
      errorMessage: e.message,
    });
  } finally {
    running = false;
  }
};
