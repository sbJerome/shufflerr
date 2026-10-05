import EmptyState from '@app/components/Common/EmptyState';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import Link from 'next/link';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Library.NoLibrary', {
  nosource: 'No music library is connected yet.',
  nosourceadmin:
    'Connect Plex, Jellyfin, Navidrome or a local folder so Shufflerr can see what you already have.',
  nosourceuser:
    'An admin needs to connect a music library in Settings before anything shows up here.',
  opensettings: 'Open settings',
  empty: 'Nothing is in the library yet.',
  emptyhint:
    'Albums show up here after the next library scan. Search for music to request something in the meantime.',
  searchmusic: 'Search music',
  nomatch: 'Nothing in the library matches “{query}”.',
  nomatchhint: 'Check the spelling, or clear the filter to see everything.',
  nofilter: 'Nothing in the library has this status. Try another filter.',
});

interface NoLibraryProps {
  /** The text filter in use, if any. */
  query?: string;
  /** A status filter other than "all" is in use. */
  filtered?: boolean;
}

/** Empty state for the Artists and Albums pages, with the right next step. */
const NoLibrary = ({ query, filtered }: NoLibraryProps) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { currentSettings } = useSettings();
  const integrations = currentSettings.integrations;

  if (query) {
    return (
      <EmptyState title={intl.formatMessage(messages.nomatch, { query })}>
        {intl.formatMessage(messages.nomatchhint)}
      </EmptyState>
    );
  }
  if (filtered) {
    return <EmptyState title={intl.formatMessage(messages.nofilter)} />;
  }

  const hasSource =
    !!integrations &&
    (integrations.plex ||
      integrations.jellyfin ||
      integrations.navidrome ||
      integrations.localFiles);

  if (!hasSource) {
    const admin = hasPermission(Permission.MANAGE_SETTINGS);
    return (
      <EmptyState
        title={intl.formatMessage(messages.nosource)}
        action={
          admin ? (
            <Link href="/settings/plex" className="sh-btn small">
              {intl.formatMessage(messages.opensettings)}
            </Link>
          ) : undefined
        }
      >
        {intl.formatMessage(
          admin ? messages.nosourceadmin : messages.nosourceuser
        )}
      </EmptyState>
    );
  }

  return (
    <EmptyState
      title={intl.formatMessage(messages.empty)}
      action={
        <Link href="/search" className="sh-btn small">
          {intl.formatMessage(messages.searchmusic)}
        </Link>
      }
    >
      {intl.formatMessage(messages.emptyhint)}
    </EmptyState>
  );
};

export default NoLibrary;
