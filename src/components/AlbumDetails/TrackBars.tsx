import StatusDot from '@app/components/Common/StatusDot';
import usePlayback, { toPlayable } from '@app/components/Playback';
import RequestButton from '@app/components/RequestButton';
import { toModalAlbum } from '@app/components/RequestModal/subject';
import type { PlayableTrack } from '@app/hooks/usePlayer';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { formatDuration } from '@app/utils/format';
import type { StatusTone } from '@app/utils/status';
import { statusMessages } from '@app/utils/status';
import { PlayIcon } from '@heroicons/react/24/outline';
import {
  MediaRequestStatus,
  MediaStatus,
  RequestScope,
} from '@server/constants/media';
import type { AlbumDetails, AlbumTrack } from '@server/models/music';
import { Fragment } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.AlbumDetails.TrackBars', {
  playnamed: 'Play {title}',
  youtube: 'YouTube',
  youtubenamed: 'Play {title} on YouTube',
  request: 'Request',
  disc: 'Disc {number}',
  nofile: 'No file',
});

const trackState = (
  track: AlbumTrack,
  downloading: boolean
): {
  tone: StatusTone;
  message: (typeof statusMessages)[keyof typeof statusMessages];
} => {
  if (track.status === MediaStatus.AVAILABLE) {
    return { tone: 'available', message: statusMessages.inlibrary };
  }
  if (track.requestStatus === MediaRequestStatus.PENDING) {
    return { tone: 'pending', message: statusMessages.waiting };
  }
  if (track.requestStatus === MediaRequestStatus.APPROVED) {
    return {
      tone: 'processing',
      message: downloading
        ? statusMessages.downloading
        : statusMessages.requested,
    };
  }
  return { tone: 'declined', message: statusMessages.missing };
};

interface TrackBarsProps {
  album: AlbumDetails;
  /** Whether a request already covers the missing tracks. */
  hasActiveRequest: boolean;
  /** Lidarr's queue holds that request right now. */
  downloading?: boolean;
}

/** The tracklist as a stack of bars: play, title, file, length, status, action. */
const TrackBars = ({
  album,
  hasActiveRequest,
  downloading = false,
}: TrackBarsProps) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { currentSettings } = useSettings();
  const { playTracks, playOnYoutube, youtubeEnabled } = usePlayback();

  const canRequestTracks =
    !!currentSettings.allowTrackRequests &&
    hasPermission([Permission.REQUEST, Permission.REQUEST_TRACK], {
      type: 'or',
    });

  const queue = album.tracks
    .map((track) => toPlayable(track, album))
    .filter((track): track is PlayableTrack => track !== null);

  return (
    <ol className="sh-ax-tracks">
      {album.tracks.map((track, index) => {
        const state = trackState(track, downloading);
        const canPlay = track.playable && !!track.id;
        const missing = track.status !== MediaStatus.AVAILABLE;
        const newDisc =
          album.discCount > 1 &&
          (index === 0 ||
            album.tracks[index - 1].discNumber !== track.discNumber);
        const onYoutube =
          !canPlay && youtubeEnabled && !!track.recordingMbid
            ? () =>
                playOnYoutube({
                  recordingMbid: track.recordingMbid as string,
                  title: track.title,
                  artist: track.artistCredit || album.artistName,
                  album: album.title,
                  albumMbid: album.mbid,
                  artistMbid: album.artistMbid,
                  durationMs: track.lengthMs,
                })
            : undefined;

        return (
          <Fragment key={`${track.position}-${index}`}>
            {newDisc && (
              <li className="disc">
                {intl.formatMessage(messages.disc, {
                  number: track.discNumber,
                })}
              </li>
            )}
            <li className={missing ? 'missing' : ''}>
              {canPlay ? (
                <button
                  type="button"
                  className="go"
                  aria-label={intl.formatMessage(messages.playnamed, {
                    title: track.title,
                  })}
                  onClick={() =>
                    playTracks(
                      queue,
                      Math.max(
                        0,
                        queue.findIndex((t) => t.id === track.id)
                      )
                    )
                  }
                >
                  <PlayIcon aria-hidden="true" />
                </button>
              ) : onYoutube ? (
                <button
                  type="button"
                  className="go"
                  aria-label={intl.formatMessage(messages.youtubenamed, {
                    title: track.title,
                  })}
                  onClick={onYoutube}
                >
                  <PlayIcon aria-hidden="true" />
                </button>
              ) : (
                <span className="go off" aria-hidden="true">
                  <PlayIcon />
                </span>
              )}
              <span className="num">
                {String(track.trackNumber).padStart(2, '0')}
              </span>
              <span className="what">
                <b>{track.title}</b>
                {track.artistCredit && <span>{track.artistCredit}</span>}
              </span>
              <span className="file">
                {track.fileFormat || intl.formatMessage(messages.nofile)}
              </span>
              <span className="len">{formatDuration(track.lengthMs)}</span>
              <span className="state">
                <StatusDot tone={state.tone}>
                  {intl.formatMessage(state.message)}
                </StatusDot>
              </span>
              <span className="act">
                {missing &&
                  !track.requestStatus &&
                  !hasActiveRequest &&
                  canRequestTracks && (
                    <RequestButton
                      album={toModalAlbum(album)}
                      defaultScope={RequestScope.TRACKS}
                    >
                      {intl.formatMessage(messages.request)}
                    </RequestButton>
                  )}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
};

export default TrackBars;
