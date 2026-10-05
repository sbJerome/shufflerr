// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Field from '@app/components/Common/Field';
import Panel from '@app/components/Common/Panel';
import SwitchRow from '@app/components/Common/SwitchRow';
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
import type { MetadataSettingsResponse } from '@server/interfaces/api/settingsInterfaces';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Settings.SettingsMetadata', {
  title: 'MusicBrainz and Last.fm',
  description: 'Where artist, album and track details come from.',
  musicbrainz: 'MusicBrainz',
  musicbrainzSub: 'Search, releases and track listings. Free and open.',
  serverUrl: 'Server URL',
  serverUrlHint: 'Use your own mirror to skip the public rate limit',
  rps: 'Requests per second',
  rps1: '1 (public server)',
  rps10: '10 (own mirror)',
  rps50: '50 (own mirror)',
  contact: 'Contact',
  contactHint:
    'An email address or URL. MusicBrainz asks every app to say who runs it, so they can reach you about problems.',
  art: 'Album art and photos',
  caa: 'Cover Art Archive',
  caaTip: 'Album art for releases in MusicBrainz.',
  fanart: 'fanart.tv',
  fanartTip: 'Artist photos and backgrounds.',
  fanartKey: 'fanart.tv API key',
  lastfm: 'Last.fm',
  lastfmSub:
    'Artist bios, tags and similar artists. The same key is used for scrobbling.',
  useLastfm: 'Use Last.fm',
  apiKey: 'API key',
  sharedSecret: 'Shared secret',
  priority: 'When sources disagree',
  priorityMb: 'MusicBrainz first, Last.fm for bios and tags',
  priorityLastfm: 'Last.fm first',
  urlInvalid:
    'Enter the full address of the MusicBrainz server, starting with http:// or https://.',
  contactRequired:
    'Add a contact email or URL. The public MusicBrainz server can block apps that don’t say who runs them.',
  publicRate:
    'The public MusicBrainz server allows 1 request per second. Pick a higher rate only with your own mirror.',
  fanartKeyRequired: 'Add a fanart.tv API key before turning fanart.tv on.',
  lastfmKeyRequired: 'Add a Last.fm API key before turning Last.fm on.',
});

