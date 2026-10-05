import Field from '@app/components/Common/Field';
import Panel from '@app/components/Common/Panel';
import SwitchRow from '@app/components/Common/SwitchRow';
import {
  ConnectionStatus,
  PanelError,
  SaveButton,
  SettingsPage,
  TestButton,
  useConnectionTest,
  useSection,
} from '@app/components/Settings/shared';
import useSettings from '@app/hooks/useSettings';
import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type {
  DiscoverSettingsResponse,
  ScrobbleSettingsResponse,
} from '@server/interfaces/api/settingsInterfaces';
import axios from 'axios';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate as globalMutate } from 'swr';
import { apiMessage } from './shared';

const messages = defineMessages('components.Settings.SettingsScrobbling', {
  title: 'Scrobble to ListenBrainz and Last.fm',
  description:
    'Shufflerr records what people play and sends it to the services they link in their profile.',
  listenbrainz: 'ListenBrainz',
  listenbrainzSub:
    'Each person adds their own user token under Linked accounts.',
  useListenbrainz: 'Scrobble to ListenBrainz',
  serverUrl: 'Server URL',
  serverUrlHint: 'Change this for a self-hosted ListenBrainz',
  trending: 'Show ListenBrainz trending releases on Discover',
  trendingTip: 'Fills the “Trending new releases” row. No account needed.',
  trendingFailed: 'That switch couldn’t be saved. Try again.',
  lastfm: 'Last.fm',
  lastfmSub:
    'Uses the API key from {link}. Each person signs in to Last.fm from their profile.',
  metadataLink: 'MusicBrainz and Last.fm',
  useLastfm: 'Scrobble to Last.fm',
  lastfmNeedsKey:
    'Last.fm isn’t set up yet. Add its API key and shared secret on the MusicBrainz and Last.fm page first.',
  rules: 'When a play counts',
  rule: 'Scrobble a track after',
  ruleHalf: 'Half the track or 4 minutes, whichever is first',
  ruleEnd: 'The track finishes',
  rule30: '30 seconds',
  ruleNote: 'Tracks shorter than 30 seconds are never scrobbled.',
  sources: 'Where plays come from',
  plex: 'Plex',
  jellyfin: 'Jellyfin',
  navidrome: 'Navidrome',
  navidromeNote:
    'If Navidrome already scrobbles for someone, leave this off for them or plays are sent twice.',
  apps: 'Connected apps',
  web: 'Shufflerr’s own player',
  urlInvalid:
    'Enter the full address of the ListenBrainz API, starting with http:// or https://.',
});

