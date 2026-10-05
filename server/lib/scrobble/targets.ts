import { getSettings } from '@server/lib/settings';
import { getAppVersion } from '@server/utils/appVersion';
import { proxyRequestInterceptor } from '@server/utils/customProxyAgent';
import { userAgentRequestInterceptor } from '@server/utils/userAgent';
import type { AxiosInstance } from 'axios';
import axios from 'axios';
import { createHash } from 'crypto';

/** One play in the shape both scrobble services need. */
export interface Listen {
  artist: string;
  track: string;
  album?: string | null;
  recordingMbid?: string | null;
  releaseGroupMbid?: string | null;
  durationMs?: number | null;
  /** When playback started. */
  playedAt: Date;
  /** Where it was played, e.g. "plex" — sent as the music service hint. */
  source?: string;
}

/** The service rejected the user's credentials: retrying will not help, the account must be linked again. */
export class ScrobbleAuthError extends Error {}

const client = (): AxiosInstance => {
  const instance = axios.create({
    timeout: getSettings().network.apiRequestTimeout,
  });
  instance.interceptors.request.use(proxyRequestInterceptor);
  instance.interceptors.request.use(userAgentRequestInterceptor);
  return instance;
};

// ---- ListenBrainz -------------------------------------------------------------

export const LISTENBRAINZ_DEFAULT_URL = 'https://api.listenbrainz.org';
/** ListenBrainz accepts up to 1000 listens per request; stay well below. */
export const LISTENBRAINZ_BATCH = 100;

export const listenBrainzPayload = (listen: Listen, withTimestamp: boolean) => ({
  ...(withTimestamp
    ? { listened_at: Math.floor(listen.playedAt.getTime() / 1000) }
    : {}),
  track_metadata: {
    artist_name: listen.artist,
    track_name: listen.track,
    ...(listen.album ? { release_name: listen.album } : {}),
    additional_info: {
      ...(listen.recordingMbid ? { recording_mbid: listen.recordingMbid } : {}),
      ...(listen.releaseGroupMbid
        ? { release_group_mbid: listen.releaseGroupMbid }
        : {}),
      ...(listen.durationMs ? { duration_ms: listen.durationMs } : {}),
      media_player: 'Shufflerr',
      submission_client: 'Shufflerr',
      submission_client_version: getAppVersion(),
    },
  },
});

const listenBrainzUrl = (): string =>
  (getSettings().scrobble.listenbrainz.url || LISTENBRAINZ_DEFAULT_URL).replace(
    /\/+$/,
    ''
  );

const submitToListenBrainz = async (
  token: string,
  listenType: 'single' | 'import' | 'playing_now',
  listens: Listen[]
): Promise<void> => {
  try {
    await client().post(
      `${listenBrainzUrl()}/1/submit-listens`,
      {
        listen_type: listenType,
        payload: listens.map((l) =>
          listenBrainzPayload(l, listenType !== 'playing_now')
        ),
      },
      { headers: { Authorization: `Token ${token}` } }
    );
  } catch (e) {
    if (e.response?.status === 401) {
      throw new ScrobbleAuthError(
        'ListenBrainz no longer accepts the user token. Link ListenBrainz again in your profile settings.'
      );
    }
    throw new Error(
      e.response?.data?.error
        ? `ListenBrainz: ${e.response.data.error}`
        : `ListenBrainz: ${e.message}`
    );
  }
};

export const listenBrainzScrobble = async (
  token: string,
  listens: Listen[]
): Promise<void> => {
  for (let i = 0; i < listens.length; i += LISTENBRAINZ_BATCH) {
    const batch = listens.slice(i, i + LISTENBRAINZ_BATCH);
    await submitToListenBrainz(
      token,
      batch.length === 1 ? 'single' : 'import',
      batch
    );
  }
};

export const listenBrainzNowPlaying = (
  token: string,
  listen: Listen
): Promise<void> => submitToListenBrainz(token, 'playing_now', [listen]);

// ---- Last.fm ------------------------------------------------------------------

export const LASTFM_URL = 'https://ws.audioscrobbler.com/2.0/';
/** track.scrobble takes at most 50 plays per call. */
export const LASTFM_BATCH = 50;

/** Last.fm error codes that mean "this session key is dead". */
const LASTFM_AUTH_ERRORS = new Set([4, 9, 10, 14, 26]);

/** api_sig: md5 of every parameter (sorted by name, name+value) followed by the shared secret. */
export const lastfmSignature = (
  params: Record<string, string>,
  sharedSecret: string
): string =>
  createHash('md5')
    .update(
      Object.keys(params)
        .filter((k) => k !== 'format' && k !== 'callback')
        .sort()
        .map((k) => `${k}${params[k]}`)
        .join('') + sharedSecret,
      'utf8'
    )
    .digest('hex');

const lastfmCall = async (
  method: string,
  sessionKey: string,
  params: Record<string, string>
): Promise<void> => {
  const { apiKey, sharedSecret } = getSettings().metadata.lastfm;
  const signed: Record<string, string> = {
    ...params,
    method,
    api_key: apiKey,
    sk: sessionKey,
  };
  signed.api_sig = lastfmSignature(signed, sharedSecret);
  signed.format = 'json';

  let data: { error?: number; message?: string } | undefined;
  try {
    const response = await client().post(
      LASTFM_URL,
      new URLSearchParams(signed).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: (status) => status < 500,
      }
    );
    data = response.data;
  } catch (e) {
    throw new Error(`Last.fm: ${e.message}`);
  }
  if (data?.error) {
    if (LASTFM_AUTH_ERRORS.has(Number(data.error))) {
      throw new ScrobbleAuthError(
        'Last.fm no longer accepts the link. Link Last.fm again in your profile settings.'
      );
    }
    throw new Error(`Last.fm: ${data.message ?? `error ${data.error}`}`);
  }
};

export const lastfmScrobbleParams = (listens: Listen[]): Record<string, string> => {
  const params: Record<string, string> = {};
  listens.forEach((listen, i) => {
    params[`artist[${i}]`] = listen.artist;
    params[`track[${i}]`] = listen.track;
    params[`timestamp[${i}]`] = String(
      Math.floor(listen.playedAt.getTime() / 1000)
    );
    if (listen.album) {
      params[`album[${i}]`] = listen.album;
    }
    if (listen.recordingMbid) {
      params[`mbid[${i}]`] = listen.recordingMbid;
    }
    if (listen.durationMs) {
      params[`duration[${i}]`] = String(Math.round(listen.durationMs / 1000));
    }
  });
  return params;
};

export const lastfmScrobble = async (
  sessionKey: string,
  listens: Listen[]
): Promise<void> => {
  for (let i = 0; i < listens.length; i += LASTFM_BATCH) {
    await lastfmCall(
      'track.scrobble',
      sessionKey,
      lastfmScrobbleParams(listens.slice(i, i + LASTFM_BATCH))
    );
  }
};

export const lastfmNowPlaying = (
  sessionKey: string,
  listen: Listen
): Promise<void> =>
  lastfmCall('track.updateNowPlaying', sessionKey, {
    artist: listen.artist,
    track: listen.track,
    ...(listen.album ? { album: listen.album } : {}),
    ...(listen.recordingMbid ? { mbid: listen.recordingMbid } : {}),
    ...(listen.durationMs
      ? { duration: String(Math.round(listen.durationMs / 1000)) }
      : {}),
  });
