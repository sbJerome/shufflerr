import defineMessages from '@app/utils/defineMessages';
import { RequestScope } from '@server/constants/media';
import type { RequestResult } from '@server/interfaces/api/requestInterfaces';
import type { IntlShape } from 'react-intl';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.UserProfile.RequestTitle', {
  tracks:
    '{title} ({count, plural, one {# missing track} other {# missing tracks}})',
  discography:
    'Everything by {artist} ({count, plural, one {# release} other {# releases}})',
  discographyPlain: 'Everything by {artist}',
  scopeTracks: 'tracks',
  scopeAlbum: 'album',
  scopeDiscography: 'discography',
});

/** Same wording as the Requests page: "<Album> (4 missing tracks)", "Everything by <Artist> (8 releases)". */
export const requestTitle = (intl: IntlShape, r: RequestResult): string => {
  const title = r.media?.title ?? '';
  if (r.scope === RequestScope.TRACKS && r.trackCount) {
    return intl.formatMessage(messages.tracks, { title, count: r.trackCount });
  }
  if (r.scope === RequestScope.DISCOGRAPHY) {
    const artist = r.media?.artistName || title;
    return r.releaseCount
      ? intl.formatMessage(messages.discography, {
          artist,
          count: r.releaseCount,
        })
      : intl.formatMessage(messages.discographyPlain, { artist });
  }
  return title;
};

export const scopeLabel = (intl: IntlShape, r: RequestResult): string =>
  intl.formatMessage(
    r.scope === RequestScope.TRACKS
      ? messages.scopeTracks
      : r.scope === RequestScope.DISCOGRAPHY
        ? messages.scopeDiscography
        : messages.scopeAlbum
  );

const RequestTitle = ({ request }: { request: RequestResult }) => {
  const intl = useIntl();
  return <>{requestTitle(intl, request)}</>;
};

export default RequestTitle;
