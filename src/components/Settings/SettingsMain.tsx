// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: src/components/Settings/SettingsMain/index.tsx at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import Button from '@app/components/Common/Button';
import Field from '@app/components/Common/Field';
import Panel from '@app/components/Common/Panel';
import SwitchRow from '@app/components/Common/SwitchRow';
import LanguageSelector from '@app/components/LanguageSelector';
import RegionSelector from '@app/components/RegionSelector';
import {
  apiMessage,
  CopyRow,
  PanelError,
  SaveButton,
  SettingsPage,
  useSection,
} from '@app/components/Settings/shared';
import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type { MainSettingsResponse } from '@server/interfaces/api/settingsInterfaces';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Settings.SettingsMain', {
  title: 'General',
  description: 'Basic settings for this Shufflerr server.',
  server: 'Server',
  applicationTitle: 'Application title',
  applicationUrl: 'Application URL',
  applicationUrlHint:
    'The address people use to reach Shufflerr. Used in links and app setup.',
  apiKey: 'API key',
  apiKeyHint: 'For scripts and other apps. Keep it secret.',
  newKey: 'Make a new key',
  newKeyDone: 'Made a new API key. Update any scripts that used the old one.',
  newKeyFailed: 'A new API key couldn’t be made. Try again.',
  locale: 'Display language',
  region: 'Discover region',
  requests: 'Requests and browsing',
  allowTrackRequests: 'Allow track requests',
  allowTrackRequestsTip:
    'People can request just the missing tracks from an album.',
  hideAvailable: 'Hide music that’s already available',
  hideAvailableTip:
    'Keeps Discover and Search focused on things you can request.',
  cacheImages: 'Cache album art',
  cacheImagesTip:
    'Stores cover art and artist photos on this server so pages load faster.',
  musicDirectGrab: 'Direct grab (bypass Lidarr release matching)',
  musicDirectGrabTip:
    'When on, Shufflerr selects releases and submits them straight to your download client, and Lidarr is used only to tag and organize the files. Requires your indexers and download clients to be configured in Lidarr.',
  versionCheck: 'Check for updates',
  versionCheckTip: 'Looks for new Shufflerr versions on GitHub.',
  titleRequired: 'Enter an application title.',
  urlInvalid:
    'Enter a full address that starts with http:// or https://, or leave it empty.',
  urlTrailingSlash: 'Remove the slash at the end of the address.',
});

const SettingsMain = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const section = useSection<MainSettingsResponse>('/api/v1/settings/main');
  const { draft, set } = section;
  const [errors, setErrors] = useState<{ title?: string; url?: string }>({});
  const [regenerating, setRegenerating] = useState(false);

  const validate = () => {
    const next: { title?: string; url?: string } = {};
    if (!draft?.applicationTitle?.trim()) {
      next.title = intl.formatMessage(messages.titleRequired);
    }
    const url = draft?.applicationUrl?.trim() ?? '';
    if (url) {
      if (!/^https?:\/\/[^\s/]+/i.test(url)) {
        next.url = intl.formatMessage(messages.urlInvalid);
      } else if (url.endsWith('/')) {
        next.url = intl.formatMessage(messages.urlTrailingSlash);
      }
    }
    setErrors(next);
    return !next.title && !next.url;
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const { data } = await axios.post<MainSettingsResponse>(
        '/api/v1/settings/main/regenerate'
      );
      set('apiKey', data.apiKey);
      section.reload();
      addToast(intl.formatMessage(messages.newKeyDone), {
        appearance: 'success',
      });
    } catch (e) {
      addToast(apiMessage(e, intl.formatMessage(messages.newKeyFailed)), {
        appearance: 'error',
      });
    } finally {
      setRegenerating(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      section.save();
    }
  };

  return (
    <SettingsPage
      title={intl.formatMessage(messages.title)}
      description={intl.formatMessage(messages.description)}
      loading={section.loading}
      loadError={section.loadError}
    >
      {draft && (
        <>
          <Panel
            as="form"
            title={intl.formatMessage(messages.server)}
            onSubmit={submit}
            actions={<SaveButton saving={section.saving} />}
          >
            <div className="sh-fields">
              <Field
                label={intl.formatMessage(messages.applicationTitle)}
                error={errors.title}
                required
              >
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    value={draft.applicationTitle ?? ''}
                    onChange={(e) => set('applicationTitle', e.target.value)}
                  />
                )}
              </Field>
              <Field
                label={intl.formatMessage(messages.applicationUrl)}
                hint={intl.formatMessage(messages.applicationUrlHint)}
                error={errors.url}
              >
                {(p) => (
                  <input
                    {...p}
                    type="url"
                    inputMode="url"
                    className="font-mono"
                    placeholder="https://music.example.com"
                    value={draft.applicationUrl ?? ''}
                    onChange={(e) => set('applicationUrl', e.target.value)}
                  />
                )}
              </Field>
              <Field
                full
                label={intl.formatMessage(messages.apiKey)}
                hint={intl.formatMessage(messages.apiKeyHint)}
              >
                {(p) => (
                  <CopyRow {...p} value={draft.apiKey ?? ''}>
                    <Button
                      type="button"
                      buttonSize="sm"
                      disabled={regenerating}
                      onClick={regenerate}
                    >
                      {intl.formatMessage(messages.newKey)}
                    </Button>
                  </CopyRow>
                )}
              </Field>
              <Field label={intl.formatMessage(messages.locale)}>
                {(p) => (
                  <LanguageSelector
                    {...p}
                    value={draft.locale}
                    setFieldValue={(_name, value) => set('locale', value)}
                  />
                )}
              </Field>
              <Field label={intl.formatMessage(messages.region)}>
                {(p) => (
                  <RegionSelector
                    {...p}
                    name="discoverRegion"
                    value={draft.discoverRegion ?? ''}
                    onChange={(_name, value) => set('discoverRegion', value)}
                  />
                )}
              </Field>
            </div>
            <PanelError message={section.saveError} />
          </Panel>
          <Panel
            as="form"
            title={intl.formatMessage(messages.requests)}
            onSubmit={submit}
            actions={<SaveButton saving={section.saving} />}
          >
            <div className="sh-box">
              <SwitchRow
                label={intl.formatMessage(messages.allowTrackRequests)}
                description={intl.formatMessage(messages.allowTrackRequestsTip)}
                checked={!!draft.allowTrackRequests}
                onChange={(v) => set('allowTrackRequests', v)}
              />
              <SwitchRow
                label={intl.formatMessage(messages.hideAvailable)}
                description={intl.formatMessage(messages.hideAvailableTip)}
                checked={!!draft.hideAvailable}
                onChange={(v) => set('hideAvailable', v)}
              />
              <SwitchRow
                label={intl.formatMessage(messages.cacheImages)}
                description={intl.formatMessage(messages.cacheImagesTip)}
                checked={!!draft.cacheImages}
                onChange={(v) => set('cacheImages', v)}
              />
              <SwitchRow
                label={intl.formatMessage(messages.musicDirectGrab)}
                description={intl.formatMessage(messages.musicDirectGrabTip)}
                checked={!!draft.musicDirectGrab}
                onChange={(v) => set('musicDirectGrab', v)}
              />
              <SwitchRow
                label={intl.formatMessage(messages.versionCheck)}
                description={intl.formatMessage(messages.versionCheckTip)}
                checked={!!draft.versionCheck}
                onChange={(v) => set('versionCheck', v)}
              />
            </div>
          </Panel>
        </>
      )}
    </SettingsPage>
  );
};

export default SettingsMain;
