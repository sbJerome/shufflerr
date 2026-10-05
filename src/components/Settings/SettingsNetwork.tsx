// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: src/components/Settings/SettingsNetwork/index.tsx at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import Alert from '@app/components/Common/Alert';
import Field from '@app/components/Common/Field';
import Panel from '@app/components/Common/Panel';
import SwitchRow from '@app/components/Common/SwitchRow';
import {
  NumberInput,
  PanelError,
  SaveButton,
  SecretInput,
  SettingsPage,
  useSection,
} from '@app/components/Settings/shared';
import defineMessages from '@app/utils/defineMessages';
import type {
  NetworkSettingsResponse,
  StatusResponse,
} from '@server/interfaces/api/settingsInterfaces';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Settings.SettingsNetwork', {
  title: 'Network',
  description:
    'Proxy, DNS and connection settings. Most servers don’t need to change these.',
  security: 'Security',
  csrf: 'CSRF protection',
  csrfTip: 'Makes the external API read-only from other sites. Needs HTTPS.',
  trustProxy: 'Behind a reverse proxy',
  trustProxyTip:
    'Trust the address your proxy passes on, for example from Nginx or Traefik.',
  proxy: 'Outgoing proxy',
  proxySub:
    'Send Shufflerr’s requests to MusicBrainz, Spotify and others through a proxy.',
  proxyEnabled: 'Use an HTTP(S) proxy',
  proxyHostname: 'Proxy hostname',
  proxyPort: 'Proxy port',
  proxyUser: 'Proxy username',
  proxyPassword: 'Proxy password',
  proxyBypass: 'Skip the proxy for these addresses',
  proxyBypassHint: 'Separate addresses with commas.',
  proxySsl: 'Use SSL for the proxy',
  proxyBypassLocal: 'Skip the proxy for local addresses',
  dns: 'DNS and timeouts',
  ipv4: 'Prefer IPv4',
  ipv4Tip: 'Try IPv4 addresses before IPv6.',
  dnsCache: 'Cache DNS lookups',
  minTtl: 'Minimum cache time (seconds)',
  maxTtl: 'Maximum cache time (seconds)',
  timeout: 'Request timeout (milliseconds)',
  restart: 'Restart Shufflerr for the network changes to take effect.',
});

