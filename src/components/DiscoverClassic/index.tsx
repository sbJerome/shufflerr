// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import AlbumCard from '@app/components/AlbumCard';
import ArtistCard from '@app/components/ArtistCard';
import PageTitle from '@app/components/Common/PageTitle';
import CoverArt from '@app/components/CoverArt';
import FeaturedRelease from '@app/components/DiscoverClassic/FeaturedRelease';
import HorizontalRow from '@app/components/HorizontalRow';
import RequestButton from '@app/components/RequestButton';
import useRequestText from '@app/components/RequestList/requestText';
import {
  isRequestable,
  toModalAlbum,
} from '@app/components/RequestModal/subject';
import StatusBadge from '@app/components/StatusBadge';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { MediaType } from '@server/constants/media';
import type {
  DiscoverAlbumsResponse,
  DiscoverArtistsResponse,
  DiscoverConcertsResponse,
  DiscoverRecentRequestsResponse,
  DiscoverStatsResponse,
} from '@server/interfaces/api/discoverInterfaces';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.DiscoverClassic', {
  discover: 'Discover',
  heroline1: 'Find it. Request it.',
  heroline2: 'Hear it tonight.',
  blurb:
    'Search MusicBrainz, request an album or a whole discography, and Shufflerr hands it to Lidarr. You get a ping when it lands in the library.',
  searchmusic: 'Search music',
  seerequests: 'See requests',
  statalbums: 'Albums in library',
  statartists: 'Artists',
  stattracks: 'Tracks',
  statdownloading: 'Downloading now',
  recentlyadded: 'Recently added',
  recentlyaddedsub: 'The newest albums in your library',
  seeall: 'See all',
  trending: 'Trending new releases',
  trendingsub: 'New releases people are listening to this week',
  popularartists: 'Popular artists',
  popularartistssub: 'Most played and requested on this server',
  popularartistslb: 'Most listened to on ListenBrainz right now',
  artistalbums:
    '{count, plural, one {# album in library} other {# albums in library}}',
  concerts: 'Concerts for artists you have',
  concertsfrom: 'From {providers}',
  tickets: 'Tickets',
  ticketsfor: 'Tickets for {artist} on {provider}',
  recentrequests: 'Recent requests',
  yourrecentrequests: 'Your recent requests',
  everyone: 'Everyone on this server',
  onlyyou: 'Only you can see these',
  allrequests: 'All requests',
  norequests:
    'You haven’t requested anything yet. Search for an album to start.',
  norequestsall: 'Nobody has requested anything yet.',
});

const PROVIDER_NAME: Record<string, string> = {
  ticketmaster: 'Ticketmaster',
  skiddle: 'Skiddle',
};

