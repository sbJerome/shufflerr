// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Button from '@app/components/Common/Button';
import Field from '@app/components/Common/Field';
import Panel from '@app/components/Common/Panel';
import SwitchRow from '@app/components/Common/SwitchRow';
import MusicLibraries from '@app/components/Settings/MusicLibraries';
import {
  apiMessage,
  ConnectionStatus,
  NumberInput,
  PanelError,
  SaveButton,
  ScanPanel,
  SettingsPage,
  TestButton,
  useConnectionTest,
  useSection,
} from '@app/components/Settings/shared';
import useSettings from '@app/hooks/useSettings';
import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type {
  PlexServerPreset,
  PlexSettingsResponse,
} from '@server/interfaces/api/settingsInterfaces';
import axios from 'axios';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Settings.SettingsPlex', {
  title: 'Plex',
  description: 'Stream from Plex, sign in with Plex, and see what people play.',
  connection: 'Connection',
  usePlex: 'Use Plex',
  usePlexTip: 'Scan your Plex music libraries and play from them.',
  preset: 'Server',
  manual: 'Manual setup',
  presetHint: 'Or load your servers from plex.tv',
  presetOption: '{name} ({kind}, {address})',
  local: 'local',
  remote: 'remote',
  secure: 'secure',
  hostname: 'Hostname or IP address',
  port: 'Port',
  useSsl: 'Use SSL',
  loadServers: 'Load servers from plex.tv',
  loadingServers: 'Loading servers…',
  foundServers:
    'Found {count, number} {count, plural, one {server} other {servers}} on plex.tv.',
  noServers:
    'plex.tv didn’t return any servers for the owner account. Enter the address yourself.',
  loadServersFailed:
    'Servers couldn’t be loaded from plex.tv. The owner needs to be signed in with Plex; otherwise enter the address yourself.',
  sourceName: 'your Plex music libraries',
  signinTitle: 'Sign-in',
  signinNote: 'Plex sign-in is {state}. New Plex users {newState} sign in.',
  on: 'on',
  off: 'off',
  can: 'can',
  cannot: 'can’t',
  changeSignin: 'Change sign-in methods',
  hostRequired: 'Enter the hostname or IP address of your Plex server.',
});

interface SettingsPlexProps {
  /** Embedded in the setup wizard: no page header, sign-in note or scan panel. */
  isSetupSettings?: boolean;
  onComplete?: () => void;
}

