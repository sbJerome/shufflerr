// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import AlbumCard from '@app/components/AlbumCard';
import Button from '@app/components/Common/Button';
import EmptyState from '@app/components/Common/EmptyState';
import FilterChips from '@app/components/Common/FilterChips';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import CoverArt from '@app/components/CoverArt';
import RequestButton from '@app/components/RequestButton';
import { isRequestable, toModalAlbum } from '@app/components/RequestModal/subject';
import TrackResults from '@app/components/Search/TrackResults';
import StatusBadge from '@app/components/StatusBadge';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type {
  AlbumResult,
  ArtistResult,
  SearchResults,
} from '@server/models/music';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

const messages = defineMessages('components.Search', {
  search: 'Search',
  resultsfor: 'Results for “{query}”',
  filterlabel: 'Filter results',
  all: 'All',
  artists: 'Artists',
  albums: 'Albums and singles',
  tracks: 'Tracks',
  topresult: 'Top result',
  nothing: 'Nothing matches “{query}”.',
  nothinghint:
    'Check the spelling, or search by artist name. Results come from MusicBrainz.',
  nothingintab: 'Nothing of this kind matches “{query}”. Try another filter.',
  prompt: 'Search for an artist, album or track.',
  prompthint:
    'Type in the search field at the top. Results come from MusicBrainz, with what’s already in your library marked.',
  loaderror:
    'The search didn’t finish. MusicBrainz may be slow right now. Try again in a moment.',
  tryagain: 'Try again',
  showmore: 'Show more',
  showall: 'Show all {count}',
});

type Tab = 'all' | 'artist' | 'album' | 'track';
const TABS: Tab[] = ['all', 'artist', 'album', 'track'];
const PAGE_SIZE = 24;

const artistMeta = (artist: ArtistResult): string =>
  artist.disambiguation ||
  [artist.type, artist.area || artist.country].filter(Boolean).join(', ');