const SettingsScrobbling = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { currentSettings } = useSettings();
  const section = useSection<ScrobbleSettingsResponse>(
    '/api/v1/settings/scrobble'
  );
  const { draft, set } = section;
  const { data: discover, mutate: revalidateDiscover } =
    useSWR<DiscoverSettingsResponse>('/api/v1/settings/discover');
  const [urlError, setUrlError] = useState<string | undefined>();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = draft?.listenbrainz.url?.trim() ?? '';
    if (!/^https?:\/\/[^\s/]+/i.test(url)) {
      setUrlError(intl.formatMessage(messages.urlInvalid));
      return;
    }
    setUrlError(undefined);
    section.save();
  };
  const actions = <SaveButton saving={section.saving} />;
  const testLb = useConnectionTest(
    '/api/v1/settings/scrobble/test/listenbrainz'
  );

  // The trending switch lives in the discover section; it saves on its own.
  const setTrending = async (enabled: boolean) => {
    try {
      const response = await axios.post<DiscoverSettingsResponse>(
        '/api/v1/settings/discover',
        { listenbrainzTrending: { enabled } }
      );
      revalidateDiscover(response.data, false);
      globalMutate('/api/v1/settings/public');
    } catch (e) {
      addToast(apiMessage(e, intl.formatMessage(messages.trendingFailed)), {
        appearance: 'error',
      });
    }
  };

  const lastfmReady = !!currentSettings.integrations?.lastfm;

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
            title={intl.formatMessage(messages.listenbrainz)}
            sub={intl.formatMessage(messages.listenbrainzSub)}
            onSubmit={submit}
            actions={
              <>
                <ConnectionStatus result={testLb.result} />
                <TestButton
                  result={testLb.result}
                  onClick={() => testLb.run({ url: draft.listenbrainz.url })}
                />
                {actions}
              </>
            }
          >
            <div className="sh-box">
              <SwitchRow
                label={intl.formatMessage(messages.useListenbrainz)}
                checked={!!draft.listenbrainz.enabled}
                onChange={(v) => set('listenbrainz.enabled', v)}
              />
              {discover && (
                <SwitchRow
                  label={intl.formatMessage(messages.trending)}
                  description={intl.formatMessage(messages.trendingTip)}
                  checked={!!discover.listenbrainzTrending?.enabled}
                  onChange={setTrending}
                />
              )}
            </div>
            <div className="sh-fields">
              <Field
                full
                label={intl.formatMessage(messages.serverUrl)}
                hint={intl.formatMessage(messages.serverUrlHint)}
                error={urlError}
              >
                {(p) => (
                  <input
                    {...p}
                    type="url"
                    inputMode="url"
                    className="font-mono"
                    value={draft.listenbrainz.url ?? ''}
                    onChange={(e) => set('listenbrainz.url', e.target.value)}
                  />
                )}
              </Field>
            </div>
            <PanelError message={section.saveError} />
          </Panel>

          <Panel
            as="form"
            title={intl.formatMessage(messages.lastfm)}
            sub={intl.formatMessage(messages.lastfmSub, {
              link: (
                <Link key="metadata" href="/settings/metadata">
                  {intl.formatMessage(messages.metadataLink)}
                </Link>
              ),
            })}
            onSubmit={submit}
            actions={actions}
          >
            <div className="sh-box">
              <SwitchRow
                label={intl.formatMessage(messages.useLastfm)}
                checked={!!draft.lastfm.enabled}
                onChange={(v) => set('lastfm.enabled', v)}
              />
            </div>
            {draft.lastfm.enabled && !lastfmReady && (
              <p className="sh-sub">
                {intl.formatMessage(messages.lastfmNeedsKey)}
              </p>
            )}
          </Panel>

          <Panel
            as="form"
            title={intl.formatMessage(messages.rules)}
            onSubmit={submit}
            actions={actions}
          >
            <div className="sh-fields">
              <Field
                full
                label={intl.formatMessage(messages.rule)}
                hint={intl.formatMessage(messages.ruleNote)}
              >
                {(p) => (
                  <select
                    {...p}
                    value={draft.rule ?? 'half-or-4min'}
                    onChange={(e) => set('rule', e.target.value)}
                  >
                    <option value="half-or-4min">
                      {intl.formatMessage(messages.ruleHalf)}
                    </option>
                    <option value="end">
                      {intl.formatMessage(messages.ruleEnd)}
                    </option>
                    <option value="30s">
                      {intl.formatMessage(messages.rule30)}
                    </option>
                  </select>
                )}
              </Field>
            </div>
            <fieldset>
              <legend className="group-label">
                {intl.formatMessage(messages.sources)}
              </legend>
              <div className="sh-checks">
                {(
                  ['plex', 'jellyfin', 'navidrome', 'apps', 'web'] as const
                ).map((key) => (
                  <label key={key} className="sh-check">
                    <input
                      type="checkbox"
                      checked={!!draft.sources?.[key]}
                      onChange={(e) => set(`sources.${key}`, e.target.checked)}
                    />{' '}
                    {intl.formatMessage(messages[key])}
                  </label>
                ))}
              </div>
              {draft.sources?.navidrome && (
                <p className="sh-sub">
                  {intl.formatMessage(messages.navidromeNote)}
                </p>
              )}
            </fieldset>
          </Panel>
        </>
      )}
    </SettingsPage>
  );
};

export default SettingsScrobbling;
