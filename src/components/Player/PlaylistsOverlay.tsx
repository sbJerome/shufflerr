import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import SlideOver from '@app/components/Common/SlideOver';
import defineMessages from '@app/utils/defineMessages';
import type { PlaylistResult } from '@server/interfaces/api/playlistInterfaces';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Player.PlaylistsOverlay', {
  playlists: 'Playlists',
  manage: 'Manage playlists',
  trackcount: '{count, plural, one {# item} other {# items}}',
  empty: 'You have no playlists yet.',
  emptynext: 'Create one, then add albums and tracks from their pages.',
  loaderror: 'Shufflerr couldn’t load your playlists.',
});

type PlaylistsOverlayProps = {
  show: boolean;
  onClose: () => void;
};

/** Slide-over list of the viewer's playlists, opened from the player bar. */
const PlaylistsOverlay = ({ show, onClose }: PlaylistsOverlayProps) => {
  const intl = useIntl();
  // Only fetch while open so the player doesn't poll playlists in the background.
  const { data, error } = useSWR<PlaylistResult[]>(
    show ? '/api/v1/playlist' : null
  );

  return (
    <SlideOver
      show={show}
      onClose={onClose}
      title={intl.formatMessage(messages.playlists)}
    >
      <div className="sh-pl-overlay">
        {error ? (
          <p className="sh-pl-overlay-msg" role="alert">
            {intl.formatMessage(messages.loaderror)}
          </p>
        ) : !data ? (
          <LoadingSpinner />
        ) : data.length === 0 ? (
          <div className="sh-pl-overlay-empty">
            <p>{intl.formatMessage(messages.empty)}</p>
            <p className="text-muted">
              {intl.formatMessage(messages.emptynext)}
            </p>
          </div>
        ) : (
          <ul className="sh-pl-overlay-list">
            {data.map((playlist) => (
              <li key={playlist.id}>
                <Link href={`/playlist/${playlist.id}`} onClick={onClose}>
                  <span className="name">{playlist.name}</span>
                  <span className="count">
                    {intl.formatMessage(messages.trackcount, {
                      count: playlist.itemCount,
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link className="sh-btn small sh-pl-overlay-manage" href="/playlists" onClick={onClose}>
          {intl.formatMessage(messages.manage)}
        </Link>
      </div>
    </SlideOver>
  );
};

export default PlaylistsOverlay;
