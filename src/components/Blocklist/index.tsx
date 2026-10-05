// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Alert from '@app/components/Common/Alert';
import Avatar from '@app/components/Common/Avatar';
import Button from '@app/components/Common/Button';
import EmptyState from '@app/components/Common/EmptyState';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageHeader from '@app/components/Common/PageHeader';
import CoverArt from '@app/components/CoverArt';
import useDebouncedState from '@app/hooks/useDebouncedState';
import { useToasts } from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { coverUrl } from '@app/utils/images';
import type {
  BlocklistItem,
  BlocklistResultsResponse,
} from '@server/interfaces/api/blocklistInterfaces';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { FormattedDate, useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Blocklist', {
  blocklist: 'Blocklist',
  description:
    'Artists and albums nobody can request. Block something from its Manage panel.',
  searchLabel: 'Search the blocklist',
  searchPlaceholder: 'Search blocked artists and albums',
  colItem: 'Artist or album',
  colType: 'Type',
  colBlockedBy: 'Blocked by',
  colDate: 'Blocked on',
  colActions: 'Actions',
  artist: 'Artist',
  album: 'Album',
  untitled: 'Untitled',
  unblock: 'Unblock',
  unblockLabel: 'Unblock {title}',
  unblocked: 'Unblocked {title}.',
  failed: 'It was not unblocked. Try again in a moment.',
  empty: 'Nothing is blocked',
  emptyNext:
    'To block an artist or album, open its page and choose Manage, then Block.',
  noMatch: 'Nothing blocked matches “{query}”',
  noMatchNext: 'Check the spelling or clear the search.',
  loadError:
    'Shufflerr could not load the blocklist. Reload the page to try again.',
  previous: 'Previous',
  next: 'Next',
  showing: 'Showing {from}–{to} of {total}',
});

const PAGE_SIZE = 25;
const COLUMNS = '48px 2fr 0.8fr 1.3fr 1fr 120px';

const Blocklist = () => {
  const intl = useIntl();
  const router = useRouter();
  const { addToast } = useToasts();
  const { hasPermission } = useUser();
  const canManage = hasPermission(Permission.MANAGE_BLOCKLIST);
  const [search, debouncedSearch, setSearch] = useDebouncedState('', 300);
  const [removing, setRemoving] = useState<string | null>(null);
  const page = Math.max(1, Number(router.query.page) || 1);

  const { data, error, mutate } = useSWR<BlocklistResultsResponse>(
    `/api/v1/blocklist?take=${PAGE_SIZE}&skip=${(page - 1) * PAGE_SIZE}${
      debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''
    }`
  );

  const setPage = (next: number) =>
    router.push(
      { pathname: router.pathname, query: { page: next } },
      undefined,
      {
        shallow: true,
      }
    );

  const unblock = async (item: BlocklistItem) => {
    const title = item.title || intl.formatMessage(messages.untitled);
    setRemoving(`${item.mediaType}:${item.mbid}`);
    try {
      await axios.delete(
        `/api/v1/blocklist/${item.mbid}?mediaType=${item.mediaType}`
      );
      addToast(intl.formatMessage(messages.unblocked, { title }), {
        appearance: 'success',
      });
      mutate();
    } catch {
      addToast(intl.formatMessage(messages.failed), { appearance: 'error' });
    } finally {
      setRemoving(null);
    }
  };

  const total = data?.pageInfo.results ?? 0;
  const pages = data?.pageInfo.pages ?? 1;

  return (
    <>
      <PageHeader
        title={intl.formatMessage(messages.blocklist)}
        description={intl.formatMessage(messages.description)}
      />
      <section>
        <div className="sh-toolbar">
          <div className="sh-searchbox">
            <input
              type="search"
              value={search}
              aria-label={intl.formatMessage(messages.searchLabel)}
              placeholder={intl.formatMessage(messages.searchPlaceholder)}
              onChange={(e) => {
                setSearch(e.target.value);
                if (page !== 1) {
                  setPage(1);
                }
              }}
            />
          </div>
        </div>

        {!data && !error && <LoadingSpinner />}
        {error && (
          <Alert type="error" title={intl.formatMessage(messages.loadError)} />
        )}
        {data && data.results.length === 0 && (
          <EmptyState
            title={
              debouncedSearch
                ? intl.formatMessage(messages.noMatch, {
                    query: debouncedSearch,
                  })
                : intl.formatMessage(messages.empty)
            }
          >
            {intl.formatMessage(
              debouncedSearch ? messages.noMatchNext : messages.emptyNext
            )}
          </EmptyState>
        )}
        {data && data.results.length > 0 && (
          <>
            <div className="sh-box sh-scroll-x">
              <div className="sh-table" role="table">
                <div
                  className="sh-tr head"
                  role="row"
                  style={{ gridTemplateColumns: COLUMNS }}
                >
                  <div role="columnheader" aria-hidden="true" />
                  <div role="columnheader">
                    {intl.formatMessage(messages.colItem)}
                  </div>
                  <div role="columnheader">
                    {intl.formatMessage(messages.colType)}
                  </div>
                  <div role="columnheader">
                    {intl.formatMessage(messages.colBlockedBy)}
                  </div>
                  <div role="columnheader">
                    {intl.formatMessage(messages.colDate)}
                  </div>
                  <div role="columnheader" className="actions">
                    {intl.formatMessage(messages.colActions)}
                  </div>
                </div>
                {data.results.map((item) => {
                  const isAlbum = item.mediaType === 'release-group';
                  const title =
                    item.title || intl.formatMessage(messages.untitled);
                  const itemKey = `${item.mediaType}:${item.mbid}`;
                  return (
                    <div
                      className="sh-tr"
                      role="row"
                      key={itemKey}
                      style={{ gridTemplateColumns: COLUMNS }}
                    >
                      <div role="cell">
                        <CoverArt
                          thumb
                          decorative
                          round={!isAlbum}
                          showInitials={!isAlbum}
                          src={isAlbum ? coverUrl(item.mbid, 250) : undefined}
                          mbid={item.mbid}
                          title={title}
                        />
                      </div>
                      <div role="cell">
                        <Link
                          className="sh-title"
                          href={`/${isAlbum ? 'album' : 'artist'}/${item.mbid}`}
                        >
                          {title}
                        </Link>
                      </div>
                      <div role="cell">
                        {intl.formatMessage(
                          isAlbum ? messages.album : messages.artist
                        )}
                      </div>
                      <div role="cell" className="flex items-center gap-2">
                        {item.user && (
                          <>
                            <Avatar
                              size="sm"
                              name={item.user.displayName}
                              src={item.user.avatar}
                            />
                            <span>{item.user.displayName}</span>
                          </>
                        )}
                      </div>
                      <div role="cell" className="dim">
                        {item.createdAt && (
                          <FormattedDate
                            value={item.createdAt}
                            year="numeric"
                            month="short"
                            day="numeric"
                          />
                        )}
                      </div>
                      <div role="cell" className="actions">
                        {canManage && (
                          <Button
                            buttonSize="sm"
                            disabled={removing === itemKey}
                            aria-label={intl.formatMessage(
                              messages.unblockLabel,
                              { title }
                            )}
                            onClick={() => unblock(item)}
                          >
                            {intl.formatMessage(messages.unblock)}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
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

export default Blocklist;
