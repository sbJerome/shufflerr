import Button from '@app/components/Common/Button';
import type { ButtonType } from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import { CheckIcon } from '@heroicons/react/24/outline';
import type { PlaylistResult } from '@server/interfaces/api/playlistInterfaces';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.AddToPlaylist', {
  add: 'Add to playlist',
  addTitle: 'Add “{title}” to a playlist',
  addFor: 'Add to a playlist',
  added: 'Added',
  addItem: 'Add to {name}',
  addedTo: 'Added “{title}” to “{name}”.',
  addError: 'It was not added. Try again in a moment.',
  empty: 'You have no playlists yet.',
  newName: 'New playlist name',
  newPlaceholder: 'For example: Friday warm-up',
  createAndAdd: 'Create and add',
  creating: 'Creating…',
  createError: 'The playlist was not created. Try again in a moment.',
  trackcount: '{count, plural, one {# item} other {# items}}',
  close: 'Done',
  loadError: 'Shufflerr could not load your playlists. Close this and retry.',
});

interface AddToPlaylistProps {
  mbid: string;
  mediaType: 'release-group' | 'recording';
  title: string;
  artistName?: string;
  buttonType?: ButtonType;
  buttonSize?: 'default' | 'lg' | 'md' | 'sm';
  className?: string;
  /** Override the trigger label. */
  label?: string;
}

const AddToPlaylist = ({
  mbid,
  mediaType,
  title,
  artistName,
  buttonType = 'default',
  buttonSize = 'default',
  className,
  label,
}: AddToPlaylistProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const [addedTo, setAddedTo] = useState<number[]>([]);
  const [newName, setNewName] = useState('');

  const { data, error, mutate } = useSWR<PlaylistResult[]>(
    open ? '/api/v1/playlist' : null
  );

  const addItem = async (playlistId: number) => {
    setBusy(playlistId);
    try {
      await axios.post(`/api/v1/playlist/${playlistId}/items`, {
        mbid,
        mediaType,
        title,
        artistName,
      });
      const name =
        data?.find((playlist) => playlist.id === playlistId)?.name ?? '';
      addToast(intl.formatMessage(messages.addedTo, { title, name }), {
        appearance: 'success',
      });
      setAddedTo((prev) => [...prev, playlistId]);
      mutate();
    } catch {
      addToast(intl.formatMessage(messages.addError), { appearance: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const createAndAdd = async () => {
    if (!newName.trim()) {
      return;
    }
    setBusy('new');
    try {
      const { data: created } = await axios.post<{ id: number }>(
        '/api/v1/playlist',
        { name: newName.trim() }
      );
      await axios.post(`/api/v1/playlist/${created.id}/items`, {
        mbid,
        mediaType,
        title,
        artistName,
      });
      addToast(
        intl.formatMessage(messages.addedTo, { title, name: newName.trim() }),
        { appearance: 'success' }
      );
      setAddedTo((prev) => [...prev, created.id]);
      setNewName('');
      mutate();
    } catch {
      addToast(intl.formatMessage(messages.createError), {
        appearance: 'error',
      });
    } finally {
      setBusy(null);
    }
  };

  const close = () => {
    setOpen(false);
    setAddedTo([]);
    setNewName('');
  };

  return (
    <>
      <Button
        buttonType={buttonType}
        buttonSize={buttonSize}
        className={className}
        onClick={() => setOpen(true)}
      >
        {label ?? intl.formatMessage(messages.add)}
      </Button>
      {open && (
        <Modal
          title={intl.formatMessage(messages.addTitle, { title })}
          onCancel={close}
          cancelText={intl.formatMessage(messages.close)}
        >
          {!data && !error && <LoadingSpinner />}
          {error && (
            <p className="sh-sub" role="alert">
              {intl.formatMessage(messages.loadError)}
            </p>
          )}
          {data && (
            <>
              {data.length === 0 ? (
                <p className="sh-sub">{intl.formatMessage(messages.empty)}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.map((playlist) => {
                    const done = addedTo.includes(playlist.id);
                    return (
                      <li
                        key={playlist.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-4 py-3"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">
                            {playlist.name}
                          </span>
                          <span className="font-mono text-xs text-faint">
                            {intl.formatMessage(messages.trackcount, {
                              count: playlist.itemCount,
                            })}
                          </span>
                        </span>
                        <Button
                          buttonSize="sm"
                          buttonType={done ? 'success' : 'default'}
                          disabled={busy !== null || done}
                          aria-label={intl.formatMessage(messages.addItem, {
                            name: playlist.name,
                          })}
                          onClick={() => addItem(playlist.id)}
                        >
                          {done ? (
                            <>
                              <CheckIcon
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                              {intl.formatMessage(messages.added)}
                            </>
                          ) : (
                            intl.formatMessage(messages.add)
                          )}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="mt-4 flex items-end gap-2 border-t border-line pt-4">
                <label className="flex-1">
                  <span className="mb-1 block text-sm text-muted">
                    {intl.formatMessage(messages.newName)}
                  </span>
                  <input
                    type="text"
                    value={newName}
                    maxLength={200}
                    placeholder={intl.formatMessage(messages.newPlaceholder)}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        createAndAdd();
                      }
                    }}
                  />
                </label>
                <Button
                  buttonType="primary"
                  disabled={busy !== null || !newName.trim()}
                  onClick={createAndAdd}
                >
                  {busy === 'new'
                    ? intl.formatMessage(messages.creating)
                    : intl.formatMessage(messages.createAndAdd)}
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
};

export default AddToPlaylist;
