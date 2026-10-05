import axios from 'axios';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type PlaySource =
  | 'local'
  | 'plex'
  | 'jellyfin'
  | 'navidrome'
  | 'youtube';

export interface PlayableTrack {
  /** Shufflerr Track id. Streams from `/api/v1/stream/track/<id>`. Use 0 for YouTube-only tracks. */
  id: number;
  title: string;
  /** Artist credit, e.g. "John Summit, Devault, Julia Church". */
  artist: string;
  album?: string;
  /** Release-group MBID — used for the cover in the player bar. */
  albumMbid?: string;
  artistMbid?: string;
  recordingMbid?: string;
  durationMs?: number;
  /**
   * Waveform peaks, 0–1 or 0–255, any length (resampled to 96 bars). When
   * omitted the player fetches `/api/v1/stream/track/<id>/peaks` itself.
   */
  peaks?: number[];
  /** Override the audio URL (defaults to `/api/v1/stream/track/<id>`). */
  streamUrl?: string;
  /** Where the audio comes from; shown as "Streaming from …". */
  source?: PlaySource;
  /** When set, the track plays in YouTube's own IFrame player. */
  youtubeVideoId?: string;
}

interface PlayerState {
  queue: PlayableTrack[];
  index: number;
  current?: PlayableTrack;
  playing: boolean;
  /** Seconds. */
  position: number;
  /** Seconds (from the media element, falling back to track metadata). */
  duration: number;
  volume: number;
  error?: string;
}

interface PlayerApi extends PlayerState {
  /** Replace the queue and start playing at `startIndex`. */
  playTracks: (tracks: PlayableTrack[], startIndex?: number) => void;
  /** Append to the queue without interrupting playback. */
  enqueue: (tracks: PlayableTrack[]) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  /** Seek to a fraction (0–1) of the current track. */
  seekTo: (fraction: number) => void;
  setVolume: (volume: number) => void;
  /** Stop and clear the queue (used on sign-out). */
  stop: () => void;
  hasNext: boolean;
  hasPrev: boolean;
  /** Mount point for YouTube's IFrame player (rendered by the Player bar). */
  youtubeHostRef: React.RefObject<HTMLDivElement | null>;
}

const PlayerContext = createContext<PlayerApi | null>(null);

/* ---- minimal typings for the official YouTube IFrame Player API ---- */
interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  setVolume: (volume: number) => void;
  loadVideoById: (videoId: string) => void;
  destroy: () => void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    }
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTNamespace> | null = null;
const loadYouTubeApi = (): Promise<YTNamespace> => {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  if (!ytApiPromise) {
    ytApiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        if (window.YT) resolve(window.YT);
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        ytApiPromise = null;
        reject(new Error('YouTube player could not be loaded.'));
      };
      document.head.appendChild(script);
    });
  }
  return ytApiPromise;
};

const VOLUME_KEY = 'shufflerr-volume';

