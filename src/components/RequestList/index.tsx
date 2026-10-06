// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Button from '@app/components/Common/Button';
import FilterChips from '@app/components/Common/FilterChips';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageHeader from '@app/components/Common/PageHeader';
import RequestItem, {
  REQUEST_COLUMNS,
} from '@app/components/RequestList/RequestItem';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { MediaRequestStatus } from '@server/constants/media';
import type {
  RequestCountResponse,
  RequestFilter,
  RequestResultsResponse,
} from '@server/interfaces/api/requestInterfaces';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.RequestList', {
  requests: 'Requests',
  yourrequests: 'Your requests',
  submanage:
    '{count} waiting for approval. Approved requests go straight to Lidarr.',
  subown: 'You can cancel a request while it’s waiting for approval.',
  limit: 'Your weekly limit:',
  limitdays: 'Your limit for the past {days} days:',
  limitalbums: '{remaining} of {limit} albums',
  limittracks: '{remaining} of {limit} tracks',
  unlimitedalbums: 'unlimited albums',
  unlimitedtracks: 'unlimited tracks',
  filterlabel: 'Filter by status',
  all: 'All',
  waiting: 'Waiting',
  downloading: 'Approved',
  available: 'Available',
  declined: 'Declined',
  failed: 'Failed',
  colrequest: 'Request',
  coltype: 'Type',
  colrequestedby: 'Requested by',
  collastchange: 'Last change',
  colstatus: 'Status',
  colactions: 'Actions',
  colcover: 'Cover',
  sort: 'Sort requests',
  sortadded: 'Newest first',
  sortmodified: 'Recently changed',
  emptyfilter: 'No requests with this status. Try another filter.',
  emptyall: 'You haven’t requested anything yet. Search for an album to start.',
  emptyallmanage: 'Nobody has requested anything yet.',
  searchmusic: 'Search music',
  loaderror:
    'The requests couldn’t be loaded. Check your connection and refresh the page.',
  previous: 'Previous',
  next: 'Next',
  pageof: 'Page {page} of {pages}',
  lidarrunreachable:
    'Shufflerr couldn’t reach {names}, so some quality names are missing.',
});

const FILTERS: RequestFilter[] = [
  'all',
  'pending',
  'approved',
  'available',
  'declined',
  'failed',
];
const PAGE_SIZE = 20;

