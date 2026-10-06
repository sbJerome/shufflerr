import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import EmptyState from '@app/components/Common/EmptyState';
import Field from '@app/components/Common/Field';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageHeader from '@app/components/Common/PageHeader';
import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type { PlaylistResult } from '@server/interfaces/api/playlistInterfaces';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Playlists', {
  playlists: 'Playlists',
  description:
    'Your own playlists. They live in Shufflerr and are not synced to your media server.',
  newplaylist: 'New playlist',
  create: 'Create playlist',
  creating: 'Creating…',
  name: 'Name',
  namePlaceholder: 'For example: Friday warm-up',
  nameRequired: 'Give the playlist a name.',
  descriptionLabel: 'Description',
  descriptionOptional: 'Optional',
  descriptionPlaceholder: 'What is this playlist for?',
  cancel: 'Cancel',
  created: 'Created “{name}”.',
  createError: 'The playlist was not created. Try again in a moment.',
  trackcount: '{count, plural, one {# item} other {# items}}',
  updated: 'Updated {date}',
  empty: 'You have no playlists yet',
  emptyNext: 'Create one, then add albums and tracks from their pages.',
  loadError:
    'Shufflerr could not load your playlists. Reload the page to try again.',
  open: 'Open {name}',
});

const CreatePlaylistModal = ({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (playlist: { id: number; name: string }) => void;
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      setNameError(true);
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await axios.post<{ id: number; name: string }>(
        '/api/v1/playlist',
        {
          name: name.trim(),
          description: description.trim() || undefined,
        }
      );
      addToast(intl.formatMessage(messages.created, { name: data.name }), {
        appearance: 'success',
      });
      onCreated(data);
    } catch {
      addToast(intl.formatMessage(messages.createError), {
        appearance: 'error',
      });
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={intl.formatMessage(messages.newplaylist)}
      onCancel={onCancel}
      onOk={submit}
      okText={
        submitting
          ? intl.formatMessage(messages.creating)
          : intl.formatMessage(messages.create)
      }
      okButtonType="primary"
      okDisabled={submitting}
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
              placeholder={intl.formatMessage(messages.namePlaceholder)}
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
              placeholder={intl.formatMessage(messages.descriptionPlaceholder)}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
};

const Playlists = () => {
  const intl = useIntl();
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const { data, error, mutate } = useSWR<PlaylistResult[]>('/api/v1/playlist');

  return (
    <>
      <PageHeader
        title={intl.formatMessage(messages.playlists)}
        description={intl.formatMessage(messages.description)}
        actions={
          <Button buttonType="primary" onClick={() => setShowCreate(true)}>
            {intl.formatMessage(messages.newplaylist)}
          </Button>
        }
      />
      <section>
        {!data && !error && <LoadingSpinner />}
        {error && (
          <Alert type="error" title={intl.formatMessage(messages.loadError)} />
        )}
        {data && data.length === 0 && (
          <EmptyState
            title={intl.formatMessage(messages.empty)}
            action={
              <Button buttonType="primary" onClick={() => setShowCreate(true)}>
                {intl.formatMessage(messages.newplaylist)}
              </Button>
            }
          >
            {intl.formatMessage(messages.emptyNext)}
          </EmptyState>
        )}
        {data && data.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((playlist) => (
              <li key={playlist.id} className="min-w-0">
                <Link
                  className="flex min-h-[112px] flex-col gap-2 rounded-2xl border border-line bg-surface p-5 transition hover:border-line-2 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  href={`/playlists/${playlist.id}`}
                  aria-label={intl.formatMessage(messages.open, {
                    name: playlist.name,
                  })}
                >
                  <span className="truncate text-lg font-semibold text-ink">
                    {playlist.name}
                  </span>
                  {playlist.description && (
                    <span className="line-clamp-2 text-sm text-muted">
                      {playlist.description}
                    </span>
                  )}
                  <span className="mt-auto font-mono text-xs text-faint">
                    {intl.formatMessage(messages.trackcount, {
                      count: playlist.itemCount,
                    })}
                    {' · '}
                    {intl.formatMessage(messages.updated, {
                      date: intl.formatDate(playlist.updatedAt, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      }),
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {showCreate && (
        <CreatePlaylistModal
          onCancel={() => setShowCreate(false)}
          onCreated={(playlist) => {
            setShowCreate(false);
            mutate();
            router.push(`/playlists/${playlist.id}`);
          }}
        />
      )}
    </>
  );
};

export default Playlists;
