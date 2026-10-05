// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: src/components/UserList/PlexImportModal.tsx and JellyfinImportModal.tsx at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import { apiErrorMessage } from '@app/components/UserProfile/shared';
import defineMessages from '@app/utils/defineMessages';
import type {
  ImportableUser,
  ImportUsersResponse,
} from '@server/interfaces/api/userInterfaces';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.UserList.ImportUsersModal', {
  title: 'Import {server} users',
  intro:
    'These {server} users can see your music library but don’t have a Shufflerr account yet. They’ll get the default permissions.',
  empty:
    'There are no {server} users to import. Everyone with access already has an account.',
  loadError:
    'The {server} user list didn’t load. Check the {server} connection in Settings and try again.',
  importError: 'The users weren’t imported. Try again.',
  importUsers: 'Import users',
  importing: 'Importing…',
  cancel: 'Cancel',
  close: 'Close',
});

interface ImportUsersModalProps {
  kind: 'plex' | 'jellyfin';
  /** Display name: "Plex", "Jellyfin" or "Emby". */
  serverName: string;
  onClose: () => void;
  onImported: (count: number) => void;
}

const ImportUsersModal = ({
  kind,
  serverName,
  onClose,
  onImported,
}: ImportUsersModalProps) => {
  const intl = useIntl();
  const { data, error } = useSWR<ImportableUser[]>(
    `/api/v1/settings/${kind}/users`,
    { revalidateOnFocus: false }
  );
  const [selected, setSelected] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Default: everyone checked.
  useEffect(() => {
    if (data && selected === null) {
      setSelected(data.map((u) => u.id));
    }
  }, [data, selected]);

  const chosen = selected ?? [];
  const hasUsers = !!data && data.length > 0;

  const submit = async () => {
    setSaving(true);
    setImportError(null);
    try {
      const { data: created } = await axios.post<ImportUsersResponse>(
        `/api/v1/user/import-from-${kind}`,
        kind === 'plex' ? { plexIds: chosen } : { jellyfinUserIds: chosen }
      );
      onImported(created.length);
    } catch (e) {
      setImportError(
        apiErrorMessage(e, intl.formatMessage(messages.importError))
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={intl.formatMessage(messages.title, { server: serverName })}
      onCancel={onClose}
      cancelText={intl.formatMessage(
        hasUsers ? messages.cancel : messages.close
      )}
      onOk={hasUsers ? submit : undefined}
      okText={intl.formatMessage(
        saving ? messages.importing : messages.importUsers
      )}
      okButtonType="primary"
      okDisabled={saving || chosen.length === 0}
    >
      {!data && !error && <LoadingSpinner />}
      {error && (
        <p role="alert" className="m-0 text-st-declined">
          {intl.formatMessage(messages.loadError, { server: serverName })}
        </p>
      )}
      {data && !hasUsers && (
        <p className="m-0">
          {intl.formatMessage(messages.empty, { server: serverName })}
        </p>
      )}
      {hasUsers && (
        <>
          <p className="sh-sub m-0">
            {intl.formatMessage(messages.intro, { server: serverName })}
          </p>
          <div className="sh-checks">
            {data.map((u) => (
              <label key={u.id}>
                <input
                  type="checkbox"
                  checked={chosen.includes(u.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...chosen, u.id]
                        : chosen.filter((id) => id !== u.id)
                    )
                  }
                />
                <span>
                  {u.username}
                  {u.email && <small>{u.email}</small>}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
      {importError && (
        <p role="alert" className="m-0 text-sm text-st-declined">
          {importError}
        </p>
      )}
    </Modal>
  );
};

export default ImportUsersModal;