const SettingsNetwork = () => {
  const intl = useIntl();
  const section = useSection<NetworkSettingsResponse>(
    '/api/v1/settings/network'
  );
  const { draft, set } = section;
  const { data: status, mutate: revalidateStatus } =
    useSWR<StatusResponse>('/api/v1/status');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await section.save();
    revalidateStatus();
  };
  const actions = <SaveButton saving={section.saving} />;

  return (
    <SettingsPage
      title={intl.formatMessage(messages.title)}
      description={intl.formatMessage(messages.description)}
      loading={section.loading}
      loadError={section.loadError}
    >
      {draft && (
        <>
          {status?.restartRequired && (
            <Alert
              title={intl.formatMessage(messages.restart)}
              type="warning"
            />
          )}
          <Panel
            as="form"
            title={intl.formatMessage(messages.security)}
            onSubmit={submit}
            actions={actions}
          >
            <div className="sh-box">
              <SwitchRow
                label={intl.formatMessage(messages.csrf)}
                description={intl.formatMessage(messages.csrfTip)}
                checked={!!draft.csrfProtection}
                onChange={(v) => set('csrfProtection', v)}
              />
              <SwitchRow
                label={intl.formatMessage(messages.trustProxy)}
                description={intl.formatMessage(messages.trustProxyTip)}
                checked={!!draft.trustProxy}
                onChange={(v) => set('trustProxy', v)}
              />
            </div>
            <PanelError message={section.saveError} />
          </Panel>

          <Panel
            as="form"
            title={intl.formatMessage(messages.proxy)}
            sub={intl.formatMessage(messages.proxySub)}
            onSubmit={submit}
            actions={actions}
          >
            <div className="sh-box">
              <SwitchRow
                label={intl.formatMessage(messages.proxyEnabled)}
                checked={!!draft.proxy?.enabled}
                onChange={(v) => set('proxy.enabled', v)}
              />
            </div>
            {draft.proxy?.enabled && (
              <>
                <div className="sh-fields">
                  <Field label={intl.formatMessage(messages.proxyHostname)}>
                    {(p) => (
                      <input
                        {...p}
                        type="text"
                        className="font-mono"
                        value={draft.proxy.hostname ?? ''}
                        onChange={(e) => set('proxy.hostname', e.target.value)}
                      />
                    )}
                  </Field>
                  <Field label={intl.formatMessage(messages.proxyPort)}>
                    {(p) => (
                      <NumberInput
                        {...p}
                        min={1}
                        max={65535}
                        value={draft.proxy.port}
                        onChange={(v) => set('proxy.port', v)}
                      />
                    )}
                  </Field>
                  <Field label={intl.formatMessage(messages.proxyUser)}>
                    {(p) => (
                      <input
                        {...p}
                        type="text"
                        autoComplete="off"
                        value={draft.proxy.user ?? ''}
                        onChange={(e) => set('proxy.user', e.target.value)}
                      />
                    )}
                  </Field>
                  <Field label={intl.formatMessage(messages.proxyPassword)}>
                    {(p) => (
                      <SecretInput
                        {...p}
                        value={draft.proxy.password ?? ''}
                        onChange={(v) => set('proxy.password', v)}
                      />
                    )}
                  </Field>
                  <Field
                    full
                    label={intl.formatMessage(messages.proxyBypass)}
                    hint={intl.formatMessage(messages.proxyBypassHint)}
                  >
                    {(p) => (
                      <input
                        {...p}
                        type="text"
                        className="font-mono"
                        placeholder="localhost, 10.0.0.0/8, *.lan"
                        value={draft.proxy.bypassFilter ?? ''}
                        onChange={(e) =>
                          set('proxy.bypassFilter', e.target.value)
                        }
                      />
                    )}
                  </Field>
                </div>
                <div className="sh-box">
                  <SwitchRow
                    label={intl.formatMessage(messages.proxySsl)}
                    checked={!!draft.proxy.useSsl}
                    onChange={(v) => set('proxy.useSsl', v)}
                  />
                  <SwitchRow
                    label={intl.formatMessage(messages.proxyBypassLocal)}
                    checked={!!draft.proxy.bypassLocalAddresses}
                    onChange={(v) => set('proxy.bypassLocalAddresses', v)}
                  />
                </div>
              </>
            )}
          </Panel>

          <Panel
            as="form"
            title={intl.formatMessage(messages.dns)}
            onSubmit={submit}
            actions={actions}
          >
            <div className="sh-box">
              <SwitchRow
                label={intl.formatMessage(messages.ipv4)}
                description={intl.formatMessage(messages.ipv4Tip)}
                checked={!!draft.forceIpv4First}
                onChange={(v) => set('forceIpv4First', v)}
              />
              <SwitchRow
                label={intl.formatMessage(messages.dnsCache)}
                checked={!!draft.dnsCache?.enabled}
                onChange={(v) => set('dnsCache.enabled', v)}
              />
            </div>
            <div className="sh-fields">
              {draft.dnsCache?.enabled && (
                <>
                  <Field label={intl.formatMessage(messages.minTtl)}>
                    {(p) => (
                      <NumberInput
                        {...p}
                        min={0}
                        value={draft.dnsCache.forceMinTtl}
                        onChange={(v) => set('dnsCache.forceMinTtl', v)}
                      />
                    )}
                  </Field>
                  <Field label={intl.formatMessage(messages.maxTtl)}>
                    {(p) => (
                      <NumberInput
                        {...p}
                        min={-1}
                        value={draft.dnsCache.forceMaxTtl}
                        onChange={(v) => set('dnsCache.forceMaxTtl', v)}
                      />
                    )}
                  </Field>
                </>
              )}
              <Field label={intl.formatMessage(messages.timeout)}>
                {(p) => (
                  <NumberInput
                    {...p}
                    min={0}
                    value={draft.apiRequestTimeout}
                    onChange={(v) => set('apiRequestTimeout', v)}
                  />
                )}
              </Field>
            </div>
          </Panel>
        </>
      )}
    </SettingsPage>
  );
};

export default SettingsNetwork;
