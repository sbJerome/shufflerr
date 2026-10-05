import AlbumCard from '@app/components/AlbumCard';
import ArtistCard from '@app/components/ArtistCard';
import Button from '@app/components/Common/Button';
import EmptyState from '@app/components/Common/EmptyState';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Carousel from '@app/components/Discover/Carousel';
import RequestButton from '@app/components/RequestButton';
import {
  isRequestable,
  toModalAlbum,
} from '@app/components/RequestModal/subject';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type { GenreResponse } from '@server/interfaces/api/discoverInterfaces';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';
import useSWRInfinite from 'swr/infinite';

const messages = defineMessages('components.Genre', {
  genre: 'Genre',
  sub: 'Albums and artists tagged “{genre}” on MusicBrainz. Anything already in your library is marked.',
  artists: 'Artists',
  artistssub:
    '{count, plural, one {# artist} other {# artists}} tagged with this genre',
  albums: 'Albums and EPs',
  albumssub:
    '{count, plural, one {# release} other {# releases}} tagged with this genre',
  showmore: 'Show more',
  loading: 'Loading…',
  none: 'Nothing is tagged “{genre}” on MusicBrainz.',
  nonehint:
    'Genres come from MusicBrainz tags. Try a broader one, or search for an artist.',
  failed: 'That genre couldn’t be loaded.',
  failedhint:
    'MusicBrainz may be unreachable right now. Try again in a moment.',
  searchmusic: 'Search music',
  artistalbums:
    '{count, plural, one {# album in library} other {# albums in library}}',
});

const PAGE_SIZE = 24;

/** Everything MusicBrainz tags with one genre: artists in a row, albums in a grid. */
const Genre = () => {
  const intl = useIntl();
  const router = useRouter();
  const { hasPermission } = useUser();
  const name = router.query.name as string | undefined;

  const canRequestAlbums = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_ALBUM],
    { type: 'or' }
  );

  const { data, error, size, setSize, isValidating } =
    useSWRInfinite<GenreResponse>(
      (index) =>
        name
          ? `/api/v1/genre/${encodeURIComponent(name)}?page=${
              index + 1
            }&pageSize=${PAGE_SIZE}`
          : null,
      { revalidateFirstPage: false }
    );

  const first = data?.[0];
  const genre = first?.genre ?? name ?? '';

  if (error && !first) {
    return (
      <>
        <PageTitle title={genre || intl.formatMessage(messages.genre)} />
        <EmptyState
          title={intl.formatMessage(messages.failed)}
          action={
            <Link href="/search" className="sh-btn small">
              {intl.formatMessage(messages.searchmusic)}
            </Link>
          }
        >
          {intl.formatMessage(messages.failedhint)}
        </EmptyState>
      </>
    );
  }

  if (!first) {
    return <LoadingSpinner />;
  }

  const albums = (data ?? []).flatMap((page) => page.albums.results);
  const total = first.albums.total;
  const loadingMore = isValidating && size > (data?.length ?? 0);
  const empty = albums.length === 0 && first.artists.results.length === 0;

  return (
    <>
      <PageTitle title={genre} />

      <header className="sh-gx-head">
        <span className="kicker">{intl.formatMessage(messages.genre)}</span>
        <h1>{genre}</h1>
        <p>{intl.formatMessage(messages.sub, { genre })}</p>
      </header>

      {empty && (
        <EmptyState
          title={intl.formatMessage(messages.none, { genre })}
          action={
            <Link href="/search" className="sh-btn small">
              {intl.formatMessage(messages.searchmusic)}
            </Link>
          }
        >
          {intl.formatMessage(messages.nonehint)}
        </EmptyState>
      )}

      {first.artists.results.length > 0 && (
        <Carousel
          className="artists"
          title={intl.formatMessage(messages.artists)}
          sub={intl.formatMessage(messages.artistssub, {
            count: first.artists.total,
          })}
        >
          {first.artists.results.map((artist) => (
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

      {albums.length > 0 && (
        <section aria-labelledby="genre-albums">
          <div className="sh-dx-head">
            <div>
              <h2 id="genre-albums">{intl.formatMessage(messages.albums)}</h2>
              <p>{intl.formatMessage(messages.albumssub, { count: total })}</p>
            </div>
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
          {albums.length < total && (
            <div className="mt-8 flex justify-center">
              <Button
                type="button"
                disabled={loadingMore}
                onClick={() => setSize(size + 1)}
              >
                {intl.formatMessage(
                  loadingMore ? messages.loading : messages.showmore
                )}
              </Button>
            </div>
          )}
        </section>
      )}
    </>
  );
};

export default Genre;
