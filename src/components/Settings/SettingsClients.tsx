import Avatar from '@app/components/Common/Avatar';
import Button from '@app/components/Common/Button';
import Field from '@app/components/Common/Field';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Panel from '@app/components/Common/Panel';
import SwitchRow from '@app/components/Common/SwitchRow';
import {
  apiMessage,
  CopyRow,
  PanelError,
  SaveButton,
  SettingsPage,
  useRelativeTime,
  useSection,
} from '@app/components/Settings/shared';
import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type {
  ClientDevice,
  ClientsSettingsResponse,
} from '@server/interfaces/api/settingsInterfaces';
import axios from 'axios';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Settings.SettingsClients', {
  title: 'Apps and devices',
  description:
    'Any OpenSubsonic or Jellyfin music app can connect to Shufflerr. People sign in with their username and an app password from their profile.',
  apis: 'Server APIs',
  openSubsonic: 'OpenSubsonic API',
  openSubsonicTip: 'For Symfonium, Feishin, Amperfy and other Subsonic apps.',
  jellyfinApi: 'Jellyfin API',
  jellyfinApiTip: 'For Finamp, Jellify, Symfonium and other Jellyfin apps.',
  allowDownloads: 'Allow downloads for offline listening',
  openSubsonicEndpoint: 'OpenSubsonic server address',
  jellyfinEndpoint: 'Jellyfin server address',
  noUrl:
    'Set the Application URL on the General page so apps get the right address.',
  quality: 'Streaming quality on mobile data',
  original: 'Original',
  opus160: 'Opus 160 kbps',
  mp3320: 'MP3 320 kbps',
  mp3128: 'MP3 128 kbps',
  tested: 'Tested apps',
  testedSub:
    'These apps are checked against Shufflerr. Others that speak the same protocols work too.',
  howTo: 'How to connect',
  stepAdd: 'Add a {protocol} server in {app}.',
  stepAddress: 'Server address: {address}',
  stepSignIn: 'Sign in with your Shufflerr username and an app password.',
  ready: 'Ready',
  turnOn: 'Turn on its API above',
  devices: 'Connected devices',
  devicesSub: 'App passwords in use across all users.',
  noDevices:
    'No app passwords yet. People create them under Profile → Settings → App passwords.',
  devicesFailed: 'Connected devices couldn’t be loaded.',
  lastUsed: 'Last used {time}',
  lastUsedWith: 'Last used {time} with {client}',
  neverUsed: 'Not used yet',
  revoke: 'Revoke',
  revokeLabel: 'Revoke {name} for {user}',
  revoked: 'Revoked {name}. That app has to sign in again.',
  revokeFailed: 'That app password couldn’t be revoked. Try again.',
});

type Protocol = 'OpenSubsonic' | 'Jellyfin';

/** Product documentation: the apps Shufflerr is tested with (docs/CLIENT_API.md). */
const TESTED_APPS: {
  name: string;
  platforms: string;
  protocols: Protocol[];
  color: string;
  tile: string;
}[] = [
  {
    name: 'Symfonium',
    platforms: 'Android',
    protocols: ['OpenSubsonic', 'Jellyfin'],
    color: '#6C4BD8',
    tile: 'Sy',
  },
  {
    name: 'Finamp',
    platforms: 'iOS, Android',
    protocols: ['Jellyfin'],
    color: '#00A4DC',
    tile: 'Fi',
  },
  {
    name: 'Feishin',
    platforms: 'Windows, macOS, Linux, web',
    protocols: ['OpenSubsonic', 'Jellyfin'],
    color: '#E34C67',
    tile: 'Fe',
  },
  {
    name: 'Amperfy',
    platforms: 'iOS, macOS',
    protocols: ['OpenSubsonic'],
    color: '#F28C28',
    tile: 'Am',
  },
  {
    name: 'Jellify',
    platforms: 'iOS, Android',
    protocols: ['Jellyfin'],
    color: '#8E5CF7',
    tile: 'Je',
  },
];

