import Button from '@app/components/Common/Button';
import usePlayback from '@app/components/Playback';
import RequestButton from '@app/components/RequestButton';
import {
  hasActiveRequest,
  toModalAlbum,
} from '@app/components/RequestModal/subject';
import defineMessages from '@app/utils/defineMessages';
import { UserIcon } from '@heroicons/react/24/outline';
import { MediaStatus, RequestScope } from '@server/constants/media';
import type { DiscoverFeaturedResponse } from '@server/interfaces/api/discoverInterfaces';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.DiscoverClassic.FeaturedRelease', {
  featured: 'Featured release',
  alltracks:
    '{total, plural, one {The one track is} other {All # tracks are}} in your library.',
  sometracks:
    '{have} of {total} tracks are already here. Request the other {missing} and Shufflerr sends them to Lidarr.',
  notracks:
    'Not in your library yet. Request it and Shufflerr sends it to Lidarr.',
  requested: 'This one has been requested. You’ll get a ping when it lands.',
  requestmissing: 'Request missing tracks',
  requestalbum: 'Request album',
  viewalbum: 'View album',
  play: 'Play from library',
});

/** The Featured release band on Discover. Hidden when there is nothing real to feature. */
const FeaturedRelease = () => {
  const intl = useIntl();
  const { playAlbum } = usePlayback();
  const { data } = useSWR<DiscoverFeaturedResponse>(
    '/api/v1/discover/featured'
  );
  const [photoFailed, setPhotoFailed] = useState(false);

  const album = data?.album;
  if (!album) {
    return null;
  }

  const total = album.trackCount ?? album.mediaInfo?.trackCount ?? 0;
  const have = album.tracksAvailable ?? album.mediaInfo?.tracksAvailable ?? 0;
  const complete = album.status === MediaStatus.AVAILABLE;
  const active = hasActiveRequest(album);
  const partial = !complete && have > 0;
  const year = album.year ?? album.firstReleaseDate?.slice(0, 4);

  const blurb = complete
    ? intl.formatMessage(messages.alltracks, { total: total || have })
    : active
      ? intl.formatMessage(messages.requested)
      : partial && total
        ? intl.formatMessage(messages.sometracks, {
            have,
            total,
            missing: total - have,
          })
        : intl.formatMessage(messages.notracks);

  return (
    <section className="sh-hero band" aria-labelledby="discover-featured">
      <div className="photo" aria-hidden="true">
        {album.artistImageUrl && !photoFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={album.artistImageUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setPhotoFailed(true)}
          />
        ) : (
          <UserIcon strokeWidth={1.5} />
        )}
      </div>
      <div className="scrim" />
      <div className="content">
        <span className="kicker">{intl.formatMessage(messages.featured)}</span>
        <h2
          id="discover-featured"
          className="font-bold"
          style={{
            fontSize: 'clamp(44px, 6vw, 76px)',
            letterSpacing: '-0.04em',
            lineHeight: 0.92,
          }}
        >
          {album.title}
        </h2>
        <div className="by">
          <Link href={`/artist/${album.artistMbid}`}>{album.artistName}</Link>
          {year ? `, ${year}` : ''}
        </div>
        <p className="blurb">{blurb}</p>
        <div className="mt-1 flex flex-wrap gap-3">
          {!complete && !active && (
            <RequestButton
              album={toModalAlbum(album)}
              defaultScope={partial ? RequestScope.TRACKS : RequestScope.ALBUM}
              buttonType="primary"
              buttonSize="default"
            >
              {intl.formatMessage(
                partial ? messages.requestmissing : messages.requestalbum
              )}
            </RequestButton>
          )}
          <Link href={`/album/${album.mbid}`} className="sh-btn">
            {intl.formatMessage(messages.viewalbum)}
          </Link>
          {album.firstPlayableTrackId != null && (
            <Button
              type="button"
              onClick={() => playAlbum(album.mbid, album.firstPlayableTrackId)}
            >
              {intl.formatMessage(messages.play)}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
};

export default FeaturedRelease;
