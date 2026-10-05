/** Web player + scrobbling + YouTube contract (streams SV3 and SV6). */

/** GET /stream/track/:trackId/peaks */
export interface TrackPeaksResponse {
  trackId: number;
  /** 0–255 amplitude per bar. Empty when no peaks exist (UI draws a flat bar). */
  peaks: number[];
}

/** GET /stream/track/:trackId/info — everything the player bar needs for one track. */
export interface TrackPlaybackInfo {
  trackId: number;
  title: string;
  artistCredit: string;
  albumTitle: string;
  albumMbid: string;
  artistMbid?: string | null;
  recordingMbid?: string | null;
  coverUrl: string | null;
  lengthMs?: number | null;
  fileFormat?: string | null;
  /** Where the audio comes from, for the "Streaming from …" line. */
  source: 'local' | 'plex' | 'jellyfin' | 'navidrome';
  streamUrl: string;
  hasPeaks: boolean;
}

/** POST /scrobble/now-playing and POST /scrobble (web player). */
export interface ScrobbleBody {
  trackId: number;
  /** Epoch ms when playback of this track started. */
  startedAt: number;
  /** Seconds actually listened (for POST /scrobble; the server applies the scrobble rule). */
  playedSeconds?: number;
}

export interface ScrobbleResponse {
  /** Whether the play was queued for scrobbling (false when the rule wasn't met or nothing is linked). */
  queued: boolean;
  targets: ('listenbrainz' | 'lastfm')[];
}

/** GET /scrobble/status — the player bar's "scrobbling to …" line for the viewer. */
export interface ScrobbleStatusResponse {
  enabled: boolean;
  targets: ('listenbrainz' | 'lastfm')[];
}

/** GET /youtube/track/:recordingMbid */
export interface YoutubeTrackResponse {
  enabled: boolean;
  videoId: string | null;
  title?: string;
  channel?: string;
}