const SettingsClients = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const relative = useRelativeTime();
  const section = useSection<ClientsSettingsResponse>(
    '/api/v1/settings/clients'
  );
  const { draft, set } = section;
  const {
    data: devices,
    error: devicesError,
    mutate: revalidateDevices,
  } = useSWR<ClientDevice[]>('/api/v1/settings/clients/devices');
  const [revoking, setRevoking] = useState<number | null>(null);

  const revoke = async (device: ClientDevice) => {
    setRevoking(device.id);
    try {
      await axios.delete(`/api/v1/settings/clients/devices/${device.id}`);
      addToast(intl.formatMessage(messages.revoked, { name: device.name }), {
        appearance: 'success',
      });
      revalidateDevices();
    } catch (e) {
      addToast(apiMessage(e, intl.formatMessage(messages.revokeFailed)), {
        appearance: 'error',
      });
    } finally {
      setRevoking(null);
    }
  };

  const isOn = (protocol: Protocol) =>
    protocol === 'OpenSubsonic' ? !!draft?.openSubsonic : !!draft?.jellyfinApi;
  const endpoint = (protocol: Protocol) =>
    (protocol === 'OpenSubsonic'
      ? draft?.endpoints?.openSubsonic
      : draft?.endpoints?.jellyfin) ?? '';

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
            title={intl.formatMessage(messages.apis)}
            onSubmit={(e) => {
              e.preventDefault();
              section.save({
                body: {
                  openSubsonic: !!draft.openSubsonic,
                  jellyfinApi: !!draft.jellyfinApi,
                  allowDownloads: !!draft.allowDownloads,
                  mobileTranscode: draft.mobileTranscode,
                },
              });
            }}
            actions={<SaveButton saving={section.saving} />}
          >
            <div className="sh-box">
              <SwitchRow
                label={intl.formatMessage(messages.openSubsonic)}
                description={intl.formatMessage(messages.openSubsonicTip)}
                checked={!!draft.openSubsonic}
                onChange={(v) => set('openSubsonic', v)}
              />
              <SwitchRow
                label={intl.formatMessage(messages.jellyfinApi)}
                description={intl.formatMessage(messages.jellyfinApiTip)}
                checked={!!draft.jellyfinApi}
                onChange={(v) => set('jellyfinApi', v)}
              />
              <SwitchRow
                label={intl.formatMessage(messages.allowDownloads)}
                checked={!!draft.allowDownloads}
                onChange={(v) => set('allowDownloads', v)}
              />
            </div>
            {(draft.openSubsonic || draft.jellyfinApi) && (
              <div className="sh-fields">
                {draft.openSubsonic && (
                  <Field
                    full
                    label={intl.formatMessage(messages.openSubsonicEndpoint)}
                  >
                    {(p) => <CopyRow {...p} value={endpoint('OpenSubsonic')} />}
                  </Field>
                )}
                {draft.jellyfinApi && (
                  <Field
                    full
                    label={intl.formatMessage(messages.jellyfinEndpoint)}
                  >
                    {(p) => <CopyRow {...p} value={endpoint('Jellyfin')} />}
                  </Field>
                )}
              </div>
            )}
            {(draft.openSubsonic || draft.jellyfinApi) &&
              !/^https?:\/\//i.test(endpoint('OpenSubsonic')) && (
                <p className="sh-sub">
                  <Link href="/settings/general">
                    {intl.formatMessage(messages.noUrl)}
                  </Link>
                </p>
              )}
            <div className="sh-fields">
              <Field label={intl.formatMessage(messages.quality)}>
                {(p) => (
                  <select
                    {...p}
                    value={draft.mobileTranscode ?? 'original'}
                    onChange={(e) => set('mobileTranscode', e.target.value)}
                  >
                    <option value="original">
                      {intl.formatMessage(messages.original)}
                    </option>
                    <option value="opus-160">
                      {intl.formatMessage(messages.opus160)}
                    </option>
                    <option value="mp3-320">
                      {intl.formatMessage(messages.mp3320)}
                    </option>
                    <option value="mp3-128">
                      {intl.formatMessage(messages.mp3128)}
                    </option>
                  </select>
                )}
              </Field>
            </div>
            <PanelError message={section.saveError} />
          </Panel>

          <Panel
            title={intl.formatMessage(messages.tested)}
            sub={intl.formatMessage(messages.testedSub)}
          >
            <div className="sh-int-grid">
              {TESTED_APPS.map((app) => {
                const usable = app.protocols.filter(isOn);
                return (
                  <article key={app.name} className="sh-int">
                    <header>
                      <span
                        className="sh-logo"
                        style={{ background: app.color }}
                        aria-hidden="true"
                      >
                        {app.tile}
                      </span>
                      <div>
                        <h3>{app.name}</h3>
                        <p>{app.platforms}</p>
                      </div>
                    </header>
                    <div className="sh-tag-row">
                      {app.protocols.map((protocol) => (
                        <span key={protocol} className="sh-tag s">
                          {protocol}
                        </span>
                      ))}
                    </div>
                    <details>
                      <summary className="cursor-pointer text-[14px] text-link">
                        {intl.formatMessage(messages.howTo)}
                      </summary>
                      <ol className="mt-2 list-decimal pl-5 text-[14px] text-muted">
                        <li>
                          {intl.formatMessage(messages.stepAdd, {
                            protocol: (usable[0] ?? app.protocols[0]) as string,
                            app: app.name,
                          })}
                        </li>
                        <li className="break-all">
                          {intl.formatMessage(messages.stepAddress, {
                            address: endpoint(usable[0] ?? app.protocols[0]),
                          })}
                        </li>
                        <li>{intl.formatMessage(messages.stepSignIn)}</li>
                      </ol>
                    </details>
                    <div className="foot">
                      {usable.length ? (
                        <span className="sh-badge-on">
                          {intl.formatMessage(messages.ready)}
                        </span>
                      ) : (
                        <span className="sh-badge-off">
                          {intl.formatMessage(messages.turnOn)}
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </Panel>

          <Panel
            title={intl.formatMessage(messages.devices)}
            sub={intl.formatMessage(messages.devicesSub)}
          >
            {devicesError && !devices ? (
              <p className="sh-err" role="alert">
                {intl.formatMessage(messages.devicesFailed)}
              </p>
            ) : !devices ? (
              <LoadingSpinner />
            ) : devices.length === 0 ? (
              <p className="sh-sub">{intl.formatMessage(messages.noDevices)}</p>
            ) : (
              <div className="sh-box">
                <ul className="sh-list">
                  {devices.map((device) => (
                    <li key={device.id}>
                      <Avatar
                        size="sm"
                        name={device.user.displayName}
                        src={device.user.avatar}
                      />
                      <div className="grow">
                        <div className="sh-title">{device.name}</div>
                        <div className="sh-sub">
                          <Link href={`/users/${device.user.id}`}>
                            {device.user.displayName}
                          </Link>
                          {' · '}
                          {device.lastUsedAt
                            ? device.lastUsedClient
                              ? intl.formatMessage(messages.lastUsedWith, {
                                  time: relative(device.lastUsedAt),
                                  client: device.lastUsedClient,
                                })
                              : intl.formatMessage(messages.lastUsed, {
                                  time: relative(device.lastUsedAt),
                                })
                            : intl.formatMessage(messages.neverUsed)}
                        </div>
                      </div>
                      <Button
                        type="button"
                        buttonSize="sm"
                        disabled={revoking === device.id}
                        aria-label={intl.formatMessage(messages.revokeLabel, {
                          name: device.name,
                          user: device.user.displayName,
                        })}
                        onClick={() => revoke(device)}
                      >
                        {intl.formatMessage(messages.revoke)}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
        </>
      )}
    </SettingsPage>
  );
};

export default SettingsClients;
