// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Button from '@app/components/Common/Button';
import Field from '@app/components/Common/Field';
import Panel from '@app/components/Common/Panel';
import SwitchRow from '@app/components/Common/SwitchRow';
import JSONEditor from '@app/components/JSONEditor';
import NotificationTypeSelector from '@app/components/NotificationTypeSelector';
import {
  apiMessage,
  NumberInput,
  PanelError,
  SaveButton,
  SecretInput,
  SettingsPage,
  useSection,
} from '@app/components/Settings/shared';
import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type {
  NotificationAgentResponse,
  NotificationAgentsOverview,
} from '@server/interfaces/api/settingsInterfaces';
import axios from 'axios';
import Link from 'next/link';
import { useState } from 'react';
import type { MessageDescriptor } from 'react-intl';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Settings.SettingsNotifications', {
  title: 'Notifications',
  description:
    'Tell people when their music arrives, and tell admins when something needs approval.',
  agentsLabel: 'Notification agents',
  enabledMark: 'on',
  send: 'Send {agent} notifications',
  whatToSend: 'What to send',
  sendTest: 'Send test',
  sendingTest: 'Sending…',
  testSent: 'Test notification sent with {agent}.',
  testFailed:
    'The test notification couldn’t be sent. Check the {agent} settings and try again.',
  saved: 'Notification settings saved.',
  loadFailed:
    'The {agent} settings couldn’t be loaded. Reload the page to try again.',
  typesRequired: 'Choose at least one thing to send, or turn this agent off.',
  required: 'Fill in {field} before turning this agent on.',
  urlInvalid:
    '{field} needs a full address that starts with http:// or https://.',
  webpushNote:
    'Browser notifications. People allow them from their own browser.',
  discordMentionsNote:
    'Uses the Discord user ID people add in their notification settings.',
  senderName: 'Sender name',
  emailFrom: 'Sender address',
  smtpHost: 'SMTP host',
  smtpPort: 'SMTP port',
  encryption: 'Encryption',
  encryptionNone: 'None',
  encryptionStarttls: 'STARTTLS',
  encryptionTls: 'Always TLS',
  authUser: 'SMTP username',
  authPass: 'SMTP password',
  allowSelfSigned: 'Allow self-signed certificates',
  pgpPrivateKey: 'PGP private key',
  pgpPrivateKeyHint: 'Optional. Signs outgoing email.',
  pgpPassword: 'PGP password',
  webhookUrl: 'Webhook URL',
  botUsername: 'Bot name',
  botAvatarUrl: 'Bot avatar URL',
  enableMentions: 'Mention users',
  botAPI: 'Bot token',
  chatId: 'Chat ID',
  sendSilently: 'Send silently',
  sendSilentlyTip: 'Notifications arrive without a sound.',
  accessToken: 'Access token',
  channelTag: 'Channel tag',
  pushoverToken: 'Application token',
  pushoverUser: 'User or group key',
  sound: 'Sound',
  soundHint: 'Leave empty to use each device’s default sound.',
  authHeader: 'Authorization header',
  jsonPayload: 'JSON payload',
  jsonPayloadHint:
    'Use variables like {event}, {mediaTitle} and {requestedBy}. All variables: {all}',
  resetPayload: 'Reset to default',
  payloadInvalid:
    'The JSON payload isn’t valid JSON. Fix it or reset it to the default.',
  gotifyUrl: 'Server URL',
  gotifyToken: 'Application token',
  priority: 'Priority',
  ntfyUrl: 'Server URL',
  topic: 'Topic',
  username: 'Username',
  password: 'Password',
});

export const NOTIFICATION_AGENTS = [
  { key: 'email', name: 'Email' },
  { key: 'webpush', name: 'Web push' },
  { key: 'discord', name: 'Discord' },
  { key: 'slack', name: 'Slack' },
  { key: 'telegram', name: 'Telegram' },
  { key: 'pushbullet', name: 'Pushbullet' },
  { key: 'pushover', name: 'Pushover' },
  { key: 'webhook', name: 'Webhook' },
  { key: 'gotify', name: 'Gotify' },
  { key: 'ntfy', name: 'ntfy' },
] as const;

