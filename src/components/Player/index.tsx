import CoverArt from '@app/components/CoverArt';
import Waveform from '@app/components/Player/Waveform';
import { usePlayer } from '@app/context/PlayerContext';
import defineMessages from '@app/utils/defineMessages';
import { formatSeconds } from '@app/utils/format';
import { coverUrl } from '@app/utils/images';
import type { TrackPeaksResponse } from '@server/interfaces/api/playbackInterfaces';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Player', {
  player: 'Player',
  previous: 'Previous track',
  next: 'Next track',
  play: 'Play',
  pause: 'Pause',
  seek: 'Seek',
  seekvalue: '{position} of {duration}',
  nothing: 'Nothing playing. Pick a track from your library to start.',
  streamingfrom: 'Streaming from {source}',
  playingon: 'Playing on YouTube',
  scrobblingto: ', scrobbling to {targets}',
  youtubecaption: 'Playing in YouTube’s player. Nothing is downloaded.',
  sourcelocal: 'your library',
  and: '{a} and {b}',
});

const SOURCE_NAMES: Record<string, string> = {
  plex: 'Plex',
  jellyfin: 'Jellyfin',
  navidrome: 'Navidrome',
};

interface PlayerProps {
  /** Names of scrobble targets the signed-in user has linked and enabled, e.g. ['ListenBrainz', 'Last.fm']. */
  scrobbleTargets?: string[];
}

/** Docked player bar (fixed bottom, 76px). Rendered once by the app shell. */
const Player = ({ scrobbleTargets = [] }: PlayerProps) => {
  const intl = useIntl();
  const {
    current,
    playing,
    position,
    duration,
    toggle,
    next,
    prev,
    seekTo,
    hasNext,
    hasPrev,
    error,
    youtubeHostRef,
  } = usePlayer();

  // Peaks come with the track when the page already has them; otherwise fetch once.
  const { data: fetchedPeaks } = useSWR<TrackPeaksResponse>(
    current && current.id && !current.peaks && !current.youtubeVideoId
      ? `/api/v1/stream/track/${current.id}/peaks`
      : null,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const peaks = current?.peaks ?? fetchedPeaks?.peaks;

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const isYouTube = !!current?.youtubeVideoId;

  let sourceLine = '';
  if (current) {
    sourceLine = isYouTube
      ? intl.formatMessage(messages.playingon)
      : intl.formatMessage(messages.streamingfrom, {
          source:
            SOURCE_NAMES[current.source ?? ''] ??
            intl.formatMessage(messages.sourcelocal),
        });
    if (scrobbleTargets.length) {
      sourceLine += intl.formatMessage(messages.scrobblingto, {
        targets:
          scrobbleTargets.length === 2
            ? intl.formatMessage(messages.and, {
                a: scrobbleTargets[0],
                b: scrobbleTargets[1],
              })
            : scrobbleTargets.join(', '),
      });
    }
  }

  return (
    <>
      {/* YouTube's own player, always visible while it plays (API terms). */}
      <div className="sh-yt" hidden={!isYouTube}>
        <div className="frame" ref={youtubeHostRef} />
        <div className="cap">{intl.formatMessage(messages.youtubecaption)}</div>
      </div>
      <div
        className="sh-player"
        role="region"
        aria-label={intl.formatMessage(messages.player)}
      >
        <div className="ctrls">
          <button
            className="sh-icon-btn"
            type="button"
            aria-label={intl.formatMessage(messages.previous)}
            disabled={!hasPrev}
            onClick={prev}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M19 20 9 12l10-8z" />
              <path d="M5 19V5" />
            </svg>
          </button>
          <button
            className="play"
            type="button"
            aria-label={intl.formatMessage(
              playing ? messages.pause : messages.play
            )}
            disabled={!current}
            onClick={toggle}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              {playing ? (
                <path d="M7 4h4v16H7zM13 4h4v16h-4z" />
              ) : (
                <path d="M7 4v16l13-8z" />
              )}
            </svg>
          </button>
          <button
            className="sh-icon-btn"
            type="button"
            aria-label={intl.formatMessage(messages.next)}
            disabled={!hasNext}
            onClick={next}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m5 4 10 8-10 8z" />
              <path d="M19 5v14" />
            </svg>
          </button>
        </div>
        {current ? (
          <>
            <div className="now">
              <CoverArt
                thumb
                decorative
                mbid={current.albumMbid ?? current.title}
                src={current.albumMbid ? coverUrl(current.albumMbid) : null}
                title={current.album ?? current.title}
              />
              <div className="txt">
                <b>{current.title}</b>
                <span>{current.artist}</span>
              </div>
            </div>
            <Waveform
              peaks={peaks}
              progress={progress}
              disabled={!duration}
              onSeek={seekTo}
              label={intl.formatMessage(messages.seek)}
              valueText={intl.formatMessage(messages.seekvalue, {
                position: formatSeconds(position),
                duration: formatSeconds(duration),
              })}
            />
            <span className="time">
              {formatSeconds(position)} / {formatSeconds(duration || null)}
            </span>
            <span className="src" role={error ? 'alert' : undefined}>
              {error ?? sourceLine}
            </span>
          </>
        ) : (
          <span className="empty">{intl.formatMessage(messages.nothing)}</span>
        )}
      </div>
    </>
  );
};

export default Player;