const SettingsMetadata = () => {
  const intl = useIntl();
  const section = useSection<MetadataSettingsResponse>(
    '/api/v1/settings/metadata'
  );
  const { draft, set } = section;
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) {
      return;
    }
    const next: Record<string, string> = {};
    const url = draft.musicbrainz.url?.trim() ?? '';
    if (!/^https?:\/\/[^\s/]+/i.test(url)) {
      next.url = intl.formatMessage(messages.urlInvalid);
    }
    const isPublic = /(^|\.)musicbrainz\.org/i.test(url);
    if (isPublic && !draft.musicbrainz.contact?.trim()) {
      next.contact = intl.formatMessage(messages.contactRequired);
    }
    if (isPublic && draft.musicbrainz.requestsPerSecond > 1) {
      next.rps = intl.formatMessage(messages.publicRate);
    }
    if (draft.fanart.enabled && !draft.fanart.apiKey?.trim()) {
      next.fanart = intl.formatMessage(messages.fanartKeyRequired);
    }
    if (draft.lastfm.enabled && !draft.lastfm.apiKey?.trim()) {
      next.lastfm = intl.formatMessage(messages.lastfmKeyRequired);
    }
    setErrors(next);
    if (Object.keys(next).length === 0) {
      section.save();
    }
  };
  const actions = <SaveButton saving={section.saving} />;
  const testMb = useConnectionTest(
    '/api/v1/settings/metadata/test/musicbrainz'
  );
  const testFanart = useConnectionTest('/api/v1/settings/metadata/test/fanart');
  const testLastfm = useConnectionTest('/api/v1/settings/metadata/test/lastfm');

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
            title={intl.formatMessage(messages.musicbrainz)}
            sub={intl.formatMessage(messages.musicbrainzSub)}
            onSubmit={submit}
            actions={
              <>
                <ConnectionStatus result={testMb.result} />
                <TestButton
                  result={testMb.result}
                  onClick={() =>
                    testMb.run({
                      url: draft.musicbrainz.url,
                      contact: draft.musicbrainz.contact,
                    })
                  }
                />
                {actions}
              </>
            }
          >
            <div className="sh-fields">
              <Field
                label={intl.formatMessage(messages.serverUrl)}
                hint={intl.formatMessage(messages.serverUrlHint)}
                error={errors.url}
              >
                {(p) => (
                  <input
                    {...p}
                    type="url"
                    inputMode="url"
                    className="font-mono"
                    value={draft.musicbrainz.url ?? ''}
                    onChange={(e) => set('musicbrainz.url', e.target.value)}
                  />
                )}
              </Field>
              <Field
                label={intl.formatMessage(messages.rps)}
                error={errors.rps}
              >
                {(p) => (
                  <select
                    {...p}
                    value={draft.musicbrainz.requestsPerSecond ?? 1}
                    onChange={(e) =>
                      set(
                        'musicbrainz.requestsPerSecond',
                        Number(e.target.value)
                      )
                    }
                  >
                    <option value={1}>
                      {intl.formatMessage(messages.rps1)}
                    </option>
                    <option value={10}>
                      {intl.formatMessage(messages.rps10)}
                    </option>
                    <option value={50}>
                      {intl.formatMessage(messages.rps50)}
                    </option>
                  </select>
                )}
              </Field>
              <Field
                full
                label={intl.formatMessage(messages.contact)}
                hint={intl.formatMessage(messages.contactHint)}
                error={errors.contact}
              >
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    placeholder="you@example.com"
                    value={draft.musicbrainz.contact ?? ''}
                    onChange={(e) => set('musicbrainz.contact', e.target.value)}
                  />
                )}
              </Field>
            </div>
            <PanelError message={section.saveError} />
          </Panel>

          <Panel
            as="form"
            title={intl.formatMessage(messages.art)}
            onSubmit={submit}
            actions={
              <>
                {draft.fanart.apiKey && (
                  <>
                    <ConnectionStatus result={testFanart.result} />
                    <TestButton
                      result={testFanart.result}
                      onClick={() =>
                        testFanart.run({ apiKey: draft.fanart.apiKey })
                      }
                    />
                  </>
                )}
                {actions}
              </>
            }
          >
            <div className="sh-box">
              <SwitchRow
                label={intl.formatMessage(messages.caa)}
                description={intl.formatMessage(messages.caaTip)}
                checked={!!draft.coverArtArchive.enabled}
                onChange={(v) => set('coverArtArchive.enabled', v)}
              />
              <SwitchRow
                label={intl.formatMessage(messages.fanart)}
                description={intl.formatMessage(messages.fanartTip)}
                checked={!!draft.fanart.enabled}
                onChange={(v) => set('fanart.enabled', v)}
              />
            </div>
            <div className="sh-fields">
              <Field
                label={intl.formatMessage(messages.fanartKey)}
                error={errors.fanart}
              >
                {(p) => (
                  <SecretInput
                    {...p}
                    value={draft.fanart.apiKey ?? ''}
                    onChange={(v) => set('fanart.apiKey', v)}
                  />
                )}
              </Field>
            </div>
          </Panel>

          <Panel
            as="form"
            title={intl.formatMessage(messages.lastfm)}
            sub={intl.formatMessage(messages.lastfmSub)}
            onSubmit={submit}
            actions={
              <>
                {draft.lastfm.apiKey && (
                  <>
                    <ConnectionStatus result={testLastfm.result} />
                    <TestButton
                      result={testLastfm.result}
                      onClick={() =>
                        testLastfm.run({ apiKey: draft.lastfm.apiKey })
                      }
                    />
                  </>
                )}
                {actions}
              </>
            }
          >
            <div className="sh-box">
              <SwitchRow
                label={intl.formatMessage(messages.useLastfm)}
                checked={!!draft.lastfm.enabled}
                onChange={(v) => set('lastfm.enabled', v)}
              />
            </div>
            <div className="sh-fields">
              <Field
                label={intl.formatMessage(messages.apiKey)}
                error={errors.lastfm}
              >
                {(p) => (
                  <SecretInput
                    {...p}
                    value={draft.lastfm.apiKey ?? ''}
                    onChange={(v) => set('lastfm.apiKey', v)}
                  />
                )}
              </Field>
              <Field label={intl.formatMessage(messages.sharedSecret)}>
                {(p) => (
                  <SecretInput
                    {...p}
                    value={draft.lastfm.sharedSecret ?? ''}
                    onChange={(v) => set('lastfm.sharedSecret', v)}
                  />
                )}
              </Field>
              <Field full label={intl.formatMessage(messages.priority)}>
                {(p) => (
                  <select
                    {...p}
                    value={draft.priority ?? 'musicbrainz-first'}
                    onChange={(e) => set('priority', e.target.value)}
                  >
                    <option value="musicbrainz-first">
                      {intl.formatMessage(messages.priorityMb)}
                    </option>
                    <option value="lastfm-first">
                      {intl.formatMessage(messages.priorityLastfm)}
                    </option>
                  </select>
                )}
              </Field>
            </div>
          </Panel>
        </>
      )}
    </SettingsPage>
  );
};

export default SettingsMetadata;
