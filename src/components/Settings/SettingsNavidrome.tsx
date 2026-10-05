import Field from '@app/components/Common/Field';
import Panel from '@app/components/Common/Panel';
import SwitchRow from '@app/components/Common/SwitchRow';
import {
  ConnectionStatus,
  PanelError,
  SaveButton,
  ScanPanel,
  SecretInput,
  SettingsPage,
  TestButton,
  useConnectionTest,
  useSection,
} from '@app/components/Settings/shared';
import defineMessages from '@app/utils/defineMessages';
import type { NavidromeSettingsResponse } from '@server/interfaces/api/settingsInterfaces';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Settings.SettingsNavidrome', {
  title: 'Navidrome',
  description: 'Stream from a Navidrome server using the Subsonic API.',
  connection: 'Connection',
  use: 'Use Navidrome',
  useTip: 'Scan your Navidrome library and play from it.',
  url: 'Server URL',
  username: 'Username',
  password: 'Password',
  passwordHint:
    'Used for Subsonic token sign-in. A Navidrome account just for Shufflerr works well.',
  sourceName: 'your Navidrome library',
  urlInvalid:
    'Enter the full address of your Navidrome server, starting with http:// or https://.',
});

interface SettingsNavidromeProps {
  isSetupSettings?: boolean;
  onComplete?: () => void;
}

const SettingsNavidrome = ({
  isSetupSettings,
  onComplete,
}: SettingsNavidromeProps) => {
  const intl = useIntl();
  const section = useSection<NavidromeSettingsResponse>(
    '/api/v1/settings/navidrome'
  );
  const { draft, set } = section;
  const test = useConnectionTest('/api/v1/settings/navidrome/test');
  const [urlError, setUrlError] = useState<string | undefined>();

  const connection = () => ({
    url: draft?.url?.trim().replace(/\/+$/, '') ?? '',
    username: draft?.username ?? '',
    password: draft?.password ?? '',
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { url } = connection();
    if ((draft?.enabled || url) && !/^https?:\/\/[^\s/]+/i.test(url)) {
      setUrlError(intl.formatMessage(messages.urlInvalid));
      return;
    }
    setUrlError(undefined);
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
                <TestButton
                  result={test.result}
                  onClick={() => test.run(connection())}
                  disabled={!draft.url}
                />
                <SaveButton saving={section.saving} />
              </>
            }
          >
            <div className="sh-box">
              <SwitchRow
                label={intl.formatMessage(messages.use)}
                description={intl.formatMessage(messages.useTip)}
                checked={!!draft.enabled}
                onChange={(v) => set('enabled', v)}
              />
            </div>
            <div className="sh-fields">
              <Field
                full
                label={intl.formatMessage(messages.url)}
                error={urlError}
              >
                {(p) => (
                  <input
                    {...p}
                    type="url"
                    inputMode="url"
                    className="font-mono"
                    placeholder="http://navidrome.local:4533"
                    value={draft.url ?? ''}
                    onChange={(e) => set('url', e.target.value)}
                  />
                )}
              </Field>
              <Field label={intl.formatMessage(messages.username)}>
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    autoComplete="off"
                    value={draft.username ?? ''}
                    onChange={(e) => set('username', e.target.value)}
                  />
                )}
              </Field>
              <Field
                label={intl.formatMessage(messages.password)}
                hint={intl.formatMessage(messages.passwordHint)}
              >
                {(p) => (
                  <SecretInput
                    {...p}
                    value={draft.password ?? ''}
                    onChange={(v) => set('password', v)}
                  />
                )}
              </Field>
            </div>
            <PanelError message={section.saveError} />
          </Panel>
          {!isSetupSettings && (
            <ScanPanel
              url="/api/v1/settings/navidrome/sync"
              source={intl.formatMessage(messages.sourceName)}
              disabled={!draft.enabled}
            />
          )}
        </>
      )}
    </SettingsPage>
  );
};

export default SettingsNavidrome;