const Search = () => {
  const intl = useIntl();
  const router = useRouter();
  const { hasPermission } = useUser();

  const query = String(router.query.query ?? '').trim();
  const queryTab = String(router.query.type ?? 'all') as Tab;
  const tab = TABS.includes(queryTab) ? queryTab : 'all';
  const encoded = encodeURIComponent(query);

  const canRequestAlbums = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_ALBUM],
    { type: 'or' }
  );

  // The "all" query gives the chip counts and the mixed first page.
  const {
    data: overview,
    error: overviewError,
    mutate: retryOverview,
  } = useSWR<SearchResults>(
    query ? `/api/v1/search?query=${encoded}&type=all&page=1&pageSize=12` : null,
    { revalidateOnFocus: false }
  );

  const {
    data: pages,
    error: pagesError,
    size,
    setSize,
    isValidating,
  } = useSWRInfinite<SearchResults>(
    (index) =>
      query && tab !== 'all'
        ? `/api/v1/search?query=${encoded}&type=${tab}&page=${
            index + 1
          }&pageSize=${PAGE_SIZE}`
        : null,
    { revalidateOnFocus: false, revalidateFirstPage: false }
  );

  const setTab = (next: Tab) => {
    const nextQuery: Record<string, string> = { query };
    if (next !== 'all') {
      nextQuery.type = next;
    }
    router.replace({ pathname: '/search', query: nextQuery }, undefined, {
      shallow: true,
    });
  };

  const title = query
    ? intl.formatMessage(messages.resultsfor, { query })
    : intl.formatMessage(messages.search);

  if (!query) {
    return (
      <>
        <PageTitle title={title} />
        <h1 className="text-[32px] font-bold tracking-[-0.02em]">{title}</h1>
        <EmptyState title={intl.formatMessage(messages.prompt)}>
          {intl.formatMessage(messages.prompthint)}
        </EmptyState>
      </>
    );
  }

  const counts = overview
    ? {
        artist: overview.artists.total,
        album: overview.albums.total,
        track: overview.tracks.total,
      }
    : undefined;
  const total = counts ? counts.artist + counts.album + counts.track : 0;

  let artists: ArtistResult[] = [];
  let albums: AlbumResult[] = [];
  let tracks: SearchResults['tracks']['results'] = [];
  let hasMore = false;

  if (tab === 'all') {
    artists = overview?.artists.results.slice(0, 5) ?? [];
    albums = overview?.albums.results.slice(0, 12) ?? [];
    tracks = overview?.tracks.results.slice(0, 10) ?? [];
  } else if (pages) {
    artists = pages.flatMap((p) => p.artists.results);
    albums = pages.flatMap((p) => p.albums.results);
    tracks = pages.flatMap((p) => p.tracks.results);
    const last = pages[pages.length - 1];
    const bucket =
      tab === 'artist' ? last?.artists : tab === 'album' ? last?.albums : last?.tracks;
    const loaded =
      tab === 'artist' ? artists.length : tab === 'album' ? albums.length : tracks.length;
    hasMore = !!bucket && bucket.results.length > 0 && loaded < bucket.total;
  }

  const loading = tab === 'all' ? !overview && !overviewError : !pages && !pagesError;
  const error = tab === 'all' ? overviewError : pagesError;
  const empty = !loading && !error && !artists.length && !albums.length && !tracks.length;

  const showArtists = (tab === 'all' || tab === 'artist') && artists.length > 0;
  const showAlbums = (tab === 'all' || tab === 'album') && albums.length > 0;
  const showTracks = (tab === 'all' || tab === 'track') && tracks.length > 0;
  const top = artists[0];
  const restArtists = artists.slice(1);

  const sectionLink = (target: Tab, count?: number) =>
    tab === 'all' && count != null && count > 0 ? (
      <button
        type="button"
        className="text-link hover:underline"
        onClick={() => setTab(target)}
      >
        {intl.formatMessage(messages.showall, { count })}
      </button>
    ) : null;

  return (
    <>
      <PageTitle title={title} />
      <div className="flex flex-col gap-3.5">
        <h1 className="text-[32px] font-bold tracking-[-0.02em]">{title}</h1>
        <FilterChips
          aria-label={intl.formatMessage(messages.filterlabel)}
          value={tab}
          onChange={setTab}
          chips={[
            {
              value: 'all',
              label: intl.formatMessage(messages.all),
              count: counts ? total : undefined,
            },
            {
              value: 'artist',
              label: intl.formatMessage(messages.artists),
              count: counts?.artist,
            },
            {
              value: 'album',
              label: intl.formatMessage(messages.albums),
              count: counts?.album,
            },
            {
              value: 'track',
              label: intl.formatMessage(messages.tracks),
              count: counts?.track,
            },
          ]}
        />
      </div>

      {loading && <LoadingSpinner />}

      {error && (
        <EmptyState
          title={intl.formatMessage(messages.loaderror)}
          action={
            <Button buttonSize="sm" onClick={() => retryOverview()}>
              {intl.formatMessage(messages.tryagain)}
            </Button>
          }
        />
      )}

      {showArtists && top && (
        <section aria-labelledby="search-artists">
          <div className="sh-sec-head">
            <h2 className="sh-h-section" id="search-artists">
              {intl.formatMessage(messages.artists)}
            </h2>
            {sectionLink('artist', counts?.artist)}
          </div>
          <div className="sh-two">
            <Link
              href={`/artist/${top.mbid}`}
              className="sh-box flex items-center gap-5 p-5 text-ink no-underline"
              style={{ flex: '1 1 380px' }}
            >
              <CoverArt
                round
                decorative
                showInitials
                src={top.imageUrl}
                mbid={top.mbid}
                title={top.name}
                className="w-[120px] flex-none"
              />
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="sh-feat">
                  {intl.formatMessage(messages.topresult)}
                </span>
                <b className="text-[28px] leading-tight tracking-[-0.02em]">
                  {top.name}
                </b>
                {artistMeta(top) && (
                  <span className="sh-feat">{artistMeta(top)}</span>
                )}
                <StatusBadge status={top.status} />
              </div>
            </Link>
            {restArtists.length > 0 && (
              <div className="sh-box" style={{ flex: '1 1 380px' }}>
                <ul className="sh-list">
                  {restArtists.map((artist) => (
                    <li key={artist.mbid}>
                      <CoverArt
                        round
                        thumb
                        decorative
                        showInitials
                        src={artist.imageUrl}
                        mbid={artist.mbid}
                        title={artist.name}
                      />
                      <div className="grow">
                        <Link
                          href={`/artist/${artist.mbid}`}
                          className="font-bold text-ink"
                        >
                          {artist.name}
                        </Link>
                        {artistMeta(artist) && (
                          <span className="sh-feat">{artistMeta(artist)}</span>
                        )}
                      </div>
                      <StatusBadge status={artist.status} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {showAlbums && (
        <section aria-labelledby="search-albums">
          <div className="sh-sec-head">
            <h2 className="sh-h-section" id="search-albums">
              {intl.formatMessage(messages.albums)}
            </h2>
            {sectionLink('album', counts?.album)}
          </div>
          <div className="sh-grid">
            {albums.map((album) => (
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
          </div>
        </section>
      )}

      {showTracks && (
        <section aria-labelledby="search-tracks">
          <div className="sh-sec-head">
            <h2 className="sh-h-section" id="search-tracks">
              {intl.formatMessage(messages.tracks)}
            </h2>
            {sectionLink('track', counts?.track)}
          </div>
          <TrackResults tracks={tracks} />
        </section>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button disabled={isValidating} onClick={() => setSize(size + 1)}>
            {intl.formatMessage(messages.showmore)}
          </Button>
        </div>
      )}

      {empty && (
        <EmptyState
          title={intl.formatMessage(
            tab === 'all' || total === 0
              ? messages.nothing
              : messages.nothingintab,
            { query }
          )}
        >
          {(tab === 'all' || total === 0) &&
            intl.formatMessage(messages.nothinghint)}
        </EmptyState>
      )}
    </>
  );
};

export default Search;
