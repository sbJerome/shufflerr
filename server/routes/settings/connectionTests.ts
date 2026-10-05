// One real call per integration, for the "Test" buttons on the admin pages.
// Each returns a ConnectionTestResponse; none of them throws.
import type { ConnectionTestResponse } from '@server/interfaces/api/settingsInterfaces';
import { getSettings } from '@server/lib/settings';
import { getAppVersion } from '@server/utils/appVersion';
import axios from 'axios';

const timeout = () => getSettings().network.apiRequestTimeout || 10000;

const fail = (message: string): ConnectionTestResponse => ({
  ok: false,
  message,
});

interface HttpError {
  response?: { status?: number; data?: unknown };
  code?: string;
  message?: string;
}

/** Turns a transport failure into a sentence that says what to check. */
const unreachable = (service: string, e: HttpError): ConnectionTestResponse => {
  if (e.code === 'ECONNABORTED' || /timeout/i.test(e.message ?? '')) {
    return fail(
      `${service} didn't answer in time. Check the address and your network, then try again.`
    );
  }
  if (e.response?.status) {
    return fail(
      `${service} answered with an error (HTTP ${e.response.status}). Try again in a minute.`
    );
  }
  return fail(
    `Couldn't reach ${service}${e.code ? ` (${e.code})` : ''}. Check the address and your network.`
  );
};

export const musicBrainzUserAgent = (contact: string): string =>
  `Shufflerr/${getAppVersion()} ( ${contact || 'https://github.com/'} )`;

export const testMusicBrainz = async (
  url: string,
  contact: string
): Promise<ConnectionTestResponse> => {
  try {
    const res = await axios.get(`${url}/ws/2/artist`, {
      params: { query: 'artist:"Queen"', limit: 1, fmt: 'json' },
      headers: { 'User-Agent': musicBrainzUserAgent(contact) },
      timeout: timeout(),
    });
    if (typeof res.data?.count !== 'number') {
      return fail(
        "That address answered, but not like a MusicBrainz server. Check the server URL."
      );
    }
    return { ok: true, name: 'MusicBrainz' };
  } catch (e) {
    if (e.response?.status === 503) {
      return fail(
        'MusicBrainz is rate limiting this address right now. Wait a few seconds and try again.'
      );
    }
    if (e.response?.status === 404) {
      return fail(
        "That address answered, but not like a MusicBrainz server. Check the server URL."
      );
    }
    return unreachable('MusicBrainz', e);
  }
};

export const testFanart = async (
  apiKey: string
): Promise<ConnectionTestResponse> => {
  if (!apiKey) {
    return fail('Enter the fanart.tv API key first.');
  }
  try {
    // Any artist will do; this one always has art.
    await axios.get(
      'https://webservice.fanart.tv/v3/music/b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d',
      { params: { api_key: apiKey }, timeout: timeout() }
    );
    return { ok: true, name: 'fanart.tv' };
  } catch (e) {
    if (e.response?.status === 401 || e.response?.status === 403) {
      return fail(
        "fanart.tv didn't accept that API key. Copy it again from your fanart.tv profile."
      );
    }
    return unreachable('fanart.tv', e);
  }
};

export const testLastfm = async (
  apiKey: string
): Promise<ConnectionTestResponse> => {
  if (!apiKey) {
    return fail('Enter the Last.fm API key first.');
  }
  try {
    const res = await axios.get('https://ws.audioscrobbler.com/2.0/', {
      params: {
        method: 'chart.gettopartists',
        limit: 1,
        api_key: apiKey,
        format: 'json',
      },
      timeout: timeout(),
      validateStatus: (s) => s < 500,
    });
    if (res.data?.error) {
      return fail(
        res.data.error === 10
          ? "Last.fm didn't accept that API key. Copy it again from last.fm/api/accounts."
          : `Last.fm answered: ${res.data.message ?? `error ${res.data.error}`}.`
      );
    }
    return { ok: true, name: 'Last.fm' };
  } catch (e) {
    return unreachable('Last.fm', e);
  }
};

export const testYoutube = async (
  apiKey: string
): Promise<ConnectionTestResponse> => {
  if (!apiKey) {
    return fail('Enter the YouTube Data API key first.');
  }
  try {
    // videoCategories.list costs 1 quota unit (search.list would cost 100).
    await axios.get('https://www.googleapis.com/youtube/v3/videoCategories', {
      params: { part: 'snippet', regionCode: 'US', key: apiKey },
      timeout: timeout(),
    });
    return { ok: true, name: 'YouTube Data API' };
  } catch (e) {
    const reason = e.response?.data?.error?.errors?.[0]?.reason;
    if (e.response?.status === 400 || e.response?.status === 403) {
      return fail(
        reason === 'quotaExceeded'
          ? "The key works, but today's YouTube quota is used up. It resets at midnight Pacific time."
          : "YouTube didn't accept that API key. Check that the YouTube Data API v3 is enabled for it in Google Cloud Console."
      );
    }
    return unreachable('YouTube', e);
  }
};