export type NotificationAgentName = (typeof NOTIFICATION_AGENTS)[number]['key'];

/** Variables the webhook template can use (docs/ADMIN_PAGES.md §Notifications). */
const WEBHOOK_VARIABLES = [
  '{{event}}',
  '{{subject}}',
  '{{message}}',
  '{{image}}',
  '{{notification_type}}',
  '{{requestedBy_username}}',
  '{{requestedBy_email}}',
  '{{requestedBy_avatar}}',
  '{{media_type}}',
  '{{media_mbid}}',
  '{{media_title}}',
  '{{media_artist}}',
  '{{media_status}}',
  '{{request_id}}',
  '{{request_scope}}',
  '{{request_track_count}}',
  '{{request_release_count}}',
  '{{extra}}',
];

const DEFAULT_WEBHOOK_PAYLOAD = JSON.stringify(
  {
    notification_type: '{{notification_type}}',
    event: '{{event}}',
    subject: '{{subject}}',
    message: '{{message}}',
    image: '{{image}}',
    media: {
      media_type: '{{media_type}}',
      mbid: '{{media_mbid}}',
      title: '{{media_title}}',
      artist: '{{media_artist}}',
      status: '{{media_status}}',
    },
    request: {
      request_id: '{{request_id}}',
      scope: '{{request_scope}}',
      track_count: '{{request_track_count}}',
      release_count: '{{request_release_count}}',
      requestedBy_username: '{{requestedBy_username}}',
      requestedBy_email: '{{requestedBy_email}}',
      requestedBy_avatar: '{{requestedBy_avatar}}',
    },
    '{{extra}}': [],
  },
  null,
  2
);

