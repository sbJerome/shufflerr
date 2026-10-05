// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: src/components/Settings/SettingsAbout/index.tsx at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import Alert from '@app/components/Common/Alert';
import Panel from '@app/components/Common/Panel';
import { SettingsPage } from '@app/components/Settings/shared';
import defineMessages from '@app/utils/defineMessages';
import type {
  SettingsAboutResponse,
  StatusResponse,
} from '@server/interfaces/api/settingsInterfaces';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Settings.SettingsAbout', {
  title: 'About Shufflerr',
  description: 'Version, library totals and credits.',
  details: 'This server',
  version: 'Version',
  albums: 'Albums',
  artists: 'Artists',
  tracks: 'Tracks',
  requests: 'Requests',
  users: 'Users',
  dataFolder: 'Data folder',
  timeZone: 'Time zone',
  updateAvailable:
    'A newer version of Shufflerr is available. Update your container to get it.',
  restartRequired: 'Restart Shufflerr to apply settings that changed.',
  help: 'Getting help',
  helpBody:
    'Setup notes are in the README and docs folder that ship with Shufflerr. When something goes wrong, the Logs page usually says why.',
  apiDocs: 'Shufflerr API reference',
  lidarrDocs: 'Lidarr documentation',
  musicbrainzDocs: 'MusicBrainz documentation',
  credits: 'Credits',
  creditsBody:
    'Shufflerr’s user system, permissions, request approval, sign-in and admin pages are adapted from Seerr (github.com/seerr-team/seerr), the successor to Overseerr and Jellyseerr. MIT License, Copyright (c) 2020 sct. Music data from MusicBrainz and the Cover Art Archive. Artist details from Last.fm. Listening history with ListenBrainz and Last.fm.',
  creditsLicense:
    'The full Seerr license ships with Shufflerr in LICENSES/seerr-MIT.txt, with details in NOTICE.md.',
});

const SettingsAbout = () => {
  const intl = useIntl();
  const { data, error } = useSWR<SettingsAboutResponse>(
    '/api/v1/settings/about'
  );
  const { data: status } = useSWR<StatusResponse>('/api/v1/status');

  const stat = (label: string, value: React.ReactNode, mono = true) => (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? 'break-all font-mono' : undefined}>{value}</dd>
    </div>
  );

  return (
    <SettingsPage
      title={intl.formatMessage(messages.title)}
      description={intl.formatMessage(messages.description)}
      loading={!data && !error}
      loadError={error && !data ? error : undefined}
    >
      {status?.updateAvailable && (
        <Alert
          title={intl.formatMessage(messages.updateAvailable)}
          type="info"
        />
      )}
      {status?.restartRequired && (
        <Alert
          title={intl.formatMessage(messages.restartRequired)}
          type="warning"
        />
      )}
      {data && (
        <Panel title={intl.formatMessage(messages.details)}>
          <dl className="sh-kvs">
            {stat(
              intl.formatMessage(messages.version),
              data.commitTag && data.commitTag !== 'local'
                ? `${data.version} (${data.commitTag.slice(0, 7)})`
                : data.version
            )}
            {stat(
              intl.formatMessage(messages.albums),
              intl.formatNumber(data.totalMediaItems)
            )}
            {stat(
              intl.formatMessage(messages.artists),
              intl.formatNumber(data.totalArtists)
            )}
            {stat(
              intl.formatMessage(messages.tracks),
              intl.formatNumber(data.totalTracks)
            )}
            {stat(
              intl.formatMessage(messages.requests),
              intl.formatNumber(data.totalRequests)
            )}
            {stat(
              intl.formatMessage(messages.users),
              intl.formatNumber(data.totalUsers)
            )}
            {stat(intl.formatMessage(messages.dataFolder), data.appDataPath)}
            {data.tz && stat(intl.formatMessage(messages.timeZone), data.tz)}
          </dl>
        </Panel>
      )}
      <Panel title={intl.formatMessage(messages.help)}>
        <p className="sh-sub">{intl.formatMessage(messages.helpBody)}</p>
        <ul className="sh-list">
          <li>
            <a href="/api-docs" target="_blank" rel="noreferrer">
              {intl.formatMessage(messages.apiDocs)}
            </a>
          </li>
          <li>
            <a
              href="https://wiki.servarr.com/lidarr"
              target="_blank"
              rel="noreferrer"
            >
              {intl.formatMessage(messages.lidarrDocs)}
            </a>
          </li>
          <li>
            <a
              href="https://musicbrainz.org/doc/MusicBrainz_Documentation"
              target="_blank"
              rel="noreferrer"
            >
              {intl.formatMessage(messages.musicbrainzDocs)}
            </a>
          </li>
        </ul>
      </Panel>
      <Panel title={intl.formatMessage(messages.credits)}>
        <p className="sh-sub">{intl.formatMessage(messages.creditsBody)}</p>
        <p className="sh-sub">{intl.formatMessage(messages.creditsLicense)}</p>
      </Panel>
    </SettingsPage>
  );
};

export default SettingsAbout;