export const testSpotify = async (
  clientId: string,
  clientSecret: string
): Promise<ConnectionTestResponse> => {
  if (!clientId || !clientSecret) {
    return fail('Enter the Spotify client ID and client secret first.');
  }
  try {
    await axios.post(
      'https://accounts.spotify.com/api/token',
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: timeout(),
      }
    );
    return { ok: true, name: 'Spotify' };
  } catch (e) {
    if (e.response?.status === 400 || e.response?.status === 401) {
      return fail(
        "Spotify didn't accept that client ID and secret. Copy them again from your app at developer.spotify.com."
      );
    }
    return unreachable('Spotify', e);
  }
};

export const testTicketmaster = async (
  apiKey: string,
  country: string
): Promise<ConnectionTestResponse> => {
  if (!apiKey) {
    return fail('Enter the Ticketmaster Discovery API key first.');
  }
  try {
    await axios.get(
      'https://app.ticketmaster.com/discovery/v2/attractions.json',
      {
        params: {
          apikey: apiKey,
          size: 1,
          classificationName: 'music',
          countryCode: country || undefined,
        },
        timeout: timeout(),
      }
    );
    return { ok: true, name: 'Ticketmaster' };
  } catch (e) {
    if (e.response?.status === 401 || e.response?.status === 403) {
      return fail(
        "Ticketmaster didn't accept that API key. Copy the consumer key from developer.ticketmaster.com."
      );
    }
    if (e.response?.status === 429) {
      return fail(
        "The key works, but its Ticketmaster quota is used up for now. Try again later."
      );
    }
    return unreachable('Ticketmaster', e);
  }
};

export const testSkiddle = async (
  apiKey: string
): Promise<ConnectionTestResponse> => {
  if (!apiKey) {
    return fail('Enter the Skiddle API key first.');
  }
  try {
    const res = await axios.get(
      'https://www.skiddle.com/api/v1/events/search/',
      {
        params: { api_key: apiKey, limit: 1 },
        timeout: timeout(),
        validateStatus: (s) => s < 500,
      }
    );
    if (res.status === 401 || res.status === 403 || res.data?.error) {
      return fail(
        "Skiddle didn't accept that API key. Copy it again from skiddle.com/api."
      );
    }
    return { ok: true, name: 'Skiddle' };
  } catch (e) {
    return unreachable('Skiddle', e);
  }
};

export const testDeezer = async (): Promise<ConnectionTestResponse> => {
  try {
    const res = await axios.get('https://api.deezer.com/infos', {
      timeout: timeout(),
    });
    return res.data?.country_iso
      ? { ok: true, name: 'Deezer' }
      : fail("Deezer answered, but not as expected. Try again in a minute.");
  } catch (e) {
    return unreachable('Deezer', e);
  }
};

export const testItunes = async (
  country: string
): Promise<ConnectionTestResponse> => {
  try {
    const res = await axios.get('https://itunes.apple.com/search', {
      params: { term: 'queen', entity: 'album', limit: 1, country },
      timeout: timeout(),
      validateStatus: (s) => s < 500,
    });
    if (res.status === 400) {
      return fail(
        `iTunes doesn't have a store for "${country}". Use a two-letter country code such as US or GB.`
      );
    }
    return { ok: true, name: 'iTunes' };
  } catch (e) {
    return unreachable('iTunes', e);
  }
};

export const testListenBrainz = async (
  url: string
): Promise<ConnectionTestResponse> => {
  try {
    // Unauthenticated: a ListenBrainz server answers this with code 200 and
    // `valid: false`, or 400/401 "You need to provide an Authorization header."
    const res = await axios.get(`${url}/1/validate-token`, {
      timeout: timeout(),
      validateStatus: (s) => s < 500,
    });
    const looksRight =
      typeof res.data?.valid === 'boolean' ||
      (typeof res.data?.error === 'string' && typeof res.data?.code === 'number');
    return looksRight
      ? { ok: true, name: 'ListenBrainz' }
      : fail(
          "That address answered, but not like a ListenBrainz server. The public one is https://api.listenbrainz.org."
        );
  } catch (e) {
    return unreachable('ListenBrainz', e);
  }
};
