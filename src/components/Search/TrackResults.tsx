import Button from '@app/components/Common/Button';
import usePlayback from '@app/components/Playback';
import RequestButton from '@app/components/RequestButton';
import StatusBadge from '@app/components/StatusBadge';
import defineMessages from '@app/utils/defineMessages';
import { formatDuration } from '@app/utils/format';
import { MediaStatus } from '@server/constants/media';
import type { TrackResult } from '@server/models/music';
import Link from 'next/link';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Search.TrackResults', {
  colnumber: '#',
  coltitle: 'Title',
  colalbum: 'Album',
  collength: 'Length',
  colstatus: 'Status',
  colactions: 'Actions',
  play: 'Play',
  playnamed: 'Play {title}',
  request: 'Request',
  requestnamed: 'Request {album}',
  youtube: 'Play on YouTube',
  youtubenamed: 'Play {title} on YouTube',
});

const COLUMNS =
  '44px minmax(220px,2fr) minmax(140px,1fr) 64px 170px minmax(110px,auto)';

interface TrackResultsProps {
  tracks: TrackResult[];
}

/** The Tracks table on the search page. */
const TrackResults = ({ tracks }: TrackResultsProps) => {
  const intl = useIntl();
  const { playTracks, playOnYoutube, youtubeEnabled } = usePlayback();

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
            {intl.formatMessage(messages.colalbum)}
          </span>
          <span role="columnheader">
            {intl.formatMessage(messages.collength)}
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
        {tracks.map((track, index) => {
          const canPlay = track.playable && !!track.trackId;
          const album = track.album;
          return (
            <div
              className={`sh-tr ${canPlay ? '' : 'missing'}`}
              role="row"
              key={`${track.recordingMbid}-${index}`}
              style={{ gridTemplateColumns: COLUMNS }}
            >
              <span role="cell" className="num">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span role="cell" className="min-w-0">
                <span className="sh-title">{track.title}</span>
                <br />
                {track.artistMbid ? (
                  <Link
                    href={`/artist/${track.artistMbid}`}
                    className="sh-feat"
                  >
                    {track.artistName}
                  </Link>
                ) : (
                  <span className="sh-feat">{track.artistName}</span>
                )}
              </span>
              <span role="cell" className="min-w-0 truncate">
                {album && <Link href={`/album/${album.mbid}`}>{album.title}</Link>}
              </span>
              <span role="cell" className="num">
                {formatDuration(track.lengthMs)}
              </span>
              <span role="cell">
                <StatusBadge status={track.status} />
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
                        [
                          {
                            id: track.trackId as number,
                            title: track.title,
                            artist: track.artistName,
                            album: album?.title,
                            albumMbid: album?.mbid,
                            artistMbid: track.artistMbid,
                            recordingMbid: track.recordingMbid,
                            durationMs: track.lengthMs ?? undefined,
                          },
                        ],
                        0
                      )
                    }
                  >
                    {intl.formatMessage(messages.play)}
                  </Button>
                ) : (
                  <>
                    {youtubeEnabled && (
                      <Button
                        buttonSize="sm"
                        aria-label={intl.formatMessage(messages.youtubenamed, {
                          title: track.title,
                        })}
                        onClick={() =>
                          playOnYoutube({
                            recordingMbid: track.recordingMbid,
                            title: track.title,
                            artist: track.artistName,
                            album: album?.title,
                            albumMbid: album?.mbid,
                            artistMbid: track.artistMbid,
                            durationMs: track.lengthMs,
                          })
                        }
                      >
                        {intl.formatMessage(messages.youtube)}
                      </Button>
                    )}
                    {album && track.status === MediaStatus.UNKNOWN && (
                      <RequestButton
                        album={{
                          mbid: album.mbid,
                          title: album.title,
                          artistName: track.artistName,
                          artistMbid: track.artistMbid,
                          year: album.year,
                          coverUrl: album.coverUrl,
                        }}
                      />
                    )}
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TrackResults;
