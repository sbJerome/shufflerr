import Field from '@app/components/Common/Field';
import Panel from '@app/components/Common/Panel';
import SwitchRow from '@app/components/Common/SwitchRow';
import RegionSelector from '@app/components/RegionSelector';
import {
  ConnectionStatus,
  CopyRow,
  PanelError,
  SaveButton,
  SecretInput,
  SettingsPage,
  TestButton,
  useConnectionTest,
  useSection,
} from '@app/components/Settings/shared';
import useSettings from '@app/hooks/useSettings';
import defineMessages from '@app/utils/defineMessages';
import type { DiscoverSettingsResponse } from '@server/interfaces/api/settingsInterfaces';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Settings.SettingsDiscover', {
  spotifyTitle: 'Spotify',
  spotifyDescription: 'Import playlists and saved albums as requests.',
  spotifyPanel: 'Spotify app',
  spotifyNeeds:
    'Needs a Spotify app. Create one at developer.spotify.com and add this as the redirect URL:',
  redirectLabel: 'Redirect URL for your Spotify app',
  redirectNeedsUrl:
    'Set the Application URL on the General page first; the redirect URL is built from it.',
  useSpotify: 'Use Spotify',
  clientId: 'Client ID',
  clientSecret: 'Client secret',
  savedAlbums: 'Check linked accounts for new saved albums',
  daily: 'Every day',
  hourly: 'Every hour',
  never: 'Never',
  whatTitle: 'What people can do',
  what1: 'Paste a Spotify playlist or album link on the Import page.',
  what2:
    'Link their Spotify account and have saved albums requested automatically.',
  what3:
    'Imports go through the same approval rules and limits as any other request.',
  spotifyKeysRequired:
    'Add the client ID and client secret before turning Spotify on.',
  deezerTitle: 'Deezer',
  deezerDescription: 'Import public Deezer playlists and albums.',
  deezerPanel: 'Deezer',
  deezerNote: 'Uses Deezer’s public API, so there’s nothing to set up.',
  useDeezer: 'Use Deezer',
  itunesTitle: 'iTunes',
  itunesDescription:
    'Import Apple Music links and show iTunes charts on Discover.',
  itunesPanel: 'iTunes',
  itunesNote: 'Uses the public iTunes Search API.',
  useItunes: 'Use iTunes',
  storeCountry: 'Store country',
  ticketmasterTitle: 'Ticketmaster',
  ticketmasterDescription:
    'Show upcoming concerts for artists in your library.',
  ticketmasterPanel: 'Ticketmaster',
  ticketmasterNote:
    'Needs a Discovery API key from developer.ticketmaster.com.',
  useTicketmaster: 'Use Ticketmaster',
  discoveryKey: 'Discovery API key',
  country: 'Country',
  distance: 'Distance from each user’s region',
  miles: '{miles} miles',
  skiddleTitle: 'Skiddle',
  skiddleDescription:
    'Show UK club nights, festivals and gigs for artists in your library.',
  skiddlePanel: 'Skiddle',
  skiddleNote: 'Needs an API key from skiddle.com/api.',
  useSkiddle: 'Use Skiddle',
  apiKey: 'API key',
  keyRequired: 'Add the API key before turning this on.',
});

export type DiscoverSource =
  | 'spotify'
  | 'deezer'
  | 'itunes'
  | 'ticketmaster'
  | 'skiddle';

/** The redirect URI the server registers with Spotify (kept in step with SV4's callback route). */
type WithRedirect = DiscoverSettingsResponse & {
  spotify: { redirectUri?: string };
};

