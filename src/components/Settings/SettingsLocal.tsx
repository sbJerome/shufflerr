import Button from '@app/components/Common/Button';
import Field from '@app/components/Common/Field';
import Panel from '@app/components/Common/Panel';
import SwitchRow from '@app/components/Common/SwitchRow';
import {
  apiMessage,
  PanelError,
  SaveButton,
  ScanPanel,
  SettingsPage,
  useSection,
} from '@app/components/Settings/shared';
import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type {
  LocalFilesSettingsResponse,
  LocalFolderCheckResponse,
} from '@server/interfaces/api/settingsInterfaces';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { mutate as globalMutate } from 'swr';

const messages = defineMessages('components.Settings.SettingsLocal', {
  title: 'Local files',
  description:
    'Read music straight from folders on this server. Connected apps can stream them too.',
  folders: 'Folders',
  use: 'Use local files',
  noFolders: 'No folders yet. Add the folder your music lives in.',
  remove: 'Remove',
  removeLabel: 'Remove {path}',
  removed: 'Removed {path}.',
  removeFailed: 'That folder couldn’t be removed. Try again.',
  addLabel: 'Add a folder',
  addHint:
    'A path inside the Shufflerr container, for example /music. In Docker, mount your music folder read-only.',
  addButton: 'Add folder',
  adding: 'Checking…',
  added: 'Added {path}.',
  mustBeAbsolute: 'Folder paths start with a slash, for example /music.',
  addFailed:
    'That folder couldn’t be added. Check that it exists and that Shufflerr can read it.',
  options: 'Scanning',
  watch: 'Watch folders for changes',
  watchTip: 'New files show up as soon as they’re copied in.',
  rescan: 'Full rescan',
  every15: 'Every 15 minutes',
  hourly: 'Every hour',
  daily: 'Every day',
  sourceName: 'your folders',
});

interface SettingsLocalProps {
  isSetupSettings?: boolean;
  onComplete?: () => void;
}

const SettingsLocal = ({ isSetupSettings, onComplete }: SettingsLocalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const section = useSection<LocalFilesSettingsResponse>(
    '/api/v1/settings/local'
  );
  const { draft, set } = section;
  const [path, setPath] = useState('');
  const [pathError, setPathError] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const refreshFolders = async () => {
    // Keep unsaved switch changes; only the folder list comes from the server.
    const { data: fresh } = await axios.get<LocalFilesSettingsResponse>(
      '/api/v1/settings/local'
    );
    section.setDraft((current) =>
      current ? { ...current, folders: fresh.folders } : fresh
    );
    globalMutate('/api/v1/settings/public');
  };

  const addFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = path.trim();
    if (!value.startsWith('/')) {
      setPathError(intl.formatMessage(messages.mustBeAbsolute));
      return;
    }
    setAdding(true);
    setPathError(undefined);
    try {
      const { data } = await axios.post<LocalFolderCheckResponse>(
        '/api/v1/settings/local/folders',
        { path: value }
      );
      if (data && data.ok === false) {
        setPathError(data.message ?? intl.formatMessage(messages.addFailed));
        return;
      }
      setPath('');
      await refreshFolders();
      addToast(
        intl.formatMessage(messages.added, { path: data?.path ?? value }),
        { appearance: 'success' }
      );
    } catch (err) {
      setPathError(apiMessage(err, intl.formatMessage(messages.addFailed)));
    } finally {
      setAdding(false);
    }
  };

  const removeFolder = async (folder: string) => {
    setRemoving(folder);
    try {
      await axios.delete('/api/v1/settings/local/folders', {
        data: { path: folder },
      });
      await refreshFolders();
      addToast(intl.formatMessage(messages.removed, { path: folder }), {
        appearance: 'success',
      });
    } catch (err) {
      addToast(apiMessage(err, intl.formatMessage(messages.removeFailed)), {
        appearance: 'error',
      });
    } finally {
      setRemoving(null);
    }
  };

  const saveOptions = async (e: React.FormEvent) => {
    e.preventDefault();
    const saved = await section.save({
      body: {
        enabled: !!draft?.enabled,
        watch: !!draft?.watch,
        rescanMinutes: draft?.rescanMinutes ?? 15,
      },
    });
    if (saved) {
      onComplete?.();
    }
  };

  return (
    <SettingsPage
      bare={isSetupSettings}
      title={intl.formatMessage(messages.title)}
      description={intl.formatMessage(messages.description)}
      loading={section.loading}
      loadError={section.loadError}
    >
      {draft && (
        <>
          <Panel title={intl.formatMessage(messages.folders)}>
            {draft.folders?.length ? (
              <div className="sh-box">
                <ul className="sh-list">
                  {draft.folders.map((folder) => (
                    <li key={folder}>
                      <div className="grow font-mono text-[13px]">{folder}</div>
                      <Button
                        type="button"
                        buttonSize="sm"
                        disabled={removing === folder}
                        aria-label={intl.formatMessage(messages.removeLabel, {
                          path: folder,
                        })}
                        onClick={() => removeFolder(folder)}
                      >
                        {intl.formatMessage(messages.remove)}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="sh-sub">{intl.formatMessage(messages.noFolders)}</p>
            )}
            <form onSubmit={addFolder} noValidate>
              <Field
                label={intl.formatMessage(messages.addLabel)}
                hint={intl.formatMessage(messages.addHint)}
                error={pathError}
              >
                {(p) => (
                  <div className="sh-copyrow">
                    <input
                      {...p}
                      type="text"
                      className="font-mono"
                      placeholder="/music"
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                    />
                    <Button
                      type="submit"
                      buttonSize="sm"
                      disabled={adding || !path.trim()}
                    >
                      {intl.formatMessage(
                        adding ? messages.adding : messages.addButton
                      )}
                    </Button>
                  </div>
                )}
              </Field>
            </form>
          </Panel>

          <Panel
            as="form"
            title={intl.formatMessage(messages.options)}
            onSubmit={saveOptions}
            actions={<SaveButton saving={section.saving} />}
          >
            <div className="sh-box">
              <SwitchRow
                label={intl.formatMessage(messages.use)}
                checked={!!draft.enabled}
                onChange={(v) => set('enabled', v)}
              />
              <SwitchRow
                label={intl.formatMessage(messages.watch)}
                description={intl.formatMessage(messages.watchTip)}
                checked={!!draft.watch}
                onChange={(v) => set('watch', v)}
              />
            </div>
            <div className="sh-fields">
              <Field label={intl.formatMessage(messages.rescan)}>
                {(p) => (
                  <select
                    {...p}
                    value={draft.rescanMinutes ?? 15}
                    onChange={(e) =>
                      set('rescanMinutes', Number(e.target.value))
                    }
                  >
                    <option value={15}>
                      {intl.formatMessage(messages.every15)}
                    </option>
                    <option value={60}>
                      {intl.formatMessage(messages.hourly)}
                    </option>
                    <option value={1440}>
                      {intl.formatMessage(messages.daily)}
                    </option>
                  </select>
                )}
              </Field>
            </div>
            <PanelError message={section.saveError} />
          </Panel>

          {!isSetupSettings && (
            <ScanPanel
              url="/api/v1/settings/local/sync"
              source={intl.formatMessage(messages.sourceName)}
              disabled={!draft.enabled || !draft.folders?.length}
            />
          )}
        </>
      )}
    </SettingsPage>
  );
};

export default SettingsLocal;
