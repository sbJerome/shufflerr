// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Avatar from '@app/components/Common/Avatar';
import Button from '@app/components/Common/Button';
import EmptyState from '@app/components/Common/EmptyState';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageHeader from '@app/components/Common/PageHeader';
import RoleBadge from '@app/components/Common/RoleBadge';
import { accountTypeMessage } from '@app/components/Layout/AccountMenu';
import BulkEditModal from '@app/components/UserList/BulkEditModal';
import CreateUserModal from '@app/components/UserList/CreateUserModal';
import ImportUsersModal from '@app/components/UserList/ImportUsersModal';
import { apiErrorMessage } from '@app/components/UserProfile/shared';
import useDebouncedState from '@app/hooks/useDebouncedState';
import useRouteGuard from '@app/hooks/useRouteGuard';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import type { User } from '@app/hooks/useUser';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { loginMethods } from '@app/utils/publicSettings';
import type { UserResultsResponse } from '@server/interfaces/api/userInterfaces';
import axios from 'axios';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.UserList', {
  users: 'Users',
  description:
    'Everyone who can sign in to Shufflerr. Permissions decide who can request what and whose requests skip the queue.',
  createLocalUser: 'Create local user',
  importUsers: 'Import {server} users',
  searchUsers: 'Search users',
  sortBy: 'Sort by',
  sortCreated: 'Sort by date joined',
  sortName: 'Sort by name',
  sortRequests: 'Sort by requests',
  sortType: 'Sort by account type',
  sortRole: 'Sort by role',
  editPermissions: 'Edit permissions',
  editPermissionsCount: 'Edit permissions ({count})',
  selectAll: 'Select all',
  selectUser: 'Select {name}',
  colUser: 'User',
  colRequests: 'Requests',
  colType: 'Type',
  colRole: 'Role',
  colJoined: 'Joined',
  colActions: 'Actions',
  requestsOf: '{count, plural, one {# request} other {# requests}} by {name}',
  edit: 'Edit',
  delete: 'Delete',
  deleteTitle: 'Delete {name}?',
  deleteBody:
    'This removes {name}’s account and all {count} of their requests. Music already in the library stays.',
  deleteUser: 'Delete user',
  deleting: 'Deleting…',
  cancel: 'Cancel',
  deleted: 'Deleted {name}.',
  deleteError: '{name} wasn’t deleted. Try again.',
  created: 'Created {name}.',
  createdEmailed: 'Created {name}. A password was emailed to them.',
  imported:
    'Imported {count, plural, one {# {server} user} other {# {server} users}} with the default permissions.',
  savedPermissions:
    'Saved permissions for {count, plural, one {# user} other {# users}}.',
  noMatches: 'No users match that search',
  noMatchesHint: 'Try a different name or email address.',
  loadError: 'The user list didn’t load',
  loadErrorHint: 'Check your connection and reload the page.',
  previous: 'Previous',
  next: 'Next',
  pageOf: 'Page {page} of {pages}',
  credit:
    'The user system, permissions and approval rules are adapted from Seerr (github.com/seerr-team/seerr), MIT License.',
});

type Sort = 'created' | 'displayname' | 'requests' | 'usertype' | 'role';

const PAGE_SIZE = 25;
const COLUMNS = '32px 44px minmax(200px,1.6fr) 90px 120px 90px 150px 180px';

