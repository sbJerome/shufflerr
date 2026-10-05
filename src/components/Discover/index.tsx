import AlbumCard from '@app/components/AlbumCard';
import ArtistCard from '@app/components/ArtistCard';
import PageTitle from '@app/components/Common/PageTitle';
import CoverArt from '@app/components/CoverArt';
import Carousel from '@app/components/Discover/Carousel';
import Hero from '@app/components/Discover/Hero';
import usePlayback from '@app/components/Playback';
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
import { PlayIcon } from '@heroicons/react/24/outline';
import { MediaStatus } from '@server/constants/media';
import type {
  DiscoverAlbumsResponse,
  DiscoverArtistsResponse,
  DiscoverConcertsResponse,
  DiscoverRecentRequestsResponse,
} from '@server/interfaces/api/discoverInterfaces';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover', {
  discover: 'Discover',
  recentlyadded: 'New in your library',
  recentlyaddedsub: 'The newest albums on this server',
  viewalbums: 'View albums',
  popularartists: 'Popular artists',
  popularartistssub: 'Most played and requested on this server',
  popularartistslb: 'Most listened to on ListenBrainz right now',
  viewartists: 'View artists',
  artistalbums:
    '{count, plural, one {# album in library} other {# albums in library}}',
  trending: 'Most popular this week',
  trendingsub: 'New releases people are listening to',
  taball: 'All',
  tabmissing: 'Not in library',
  tabhave: 'In library',
  tablabel: 'Filter the list',
  play: 'Play {title}',
  open: 'Open',
  nonehere: 'Nothing in this list right now.',
  concerts: 'Concerts for artists you have',
  tickets: 'Tickets',
  ticketsfor: 'Tickets for {artist} on {provider}',
  recentrequests: 'Recent requests',
  yourrecentrequests: 'Your recent requests',
  allrequests: 'All requests',
  requestedby: 'Requested by {name}',
  norequests:
    'You haven’t requested anything yet. Search for an album to start.',
  norequestsall: 'Nobody has requested anything yet.',
  searchmusic: 'Search music',
});

const PROVIDER_NAME: Record<string, string> = {
  ticketmaster: 'Ticketmaster',
  skiddle: 'Skiddle',
};

type TrendTab = 'all' | 'missing' | 'have';