export const PlayerProvider = ({ children }: { children: React.ReactNode }) => {
  const [queue, setQueue] = useState<PlayableTrack[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [error, setError] = useState<string>();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytRef = useRef<YTPlayer | null>(null);
  const youtubeHostRef = useRef<HTMLDivElement | null>(null);
  const queueRef = useRef<PlayableTrack[]>([]);
  const indexRef = useRef(-1);
  // play accounting for scrobbles
  const playedMsRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const reportedRef = useRef(true);

  queueRef.current = queue;
  indexRef.current = index;

  const current = index >= 0 ? queue[index] : undefined;

  /** Tell the server what was played; it applies the scrobble rule. */
  const reportPlay = useCallback(() => {
    const track = queueRef.current[indexRef.current];
    if (!track || reportedRef.current || playedMsRef.current < 1000) {
      return;
    }
    reportedRef.current = true;
    if (!track.id) {
      return; // YouTube-only plays have no library track to scrobble against
    }
    axios
      .post('/api/v1/scrobble', {
        trackId: track.id,
        startedAt: startedAtRef.current ?? Date.now(),
        playedSeconds: Math.round(playedMsRef.current / 1000),
      })
      .catch(() => undefined);
  }, []);

  const accountTick = useCallback((isPlaying: boolean) => {
    const now = performance.now();
    if (isPlaying && lastTickRef.current != null) {
      const delta = now - lastTickRef.current;
      // ignore gaps from seeking, sleeping tabs or stalls
      if (delta > 0 && delta < 2000) {
        playedMsRef.current += delta;
      }
    }
    lastTickRef.current = isPlaying ? now : null;
  }, []);

  const goTo = useCallback(
    (nextIndex: number, list?: PlayableTrack[]) => {
      reportPlay();
      const q = list ?? queueRef.current;
      if (nextIndex < 0 || nextIndex >= q.length) {
        setPlaying(false);
        return;
      }
      playedMsRef.current = 0;
      lastTickRef.current = null;
      startedAtRef.current = Date.now();
      reportedRef.current = false;
      setError(undefined);
      setPosition(0);
      setDuration((q[nextIndex].durationMs ?? 0) / 1000);
      if (list) setQueue(list);
      setIndex(nextIndex);
      setPlaying(true);
    },
    [reportPlay]
  );

  const next = useCallback(() => goTo(indexRef.current + 1), [goTo]);

  const prev = useCallback(() => {
    const audio = audioRef.current;
    const pos = ytRef.current
      ? ytRef.current.getCurrentTime()
      : (audio?.currentTime ?? 0);
    if (pos > 3 || indexRef.current === 0) {
      if (ytRef.current) ytRef.current.seekTo(0, true);
      else if (audio) audio.currentTime = 0;
      setPosition(0);
      return;
    }
    goTo(indexRef.current - 1);
  }, [goTo]);

  // audio element (created once, client only)
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audioRef.current = audio;
    try {
      const saved = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '');
      if (saved >= 0 && saved <= 1) {
        audio.volume = saved;
        setVolumeState(saved);
      }
    } catch {
      // keep default volume
    }

    const onTime = () => {
      accountTick(!audio.paused);
      setPosition(audio.currentTime);
    };
    const onMeta = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };
    const onPlay = () => {
      lastTickRef.current = performance.now();
      setPlaying(true);
    };
    const onPause = () => {
      accountTick(false);
      if (!audio.ended) setPlaying(false);
    };
    const onEnded = () => {
      accountTick(false);
      goTo(indexRef.current + 1);
    };
    const onError = () => {
      if (!audio.src) return;
      setPlaying(false);
      setError("This track couldn't be played. The file may have moved.");
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    const onUnload = () => reportPlay();
    window.addEventListener('pagehide', onUnload);

    return () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      window.removeEventListener('pagehide', onUnload);
      audioRef.current = null;
    };
  }, [accountTick, goTo, reportPlay]);

  // load the current track into the right engine
  const currentKey = current
    ? `${index}:${current.id}:${current.youtubeVideoId ?? ''}`
    : '';
  useEffect(() => {
    const audio = audioRef.current;
    const track = queueRef.current[indexRef.current];
    if (!audio) return;

    const destroyYt = () => {
      if (ytRef.current) {
        try {
          ytRef.current.destroy();
        } catch {
          // already gone
        }
        ytRef.current = null;
      }
    };

    if (!track) {
      audio.pause();
      audio.removeAttribute('src');
      destroyYt();
      return;
    }

    if (track.id) {
      axios
        .post('/api/v1/scrobble/now-playing', {
          trackId: track.id,
          startedAt: startedAtRef.current ?? Date.now(),
        })
        .catch(() => undefined);
    }

    if (track.youtubeVideoId) {
      audio.pause();
      audio.removeAttribute('src');
      let cancelled = false;
      let poll: ReturnType<typeof setInterval> | undefined;
      loadYouTubeApi()
        .then((YT) => {
          if (cancelled || !youtubeHostRef.current) return;
          destroyYt();
          const mount = document.createElement('div');
          youtubeHostRef.current.replaceChildren(mount);
          ytRef.current = new YT.Player(mount, {
            videoId: track.youtubeVideoId as string,
            width: '100%',
            height: '100%',
            playerVars: { autoplay: 1, playsinline: 1, rel: 0 },
            events: {
              onReady: (e) => {
                e.target.setVolume(Math.round((audio.volume ?? 1) * 100));
                e.target.playVideo();
              },
              onStateChange: (e) => {
                // 0 ended, 1 playing, 2 paused
                if (e.data === 1) {
                  lastTickRef.current = performance.now();
                  setPlaying(true);
                } else if (e.data === 2) {
                  accountTick(false);
                  setPlaying(false);
                } else if (e.data === 0) {
                  accountTick(false);
                  goTo(indexRef.current + 1);
                }
              },
              onError: () => {
                setPlaying(false);
                setError("YouTube couldn't play this video.");
              },
            },
          });
          poll = setInterval(() => {
            const p = ytRef.current;
            if (!p?.getCurrentTime) return;
            const d = p.getDuration();
            if (d > 0) setDuration(d);
            setPosition(p.getCurrentTime());
            accountTick(true);
          }, 500);
        })
        .catch((e: Error) => {
          setPlaying(false);
          setError(e.message);
        });
      return () => {
        cancelled = true;
        if (poll) clearInterval(poll);
      };
    }

    destroyYt();
    youtubeHostRef.current?.replaceChildren();
    audio.src = track.streamUrl ?? `/api/v1/stream/track/${track.id}`;
    audio.play().catch(() => setPlaying(false));
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  // OS media controls
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    if (!current) {
      navigator.mediaSession.metadata = null;
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album ?? '',
      artwork: current.albumMbid
        ? [
            {
              src: `/imageproxy/caa/release-group/${current.albumMbid}/front-500`,
              sizes: '500x500',
            },
          ]
        : [],
    });
  }, [current]);

  const play = useCallback(() => {
    if (indexRef.current < 0) return;
    if (ytRef.current) ytRef.current.playVideo();
    else audioRef.current?.play().catch(() => setPlaying(false));
  }, []);

  const pause = useCallback(() => {
    if (ytRef.current) ytRef.current.pauseVideo();
    else audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [playing, play, pause]);

  const seekTo = useCallback(
    (fraction: number) => {
      const f = Math.max(0, Math.min(1, fraction));
      if (!duration) return;
      const seconds = f * duration;
      lastTickRef.current = null;
      if (ytRef.current) ytRef.current.seekTo(seconds, true);
      else if (audioRef.current) audioRef.current.currentTime = seconds;
      setPosition(seconds);
    },
    [duration]
  );

  const setVolume = useCallback((v: number) => {
    const vol = Math.max(0, Math.min(1, v));
    if (audioRef.current) audioRef.current.volume = vol;
    ytRef.current?.setVolume(Math.round(vol * 100));
    setVolumeState(vol);
    try {
      localStorage.setItem(VOLUME_KEY, String(vol));
    } catch {
      // not persisted
    }
  }, []);

  const playTracks = useCallback(
    (tracks: PlayableTrack[], startIndex = 0) => {
      if (!tracks.length) return;
      goTo(Math.max(0, Math.min(startIndex, tracks.length - 1)), tracks);
    },
    [goTo]
  );

  const enqueue = useCallback(
    (tracks: PlayableTrack[]) => {
      if (!tracks.length) return;
      if (indexRef.current < 0) {
        goTo(0, tracks);
      } else {
        setQueue((q) => [...q, ...tracks]);
      }
    },
    [goTo]
  );

  const stop = useCallback(() => {
    reportPlay();
    audioRef.current?.pause();
    setQueue([]);
    setIndex(-1);
    setPlaying(false);
    setPosition(0);
    setDuration(0);
  }, [reportPlay]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', play);
    ms.setActionHandler('pause', pause);
    ms.setActionHandler('nexttrack', next);
    ms.setActionHandler('previoustrack', prev);
  }, [play, pause, next, prev]);

  const value = useMemo<PlayerApi>(
    () => ({
      queue,
      index,
      current,
      playing,
      position,
      duration,
      volume,
      error,
      playTracks,
      enqueue,
      toggle,
      play,
      pause,
      next,
      prev,
      seekTo,
      setVolume,
      stop,
      hasNext: index >= 0 && index < queue.length - 1,
      hasPrev: index >= 0,
      youtubeHostRef,
    }),
    [
      queue,
      index,
      current,
      playing,
      position,
      duration,
      volume,
      error,
      playTracks,
      enqueue,
      toggle,
      play,
      pause,
      next,
      prev,
      seekTo,
      setVolume,
      stop,
    ]
  );

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
};

/** Player state and controls. Must be used inside the app shell. */
export const usePlayer = (): PlayerApi => {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error('usePlayer must be used inside <PlayerProvider>.');
  }
  return ctx;
};
