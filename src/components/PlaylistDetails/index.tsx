import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import EmptyState from '@app/components/Common/EmptyState';
import Field from '@app/components/Common/Field';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageHeader from '@app/components/Common/PageHeader';
import CoverArt from '@app/components/CoverArt';
import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import { coverUrl } from '@app/utils/images';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type {
  PlaylistDetail,
  PlaylistItemResult,
} from '@server/interfaces/api/playlistInterfaces';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.PlaylistDetails', {
  back: 'All playlists',
  rename: 'Rename',
  renameTitle: 'Rename playlist',
  save: 'Save changes',
  saving: 'Saving…',
  name: 'Name',
  nameRequired: 'Give the playlist a name.',
  descriptionLabel: 'Description',
  descriptionOptional: 'Optional',
  cancel: 'Cancel',
  renamed: 'Saved your changes.',
  renameError: 'Your changes were not saved. Try again in a moment.',
  deletePlaylist: 'Delete playlist',
  deleteConfirm: 'Delete it?',
  deleted: 'Deleted the playlist.',
  deleteError: 'The playlist was not deleted. Try again in a moment.',
  trackcount: '{count, plural, one {# item} other {# items}}',
  colItem: 'Album or track',
  colType: 'Type',
  colActions: 'Actions',
  album: 'Album',
  track: 'Track',
  untitled: 'Untitled',
  moveUp: 'Move {title} up',
  moveDown: 'Move {title} down',
  remove: 'Remove {title}',
  removed: 'Removed {title}.',
  removeError: 'It was not removed. Try again in a moment.',
  reorderError: 'The new order was not saved. Try again in a moment.',
  empty: 'This playlist is empty',
  emptyNext:
    'Open an album or track and choose “Add to playlist” to put it here.',
  loadError:
    'Shufflerr could not load this playlist. It may have been deleted. Go back to all playlists.',
});

const COLUMNS = '48px 2.4fr 0.8fr 150px';

