import Button from '@app/components/Common/Button';
import StatusDot from '@app/components/Common/StatusDot';
import usePlayback, { toPlayable } from '@app/components/Playback';
import type { PlayableTrack } from '@app/hooks/usePlayer';
import defineMessages from '@app/utils/defineMessages';
import { formatDuration } from '@app/utils/format';
import type { StatusTone } from '@app/utils/status';
import { statusMessages } from '@app/utils/status';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { AlbumDetails, AlbumTrack } from '@server/models/music';
import { Fragment } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.AlbumDetails.Tracklist', {
  colnumber: '#',
  coltitle: 'Title',
  collength: 'Length',
  colfile: 'File',
  colstatus: 'Status',
  colactions: 'Actions',
  none: 'None',
  play: 'Play',
  playnamed: 'Play {title}',
  youtube: 'YouTube',
  youtubenamed: 'Play {title} on YouTube',
  disc: 'Disc {number}',
});

const COLUMNS = '44px minmax(240px,3fr) 64px 130px 170px minmax(100px,auto)';

const trackState = (
  track: AlbumTrack
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
    return { tone: 'processing', message: statusMessages.downloading };
  }
  return { tone: 'declined', message: statusMessages.missing };
};

interface TracklistProps {
  album: AlbumDetails;
}

const Tracklist = ({ album }: TracklistProps) => {
  const intl = useIntl();
  const { playTracks, playOnYoutube, youtubeEnabled } = usePlayback();

  const queue = album.tracks
    .map((track) => toPlayable(track, album))
    .filter((track): track is PlayableTrack => track !== null);

  return (
    <div className="sh-box sh-scroll-x">
      <div className="sh-table" role="table">
        <div
          className="sh-tr head"
          role="row"
          style={{ gridTemplateColumns: COLUMNS }}
        >
          <span role="columnheader">
            {intl.formatMessage(messages.colnumber)}
          </span>
          <span role="columnheader">
            {intl.formatMessage(messages.coltitle)}
          </span>
          <span role="columnheader">
            {intl.formatMessage(messages.collength)}
          </span>
          <span role="columnheader">
            {intl.formatMessage(messages.colfile)}
          </span>
          <span role="columnheader">
            {intl.formatMessage(messages.colstatus)}
          </span>
          <span role="columnheader">
            <span className="sr-only">
              {intl.formatMessage(messages.colactions)}
            </span>
          </span>
        </div>
        {album.tracks.map((track, index) => {
          const state = trackState(track);
          const canPlay = track.playable && !!track.id;
          const newDisc =
            album.discCount > 1 &&
            (index === 0 ||
              album.tracks[index - 1].discNumber !== track.discNumber);
          return (
            <Fragment key={`${track.position}-${index}`}>
              {newDisc && (
                <div
                  className="sh-tr head"
                  role="row"
                  style={{ gridTemplateColumns: '1fr' }}
                >
                  <span role="cell">
                    {intl.formatMessage(messages.disc, {
                      number: track.discNumber,
                    })}
                  </span>
                </div>
              )}
              <div
                className={`sh-tr ${
                  track.status === MediaStatus.AVAILABLE ? '' : 'missing'
                }`}
                role="row"
                style={{ gridTemplateColumns: COLUMNS }}
              >
                <span role="cell" className="num">
                  {String(track.trackNumber).padStart(2, '0')}
                </span>
                <span role="cell" className="min-w-0">
                  <span className="sh-title">{track.title}</span>
                  <br />
                  <span className="sh-feat">{track.artistCredit}</span>
                </span>
                <span role="cell" className="num">
                  {formatDuration(track.lengthMs)}
                </span>
                <span role="cell" className="num !text-xs">
                  {track.fileFormat || intl.formatMessage(messages.none)}
                </span>
                <span role="cell">
                  <StatusDot tone={state.tone}>
                    {intl.formatMessage(state.message)}
                  </StatusDot>
                </span>
                <span role="cell" className="actions">
                  {canPlay ? (
                    <Button
                      buttonSize="sm"
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
                      {intl.formatMessage(messages.play)}
                    </Button>
                  ) : (
                    youtubeEnabled &&
                    track.recordingMbid && (
                      <Button
                        buttonSize="sm"
                        aria-label={intl.formatMessage(messages.youtubenamed, {
                          title: track.title,
                        })}
                        onClick={() =>
                          playOnYoutube({
                            recordingMbid: track.recordingMbid as string,
                            title: track.title,
                            artist: track.artistCredit || album.artistName,
                            album: album.title,
                            albumMbid: album.mbid,
                            artistMbid: album.artistMbid,
                            durationMs: track.lengthMs,
                          })
                        }
                      >
                        {intl.formatMessage(messages.youtube)}
                      </Button>
                    )
                  )}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default Tracklist;
