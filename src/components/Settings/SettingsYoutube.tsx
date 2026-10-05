import Field from '@app/components/Common/Field';
import Panel from '@app/components/Common/Panel';
import SwitchRow from '@app/components/Common/SwitchRow';
import RegionSelector from '@app/components/RegionSelector';
import {
  ConnectionStatus,
  PanelError,
  SaveButton,
  SecretInput,
  SettingsPage,
  TestButton,
  useConnectionTest,
  useSection,
} from '@app/components/Settings/shared';
import defineMessages from '@app/utils/defineMessages';
import type { YoutubeSettingsResponse } from '@server/interfaces/api/settingsInterfaces';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Settings.SettingsYoutube', {
  title: 'YouTube',
  description:
    'Play tracks you don’t have yet with YouTube’s own player. Nothing is downloaded.',
  panel: 'YouTube player',
  use: 'Use YouTube',
  useTip: 'Tracks that aren’t in your library get a “Play on YouTube” option.',
  apiKey: 'YouTube Data API key',
  apiKeyHint: 'From Google Cloud Console',
  region: 'Region',
  fill: 'Fill gaps while requests download',
  fillTip: 'Missing tracks play from YouTube until the real files arrive.',
  keyRequired: 'Add a YouTube Data API key before turning YouTube on.',
});

const SettingsYoutube = () => {
  const intl = useIntl();
  const section = useSection<YoutubeSettingsResponse>(
    '/api/v1/settings/youtube'
  );
  const { draft, set } = section;
  const [keyError, setKeyError] = useState<string | undefined>();
  const test = useConnectionTest('/api/v1/settings/youtube/test');

  return (
    <SettingsPage
      title={intl.formatMessage(messages.title)}
      description={intl.formatMessage(messages.description)}
      loading={section.loading}
      loadError={section.loadError}
    >
      {draft && (
        <Panel
          as="form"
          title={intl.formatMessage(messages.panel)}
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.enabled && !draft.apiKey?.trim()) {
              setKeyError(intl.formatMessage(messages.keyRequired));
              return;
            }
            setKeyError(undefined);
            section.save();
          }}
          actions={
            <>
              <ConnectionStatus result={test.result} />
              <TestButton
                result={test.result}
                onClick={() => test.run({ apiKey: draft.apiKey })}
                disabled={!draft.apiKey}
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
              label={intl.formatMessage(messages.apiKey)}
              hint={intl.formatMessage(messages.apiKeyHint)}
              error={keyError}
            >
              {(p) => (
                <SecretInput
                  {...p}
                  value={draft.apiKey ?? ''}
                  onChange={(v) => set('apiKey', v)}
                />
              )}
            </Field>
            <Field label={intl.formatMessage(messages.region)}>
              {(p) => (
                <RegionSelector
                  {...p}
                  name="region"
                  disableAll
                  value={draft.region ?? ''}
                  onChange={(_name, value) => set('region', value)}
                />
              )}
            </Field>
          </div>
          <div className="sh-box">
            <SwitchRow
              label={intl.formatMessage(messages.fill)}
              description={intl.formatMessage(messages.fillTip)}
              checked={!!draft.fillMissingWhileDownloading}
              onChange={(v) => set('fillMissingWhileDownloading', v)}
            />
          </div>
          <PanelError message={section.saveError} />
        </Panel>
      )}
    </SettingsPage>
  );
};

export default SettingsYoutube;