/** The stored payload may arrive as an object, JSON text or base64 JSON text. */
const payloadToText = (value: unknown): string => {
  if (value && typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  if (typeof value !== 'string' || !value.trim()) {
    return DEFAULT_WEBHOOK_PAYLOAD;
  }
  const pretty = (text: string): string | null => {
    try {
      const parsed = JSON.parse(text);
      return typeof parsed === 'string'
        ? pretty(parsed)
        : JSON.stringify(parsed, null, 2);
    } catch {
      return null;
    }
  };
  const direct = pretty(value);
  if (direct) {
    return direct;
  }
  try {
    const decoded = pretty(decodeURIComponent(escape(window.atob(value))));
    if (decoded) {
      return decoded;
    }
  } catch {
    // not base64
  }
  return value;
};

type FieldKind = 'text' | 'url' | 'secret' | 'number' | 'textarea';

interface AgentField {
  key: string;
  label: MessageDescriptor;
  kind: FieldKind;
  hint?: MessageDescriptor;
  required?: boolean;
  full?: boolean;
}

interface AgentSwitch {
  key: string;
  label: MessageDescriptor;
  tip?: MessageDescriptor;
}

const AGENT_FIELDS: Record<
  NotificationAgentName,
  { fields: AgentField[]; switches?: AgentSwitch[]; note?: MessageDescriptor }
> = {
  email: {
    fields: [
      { key: 'senderName', label: messages.senderName, kind: 'text' },
      {
        key: 'emailFrom',
        label: messages.emailFrom,
        kind: 'text',
        required: true,
      },
      {
        key: 'smtpHost',
        label: messages.smtpHost,
        kind: 'text',
        required: true,
      },
      {
        key: 'smtpPort',
        label: messages.smtpPort,
        kind: 'number',
        required: true,
      },
      { key: 'authUser', label: messages.authUser, kind: 'text' },
      { key: 'authPass', label: messages.authPass, kind: 'secret' },
      {
        key: 'pgpPrivateKey',
        label: messages.pgpPrivateKey,
        kind: 'textarea',
        hint: messages.pgpPrivateKeyHint,
        full: true,
      },
      { key: 'pgpPassword', label: messages.pgpPassword, kind: 'secret' },
    ],
    switches: [{ key: 'allowSelfSigned', label: messages.allowSelfSigned }],
  },
  webpush: { fields: [], note: messages.webpushNote },
  discord: {
    fields: [
      {
        key: 'webhookUrl',
        label: messages.webhookUrl,
        kind: 'secret',
        required: true,
        full: true,
      },
      { key: 'botUsername', label: messages.botUsername, kind: 'text' },
      { key: 'botAvatarUrl', label: messages.botAvatarUrl, kind: 'url' },
    ],
    switches: [
      {
        key: 'enableMentions',
        label: messages.enableMentions,
        tip: messages.discordMentionsNote,
      },
    ],
  },
  slack: {
    fields: [
      {
        key: 'webhookUrl',
        label: messages.webhookUrl,
        kind: 'secret',
        required: true,
        full: true,
      },
    ],
  },
  telegram: {
    fields: [
      { key: 'botAPI', label: messages.botAPI, kind: 'secret', required: true },
      { key: 'chatId', label: messages.chatId, kind: 'text', required: true },
    ],
    switches: [
      {
        key: 'sendSilently',
        label: messages.sendSilently,
        tip: messages.sendSilentlyTip,
      },
    ],
  },
  pushbullet: {
    fields: [
      {
        key: 'accessToken',
        label: messages.accessToken,
        kind: 'secret',
        required: true,
      },
      { key: 'channelTag', label: messages.channelTag, kind: 'text' },
    ],
  },
  pushover: {
    fields: [
      {
        key: 'accessToken',
        label: messages.pushoverToken,
        kind: 'secret',
        required: true,
      },
      {
        key: 'userToken',
        label: messages.pushoverUser,
        kind: 'secret',
        required: true,
      },
      {
        key: 'sound',
        label: messages.sound,
        kind: 'text',
        hint: messages.soundHint,
      },
    ],
  },
  webhook: {
    fields: [
      {
        key: 'webhookUrl',
        label: messages.webhookUrl,
        kind: 'url',
        required: true,
        full: true,
      },
      {
        key: 'authHeader',
        label: messages.authHeader,
        kind: 'secret',
        full: true,
      },
    ],
  },
  gotify: {
    fields: [
      { key: 'url', label: messages.gotifyUrl, kind: 'url', required: true },
      {
        key: 'token',
        label: messages.gotifyToken,
        kind: 'secret',
        required: true,
      },
      { key: 'priority', label: messages.priority, kind: 'number' },
    ],
  },
  ntfy: {
    fields: [
      { key: 'url', label: messages.ntfyUrl, kind: 'url', required: true },
      { key: 'topic', label: messages.topic, kind: 'text', required: true },
      { key: 'username', label: messages.username, kind: 'text' },
      { key: 'password', label: messages.password, kind: 'secret' },
    ],
  },
};

type Encryption = 'none' | 'starttls' | 'tls';

const encryptionOf = (options: Record<string, unknown>): Encryption =>
  options.secure ? 'tls' : options.requireTls ? 'starttls' : 'none';

const encryptionOptions = (value: Encryption) => ({
  secure: value === 'tls',
  requireTls: value === 'starttls',
  ignoreTls: value === 'none',
});

const AgentForm = ({ agent }: { agent: NotificationAgentName }) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const name = NOTIFICATION_AGENTS.find((a) => a.key === agent)?.name ?? agent;
  const config = AGENT_FIELDS[agent];
  const section = useSection<NotificationAgentResponse>(
    `/api/v1/settings/notifications/${agent}`
  );
  const { draft, set } = section;
  const { mutate: revalidateOverview } = useSWR<NotificationAgentsOverview>(
    '/api/v1/settings/notifications'
  );
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  // Webhook template text; null until the user edits it (then it wins over the stored value).
  const [payloadText, setPayloadText] = useState<string | null>(null);

  const options = (draft?.options ?? {}) as Record<string, unknown>;
  const text = (key: string) =>
    options[key] === undefined || options[key] === null
      ? ''
      : String(options[key]);
  const payload =
    agent === 'webhook'
      ? (payloadText ?? payloadToText(options.jsonPayload))
      : '';

  /** The body to save or test: the draft, with the webhook template as JSON text. */
  const body = (): NotificationAgentResponse | null => {
    if (!draft) {
      return null;
    }
    const next: NotificationAgentResponse = {
      ...draft,
      options: { ...options },
    };
    if (agent === 'webhook') {
      next.options.jsonPayload = payload;
    }
    if (agent === 'ntfy') {
      next.options.authMethodUsernamePassword = !!text('username');
    }
    return next;
  };

  const validate = (): string | null => {
    if (!draft) {
      return null;
    }
    if (agent === 'webhook') {
      try {
        JSON.parse(payload);
      } catch {
        return intl.formatMessage(messages.payloadInvalid);
      }
    }
    if (!draft.enabled) {
      return null;
    }
    for (const field of config.fields) {
      const value = text(field.key).trim();
      const label = intl.formatMessage(field.label);
      if (field.required && !value) {
        return intl.formatMessage(messages.required, { field: label });
      }
      if (
        field.kind === 'url' &&
        value &&
        !/^https?:\/\/[^\s/]+/i.test(value)
      ) {
        return intl.formatMessage(messages.urlInvalid, { field: label });
      }
    }
    if (!draft.types?.length) {
      return intl.formatMessage(messages.typesRequired);
    }
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) {
      return;
    }
    const saved = await section.save({
      body: body(),
      okMessage: intl.formatMessage(messages.saved),
    });
    if (saved) {
      setPayloadText(null);
      revalidateOverview();
    }
  };

  const sendTest = async () => {
    const problem = validate();
    setError(problem);
    if (problem) {
      return;
    }
    setTesting(true);
    try {
      await axios.post(`/api/v1/settings/notifications/${agent}/test`, body());
      addToast(intl.formatMessage(messages.testSent, { agent: name }), {
        appearance: 'success',
      });
    } catch (e) {
      addToast(
        apiMessage(e, intl.formatMessage(messages.testFailed, { agent: name })),
        { appearance: 'error' }
      );
    } finally {
      setTesting(false);
    }
  };

  if (section.loadError) {
    return (
      <PanelError
        message={intl.formatMessage(messages.loadFailed, { agent: name })}
      />
    );
  }
  if (!draft) {
    return null;
  }

  return (
    <Panel
      as="form"
      title={name}
      sub={config.note ? intl.formatMessage(config.note) : undefined}
      onSubmit={submit}
      actions={
        <>
          <Button type="button" onClick={sendTest} disabled={testing}>
            {intl.formatMessage(
              testing ? messages.sendingTest : messages.sendTest
            )}
          </Button>
          <SaveButton saving={section.saving} />
        </>
      }
    >
      <div className="sh-box">
        <SwitchRow
          label={intl.formatMessage(messages.send, { agent: name })}
          checked={!!draft.enabled}
          onChange={(v) => set('enabled', v)}
        />
      </div>

      {(config.fields.length > 0 || agent === 'email') && (
        <div className="sh-fields">
          {config.fields.map((field) => (
            <Field
              key={field.key}
              full={field.full}
              required={field.required}
              label={intl.formatMessage(field.label)}
              hint={field.hint ? intl.formatMessage(field.hint) : undefined}
            >
              {(p) =>
                field.kind === 'secret' ? (
                  <SecretInput
                    {...p}
                    value={text(field.key)}
                    onChange={(v) => set(`options.${field.key}`, v)}
                  />
                ) : field.kind === 'number' ? (
                  <NumberInput
                    {...p}
                    min={0}
                    value={
                      options[field.key] === undefined
                        ? undefined
                        : Number(options[field.key])
                    }
                    onChange={(v) => set(`options.${field.key}`, v)}
                  />
                ) : field.kind === 'textarea' ? (
                  <textarea
                    {...p}
                    rows={4}
                    className="font-mono"
                    value={text(field.key)}
                    onChange={(e) =>
                      set(`options.${field.key}`, e.target.value)
                    }
                  />
                ) : (
                  <input
                    {...p}
                    type={field.kind === 'url' ? 'url' : 'text'}
                    inputMode={field.kind === 'url' ? 'url' : undefined}
                    className={field.kind === 'url' ? 'font-mono' : undefined}
                    autoComplete="off"
                    value={text(field.key)}
                    onChange={(e) =>
                      set(`options.${field.key}`, e.target.value)
                    }
                  />
                )
              }
            </Field>
          ))}
          {agent === 'email' && (
            <Field label={intl.formatMessage(messages.encryption)}>
              {(p) => (
                <select
                  {...p}
                  value={encryptionOf(options)}
                  onChange={(e) =>
                    section.setDraft((current) =>
                      current
                        ? {
                            ...current,
                            options: {
                              ...current.options,
                              ...encryptionOptions(
                                e.target.value as Encryption
                              ),
                            },
                          }
                        : current
                    )
                  }
                >
                  <option value="none">
                    {intl.formatMessage(messages.encryptionNone)}
                  </option>
                  <option value="starttls">
                    {intl.formatMessage(messages.encryptionStarttls)}
                  </option>
                  <option value="tls">
                    {intl.formatMessage(messages.encryptionTls)}
                  </option>
                </select>
              )}
            </Field>
          )}
        </div>
      )}

      {config.switches && (
        <div className="sh-box">
          {config.switches.map((item) => (
            <SwitchRow
              key={item.key}
              label={intl.formatMessage(item.label)}
              description={item.tip ? intl.formatMessage(item.tip) : undefined}
              checked={!!options[item.key]}
              onChange={(v) => set(`options.${item.key}`, v)}
            />
          ))}
        </div>
      )}

      {agent === 'webhook' && (
        <div className="flex flex-col gap-2">
          <span className="group-label" id="webhook-payload-label">
            {intl.formatMessage(messages.jsonPayload)}
          </span>
          <JSONEditor
            name="webhook-json-payload"
            aria-labelledby="webhook-payload-label"
            value={payload}
            onUpdate={(value) => setPayloadText(value)}
          />
          <p className="sh-sub">
            {intl.formatMessage(messages.jsonPayloadHint, {
              event: '{{event}}',
              mediaTitle: '{{media_title}}',
              requestedBy: '{{requestedBy_username}}',
              all: (
                <span key="all" className="font-mono text-[12px]">
                  {WEBHOOK_VARIABLES.join(' ')}
                </span>
              ),
            })}
          </p>
          <div>
            <Button
              type="button"
              buttonSize="sm"
              onClick={() => setPayloadText(DEFAULT_WEBHOOK_PAYLOAD)}
            >
              {intl.formatMessage(messages.resetPayload)}
            </Button>
          </div>
        </div>
      )}

      <NotificationTypeSelector
        legend={intl.formatMessage(messages.whatToSend)}
        currentTypes={draft.types ?? []}
        onUpdate={(types) => set('types', types)}
      />
      <PanelError message={error ?? section.saveError} />
    </Panel>
  );
};