const Discover = () => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { currentSettings } = useSettings();
  const text = useRequestText();
  const { playAlbum } = usePlayback();
  const [tab, setTab] = useState<TrendTab>('all');

  const canRequestAlbums = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_ALBUM],
    { type: 'or' }
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
    currentSettings.concertsEnabled ? '/api/v1/discover/concerts?take=6' : null
  );
  const { data: requests } = useSWR<DiscoverRecentRequestsResponse>(
    '/api/v1/discover/recent-requests?take=5'
  );

  const ownOnly = requests
    ? requests.ownOnly
    : !hasPermission([Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW], {
        type: 'or',
      });

  const inLibrary = (status: MediaStatus) =>
    status === MediaStatus.AVAILABLE ||
    status === MediaStatus.PARTIALLY_AVAILABLE;

  const trendingAll = trending?.enabled ? trending.results : [];
  const trendingShown = trendingAll
    .filter((album) =>
      tab === 'all'
        ? true
        : tab === 'have'
          ? inLibrary(album.status)
          : !inLibrary(album.status)
    )
    .slice(0, 8);

  const tabs: { key: TrendTab; label: string }[] = [
    { key: 'all', label: intl.formatMessage(messages.taball) },
    { key: 'missing', label: intl.formatMessage(messages.tabmissing) },
    { key: 'have', label: intl.formatMessage(messages.tabhave) },
  ];

  const showRequests = !!requests && requests.enabled !== false;
  const showConcerts = !!concerts?.enabled && concerts.results.length > 0;
  const hasSide = showRequests || showConcerts;

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.discover)} />

      <Hero />

      {recent?.enabled && recent.results.length > 0 && (
        <Carousel
          title={intl.formatMessage(messages.recentlyadded)}
          sub={intl.formatMessage(messages.recentlyaddedsub)}
          linkHref="/albums"
          linkText={intl.formatMessage(messages.viewalbums)}
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
        </Carousel>
      )}

      {(trendingAll.length > 0 || hasSide) && (
        <div
          className={`sh-dx-split ${
            hasSide && trendingAll.length > 0 ? '' : 'solo'
          }`}
        >
          {trendingAll.length > 0 && (
            <section
              className="sh-dx-panel"
              aria-labelledby="discover-trending"
            >
              <div className="sh-dx-head">
                <div>
                  <h2 id="discover-trending">
                    {intl.formatMessage(messages.trending)}
                  </h2>
                  <p>{intl.formatMessage(messages.trendingsub)}</p>
                </div>
              </div>
              <div
                className="sh-dx-tabs"
                role="group"
                aria-label={intl.formatMessage(messages.tablabel)}
              >
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={tab === t.key}
                    className={tab === t.key ? 'on' : ''}
                    onClick={() => setTab(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {trendingShown.length ? (
                <ol className="sh-dx-tracks">
                  {trendingShown.map((album) => {
                    const playable = inLibrary(album.status);
                    return (
                      <li key={album.mbid}>
                        {playable ? (
                          <button
                            type="button"
                            className="go"
                            onClick={() => playAlbum(album.mbid)}
                            aria-label={intl.formatMessage(messages.play, {
                              title: album.title,
                            })}
                          >
                            <PlayIcon aria-hidden="true" />
                          </button>
                        ) : (
                          <span className="go off" aria-hidden="true">
                            <PlayIcon />
                          </span>
                        )}
                        <CoverArt
                          thumb
                          decorative
                          src={album.coverUrl}
                          mbid={album.mbid}
                          title={album.title}
                        />
                        <div className="what">
                          <Link href={`/album/${album.mbid}`}>
                            {album.title}
                          </Link>
                          <span>{album.artistName}</span>
                        </div>
                        <span className="year">
                          {album.year ?? album.firstReleaseDate?.slice(0, 4)}
                        </span>
                        <span className="act">
                          {canRequestAlbums && isRequestable(album) ? (
                            <RequestButton album={toModalAlbum(album)} />
                          ) : (
                            <StatusBadge status={album.status} />
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="sh-dx-empty">
                  {intl.formatMessage(messages.nonehere)}
                </p>
              )}
            </section>
          )}

          {hasSide && (
            <div className="sh-dx-side">
              {showConcerts &&
                concerts.results.slice(0, 3).map((event) => {
                  const date = new Date(event.startsAt);
                  const provider =
                    PROVIDER_NAME[event.provider] ?? event.provider;
                  return (
                    <article
                      className="sh-dx-event"
                      key={`${event.provider}-${event.id}`}
                    >
                      <div className="date">
                        <b>{intl.formatDate(date, { day: '2-digit' })}</b>
                        <span>{intl.formatDate(date, { month: 'long' })}</span>
                      </div>
                      <div className="body">
                        <h3>
                          {event.artistMbid ? (
                            <Link href={`/artist/${event.artistMbid}`}>
                              {event.artistName}
                            </Link>
                          ) : (
                            event.artistName
                          )}
                        </h3>
                        <p>
                          {[event.name, event.venue, event.city]
                            .filter(Boolean)
                            .join(', ')}
                        </p>
                        <div className="foot">
                          <span>{provider}</span>
                          <a
                            href={event.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={intl.formatMessage(
                              messages.ticketsfor,
                              {
                                artist: event.artistName,
                                provider,
                              }
                            )}
                          >
                            {intl.formatMessage(messages.tickets)}
                          </a>
                        </div>
                      </div>
                    </article>
                  );
                })}

              {showRequests && (
                <section aria-labelledby="discover-requests">
                  <div className="sh-dx-head small">
                    <h2 id="discover-requests">
                      {intl.formatMessage(
                        ownOnly
                          ? messages.yourrecentrequests
                          : messages.recentrequests
                      )}
                    </h2>
                    <Link href="/requests" className="sh-dx-more">
                      {intl.formatMessage(messages.allrequests)}
                    </Link>
                  </div>
                  {requests.results.length ? (
                    requests.results.slice(0, 4).map((request) => {
                      const date = new Date(request.createdAt);
                      const artistLine = text.artistLine(request);
                      return (
                        <article className="sh-dx-event" key={request.id}>
                          <div className="date">
                            <b>{intl.formatDate(date, { day: '2-digit' })}</b>
                            <span>
                              {intl.formatDate(date, { month: 'long' })}
                            </span>
                          </div>
                          <div className="body">
                            <h3>
                              <Link href={text.href(request)}>
                                {text.title(request)}
                              </Link>
                            </h3>
                            {artistLine && <p>{artistLine}</p>}
                            <div className="foot">
                              <span>
                                {request.requestedBy?.displayName
                                  ? intl.formatMessage(messages.requestedby, {
                                      name: request.requestedBy.displayName,
                                    })
                                  : text.ago(request.createdAt)}
                              </span>
                              <StatusBadge requestStatus={request.status} />
                            </div>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <div className="sh-dx-event empty">
                      <p>
                        {intl.formatMessage(
                          ownOnly ? messages.norequests : messages.norequestsall
                        )}
                      </p>
                      <Link href="/search" className="sh-btn small">
                        {intl.formatMessage(messages.searchmusic)}
                      </Link>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      )}

      {artists?.enabled && artists.results.length > 0 && (
        <Carousel
          className="artists"
          title={intl.formatMessage(messages.popularartists)}
          sub={intl.formatMessage(
            artists.results.some((artist) => !artist.albumsInLibrary)
              ? messages.popularartistslb
              : messages.popularartistssub
          )}
          linkHref="/artists"
          linkText={intl.formatMessage(messages.viewartists)}
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
        </Carousel>
      )}
    </>
  );
};

export default Discover;