const UserList = () => {
  useRouteGuard(Permission.MANAGE_USERS);
  const intl = useIntl();
  const { addToast } = useToasts();
  const { currentSettings } = useSettings();
  const { user: currentUser } = useUser();
  const methods = loginMethods(currentSettings);

  const [search, debouncedSearch, setSearch] = useDebouncedState('');
  const [sort, setSort] = useState<Sort>('created');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [modal, setModal] = useState<
    | { type: 'create' }
    | { type: 'import'; kind: 'plex' | 'jellyfin' }
    | { type: 'bulk' }
    | { type: 'delete'; user: User }
    | null
  >(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, sort]);

  const query = new URLSearchParams({
    take: String(PAGE_SIZE),
    skip: String((page - 1) * PAGE_SIZE),
    sort,
  });
  if (debouncedSearch.trim()) {
    query.set('q', debouncedSearch.trim());
  }
  const { data, error, mutate } = useSWR<UserResultsResponse>(
    `/api/v1/user?${query.toString()}`
  );

  const users = data?.results ?? [];
  const selectable = users.filter((u) => u.id !== 1);
  const selectedUsers = users.filter((u) => selected.includes(u.id));
  const allSelected =
    selectable.length > 0 && selectable.every((u) => selected.includes(u.id));
  const pages = data?.pageInfo.pages ?? 1;

  const close = () => setModal(null);

  const deleteUser = async (target: User) => {
    setDeleting(true);
    try {
      await axios.delete(`/api/v1/user/${target.id}`);
      addToast(
        intl.formatMessage(messages.deleted, { name: target.displayName }),
        { appearance: 'success' }
      );
      setSelected((ids) => ids.filter((id) => id !== target.id));
      close();
      mutate();
    } catch (e) {
      addToast(
        apiErrorMessage(
          e,
          intl.formatMessage(messages.deleteError, {
            name: target.displayName,
          })
        ),
        { appearance: 'error' }
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={intl.formatMessage(messages.users)}
        description={intl.formatMessage(messages.description)}
        actions={
          <>
            {methods.local && (
              <Button onClick={() => setModal({ type: 'create' })}>
                {intl.formatMessage(messages.createLocalUser)}
              </Button>
            )}
            {currentSettings.integrations?.plex && (
              <Button
                onClick={() => setModal({ type: 'import', kind: 'plex' })}
              >
                {intl.formatMessage(messages.importUsers, { server: 'Plex' })}
              </Button>
            )}
            {currentSettings.integrations?.jellyfin && (
              <Button
                onClick={() => setModal({ type: 'import', kind: 'jellyfin' })}
              >
                {intl.formatMessage(messages.importUsers, {
                  server: methods.jellyfinName,
                })}
              </Button>
            )}
          </>
        }
      />

      <section className="flex flex-col gap-4">
        <div className="sh-toolbar">
          <div className="sh-searchbox">
            <label htmlFor="user-search" className="sr-only">
              {intl.formatMessage(messages.searchUsers)}
            </label>
            <input
              id="user-search"
              type="search"
              placeholder={intl.formatMessage(messages.searchUsers)}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="user-sort" className="sr-only">
              {intl.formatMessage(messages.sortBy)}
            </label>
            <select
              id="user-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
            >
              <option value="created">
                {intl.formatMessage(messages.sortCreated)}
              </option>
              <option value="displayname">
                {intl.formatMessage(messages.sortName)}
              </option>
              <option value="requests">
                {intl.formatMessage(messages.sortRequests)}
              </option>
              <option value="usertype">
                {intl.formatMessage(messages.sortType)}
              </option>
              <option value="role">
                {intl.formatMessage(messages.sortRole)}
              </option>
            </select>
          </div>
          <Button
            disabled={selectedUsers.length === 0}
            onClick={() => setModal({ type: 'bulk' })}
          >
            {selectedUsers.length > 0
              ? intl.formatMessage(messages.editPermissionsCount, {
                  count: selectedUsers.length,
                })
              : intl.formatMessage(messages.editPermissions)}
          </Button>
        </div>

        {!data && !error && <LoadingSpinner />}
        {error && !data && (
          <EmptyState title={intl.formatMessage(messages.loadError)}>
            {intl.formatMessage(messages.loadErrorHint)}
          </EmptyState>
        )}
        {data && users.length === 0 && (
          <EmptyState title={intl.formatMessage(messages.noMatches)}>
            {intl.formatMessage(messages.noMatchesHint)}
          </EmptyState>
        )}

        {data && users.length > 0 && (
          <div className="sh-box sh-scroll-x">
            <div className="sh-table" role="table" style={{ minWidth: 980 }}>
              <div
                className="sh-tr head"
                role="row"
                style={{ gridTemplateColumns: COLUMNS }}
              >
                <span role="columnheader">
                  <input
                    type="checkbox"
                    aria-label={intl.formatMessage(messages.selectAll)}
                    checked={allSelected}
                    disabled={selectable.length === 0}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? selectable.map((u) => u.id) : []
                      )
                    }
                  />
                </span>
                <span role="columnheader" aria-hidden="true" />
                <span role="columnheader">
                  {intl.formatMessage(messages.colUser)}
                </span>
                <span role="columnheader">
                  {intl.formatMessage(messages.colRequests)}
                </span>
                <span role="columnheader">
                  {intl.formatMessage(messages.colType)}
                </span>
                <span role="columnheader">
                  {intl.formatMessage(messages.colRole)}
                </span>
                <span role="columnheader">
                  {intl.formatMessage(messages.colJoined)}
                </span>
                <span role="columnheader" className="sr-only">
                  {intl.formatMessage(messages.colActions)}
                </span>
              </div>
              {users.map((u) => {
                const isOwner = u.id === 1;
                // Only the owner edits the owner.
                const editLocked = isOwner && currentUser?.id !== 1;
                const isSelected = selected.includes(u.id);
                return (
                  <div
                    key={u.id}
                    className={`sh-tr ${isSelected ? 'sel' : ''}`}
                    role="row"
                    style={{ gridTemplateColumns: COLUMNS }}
                    data-testid="user-list-row"
                  >
                    <span role="cell">
                      <input
                        type="checkbox"
                        aria-label={intl.formatMessage(messages.selectUser, {
                          name: u.displayName,
                        })}
                        checked={isSelected}
                        disabled={isOwner}
                        onChange={(e) =>
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, u.id]
                              : ids.filter((id) => id !== u.id)
                          )
                        }
                      />
                    </span>
                    <span role="cell">
                      <Link
                        href={`/users/${u.id}`}
                        aria-label={u.displayName}
                        tabIndex={-1}
                      >
                        <Avatar name={u.displayName} src={u.avatar} size="sm" />
                      </Link>
                    </span>
                    <span role="cell" className="min-w-0">
                      <Link
                        href={`/users/${u.id}`}
                        className="sh-title text-ink"
                      >
                        {u.displayName}
                      </Link>
                      <br />
                      <span className="sh-feat">{u.email}</span>
                    </span>
                    <span role="cell">
                      <Link
                        href={`/users/${u.id}/requests`}
                        className="num"
                        aria-label={intl.formatMessage(messages.requestsOf, {
                          count: u.requestCount ?? 0,
                          name: u.displayName,
                        })}
                      >
                        {u.requestCount ?? 0}
                      </Link>
                    </span>
                    <span role="cell" className="dim">
                      {intl.formatMessage(accountTypeMessage(u.userType))}
                    </span>
                    <span role="cell">
                      <RoleBadge user={u} />
                    </span>
                    <span role="cell" className="dim">
                      {intl.formatDate(u.createdAt, {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </span>
                    <span role="cell" className="actions">
                      {editLocked ? (
                        <span
                          className="sh-btn small"
                          aria-disabled="true"
                          style={{ opacity: 0.5 }}
                        >
                          {intl.formatMessage(messages.edit)}
                        </span>
                      ) : (
                        <Link
                          href={`/users/${u.id}/settings`}
                          className="sh-btn small"
                        >
                          {intl.formatMessage(messages.edit)}
                        </Link>
                      )}
                      <button
                        type="button"
                        className="sh-btn small no"
                        disabled={isOwner || u.id === currentUser?.id}
                        onClick={() => setModal({ type: 'delete', user: u })}
                      >
                        {intl.formatMessage(messages.delete)}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {data && pages > 1 && (
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

        <p className="sh-credit">{intl.formatMessage(messages.credit)}</p>
      </section>

      {modal?.type === 'create' && (
        <CreateUserModal
          onClose={close}
          onCreated={(created, emailed) => {
            addToast(
              intl.formatMessage(
                emailed ? messages.createdEmailed : messages.created,
                { name: created.displayName ?? created.username }
              ),
              { appearance: 'success' }
            );
            close();
            mutate();
          }}
        />
      )}
      {modal?.type === 'import' && (
        <ImportUsersModal
          kind={modal.kind}
          serverName={modal.kind === 'plex' ? 'Plex' : methods.jellyfinName}
          onClose={close}
          onImported={(count) => {
            addToast(
              intl.formatMessage(messages.imported, {
                count,
                server: modal.kind === 'plex' ? 'Plex' : methods.jellyfinName,
              }),
              { appearance: 'success' }
            );
            close();
            mutate();
          }}
        />
      )}
      {modal?.type === 'bulk' && (
        <BulkEditModal
          users={selectedUsers}
          onClose={close}
          onSaved={(count) => {
            addToast(intl.formatMessage(messages.savedPermissions, { count }), {
              appearance: 'success',
            });
            setSelected([]);
            close();
            mutate();
          }}
        />
      )}
      {modal?.type === 'delete' && (
        <Modal
          title={intl.formatMessage(messages.deleteTitle, {
            name: modal.user.displayName,
          })}
          onCancel={close}
          cancelText={intl.formatMessage(messages.cancel)}
          onOk={() => deleteUser(modal.user)}
          okText={intl.formatMessage(
            deleting ? messages.deleting : messages.deleteUser
          )}
          okButtonType="danger"
          okDisabled={deleting}
        >
          <p className="m-0">
            {intl.formatMessage(messages.deleteBody, {
              name: modal.user.displayName,
              count: modal.user.requestCount ?? 0,
            })}
          </p>
        </Modal>
      )}
    </>
  );
};

export default UserList;