const SettingsDiscover = ({ source }: { source: DiscoverSource }) => {
  const intl = useIntl();
  const { currentSettings } = useSettings();
  const section = useSection<WithRedirect>('/api/v1/settings/discover');
  const { draft, set } = section;
  const [error, setError] = useState<string | undefined>();

  const title = intl.formatMessage(messages[`${source}Title`]);
  const description = intl.formatMessage(messages[`${source}Description`]);

  // Each page saves only its own source, so pages don't overwrite each other.
  const save = (problem?: string) => (e: React.FormEvent) => {
    e.preventDefault();
    setError(problem);
    if (!problem && draft) {
      section.save({ body: { [source]: draft[source] } });
    }
  };
  const test = useConnectionTest(`/api/v1/settings/discover/test/${source}`);
  // Tests the values on screen (masked secrets fall back to the stored ones).
  const actions = (
    <>
      <ConnectionStatus result={test.result} />
      <TestButton
        result={test.result}
        onClick={() => test.run(draft?.[source])}
      />
      <SaveButton saving={section.saving} />
    </>
  );

  const redirectUri =
    draft?.spotify.redirectUri ??
    (currentSettings.applicationUrl
      ? `${currentSettings.applicationUrl}/api/v1/callback/spotify`
      : '');

  return (
    <SettingsPage
      title={title}
      description={description}
      loading={section.loading}
      loadError={section.loadError}
    >
      {draft && source === 'spotify' && (
        <>
          <Panel
            as="form"
            title={intl.formatMessage(messages.spotifyPanel)}
            sub={intl.formatMessage(messages.spotifyNeeds)}
            onSubmit={save(
              draft.spotify.enabled &&
                (!draft.spotify.clientId?.trim() ||
                  !draft.spotify.clientSecret?.trim())
                ? intl.formatMessage(messages.spotifyKeysRequired)
                : undefined
            )}
            actions={actions}
          >
            {redirectUri ? (
              <CopyRow
                value={redirectUri}
                label={intl.formatMessage(messages.redirectLabel)}
              />
            ) : (
              <p className="sh-sub">
                {intl.formatMessage(messages.redirectNeedsUrl)}
              </p>
            )}
            <div className="sh-box">
              <SwitchRow
                label={intl.formatMessage(messages.useSpotify)}
                checked={!!draft.spotify.enabled}
                onChange={(v) => set('spotify.enabled', v)}
              />
            </div>
            <div className="sh-fields">
              <Field label={intl.formatMessage(messages.clientId)}>
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    className="font-mono"
                    autoComplete="off"
                    value={draft.spotify.clientId ?? ''}
                    onChange={(e) => set('spotify.clientId', e.target.value)}
                  />
                )}
              </Field>
              <Field label={intl.formatMessage(messages.clientSecret)}>
                {(p) => (
                  <SecretInput
                    {...p}
                    value={draft.spotify.clientSecret ?? ''}
                    onChange={(v) => set('spotify.clientSecret', v)}
                  />
                )}
              </Field>
              <Field label={intl.formatMessage(messages.savedAlbums)}>
                {(p) => (
                  <select
                    {...p}
                    value={draft.spotify.savedAlbumsSync ?? 'daily'}
                    onChange={(e) =>
                      set('spotify.savedAlbumsSync', e.target.value)
                    }
                  >
                    <option value="daily">
                      {intl.formatMessage(messages.daily)}
                    </option>
                    <option value="hourly">
                      {intl.formatMessage(messages.hourly)}
                    </option>
                    <option value="never">
                      {intl.formatMessage(messages.never)}
                    </option>
                  </select>
                )}
              </Field>
            </div>
            <PanelError message={error ?? section.saveError} />
          </Panel>
          <Panel title={intl.formatMessage(messages.whatTitle)}>
            <ul className="list-disc pl-5 text-[14px] text-muted">
              <li>{intl.formatMessage(messages.what1)}</li>
              <li>{intl.formatMessage(messages.what2)}</li>
              <li>{intl.formatMessage(messages.what3)}</li>
            </ul>
          </Panel>
        </>
      )}

      {draft && source === 'deezer' && (
        <Panel
          as="form"
          title={intl.formatMessage(messages.deezerPanel)}
          sub={intl.formatMessage(messages.deezerNote)}
          onSubmit={save()}
          actions={actions}
        >
          <div className="sh-box">
            <SwitchRow
              label={intl.formatMessage(messages.useDeezer)}
              checked={!!draft.deezer.enabled}
              onChange={(v) => set('deezer.enabled', v)}
            />
          </div>
          <PanelError message={section.saveError} />
        </Panel>
      )}

      {draft && source === 'itunes' && (
        <Panel
          as="form"
          title={intl.formatMessage(messages.itunesPanel)}
          sub={intl.formatMessage(messages.itunesNote)}
          onSubmit={save()}
          actions={actions}
        >
          <div className="sh-box">
            <SwitchRow
              label={intl.formatMessage(messages.useItunes)}
              checked={!!draft.itunes.enabled}
              onChange={(v) => set('itunes.enabled', v)}
            />
          </div>
          <div className="sh-fields">
            <Field label={intl.formatMessage(messages.storeCountry)}>
              {(p) => (
                <RegionSelector
                  {...p}
                  name="country"
                  disableAll
                  value={draft.itunes.country ?? ''}
                  onChange={(_n, value) => set('itunes.country', value)}
                />
              )}
            </Field>
          </div>
          <PanelError message={section.saveError} />
        </Panel>
      )}

      {draft && source === 'ticketmaster' && (
        <Panel
          as="form"
          title={intl.formatMessage(messages.ticketmasterPanel)}
          sub={intl.formatMessage(messages.ticketmasterNote)}
          onSubmit={save(
            draft.ticketmaster.enabled && !draft.ticketmaster.apiKey?.trim()
              ? intl.formatMessage(messages.keyRequired)
              : undefined
          )}
          actions={actions}
        >
          <div className="sh-box">
            <SwitchRow
              label={intl.formatMessage(messages.useTicketmaster)}
              checked={!!draft.ticketmaster.enabled}
              onChange={(v) => set('ticketmaster.enabled', v)}
            />
          </div>
          <div className="sh-fields">
            <Field full label={intl.formatMessage(messages.discoveryKey)}>
              {(p) => (
                <SecretInput
                  {...p}
                  value={draft.ticketmaster.apiKey ?? ''}
                  onChange={(v) => set('ticketmaster.apiKey', v)}
                />
              )}
            </Field>
            <Field label={intl.formatMessage(messages.country)}>
              {(p) => (
                <RegionSelector
                  {...p}
                  name="country"
                  disableAll
                  value={draft.ticketmaster.country ?? ''}
                  onChange={(_n, value) => set('ticketmaster.country', value)}
                />
              )}
            </Field>
            <Field label={intl.formatMessage(messages.distance)}>
              {(p) => (
                <select
                  {...p}
                  value={draft.ticketmaster.radiusMiles ?? 50}
                  onChange={(e) =>
                    set('ticketmaster.radiusMiles', Number(e.target.value))
                  }
                >
                  {[25, 50, 100].map((miles) => (
                    <option key={miles} value={miles}>
                      {intl.formatMessage(messages.miles, { miles })}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <PanelError message={error ?? section.saveError} />
        </Panel>
      )}

      {draft && source === 'skiddle' && (
        <Panel
          as="form"
          title={intl.formatMessage(messages.skiddlePanel)}
          sub={intl.formatMessage(messages.skiddleNote)}
          onSubmit={save(
            draft.skiddle.enabled && !draft.skiddle.apiKey?.trim()
              ? intl.formatMessage(messages.keyRequired)
              : undefined
          )}
          actions={actions}
        >
          <div className="sh-box">
            <SwitchRow
              label={intl.formatMessage(messages.useSkiddle)}
              checked={!!draft.skiddle.enabled}
              onChange={(v) => set('skiddle.enabled', v)}
            />
          </div>
          <div className="sh-fields">
            <Field full label={intl.formatMessage(messages.apiKey)}>
              {(p) => (
                <SecretInput
                  {...p}
                  value={draft.skiddle.apiKey ?? ''}
                  onChange={(v) => set('skiddle.apiKey', v)}
                />
              )}
            </Field>
          </div>
          <PanelError message={error ?? section.saveError} />
        </Panel>
      )}
    </SettingsPage>
  );
};

export default SettingsDiscover;