const DiscoverClassic = () => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { currentSettings } = useSettings();
  const text = useRequestText();

  const canRequestAlbums = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_ALBUM],
    { type: 'or' }
  );

  const { data: stats } = useSWR<DiscoverStatsResponse>(
    '/api/v1/discover/stats'
  );
  const { data: recent } = useSWR<DiscoverAlbumsResponse>(
    '/api/v1/discover/recently-added?take=20'
  );
  const { data: trending } = useSWR<DiscoverAlbumsResponse>(
    '/api/v1/discover/trending?take=20'
  );
  const { data: artists } = useSWR<DiscoverArtistsResponse>(
    '/api/v1/discover/popular-artists?take=20'
  );
  const { data: concerts } = useSWR<DiscoverConcertsResponse>(
    currentSettings.concertsEnabled ? '/api/v1/discover/concerts?take=20' : null
  );
  const { data: requests } = useSWR<DiscoverRecentRequestsResponse>(
    '/api/v1/discover/recent-requests?take=5'
  );

  const stat = (value?: number) =>
    value == null ? '–' : intl.formatNumber(value);

  const ownOnly = requests
    ? requests.ownOnly
    : !hasPermission([Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW], {
        type: 'or',
      });

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.discover)} />

      <section className="sh-base-hero" aria-labelledby="discover-hero">
        <div className="sh-bh-copy">
          <p className="cmd">$ shufflerr discover --since 7d</p>
          <h1 id="discover-hero">
            {intl.formatMessage(messages.heroline1)}
            <br />
            <span>{intl.formatMessage(messages.heroline2)}</span>
          </h1>
          <p className="blurb">{intl.formatMessage(messages.blurb)}</p>
          <div className="sh-bh-cta">
            <Link href="/search" className="sh-btn primary">
              {intl.formatMessage(messages.searchmusic)}
            </Link>
            <Link href="/requests" className="sh-btn">
              {intl.formatMessage(messages.seerequests)}
            </Link>
          </div>
        </div>
        <dl className="sh-bh-stats">
          <div>
            <dt>{intl.formatMessage(messages.statalbums)}</dt>
            <dd>{stat(stats?.albums)}</dd>
          </div>
          <div>
            <dt>{intl.formatMessage(messages.statartists)}</dt>
            <dd>{stat(stats?.artists)}</dd>
          </div>
          <div>
            <dt>{intl.formatMessage(messages.stattracks)}</dt>
            <dd>{stat(stats?.tracks)}</dd>
          </div>
          <div>
            <dt>{intl.formatMessage(messages.statdownloading)}</dt>
            <dd className="text-st-processing">{stat(stats?.downloading)}</dd>
          </div>
        </dl>
      </section>

      <FeaturedRelease />

      {recent?.enabled && recent.results.length > 0 && (
        <HorizontalRow
          title={intl.formatMessage(messages.recentlyadded)}
          sub={intl.formatMessage(messages.recentlyaddedsub)}
          linkHref="/albums"
          linkText={intl.formatMessage(messages.seeall)}
        >
          {recent.results.map((album) => (
            <AlbumCard
              key={album.mbid}
              mbid={album.mbid}
              title={album.title}
              artistName={album.artistName}
              year={album.firstReleaseDate}
              status={album.status}
              imageSrc={album.coverUrl}
            />
          ))}
        </HorizontalRow>
      )}

      {trending?.enabled && trending.results.length > 0 && (
        <HorizontalRow
          title={intl.formatMessage(messages.trending)}
          sub={intl.formatMessage(messages.trendingsub)}
        >
          {trending.results.map((album) => (
            <AlbumCard
              key={album.mbid}
              mbid={album.mbid}
              title={album.title}
              artistName={album.artistName}
              year={album.firstReleaseDate}
              status={album.status}
              imageSrc={album.coverUrl}
              action={
                canRequestAlbums && isRequestable(album) ? (
                  <RequestButton album={toModalAlbum(album)} />
                ) : undefined
              }
            />
          ))}
        </HorizontalRow>
      )}

      {artists?.enabled && artists.results.length > 0 && (
        <HorizontalRow
          title={intl.formatMessage(messages.popularartists)}
          sub={intl.formatMessage(
            artists.results.some((artist) => !artist.albumsInLibrary)
              ? messages.popularartistslb
              : messages.popularartistssub
          )}
          linkHref="/artists"
          linkText={intl.formatMessage(messages.seeall)}
        >
          {artists.results.map((artist) => (
            <ArtistCard
              key={artist.mbid}
              mbid={artist.mbid}
              name={artist.name}
              imageSrc={artist.imageUrl}
              meta={
                artist.albumsInLibrary
                  ? intl.formatMessage(messages.artistalbums, {
                      count: artist.albumsInLibrary,
                    })
                  : artist.disambiguation || artist.area
              }
            />
          ))}
        </HorizontalRow>
      )}

      {concerts?.enabled && concerts.results.length > 0 && (
        <section aria-labelledby="discover-concerts">
          <div className="sh-sec-head">
            <div>
              <h2 className="sh-h-section" id="discover-concerts">
                {intl.formatMessage(messages.concerts)}
              </h2>
              {concerts.attribution.length > 0 && (
                <p className="sh-sub">
                  {intl.formatMessage(messages.concertsfrom, {
                    providers: intl.formatList(
                      concerts.attribution.map((p) => PROVIDER_NAME[p] ?? p),
                      { type: 'conjunction' }
                    ),
                  })}
                </p>
              )}
            </div>
          </div>
          <div className="sh-box">
            <ul className="sh-list sh-events">
              {concerts.results.map((event) => {
                const date = new Date(event.startsAt);
                const provider =
                  PROVIDER_NAME[event.provider] ?? event.provider;
                return (
                  <li key={`${event.provider}-${event.id}`}>
                    <span className="sh-date">
                      <b>{intl.formatDate(date, { day: '2-digit' })}</b>
                      <span>{intl.formatDate(date, { month: 'short' })}</span>
                    </span>
                    <div className="grow">
                      {event.artistMbid ? (
                        <Link
                          href={`/artist/${event.artistMbid}`}
                          className="font-bold text-ink"
                        >
                          {event.artistName}
                        </Link>
                      ) : (
                        <b>{event.artistName}</b>
                      )}
                      <span className="sh-feat">
                        {[event.name, event.venue, event.city]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    </div>
                    <span className="who">{provider}</span>
                    <a
                      className="sh-btn small"
                      href={event.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={intl.formatMessage(messages.ticketsfor, {
                        artist: event.artistName,
                        provider,
                      })}
                    >
                      {intl.formatMessage(messages.tickets)}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {requests && requests.enabled !== false && (
        <section aria-labelledby="discover-requests">
          <div className="sh-sec-head">
            <div>
              <h2 className="sh-h-section" id="discover-requests">
                {intl.formatMessage(
                  ownOnly
                    ? messages.yourrecentrequests
                    : messages.recentrequests
                )}
              </h2>
              <p className="sh-sub">
                {intl.formatMessage(
                  ownOnly ? messages.onlyyou : messages.everyone
                )}
              </p>
            </div>
            <Link href="/requests">
              {intl.formatMessage(messages.allrequests)}
            </Link>
          </div>
          {requests.results.length ? (
            <div className="sh-box">
              <ul className="sh-list">
                {requests.results.map((request) => {
                  const artistLine = text.artistLine(request);
                  return (
                    <li key={request.id}>
                      <CoverArt
                        thumb
                        decorative
                        round={request.media?.mediaType === MediaType.ARTIST}
                        src={request.coverUrl}
                        mbid={request.media?.mbid}
                        title={request.media?.title}
                      />
                      <div className="grow">
                        <Link
                          href={text.href(request)}
                          className="font-bold text-ink"
                        >
                          {text.title(request)}
                        </Link>
                        {artistLine && (
                          <span className="sh-feat">{artistLine}</span>
                        )}
                      </div>
                      <span className="who">
                        {[
                          request.requestedBy?.displayName,
                          text.ago(request.createdAt),
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                      <StatusBadge requestStatus={request.status} />
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="sh-box flex flex-col items-center gap-3 p-7 text-center text-muted">
              <span>
                {intl.formatMessage(
                  ownOnly ? messages.norequests : messages.norequestsall
                )}
              </span>
              <Link href="/search" className="sh-btn small">
                {intl.formatMessage(messages.searchmusic)}
              </Link>
            </div>
          )}
        </section>
      )}
    </>
  );
};

export default DiscoverClassic;
