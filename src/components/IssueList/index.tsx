// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import EmptyState from '@app/components/Common/EmptyState';
import FilterChips from '@app/components/Common/FilterChips';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageHeader from '@app/components/Common/PageHeader';
import IssueItem, { ISSUE_COLUMNS } from '@app/components/IssueList/IssueItem';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type { IssueResultsResponse } from '@server/interfaces/api/issueInterfaces';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.IssueList', {
  issues: 'Issues',
  description:
    'Problems people reported with music in the library. Resolve one when it is fixed.',
  descriptionOwn:
    'Problems you reported with music in the library. An admin resolves them when they are fixed.',
  filterLabel: 'Filter issues',
  open: 'Open',
  resolved: 'Resolved',
  all: 'All',
  sortLabel: 'Sort by',
  sortAdded: 'Newest first',
  sortModified: 'Last changed',
  colItem: 'Album or artist',
  colType: 'Problem',
  colReporter: 'Reported by',
  colStatus: 'Status',
  colActions: 'Actions',
  noOpen: 'No open issues',
  noOpenNext:
    'When someone reports a problem from an album page, it shows up here.',
  noResolved: 'Nothing has been resolved yet',
  noIssues: 'No issues reported',
  showAll: 'Show all issues',
  loadError:
    'Shufflerr could not load the issues. Reload the page to try again.',
  previous: 'Previous',
  next: 'Next',
  showing: 'Showing {from}–{to} of {total}',
});

type Filter = 'open' | 'resolved' | 'all';
type Sort = 'added' | 'modified';

interface IssueCounts {
  total: number;
  open: number;
  closed: number;
}

const PAGE_SIZE = 20;

const IssueList = () => {
  const intl = useIntl();
  const router = useRouter();
  const { hasPermission } = useUser();
  const seesAll = hasPermission(
    [Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES],
    { type: 'or' }
  );
  const [filter, setFilter] = useState<Filter>('open');
  const [sort, setSort] = useState<Sort>('added');
  const page = Math.max(1, Number(router.query.page) || 1);

  // Remember filter and sort between visits.
  useEffect(() => {
    try {
      const stored = JSON.parse(
        window.localStorage.getItem('il-filter-settings') ?? '{}'
      );
      if (['open', 'resolved', 'all'].includes(stored.filter)) {
        setFilter(stored.filter);
      }
      if (['added', 'modified'].includes(stored.sort)) {
        setSort(stored.sort);
      }
    } catch {
      // ignore unreadable storage
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        'il-filter-settings',
        JSON.stringify({ filter, sort })
      );
    } catch {
      // ignore unwritable storage
    }
  }, [filter, sort]);

  const { data, error } = useSWR<IssueResultsResponse>(
    `/api/v1/issue?take=${PAGE_SIZE}&skip=${
      (page - 1) * PAGE_SIZE
    }&filter=${filter}&sort=${sort}`
  );
  // Counts are for the whole server, so only people who see every issue get them.
  const { data: counts } = useSWR<IssueCounts>(
    seesAll ? '/api/v1/issue/count' : null
  );

  const setPage = (next: number) =>
    router.push(
      { pathname: router.pathname, query: { page: next } },
      undefined,
      {
        shallow: true,
      }
    );

  const total = data?.pageInfo.results ?? 0;
  const pages = data?.pageInfo.pages ?? 1;

  return (
    <>
      <PageHeader
        title={intl.formatMessage(messages.issues)}
        description={intl.formatMessage(
          seesAll ? messages.description : messages.descriptionOwn
        )}
      />
      <section>
        <div className="sh-toolbar">
          <FilterChips<Filter>
            aria-label={intl.formatMessage(messages.filterLabel)}
            value={filter}
            onChange={(value) => {
              setFilter(value);
              if (page !== 1) {
                setPage(1);
              }
            }}
            chips={[
              {
                value: 'open',
                label: intl.formatMessage(messages.open),
                count: counts?.open,
              },
              {
                value: 'resolved',
                label: intl.formatMessage(messages.resolved),
                count: counts?.closed,
              },
              {
                value: 'all',
                label: intl.formatMessage(messages.all),
                count: counts?.total,
              },
            ]}
          />
          <label className="ml-auto flex items-center gap-2">
            <span className="text-muted">
              {intl.formatMessage(messages.sortLabel)}
            </span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
            >
              <option value="added">
                {intl.formatMessage(messages.sortAdded)}
              </option>
              <option value="modified">
                {intl.formatMessage(messages.sortModified)}
              </option>
            </select>
          </label>
        </div>

        {!data && !error && <LoadingSpinner />}
        {error && (
          <Alert type="error" title={intl.formatMessage(messages.loadError)} />
        )}
        {data && data.results.length === 0 && (
          <EmptyState
            title={intl.formatMessage(
              filter === 'open'
                ? messages.noOpen
                : filter === 'resolved'
                  ? messages.noResolved
                  : messages.noIssues
            )}
            action={
              filter !== 'all' ? (
                <Button buttonSize="sm" onClick={() => setFilter('all')}>
                  {intl.formatMessage(messages.showAll)}
                </Button>
              ) : undefined
            }
          >
            {intl.formatMessage(messages.noOpenNext)}
          </EmptyState>
        )}
        {data && data.results.length > 0 && (
          <>
            <div className="sh-box sh-scroll-x">
              <div className="sh-table" role="table">
                <div
                  className="sh-tr head"
                  role="row"
                  style={{ gridTemplateColumns: ISSUE_COLUMNS }}
                >
                  <div role="columnheader" aria-hidden="true" />
                  <div role="columnheader">
                    {intl.formatMessage(messages.colItem)}
                  </div>
                  <div role="columnheader">
                    {intl.formatMessage(messages.colType)}
                  </div>
                  <div role="columnheader">
                    {intl.formatMessage(messages.colReporter)}
                  </div>
                  <div role="columnheader">
                    {intl.formatMessage(messages.colStatus)}
                  </div>
                  <div role="columnheader" className="actions">
                    {intl.formatMessage(messages.colActions)}
                  </div>
                </div>
                {data.results.map((issue) => (
                  <IssueItem issue={issue} key={issue.id} />
                ))}
              </div>
            </div>
            <nav
              className="mt-4 flex items-center justify-between gap-3"
              aria-label="Pagination"
            >
              <span className="font-mono text-muted">
                {intl.formatMessage(messages.showing, {
                  from: (page - 1) * PAGE_SIZE + 1,
                  to: Math.min(page * PAGE_SIZE, total),
                  total,
                })}
              </span>
              <span className="flex gap-2">
                <Button
                  buttonSize="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  {intl.formatMessage(messages.previous)}
                </Button>
                <Button
                  buttonSize="sm"
                  disabled={page >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  {intl.formatMessage(messages.next)}
                </Button>
              </span>
            </nav>
          </>
        )}
      </section>
    </>
  );
};

export default IssueList;
