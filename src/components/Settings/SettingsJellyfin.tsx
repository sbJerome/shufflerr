// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Field from '@app/components/Common/Field';
import Panel from '@app/components/Common/Panel';
import SwitchRow from '@app/components/Common/SwitchRow';
import MusicLibraries from '@app/components/Settings/MusicLibraries';
import {
  ConnectionStatus,
  NumberInput,
  PanelError,
  SaveButton,
  ScanPanel,
  SecretInput,
  SettingsPage,
  TestButton,
  useConnectionTest,
  useSection,
} from '@app/components/Settings/shared';
import useSettings from '@app/hooks/useSettings';
import defineMessages from '@app/utils/defineMessages';
import { MediaServerType } from '@server/constants/server';
import type { JellyfinSettingsResponse } from '@server/interfaces/api/settingsInterfaces';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Settings.SettingsJellyfin', {
  title: 'Jellyfin',
  description: 'Stream from Jellyfin and let Jellyfin users sign in.',
  descriptionEmby: 'Stream from Emby and let Emby users sign in.',
  connection: 'Connection',
  use: 'Use {server}',
  useTip: 'Scan your {server} music libraries and play from them.',
  hostname: 'Hostname or IP address',
  port: 'Port',
  urlBase: 'URL base',
  urlBaseHint: 'Only if {server} runs under a sub-path, for example /jellyfin.',
  useSsl: 'Use SSL',
  apiKey: 'API key',
  apiKeyHint: 'Dashboard → API keys in {server}',
  externalUrl: 'External URL',
  externalUrlHint:
    'The address people use to open {server} in a browser. Used for “Open in {server}” links.',
  forgotPasswordUrl: 'Forgot password URL',
  forgotPasswordUrlHint:
    'Where the sign-in page sends people who forgot their {server} password.',
  sourceName: 'your {server} music libraries',
  signinTitle: 'Sign-in',
  signinNote:
    '{server} sign-in is {state}. New {server} users {newState} sign in.',
  on: 'on',
  off: 'off',
  can: 'can',
  cannot: 'can’t',
  changeSignin: 'Change sign-in methods',
  hostRequired: 'Enter the hostname or IP address of your {server} server.',
  urlBaseInvalid:
    'Start the URL base with a slash and leave off the slash at the end.',
});

interface SettingsJellyfinProps {
  /** Embedded in the setup wizard: no page header, sign-in note or scan panel. */
  isSetupSettings?: boolean;
  onComplete?: () => void;
}

const SettingsJellyfin = ({
  isSetupSettings,
  onComplete,
}: SettingsJellyfinProps) => {
  const intl = useIntl();
  const { currentSettings } = useSettings();
  const section = useSection<JellyfinSettingsResponse>(
    '/api/v1/settings/jellyfin'
  );
  const { draft, set } = section;
  const test = useConnectionTest('/api/v1/settings/jellyfin/test');
  const [errors, setErrors] = useState<{ host?: string; base?: string }>({});

  // Emby shares this page; the name follows what the owner signed in with.
  const server =
    currentSettings.mediaServerType === MediaServerType.EMBY
      ? 'Emby'
      : 'Jellyfin';

  const connection = () => ({
    ip: draft?.ip,
    port: Number(draft?.port),
    useSsl: !!draft?.useSsl,
    urlBase: draft?.urlBase ?? '',
    apiKey: draft?.apiKey,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: { host?: string; base?: string } = {};
    if (draft?.enabled && !draft.ip?.trim()) {
      next.host = intl.formatMessage(messages.hostRequired, { server });
    }
    const base = draft?.urlBase ?? '';
    if (base && (!base.startsWith('/') || base.endsWith('/'))) {
      next.base = intl.formatMessage(messages.urlBaseInvalid);
    }
    setErrors(next);
    if (next.host || next.base) {
      return;
    }
    const saved = await section.save({
      body: {
        ...connection(),
        enabled: !!draft?.enabled,
        externalHostname: draft?.externalHostname ?? '',
        jellyfinForgotPasswordUrl: draft?.jellyfinForgotPasswordUrl ?? '',
      },
    });
    if (saved) {
      onComplete?.();
    }
  };

  return (
    <SettingsPage
      bare={isSetupSettings}
      title={server}
      description={intl.formatMessage(
        server === 'Emby' ? messages.descriptionEmby : messages.description
      )}
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
                label={intl.formatMessage(messages.use, { server })}
                description={intl.formatMessage(messages.useTip, { server })}
                checked={!!draft.enabled}
                onChange={(v) => set('enabled', v)}
              />
            </div>
            <div className="sh-fields">
              <Field
                label={intl.formatMessage(messages.hostname)}
                error={errors.host}
              >
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    className="font-mono"
                    value={draft.ip ?? ''}
                    onChange={(e) => set('ip', e.target.value)}
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
                    onChange={(v) => set('port', v)}
                  />
                )}
              </Field>
              <Field
                label={intl.formatMessage(messages.urlBase)}
                hint={intl.formatMessage(messages.urlBaseHint, { server })}
                error={errors.base}
              >
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    className="font-mono"
                    value={draft.urlBase ?? ''}
                    onChange={(e) => set('urlBase', e.target.value)}
                  />
                )}
              </Field>
              <Field
                label={intl.formatMessage(messages.apiKey)}
                hint={intl.formatMessage(messages.apiKeyHint, { server })}
              >
                {(p) => (
                  <SecretInput
                    {...p}
                    value={draft.apiKey ?? ''}
                    onChange={(v) => set('apiKey', v)}
                  />
                )}
              </Field>
              {!isSetupSettings && (
                <>
                  <Field
                    label={intl.formatMessage(messages.externalUrl)}
                    hint={intl.formatMessage(messages.externalUrlHint, {
                      server,
                    })}
                  >
                    {(p) => (
                      <input
                        {...p}
                        type="url"
                        inputMode="url"
                        className="font-mono"
                        value={draft.externalHostname ?? ''}
                        onChange={(e) =>
                          set('externalHostname', e.target.value)
                        }
                      />
                    )}
                  </Field>
                  <Field
                    label={intl.formatMessage(messages.forgotPasswordUrl)}
                    hint={intl.formatMessage(messages.forgotPasswordUrlHint, {
                      server,
                    })}
                  >
                    {(p) => (
                      <input
                        {...p}
                        type="url"
                        inputMode="url"
                        className="font-mono"
                        value={draft.jellyfinForgotPasswordUrl ?? ''}
                        onChange={(e) =>
                          set('jellyfinForgotPasswordUrl', e.target.value)
                        }
                      />
                    )}
                  </Field>
                </>
              )}
            </div>
            <div className="sh-box">
              <SwitchRow
                label={intl.formatMessage(messages.useSsl)}
                checked={!!draft.useSsl}
                onChange={(v) => set('useSsl', v)}
              />
            </div>
            <PanelError message={section.saveError} />
          </Panel>

          <MusicLibraries baseUrl="/api/v1/settings/jellyfin" />

          {!isSetupSettings && (
            <>
              <ScanPanel
                url="/api/v1/settings/jellyfin/sync"
                source={intl.formatMessage(messages.sourceName, { server })}
                recent
                disabled={!draft.enabled}
              />
              <Panel title={intl.formatMessage(messages.signinTitle)}>
                <p className="sh-sub">
                  {intl.formatMessage(messages.signinNote, {
                    server,
                    state: intl.formatMessage(
                      currentSettings.jellyfinLoginEnabled
                        ? messages.on
                        : messages.off
                    ),
                    newState: intl.formatMessage(
                      currentSettings.newJellyfinLogin
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

export default SettingsJellyfin;