/** Agent pills (● marks enabled ones) and the selected agent's form. */
const SettingsNotifications = ({ agent }: { agent: NotificationAgentName }) => {
  const intl = useIntl();
  const { data: overview, error } = useSWR<NotificationAgentsOverview>(
    '/api/v1/settings/notifications'
  );
  const enabled = (key: string) =>
    !!overview?.agents?.find((a) => a.key === key)?.enabled;

  return (
    <SettingsPage
      title={intl.formatMessage(messages.title)}
      description={intl.formatMessage(messages.description)}
      loadError={error && !overview ? error : undefined}
    >
      <nav
        className="sh-subnav-pills"
        aria-label={intl.formatMessage(messages.agentsLabel)}
      >
        {NOTIFICATION_AGENTS.map((item) => (
          <Link
            key={item.key}
            href={`/settings/notifications/${item.key}`}
            aria-current={item.key === agent ? 'page' : undefined}
          >
            {enabled(item.key) && (
              <>
                <span aria-hidden="true">● </span>
                <span className="sr-only">
                  {intl.formatMessage(messages.enabledMark)}{' '}
                </span>
              </>
            )}
            {item.name}
          </Link>
        ))}
      </nav>
      <AgentForm key={agent} agent={agent} />
    </SettingsPage>
  );
};

export default SettingsNotifications;