const RequestList = () => {
  const intl = useIntl();
  const router = useRouter();
  const { user, hasPermission } = useUser();

  const manage = hasPermission(Permission.MANAGE_REQUESTS);
  const seesAll = hasPermission(
    [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
    { type: 'or' }
  );

  const queryFilter = String(router.query.filter ?? 'all') as RequestFilter;
  const filter = FILTERS.includes(queryFilter) ? queryFilter : 'all';
  const sort = router.query.sort === 'modified' ? 'modified' : 'added';
  const page = Math.max(1, Number(router.query.page) || 1);

  const setQuery = (next: Record<string, string | undefined>) => {
    const query: Record<string, string> = {};
    const merged = {
      filter,
      sort,
      page: String(page),
      ...next,
    };
    if (merged.filter && merged.filter !== 'all') {
      query.filter = merged.filter;
    }
    if (merged.sort && merged.sort !== 'added') {
      query.sort = merged.sort;
    }
    if (merged.page && merged.page !== '1') {
      query.page = merged.page;
    }
    router.replace({ pathname: '/requests', query }, undefined, {
      shallow: true,
    });
  };

  const { data: counts, mutate: revalidateCounts } =
    useSWR<RequestCountResponse>('/api/v1/request/count');
  const { data: quota } = useSWR<QuotaResponse>(
    user ? `/api/v1/user/${user.id}/quota` : null
  );
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<RequestResultsResponse>(
    `/api/v1/request?take=${PAGE_SIZE}&skip=${
      (page - 1) * PAGE_SIZE
    }&filter=${filter}&sort=${sort}`,
    {
      // Live updates come over SSE; this is a slow fallback while downloading.
      refreshInterval: (latest) =>
        latest?.results.some((r) => r.status === MediaRequestStatus.APPROVED)
          ? 60000
          : 0,
    }
  );

  const onChange = () => {
    revalidate();
    revalidateCounts();
  };

  const countFor = (value: RequestFilter): number | undefined => {
    if (!counts) {
      return undefined;
    }
    return value === 'all' ? counts.total : counts[value];
  };

  const chipLabels: Record<string, string> = {
    all: intl.formatMessage(messages.all),
    pending: intl.formatMessage(messages.waiting),
    approved: intl.formatMessage(messages.downloading),
    available: intl.formatMessage(messages.available),
    declined: intl.formatMessage(messages.declined),
    failed: intl.formatMessage(messages.failed),
  };

  const title = intl.formatMessage(
    seesAll ? messages.requests : messages.yourrequests
  );
  const limitDays = quota?.album.days ?? quota?.track.days ?? 7;
  const unreachable = data?.serviceErrors?.lidarr ?? [];
  const pages = data?.pageInfo.pages ?? 1;

  return (
    <>
      <PageHeader
        title={title}
        description={
          manage
            ? intl.formatMessage(messages.submanage, {
                count: counts?.pending ?? 0,
              })
            : intl.formatMessage(messages.subown)
        }
        actions={
          quota ? (
            <div className="sh-box min-w-[240px] px-4 py-3 text-[13px] text-muted">
              {limitDays === 7
                ? intl.formatMessage(messages.limit)
                : intl.formatMessage(messages.limitdays, {
                    days: limitDays,
                  })}{' '}
              {quota.album.limit
                ? intl.formatMessage(messages.limitalbums, {
                    remaining: (
                      <b key="album" className="text-ink">
                        {quota.album.remaining ?? 0}
                      </b>
                    ),
                    limit: quota.album.limit,
                  })
                : intl.formatMessage(messages.unlimitedalbums)}
              {', '}
              {quota.track.limit
                ? intl.formatMessage(messages.limittracks, {
                    remaining: (
                      <b key="track" className="text-ink">
                        {quota.track.remaining ?? 0}
                      </b>
                    ),
                    limit: quota.track.limit,
                  })
                : intl.formatMessage(messages.unlimitedtracks)}
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          aria-label={intl.formatMessage(messages.filterlabel)}
          value={filter}
          onChange={(value) => setQuery({ filter: value, page: '1' })}
          chips={FILTERS.map((value) => ({
            value,
            label: chipLabels[value],
            count: countFor(value),
          }))}
        />
        <select
          aria-label={intl.formatMessage(messages.sort)}
          className="!w-auto !flex-none"
          value={sort}
          onChange={(e) => setQuery({ sort: e.target.value, page: '1' })}
        >
          <option value="added">
            {intl.formatMessage(messages.sortadded)}
          </option>
          <option value="modified">
            {intl.formatMessage(messages.sortmodified)}
          </option>
        </select>
      </div>

      {unreachable.length > 0 && (
        <div className="sh-outcome wait" role="status">
          {intl.formatMessage(messages.lidarrunreachable, {
            names: unreachable.map((s) => s.name).join(', '),
          })}
        </div>
      )}

      <div className="sh-box sh-scroll-x">
        <div className="sh-table" role="table" style={{ minWidth: 1080 }}>
          <div
            className="sh-tr head"
            role="row"
            style={{ gridTemplateColumns: REQUEST_COLUMNS }}
          >
            <span role="columnheader">
              <span className="sr-only">
                {intl.formatMessage(messages.colcover)}
              </span>
            </span>
            <span role="columnheader">
              {intl.formatMessage(messages.colrequest)}
            </span>
            <span role="columnheader">
              {intl.formatMessage(messages.coltype)}
            </span>
            <span role="columnheader">
              {intl.formatMessage(messages.colrequestedby)}
            </span>
            <span role="columnheader">
              {intl.formatMessage(messages.collastchange)}
            </span>
            <span role="columnheader">
              {intl.formatMessage(messages.colstatus)}
            </span>
            <span role="columnheader">
              <span className="sr-only">
                {intl.formatMessage(messages.colactions)}
              </span>
            </span>
          </div>
          {error ? (
            <div className="px-4 py-10 text-center text-muted" role="alert">
              {intl.formatMessage(messages.loaderror)}
            </div>
          ) : !data ? (
            <div className="px-4 py-10">
              <LoadingSpinner />
            </div>
          ) : data.results.length ? (
            data.results.map((request) => (
              <RequestItem
                key={request.id}
                request={request}
                onChange={onChange}
              />
            ))
          ) : (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-muted">
              {filter !== 'all' || (counts && counts.total > 0) ? (
                intl.formatMessage(messages.emptyfilter)
              ) : (
                <>
                  <span>
                    {intl.formatMessage(
                      seesAll ? messages.emptyallmanage : messages.emptyall
                    )}
                  </span>
                  <Link href="/search" className="sh-btn small">
                    {intl.formatMessage(messages.searchmusic)}
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {pages > 1 && (
        <nav
          className="flex items-center justify-between gap-3"
          aria-label={intl.formatMessage(messages.pageof, { page, pages })}
        >
          <Button
            buttonSize="sm"
            disabled={page <= 1}
            onClick={() => setQuery({ page: String(page - 1) })}
          >
            {intl.formatMessage(messages.previous)}
          </Button>
          <span className="font-mono text-[13px] text-faint">
            {intl.formatMessage(messages.pageof, { page, pages })}
          </span>
          <Button
            buttonSize="sm"
            disabled={page >= pages}
            onClick={() => setQuery({ page: String(page + 1) })}
          >
            {intl.formatMessage(messages.next)}
          </Button>
        </nav>
      )}
    </>
  );
};

export default RequestList;
