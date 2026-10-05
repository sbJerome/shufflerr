import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Panel from '@app/components/Common/Panel';
import { apiMessage } from '@app/components/Settings/shared';
import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type { Library } from '@server/lib/settings';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate as globalMutate } from 'swr';

const messages = defineMessages('components.Settings.MusicLibraries', {
  title: 'Music libraries',
  sub: 'Choose which libraries count toward “already in your library”.',
  sync: 'Sync libraries',
  syncing: 'Syncing…',
  synced:
    'Found {count, number} music {count, plural, one {library} other {libraries}}.',
  syncFailed:
    'Libraries couldn’t be loaded from the server. Save a working connection first, then sync again.',
  toggleFailed: 'That library couldn’t be changed. Try again.',
  empty:
    'No music libraries found yet. Save the connection, then choose “Sync libraries”.',
  loadFailed: 'Libraries couldn’t be loaded. Check the connection above.',
});

interface MusicLibrariesProps {
  /** `/api/v1/settings/plex` or `/api/v1/settings/jellyfin` */
  baseUrl: string;
  /** Called after libraries change, so a parent (the setup wizard) can react. */
  onChange?: (libraries: Library[]) => void;
}

/** Checkbox per music library on the media server; only checked ones are scanned. */
const MusicLibraries = ({ baseUrl, onChange }: MusicLibrariesProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { data, error, mutate } = useSWR<Library[]>(`${baseUrl}/library`);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const update = (libraries: Library[]) => {
    mutate(libraries, false);
    globalMutate(baseUrl);
    onChange?.(libraries);
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const response = await axios.post<Library[]>(`${baseUrl}/library/sync`);
      update(response.data);
      addToast(
        intl.formatMessage(messages.synced, { count: response.data.length }),
        { appearance: 'success' }
      );
    } catch (e) {
      addToast(apiMessage(e, intl.formatMessage(messages.syncFailed)), {
        appearance: 'error',
      });
    } finally {
      setSyncing(false);
    }
  };

  const toggle = async (library: Library, enabled: boolean) => {
    setPending(library.id);
    try {
      const response = await axios.put<Library[]>(
        `${baseUrl}/library/${encodeURIComponent(library.id)}`,
        { enabled }
      );
      update(response.data);
    } catch (e) {
      addToast(apiMessage(e, intl.formatMessage(messages.toggleFailed)), {
        appearance: 'error',
      });
    } finally {
      setPending(null);
    }
  };

  return (
    <Panel
      title={intl.formatMessage(messages.title)}
      sub={intl.formatMessage(messages.sub)}
      actions={
        <Button type="button" onClick={sync} disabled={syncing}>
          {intl.formatMessage(syncing ? messages.syncing : messages.sync)}
        </Button>
      }
    >
      {error && !data ? (
        <p className="sh-sub">{intl.formatMessage(messages.loadFailed)}</p>
      ) : !data ? (
        <LoadingSpinner />
      ) : data.length === 0 ? (
        <p className="sh-sub">{intl.formatMessage(messages.empty)}</p>
      ) : (
        <div className="sh-checks">
          {data.map((library) => (
            <label key={library.id} className="sh-check">
              <input
                type="checkbox"
                checked={library.enabled}
                disabled={pending === library.id}
                onChange={(e) => toggle(library, e.target.checked)}
              />{' '}
              {library.name}
            </label>
          ))}
        </div>
      )}
    </Panel>
  );
};

export default MusicLibraries;
