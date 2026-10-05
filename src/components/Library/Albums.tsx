import AlbumCard from '@app/components/AlbumCard';
import FilterChips from '@app/components/Common/FilterChips';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageHeader from '@app/components/Common/PageHeader';
import NoLibrary from '@app/components/Library/NoLibrary';
import Pager from '@app/components/Library/Pager';
import useLibraryQuery from '@app/components/Library/useLibraryQuery';
import defineMessages from '@app/utils/defineMessages';
import type { LibraryAlbumsResponse } from '@server/interfaces/api/mediaInterfaces';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Library.Albums', {
  albums: 'Albums',
  description:
    'Albums, EPs and singles in your library, and the ones on their way.',
  filter: 'Filter albums',
  filterplaceholder: 'Filter by title or artist',
  sort: 'Sort albums',
  sortadded: 'Recently added',
  sorttitle: 'Title',
  sortartist: 'Artist',
  sortyear: 'Release year',
  statuslabel: 'Filter by status',
  all: 'All',
  available: 'Available',
  partial: 'Partly available',
  processing: 'Downloading',
  loaderror:
    'The albums couldn’t be loaded. Check your connection and refresh the page.',
});

const SORTS = ['added', 'title', 'artist', 'year'] as const;
const FILTERS = ['all', 'available', 'partial', 'processing'] as const;
const PAGE_SIZE = 48;

const LibraryAlbums = () => {
  const intl = useIntl();
  const { sort, filter, page, q, text, setText, update } = useLibraryQuery(
    '/albums',
    SORTS,
    FILTERS
  );

  const { data, error } = useSWR<LibraryAlbumsResponse>(
    `/api/v1/library/albums?page=${page}&pageSize=${PAGE_SIZE}&sort=${sort}&filter=${filter}${
      q ? `&q=${encodeURIComponent(q)}` : ''
    }`,
    { keepPreviousData: true }
  );

  const sortLabels: Record<(typeof SORTS)[number], string> = {
    added: intl.formatMessage(messages.sortadded),
    title: intl.formatMessage(messages.sorttitle),
    artist: intl.formatMessage(messages.sortartist),
    year: intl.formatMessage(messages.sortyear),
  };
  const filterLabels: Record<(typeof FILTERS)[number], string> = {
    all: intl.formatMessage(messages.all),
    available: intl.formatMessage(messages.available),
    partial: intl.formatMessage(messages.partial),
    processing: intl.formatMessage(messages.processing),
  };

  return (
    <>
      <PageHeader
        title={intl.formatMessage(messages.albums)}
        description={intl.formatMessage(messages.description)}
      />
      <div className="sh-toolbar">
        <FilterChips
          aria-label={intl.formatMessage(messages.statuslabel)}
          value={filter}
          onChange={(value) => update({ filter: value, page: 1 })}
          chips={FILTERS.map((value) => ({
            value,
            label: filterLabels[value],
          }))}
        />
        <input
          type="search"
          className="max-w-[320px]"
          aria-label={intl.formatMessage(messages.filter)}
          placeholder={intl.formatMessage(messages.filterplaceholder)}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <select
          className="!w-auto"
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
        <div className="sh-grid">
          {data.results.map((album) => (
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
        </div>
      ) : (
        <NoLibrary query={q} filtered={filter !== 'all'} />
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

export default LibraryAlbums;
