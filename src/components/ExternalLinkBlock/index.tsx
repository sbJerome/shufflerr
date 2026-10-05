// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import defineMessages from '@app/utils/defineMessages';
import type { ExternalLink } from '@server/models/music';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.ExternalLinkBlock', {
  openIn: 'Open in {name}',
  open: 'Open {name}',
  newTab: '(opens in a new tab)',
  official: 'Official site',
  other: 'Link',
});

const names: Partial<Record<ExternalLink['type'], string>> = {
  musicbrainz: 'MusicBrainz',
  lidarr: 'Lidarr',
  plex: 'Plex',
  jellyfin: 'Jellyfin',
  navidrome: 'Navidrome',
  lastfm: 'Last.fm',
  discogs: 'Discogs',
  spotify: 'Spotify',
  bandcamp: 'Bandcamp',
  apple: 'Apple Music',
};

interface ExternalLinkBlockProps {
  links: ExternalLink[];
  /** Limit to these link types, in this order. */
  only?: ExternalLink['type'][];
}

/** A row of "Open in …" links. Renders nothing when there are none. */
const ExternalLinkBlock = ({ links, only }: ExternalLinkBlockProps) => {
  const intl = useIntl();
  const shown = (
    only
      ? only.flatMap((type) => links.filter((link) => link.type === type))
      : links
  ).filter((link) => /^https?:\/\//i.test(link.url));

  if (shown.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {shown.map((link) => {
        const name = names[link.type];
        const text =
          link.label ??
          (name
            ? intl.formatMessage(messages.openIn, { name })
            : link.type === 'official'
              ? intl.formatMessage(messages.official)
              : intl.formatMessage(messages.other));
        return (
          <li key={`${link.type}:${link.url}`}>
            <a
              className="sh-btn small"
              href={link.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {text}
              <span className="sr-only">
                {' '}
                {intl.formatMessage(messages.newTab)}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
};

export default ExternalLinkBlock;
