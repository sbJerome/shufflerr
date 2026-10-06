import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import CoverArt from '@app/components/CoverArt';
import StatusBadge from '@app/components/StatusBadge';
import {
  requestTitle,
  scopeLabel,
} from '@app/components/UserProfile/RequestTitle';
import {
  requestHref,
  timeAgo,
  useProfileUser,
} from '@app/components/UserProfile/shared';
import defineMessages from '@app/utils/defineMessages';
import { isDownloading } from '@app/utils/status';
import type { UserRequestsResponse } from '@server/interfaces/api/userInterfaces';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.UserProfile.Requests', {
  emptyOther: '{name} hasn’t requested anything yet.',
  emptySelf:
    'You haven’t requested anything yet. Search for an album to start.',
  searchMusic: 'Search music',
  loadError: 'The requests didn’t load. Reload the page to try again.',
  previous: 'Previous',
  next: 'Next',
  pageOf: 'Page {page} of {pages}',
  listLabel: 'Requests by {name}',
});

const PAGE_SIZE = 20;

const Requests = () => {
  const intl = useIntl();
  const { user, isSelf } = useProfileUser();
  const [page, setPage] = useState(1);
  const { data, error } = useSWR<UserRequestsResponse>(
    user
      ? `/api/v1/user/${user.id}/requests?take=${PAGE_SIZE}&skip=${
          (page - 1) * PAGE_SIZE
        }`
      : null
  );

  if (!user) {
    return null;
  }
  if (error && !data) {
    return (
      <div className="sh-box p-7 text-muted" role="alert">
        {intl.formatMessage(messages.loadError)}
      </div>
    );
  }
  if (!data) {
    return <LoadingSpinner />;
  }
  if (data.results.length === 0) {
    return (
      <div className="sh-box flex flex-wrap items-center justify-between gap-4 p-7 text-muted">
        <span>
          {isSelf
            ? intl.formatMessage(messages.emptySelf)
            : intl.formatMessage(messages.emptyOther, {
                name: user.displayName,
              })}
        </span>
        {isSelf && (
          <Link href="/search" className="sh-btn small">
            {intl.formatMessage(messages.searchMusic)}
          </Link>
        )}
      </div>
    );
  }

  const pages = data.pageInfo.pages;

  return (
    <>
      <div className="sh-box">
        <ul
          className="sh-list"
          aria-label={intl.formatMessage(messages.listLabel, {
            name: user.displayName,
          })}
        >
          {data.results.map((r) => (
            <li key={r.id}>
              <span className="w-12 flex-none">
                <CoverArt
                  thumb
                  decorative
                  src={r.coverUrl}
                  mbid={r.media?.mbid}
                  title={r.media?.title}
                />
              </span>
              <div className="grow">
                <Link href={requestHref(r)} className="sh-title text-ink">
                  {requestTitle(intl, r)}
                </Link>
                <span className="sh-feat">
                  {[r.media?.artistName, scopeLabel(intl, r)]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </div>
              <span className="who">{timeAgo(r.createdAt, intl.locale)}</span>
              <StatusBadge
                requestStatus={r.status}
                downloading={isDownloading(r)}
              />
            </li>
          ))}
        </ul>
      </div>
      {pages > 1 && (
        <nav
          className="flex items-center justify-between gap-3"
          aria-label="Pagination"
        >
          <Button
            buttonSize="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {intl.formatMessage(messages.previous)}
          </Button>
          <span className="sh-feat">
            {intl.formatMessage(messages.pageOf, { page, pages })}
          </span>
          <Button
            buttonSize="sm"
            disabled={page >= pages}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
          >
            {intl.formatMessage(messages.next)}
          </Button>
        </nav>
      )}
    </>
  );
};

export default Requests;