const RenameModal = ({
  playlist,
  onCancel,
  onSaved,
}: {
  playlist: PlaylistDetail;
  onCancel: () => void;
  onSaved: (updated: PlaylistDetail) => void;
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description ?? '');
  const [nameError, setNameError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      setNameError(true);
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await axios.put<PlaylistDetail>(
        `/api/v1/playlist/${playlist.id}`,
        { name: name.trim(), description: description.trim() || null }
      );
      addToast(intl.formatMessage(messages.renamed), { appearance: 'success' });
      onSaved(data);
    } catch {
      addToast(intl.formatMessage(messages.renameError), {
        appearance: 'error',
      });
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={intl.formatMessage(messages.renameTitle)}
      onCancel={onCancel}
      onOk={submit}
      okButtonType="primary"
      okDisabled={submitting}
      okText={
        submitting
          ? intl.formatMessage(messages.saving)
          : intl.formatMessage(messages.save)
      }
      cancelText={intl.formatMessage(messages.cancel)}
    >
      <div className="sh-fields">
        <Field
          label={intl.formatMessage(messages.name)}
          required
          full
          error={
            nameError ? intl.formatMessage(messages.nameRequired) : undefined
          }
        >
          {({ id, ...aria }) => (
            <input
              {...aria}
              id={id}
              type="text"
              value={name}
              maxLength={200}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) {
                  setNameError(false);
                }
              }}
            />
          )}
        </Field>
        <Field
          label={intl.formatMessage(messages.descriptionLabel)}
          hint={intl.formatMessage(messages.descriptionOptional)}
          full
        >
          {({ id, ...aria }) => (
            <textarea
              {...aria}
              id={id}
              rows={3}
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
};

const PlaylistDetails = () => {
  const intl = useIntl();
  const router = useRouter();
  const { addToast } = useToasts();
  const id = router.query.id as string | undefined;
  const [showRename, setShowRename] = useState(false);
  const [busy, setBusy] = useState<number | 'reorder' | null>(null);

  const { data, error, mutate } = useSWR<PlaylistDetail>(
    id ? `/api/v1/playlist/${id}` : null
  );

  if (error) {
    return (
      <>
        <PageHeader title=" " documentTitle="Playlist" />
        <Alert type="error" title={intl.formatMessage(messages.loadError)} />
        <Link className="sh-btn mt-4 inline-flex" href="/playlists">
          {intl.formatMessage(messages.back)}
        </Link>
      </>
    );
  }

  if (!data) {
    return <LoadingSpinner />;
  }

  const items = data.items;

  const titleOf = (item: PlaylistItemResult) =>
    item.title || intl.formatMessage(messages.untitled);

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) {
      return;
    }
    const order = items.map((item) => item.id);
    [order[index], order[target]] = [order[target], order[index]];
    setBusy('reorder');
    try {
      const { data: updated } = await axios.post<PlaylistDetail>(
        `/api/v1/playlist/${data.id}/items/reorder`,
        { itemIds: order }
      );
      mutate(updated, false);
    } catch {
      addToast(intl.formatMessage(messages.reorderError), {
        appearance: 'error',
      });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (item: PlaylistItemResult) => {
    setBusy(item.id);
    try {
      const { data: updated } = await axios.delete<PlaylistDetail>(
        `/api/v1/playlist/${data.id}/items/${item.id}`
      );
      addToast(
        intl.formatMessage(messages.removed, { title: titleOf(item) }),
        { appearance: 'success' }
      );
      mutate(updated, false);
    } catch {
      addToast(intl.formatMessage(messages.removeError), {
        appearance: 'error',
      });
    } finally {
      setBusy(null);
    }
  };

  const deletePlaylist = async () => {
    try {
      await axios.delete(`/api/v1/playlist/${data.id}`);
      addToast(intl.formatMessage(messages.deleted), { appearance: 'success' });
      router.push('/playlists');
    } catch {
      addToast(intl.formatMessage(messages.deleteError), {
        appearance: 'error',
      });
    }
  };

  return (
    <>
      <Link className="sh-crumb" href="/playlists">
        {intl.formatMessage(messages.back)}
      </Link>
      <PageHeader
        title={data.name}
        description={
          <>
            {intl.formatMessage(messages.trackcount, { count: items.length })}
            {data.description ? ` · ${data.description}` : ''}
          </>
        }
        actions={
          <>
            <Button onClick={() => setShowRename(true)}>
              {intl.formatMessage(messages.rename)}
            </Button>
            <ConfirmButton
              onClick={deletePlaylist}
              confirmText={intl.formatMessage(messages.deleteConfirm)}
            >
              {intl.formatMessage(messages.deletePlaylist)}
            </ConfirmButton>
          </>
        }
      />
      <section>
        {items.length === 0 ? (
          <EmptyState title={intl.formatMessage(messages.empty)}>
            {intl.formatMessage(messages.emptyNext)}
          </EmptyState>
        ) : (
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
                <div role="columnheader" className="actions">
                  {intl.formatMessage(messages.colActions)}
                </div>
              </div>
              {items.map((item, index) => {
                const isAlbum = item.mediaType === 'release-group';
                const title = titleOf(item);
                return (
                  <div
                    className="sh-tr"
                    role="row"
                    key={item.id}
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
                    <div role="cell" className="min-w-0">
                      {isAlbum ? (
                        <Link className="sh-title" href={`/album/${item.mbid}`}>
                          {title}
                        </Link>
                      ) : (
                        <span className="sh-title">{title}</span>
                      )}
                      {item.artistName && (
                        <span className="block truncate text-sm text-muted">
                          {item.artistName}
                        </span>
                      )}
                    </div>
                    <div role="cell">
                      {intl.formatMessage(
                        isAlbum ? messages.album : messages.track
                      )}
                    </div>
                    <div role="cell" className="actions flex gap-1">
                      <button
                        type="button"
                        className="sh-icon-btn"
                        disabled={index === 0 || busy !== null}
                        aria-label={intl.formatMessage(messages.moveUp, {
                          title,
                        })}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUpIcon className="h-5 w-5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="sh-icon-btn"
                        disabled={index === items.length - 1 || busy !== null}
                        aria-label={intl.formatMessage(messages.moveDown, {
                          title,
                        })}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDownIcon className="h-5 w-5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="sh-icon-btn"
                        disabled={busy !== null}
                        aria-label={intl.formatMessage(messages.remove, {
                          title,
                        })}
                        onClick={() => remove(item)}
                      >
                        <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
      {showRename && (
        <RenameModal
          playlist={data}
          onCancel={() => setShowRename(false)}
          onSaved={(updated) => {
            setShowRename(false);
            mutate(updated, false);
          }}
        />
      )}
    </>
  );
};

export default PlaylistDetails;
