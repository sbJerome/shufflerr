import Button from '@app/components/Common/Button';
import usePlayback from '@app/components/Playback';
import RequestButton from '@app/components/RequestButton';
import {
  hasActiveRequest,
  toModalAlbum,
} from '@app/components/RequestModal/subject';
import defineMessages from '@app/utils/defineMessages';
import { coverUrl } from '@app/utils/images';
import { MediaStatus, RequestScope } from '@server/constants/media';
import type {
  DiscoverFeaturedResponse,
  DiscoverStatsResponse,
} from '@server/interfaces/api/discoverInterfaces';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover.Hero', {
  featured: 'Featured release',
  fallbacktitle: 'Find it. Request it.',
  fallbacksub:
    'Search MusicBrainz, request an album or a whole discography, and Shufflerr hands it to Lidarr.',
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
  searchmusic: 'Search music',
  seerequests: 'See requests',
  statalbums: 'Albums in library',
  statartists: 'Artists',
  stattracks: 'Tracks',
  statdownloading: 'Downloading now',
});

/**
 * Full-bleed hero: the featured release over its own blurred artwork, with the
 * library numbers along the bottom edge. Falls back to a plain welcome when
 * there is nothing real to feature.
 */
const Hero = () => {
  const intl = useIntl();
  const { playAlbum } = usePlayback();
  const { data } = useSWR<DiscoverFeaturedResponse>(
    '/api/v1/discover/featured'
  );
  const { data: stats } = useSWR<DiscoverStatsResponse>(
    '/api/v1/discover/stats'
  );
  const [artFailed, setArtFailed] = useState(false);

  const album = data?.album ?? null;
  const art = album
    ? (album.artistImageUrl ?? album.coverUrl ?? coverUrl(album.mbid, 500))
    : null;

  useEffect(() => setArtFailed(false), [art]);

  const stat = (value?: number) =>
    value == null ? '–' : intl.formatNumber(value);

  const total = album?.trackCount ?? album?.mediaInfo?.trackCount ?? 0;
  const have = album?.tracksAvailable ?? album?.mediaInfo?.tracksAvailable ?? 0;
  const complete = album?.status === MediaStatus.AVAILABLE;
  const active = album ? hasActiveRequest(album) : false;
  const partial = !complete && have > 0;
  const year = album?.year ?? album?.firstReleaseDate?.slice(0, 4);

  const blurb = !album
    ? intl.formatMessage(messages.fallbacksub)
    : complete
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
    <section className="sh-dx-hero" aria-labelledby="discover-hero">
      {art && !artFailed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="art"
          src={art}
          alt=""
          aria-hidden="true"
          onError={() => setArtFailed(true)}
        />
      )}
      <div className="veil" aria-hidden="true" />
      <div className="copy">
        {album && (
          <span className="kicker">
            {intl.formatMessage(messages.featured)}
          </span>
        )}
        <h1 id="discover-hero">
          {album ? album.title : intl.formatMessage(messages.fallbacktitle)}
        </h1>
        {album && (
          <p className="by">
            <Link href={`/artist/${album.artistMbid}`}>{album.artistName}</Link>
            {year ? `, ${year}` : ''}
          </p>
        )}
        <p className="blurb">{blurb}</p>
        <div className="cta">
          {album ? (
            <>
              {album.firstPlayableTrackId != null && (
                <Button
                  buttonType="primary"
                  type="button"
                  onClick={() =>
                    playAlbum(album.mbid, album.firstPlayableTrackId)
                  }
                >
                  {intl.formatMessage(messages.play)}
                </Button>
              )}
              {!complete && !active && (
                <RequestButton
                  album={toModalAlbum(album)}
                  defaultScope={
                    partial ? RequestScope.TRACKS : RequestScope.ALBUM
                  }
                  buttonType={
                    album.firstPlayableTrackId != null ? 'default' : 'primary'
                  }
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
            </>
          ) : (
            <>
              <Link href="/search" className="sh-btn primary">
                {intl.formatMessage(messages.searchmusic)}
              </Link>
              <Link href="/requests" className="sh-btn">
                {intl.formatMessage(messages.seerequests)}
              </Link>
            </>
          )}
        </div>
      </div>
      <dl className="stats">
        <div>
          <dd>{stat(stats?.albums)}</dd>
          <dt>{intl.formatMessage(messages.statalbums)}</dt>
        </div>
        <div>
          <dd>{stat(stats?.artists)}</dd>
          <dt>{intl.formatMessage(messages.statartists)}</dt>
        </div>
        <div>
          <dd>{stat(stats?.tracks)}</dd>
          <dt>{intl.formatMessage(messages.stattracks)}</dt>
        </div>
        <div>
          <dd className="text-st-processing">{stat(stats?.downloading)}</dd>
          <dt>{intl.formatMessage(messages.statdownloading)}</dt>
        </div>
      </dl>
    </section>
  );
};

export default Hero;