const SettingsPlex = ({ isSetupSettings, onComplete }: SettingsPlexProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { currentSettings } = useSettings();
  const section = useSection<PlexSettingsResponse>('/api/v1/settings/plex');
  const { draft, set, setDraft } = section;
  const test = useConnectionTest('/api/v1/settings/plex/test');
  const [servers, setServers] = useState<PlexServerPreset[] | null>(null);
  const [loadingServers, setLoadingServers] = useState(false);
  const [preset, setPreset] = useState('manual');
  const [hostError, setHostError] = useState<string | undefined>();

  const connection = () => ({
    name: draft?.name,
    machineId: draft?.machineId,
    ip: draft?.ip,
    port: Number(draft?.port),
    useSsl: !!draft?.useSsl,
  });

  const loadServers = async () => {
    setLoadingServers(true);
    try {
      const { data } = await axios.get<PlexServerPreset[]>(
        '/api/v1/settings/plex/devices/servers'
      );
      setServers(data);
      addToast(
        data.length
          ? intl.formatMessage(messages.foundServers, { count: data.length })
          : intl.formatMessage(messages.noServers),
        { appearance: data.length ? 'success' : 'warning' }
      );
    } catch (e) {
      addToast(apiMessage(e, intl.formatMessage(messages.loadServersFailed)), {
        appearance: 'error',
      });
    } finally {
      setLoadingServers(false);
    }
  };

  const presets = (servers ?? []).flatMap((server) =>
    server.connections.map((c) => ({
      key: `${server.machineId}|${c.uri}`,
      server,
      connection: c,
    }))
  );

  const choosePreset = (key: string) => {
    setPreset(key);
    const chosen = presets.find((p) => p.key === key);
    if (!chosen || !draft) {
      return;
    }
    setDraft({
      ...draft,
      name: chosen.server.name,
      machineId: chosen.server.machineId,
      ip: chosen.connection.address,
      port: chosen.connection.port,
      useSsl: chosen.connection.protocol === 'https',
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (draft?.enabled && !draft.ip?.trim()) {
      setHostError(intl.formatMessage(messages.hostRequired));
      return;
    }
    setHostError(undefined);
    const saved = await section.save({
      body: { ...connection(), enabled: !!draft?.enabled },
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
          <Panel
            as="form"
            title={intl.formatMessage(messages.connection)}
            onSubmit={submit}
            actions={
              <>
                <ConnectionStatus result={test.result} />
                <Button
                  type="button"
                  onClick={loadServers}
                  disabled={loadingServers}
                >
                  {intl.formatMessage(
                    loadingServers
                      ? messages.loadingServers
                      : messages.loadServers
                  )}
                </Button>
                <TestButton
                  result={test.result}
                  onClick={() => test.run(connection())}
                  disabled={!draft.ip}
                />
                <SaveButton saving={section.saving} />
              </>
            }
          >
            <div className="sh-box">
              <SwitchRow
                label={intl.formatMessage(messages.usePlex)}
                description={intl.formatMessage(messages.usePlexTip)}
                checked={!!draft.enabled}
                onChange={(v) => set('enabled', v)}
              />
            </div>
            <div className="sh-fields">
              <Field
                full
                label={intl.formatMessage(messages.preset)}
                hint={
                  servers ? undefined : intl.formatMessage(messages.presetHint)
                }
              >
                {(p) => (
                  <select
                    {...p}
                    value={preset}
                    onChange={(e) => choosePreset(e.target.value)}
                  >
                    <option value="manual">
                      {intl.formatMessage(messages.manual)}
                    </option>
                    {presets.map((item) => (
                      <option
                        key={item.key}
                        value={item.key}
                        disabled={
                          item.connection.status !== undefined &&
                          item.connection.status !== 200
                        }
                      >
                        {intl.formatMessage(messages.presetOption, {
                          name: item.server.name,
                          kind: [
                            intl.formatMessage(
                              item.connection.local
                                ? messages.local
                                : messages.remote
                            ),
                            item.connection.protocol === 'https'
                              ? intl.formatMessage(messages.secure)
                              : null,
                          ]
                            .filter(Boolean)
                            .join(', '),
                          address: `${item.connection.address}:${item.connection.port}`,
                        })}
                        {item.connection.message &&
                        item.connection.status !== 200
                          ? ` · ${item.connection.message}`
                          : ''}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field
                label={intl.formatMessage(messages.hostname)}
                error={hostError}
              >
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    className="font-mono"
                    value={draft.ip ?? ''}
                    onChange={(e) => {
                      setPreset('manual');
                      set('ip', e.target.value);
                    }}
                  />
                )}
              </Field>
              <Field label={intl.formatMessage(messages.port)}>
                {(p) => (
                  <NumberInput
                    {...p}
                    min={1}
                    max={65535}
                    value={draft.port}
                    onChange={(v) => {
                      setPreset('manual');
                      set('port', v);
                    }}
                  />
                )}
              </Field>
            </div>
            <div className="sh-box">
              <SwitchRow
                label={intl.formatMessage(messages.useSsl)}
                checked={!!draft.useSsl}
                onChange={(v) => {
                  setPreset('manual');
                  set('useSsl', v);
                }}
              />
            </div>
            <PanelError message={section.saveError} />
          </Panel>

          <MusicLibraries baseUrl="/api/v1/settings/plex" />

          {!isSetupSettings && (
            <>
              <ScanPanel
                url="/api/v1/settings/plex/sync"
                source={intl.formatMessage(messages.sourceName)}
                recent
                disabled={!draft.enabled}
              />
              <Panel title={intl.formatMessage(messages.signinTitle)}>
                <p className="sh-sub">
                  {intl.formatMessage(messages.signinNote, {
                    state: intl.formatMessage(
                      currentSettings.plexLoginEnabled
                        ? messages.on
                        : messages.off
                    ),
                    newState: intl.formatMessage(
                      currentSettings.newPlexLogin
                        ? messages.can
                        : messages.cannot
                    ),
                  })}{' '}
                  <Link href="/settings/users">
                    {intl.formatMessage(messages.changeSignin)}
                  </Link>
                </p>
              </Panel>
            </>
          )}
        </>
      )}
    </SettingsPage>
  );
};

export default SettingsPlex;
