import ArtistCard from '@app/components/ArtistCard';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageHeader from '@app/components/Common/PageHeader';
import NoLibrary from '@app/components/Library/NoLibrary';
import Pager from '@app/components/Library/Pager';
import useLibraryQuery from '@app/components/Library/useLibraryQuery';
import defineMessages from '@app/utils/defineMessages';
import type { LibraryArtistsResponse } from '@server/interfaces/api/mediaInterfaces';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Library.Artists', {
  artists: 'Artists',
  description: 'Every artist with music in your library.',
  filter: 'Filter artists',
  filterplaceholder: 'Filter by name',
  sort: 'Sort artists',
  sortname: 'Name',
  sortadded: 'Recently added',
  sortalbums: 'Most albums',
  albums:
    '{count, plural, one {# album in library} other {# albums in library}}',
  loaderror:
    'The artists couldn’t be loaded. Check your connection and refresh the page.',
});

const SORTS = ['name', 'added', 'albums'] as const;
const PAGE_SIZE = 48;

const LibraryArtists = () => {
  const intl = useIntl();
  const { sort, page, q, text, setText, update } = useLibraryQuery(
    '/artists',
    SORTS
  );

  const { data, error } = useSWR<LibraryArtistsResponse>(
    `/api/v1/library/artists?page=${page}&pageSize=${PAGE_SIZE}&sort=${sort}${
      q ? `&q=${encodeURIComponent(q)}` : ''
    }`,
    { keepPreviousData: true }
  );

  const sortLabels: Record<(typeof SORTS)[number], string> = {
    name: intl.formatMessage(messages.sortname),
    added: intl.formatMessage(messages.sortadded),
    albums: intl.formatMessage(messages.sortalbums),
  };

  return (
    <>
      <PageHeader
        title={intl.formatMessage(messages.artists)}
        description={intl.formatMessage(messages.description)}
      />
      <div className="sh-toolbar">
        <input
          type="search"
          className="max-w-[320px]"
          aria-label={intl.formatMessage(messages.filter)}
          placeholder={intl.formatMessage(messages.filterplaceholder)}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <select
          className="!w-auto !flex-none"
          aria-label={intl.formatMessage(messages.sort)}
          value={sort}
          onChange={(e) =>
            update({ sort: e.target.value as (typeof SORTS)[number], page: 1 })
          }
        >
          {SORTS.map((value) => (
            <option key={value} value={value}>
              {sortLabels[value]}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="sh-outcome block" role="alert">
          {intl.formatMessage(messages.loaderror)}
        </div>
      ) : !data ? (
        <LoadingSpinner />
      ) : data.results.length ? (
        <div
          className="sh-grid"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          }}
        >
          {data.results.map((artist) => (
            <ArtistCard
              key={artist.mbid}
              mbid={artist.mbid}
              name={artist.name}
              imageSrc={artist.imageUrl}
              meta={
                artist.albumsInLibrary != null
                  ? intl.formatMessage(messages.albums, {
                      count: artist.albumsInLibrary,
                    })
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <NoLibrary query={q} />
      )}

      {data && (
        <Pager
          page={data.pageInfo.page}
          pages={data.pageInfo.pages}
          onPage={(next) => update({ page: next })}
        />
      )}
    </>
  );
};

export default LibraryArtists;
