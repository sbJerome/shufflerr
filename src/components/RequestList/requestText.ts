/** Display helpers shared by every place a request is listed. */
import defineMessages from '@app/utils/defineMessages';
import { MediaType, RequestScope } from '@server/constants/media';
import type { RequestResult } from '@server/interfaces/api/requestInterfaces';
import type { IntlShape } from 'react-intl';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.RequestList.requestText', {
  titletracks:
    '{title} ({count, plural, one {# missing track} other {# missing tracks}})',
  titlediscography:
    'Everything by {artist} ({count, plural, one {# release} other {# releases}})',
  titlediscographynocount: 'Everything by {artist}',
  typealbum: 'Album',
  typetracks: 'Tracks',
  typediscography: 'Discography',
  justnow: 'just now',
});

type RequestLike = Pick<
  RequestResult,
  'scope' | 'media' | 'trackCount' | 'releaseCount'
>;

/** "3 h ago", "yesterday", "5 days ago". */
export const relativeTime = (intl: IntlShape, date: Date | string): string => {
  const then = new Date(date).getTime();
  if (!isFinite(then)) {
    return '';
  }
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) {
    return intl.formatMessage(messages.justnow);
  }
  if (minutes < 60) {
    return intl.formatRelativeTime(-minutes, 'minute', { style: 'short' });
  }
  if (minutes < 1440) {
    return intl.formatRelativeTime(-Math.round(minutes / 60), 'hour', {
      style: 'short',
    });
  }
  const days = Math.round(minutes / 1440);
  if (days < 30) {
    return intl.formatRelativeTime(-days, 'day', { numeric: 'auto' });
  }
  return intl.formatDate(date, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export const useRequestText = () => {
  const intl = useIntl();

  /** "CTRL ESCAPE (4 missing tracks)", "Everything by John Summit (8 releases)". */
  const title = (request: RequestLike): string => {
    const media = request.media;
    if (request.scope === RequestScope.TRACKS && request.trackCount) {
      return intl.formatMessage(messages.titletracks, {
        title: media?.title ?? '',
        count: request.trackCount,
      });
    }
    if (request.scope === RequestScope.DISCOGRAPHY) {
      const artist = media?.artistName || media?.title || '';
      return request.releaseCount
        ? intl.formatMessage(messages.titlediscography, {
            artist,
            count: request.releaseCount,
          })
        : intl.formatMessage(messages.titlediscographynocount, { artist });
    }
    return media?.title ?? '';
  };

  /** Plain name for toasts ("Approved CTRL ESCAPE. Sent to Lidarr."). */
  const shortTitle = (request: RequestLike): string =>
    request.scope === RequestScope.DISCOGRAPHY
      ? intl.formatMessage(messages.titlediscographynocount, {
          artist: request.media?.artistName || request.media?.title || '',
        })
      : (request.media?.title ?? '');

  const artistLine = (request: RequestLike): string =>
    request.media?.mediaType === MediaType.ARTIST
      ? ''
      : (request.media?.artistName ?? '');

  const typeLabel = (scope: RequestScope): string =>
    intl.formatMessage(
      scope === RequestScope.TRACKS
        ? messages.typetracks
        : scope === RequestScope.DISCOGRAPHY
          ? messages.typediscography
          : messages.typealbum
    );

  const href = (request: RequestLike): string => {
    const media = request.media;
    if (!media) {
      return '/requests';
    }
    return media.mediaType === MediaType.ARTIST
      ? `/artist/${media.mbid}`
      : `/album/${media.mbid}`;
  };

  return {
    title,
    shortTitle,
    artistLine,
    typeLabel,
    href,
    ago: (date: Date | string) => relativeTime(intl, date),
  };
};

export default useRequestText;
