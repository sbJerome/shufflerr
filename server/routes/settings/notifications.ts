// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type { User } from '@server/entity/User';
import type {
  NotificationAgentResponse,
  NotificationAgentsOverview,
} from '@server/interfaces/api/settingsInterfaces';
import { Notification } from '@server/lib/notifications';
import type { NotificationAgent } from '@server/lib/notifications/agents/agent';
import DiscordAgent from '@server/lib/notifications/agents/discord';
import EmailAgent from '@server/lib/notifications/agents/email';
import GotifyAgent from '@server/lib/notifications/agents/gotify';
import NtfyAgent from '@server/lib/notifications/agents/ntfy';
import PushbulletAgent from '@server/lib/notifications/agents/pushbullet';
import PushoverAgent from '@server/lib/notifications/agents/pushover';
import SlackAgent from '@server/lib/notifications/agents/slack';
import TelegramAgent from '@server/lib/notifications/agents/telegram';
import WebhookAgent from '@server/lib/notifications/agents/webhook';
import WebPushAgent from '@server/lib/notifications/agents/webpush';
import {
  MUSIC_NOTIFICATION_TYPES,
  maskToTypes,
  typesToMask,
} from '@server/lib/notifications/types';
import type { NotificationAgentConfig } from '@server/lib/settings';
import {
  getSettings,
  isMaskedSecret,
  maskSecret,
  resolveSecret,
} from '@server/lib/settings';
import { Router } from 'express';
import validator from 'validator';

const notificationRoutes = Router();

export type AgentKey =
  | 'email'
  | 'webpush'
  | 'discord'
  | 'slack'
  | 'telegram'
  | 'pushbullet'
  | 'pushover'
  | 'webhook'
  | 'gotify'
  | 'ntfy';

type Options = Record<string, unknown>;

interface AgentSpec {
  name: string;
  /** Option keys that are masked in GET and kept when the mask is posted back. */
  secrets: string[];
  /** Returns a message when the options can't work, else undefined. Only run when enabled. */
  validate: (options: Options) => string | undefined;
  create: (config: NotificationAgentConfig) => NotificationAgent;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const isUrl = (v: unknown): boolean =>
  validator.isURL(str(v), {
    require_protocol: true,
    require_tld: false,
    protocols: ['http', 'https'],
  });

const urlError = (label: string, v: unknown): string | undefined => {
  if (!str(v)) {
    return `Enter the ${label}.`;
  }
  // A masked value is the stored (already validated) one.
  if (!isMaskedSecret(v) && !isUrl(v)) {
    return `The ${label} isn't a valid address. Start it with http:// or https://.`;
  }
  return undefined;
};

const required = (label: string, v: unknown): string | undefined =>
  str(v) || typeof v === 'number' ? undefined : `Enter the ${label}.`;

const first = (...errors: (string | undefined)[]): string | undefined =>
  errors.find((e) => !!e);

/* eslint-disable @typescript-eslint/no-explicit-any */
export const AGENTS: Record<AgentKey, AgentSpec> = {
  email: {
    name: 'Email',
    secrets: ['authPass', 'pgpPrivateKey', 'pgpPassword'],
    validate: (o) =>
      first(
        !str(o.emailFrom)
          ? 'Enter the sender address.'
          : !validator.isEmail(str(o.emailFrom), { require_tld: false })
            ? "The sender address isn't a valid email address."
            : undefined,
        required('SMTP host', o.smtpHost),
        !Number.isInteger(Number(o.smtpPort)) ||
          Number(o.smtpPort) < 1 ||
          Number(o.smtpPort) > 65535
          ? 'The SMTP port has to be a number between 1 and 65535.'
          : undefined
      ),
    create: (c) => new EmailAgent(c as any),
  },
  webpush: {
    name: 'Web push',
    secrets: [],
    validate: () => undefined,
    create: (c) => new WebPushAgent(c),
  },
  discord: {
    name: 'Discord',
    secrets: ['webhookUrl'],
    validate: (o) =>
      first(
        urlError('webhook URL', o.webhookUrl),
        str(o.botAvatarUrl) && !isUrl(o.botAvatarUrl)
          ? "The bot avatar URL isn't a valid address. Start it with http:// or https://."
          : undefined
      ),
    create: (c) => new DiscordAgent(c as any),
  },
  slack: {
    name: 'Slack',
    secrets: ['webhookUrl'],
    validate: (o) => urlError('webhook URL', o.webhookUrl),
    create: (c) => new SlackAgent(c as any),
  },
  telegram: {
    name: 'Telegram',
    secrets: ['botAPI'],
    validate: (o) =>
      first(required('bot token', o.botAPI), required('chat ID', o.chatId)),
    create: (c) => new TelegramAgent(c as any),
  },
  pushbullet: {
    name: 'Pushbullet',
    secrets: ['accessToken'],
    validate: (o) => required('access token', o.accessToken),
    create: (c) => new PushbulletAgent(c as any),
  },
  pushover: {
    name: 'Pushover',
    secrets: ['accessToken', 'userToken'],
    validate: (o) =>
      first(
        required('application token', o.accessToken),
        required('user or group key', o.userToken)
      ),
    create: (c) => new PushoverAgent(c as any),
  },
  webhook: {
    name: 'Webhook',
    secrets: ['authHeader'],
    validate: (o) => urlError('webhook URL', o.webhookUrl),
    create: (c) => new WebhookAgent(c as any),
  },
  gotify: {
    name: 'Gotify',
    secrets: ['token'],
    validate: (o) =>
      first(
        urlError('server URL', o.url),
        required('application token', o.token),
        !Number.isInteger(Number(o.priority)) ||
          Number(o.priority) < 0 ||
          Number(o.priority) > 10
          ? 'The priority has to be a number from 0 to 10.'
          : undefined
      ),
    create: (c) => new GotifyAgent(c as any),
  },
  ntfy: {
    name: 'ntfy',
    secrets: ['password', 'token'],
    validate: (o) =>
      first(urlError('server URL', o.url), required('topic', o.topic)),
    create: (c) => new NtfyAgent(c as any),
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Display order of the pills (docs/ADMIN_PAGES.md §Notifications). */
export const AGENT_ORDER: AgentKey[] = [
  'email',
  'webpush',
  'discord',
  'slack',
  'telegram',
  'pushbullet',
  'pushover',
  'webhook',
  'gotify',
  'ntfy',
];

const isAgentKey = (key: string): key is AgentKey =>
  Object.prototype.hasOwnProperty.call(AGENTS, key);

const stored = (key: AgentKey): NotificationAgentConfig =>
  getSettings().notifications.agents[key] as NotificationAgentConfig;

const decodeWebhookPayload = (encoded: unknown): string => {
  try {
    const decoded = JSON.parse(
      Buffer.from(String(encoded ?? ''), 'base64').toString('utf8')
    );
    return typeof decoded === 'string' ? decoded : JSON.stringify(decoded);
  } catch {
    return '';
  }
};

const encodeWebhookPayload = (template: string): string =>
  Buffer.from(JSON.stringify(template)).toString('base64');

type EmailEncryption = 'none' | 'starttls' | 'tls';

/** Seerr's three SMTP flags as the single choice the page shows. */
const emailEncryption = (o: Options): EmailEncryption =>
  o.secure ? 'tls' : o.requireTls ? 'starttls' : 'none';

/** What GET returns: string type keys, masked secrets, decoded webhook template. */
export const toResponse = (
  key: AgentKey,
  config: NotificationAgentConfig
): NotificationAgentResponse => {
  const options: Options = { ...(config.options ?? {}) };

  for (const secret of AGENTS[key].secrets) {
    if (typeof options[secret] === 'string') {
      options[secret] = maskSecret(options[secret] as string);
    }
  }

  if (key === 'webhook') {
    options.jsonPayload = decodeWebhookPayload(config.options.jsonPayload);
    options.customHeaders = options.customHeaders ?? [];
    options.supportVariables = options.supportVariables ?? false;
  }
  if (key === 'email') {
    options.encryption = emailEncryption(options);
  }

  return {
    enabled: !!config.enabled,
    embedPoster: config.embedPoster ?? true,
    types: maskToTypes(config.types ?? 0).filter((t) =>
      MUSIC_NOTIFICATION_TYPES.includes(t)
    ),
    options,
  };
};

/**
 * Turns a posted body into the config to store (or to test). Throws an
 * `{status, message}` object the error handler understands.
 */
export const fromBody = (
  key: AgentKey,
  body: Partial<NotificationAgentResponse> | undefined,
  current: NotificationAgentConfig
): NotificationAgentConfig => {
  const spec = AGENTS[key];
  const incoming: Options = { ...((body?.options as Options) ?? {}) };
  const currentOptions = (current.options ?? {}) as Options;
  const options: Options = { ...currentOptions, ...incoming };

  for (const secret of spec.secrets) {
    options[secret] = resolveSecret(
      incoming[secret] as string | undefined,
      currentOptions[secret] as string | undefined
    );
  }

  if (key === 'email') {
    const encryption = incoming.encryption as EmailEncryption | undefined;
    if (encryption) {
      if (!['none', 'starttls', 'tls'].includes(encryption)) {
        throw {
          status: 400,
          message: 'Choose no encryption, STARTTLS or always TLS.',
        };
      }
      options.secure = encryption === 'tls';
      options.requireTls = encryption === 'starttls';
      options.ignoreTls = encryption === 'none';
    }
    delete options.encryption;
    options.smtpPort = Number(options.smtpPort);
  }

  if (key === 'gotify') {
    options.priority = Number(options.priority ?? 0);
  }

  if (key === 'ntfy') {
    options.authMethodUsernamePassword = !!str(options.username);
    options.authMethodToken = !options.authMethodUsernamePassword
      ? !!str(options.token)
      : false;
    if (options.priority !== undefined) {
      options.priority = Number(options.priority);
    }
  }

  if (key === 'webhook') {
    // The template arrives as text (or, from older clients, as an object).
    let template: string;
    if (incoming.jsonPayload === undefined) {
      template = decodeWebhookPayload(currentOptions.jsonPayload);
    } else if (typeof incoming.jsonPayload === 'string') {
      template = incoming.jsonPayload;
    } else {
      template = JSON.stringify(incoming.jsonPayload, null, 2);
    }
    try {
      const parsed = JSON.parse(template);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
    } catch {
      throw {
        status: 400,
        message:
          "The JSON payload isn't valid JSON. It has to be one object, with keys and text in double quotes.",
      };
    }
    options.jsonPayload = encodeWebhookPayload(template);
    options.customHeaders = options.customHeaders ?? [];
    options.supportVariables = options.supportVariables ?? false;
  }

  const enabled = body?.enabled ?? current.enabled;
  if (enabled) {
    const problem = spec.validate(options);
    if (problem) {
      throw { status: 400, message: problem };
    }
  }

  let types = current.types ?? 0;
  if (Array.isArray(body?.types)) {
    types = typesToMask(body.types as string[]);
  } else if (typeof body?.types === 'number') {
    types = body.types;
  }

  return {
    enabled: !!enabled,
    embedPoster: body?.embedPoster ?? current.embedPoster ?? true,
    types,
    options,
  };
};

const sendTestNotification = async (agent: NotificationAgent, user: User) =>
  agent.send(Notification.TEST_NOTIFICATION, {
    notifySystem: true,
    notifyAdmin: false,
    notifyUser: user,
    event: 'Test notification',
    subject: 'Test notification',
    message: `This is a test from ${getSettings().main.applicationTitle}. If you can read it, notifications work.`,
  });

notificationRoutes.get('/', (_req, res) => {
  const overview: NotificationAgentsOverview = {
    agents: AGENT_ORDER.map((key) => ({
      key,
      name: AGENTS[key].name,
      enabled: !!stored(key).enabled,
    })),
  };
  return res.status(200).json(overview);
});

notificationRoutes.get<{ agent: string }>('/:agent', (req, res, next) => {
  const key = req.params.agent;
  if (!isAgentKey(key)) {
    return next({ status: 404, message: 'Notification agent not found.' });
  }
  return res.status(200).json(toResponse(key, stored(key)));
});

notificationRoutes.post<{ agent: string }>(
  '/:agent',
  async (req, res, next) => {
    const key = req.params.agent;
    if (!isAgentKey(key)) {
      return next({ status: 404, message: 'Notification agent not found.' });
    }

    try {
      const settings = getSettings();
      const config = fromBody(key, req.body, stored(key));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (settings.notifications.agents as any)[key] = config;
      await settings.save();
      return res.status(200).json(toResponse(key, config));
    } catch (e) {
      return next({ status: e.status ?? 500, message: e.message });
    }
  }
);

notificationRoutes.post<{ agent: string }>(
  '/:agent/test',
  async (req, res, next) => {
    const key = req.params.agent;
    if (!isAgentKey(key)) {
      return next({ status: 404, message: 'Notification agent not found.' });
    }
    if (!req.user) {
      return next({
        status: 500,
        message: 'User information is missing from the request.',
      });
    }

    let config: NotificationAgentConfig;
    try {
      // Unsaved values are tested; the switch itself doesn't have to be on.
      config = fromBody(key, { ...req.body, enabled: true }, stored(key));
    } catch (e) {
      return next({ status: e.status ?? 500, message: e.message });
    }

    const sent = await sendTestNotification(AGENTS[key].create(config), req.user);
    if (sent) {
      return res.status(204).send();
    }
    return next({
      status: 400,
      message: `${AGENTS[key].name} didn't accept the test notification. Check the settings above and the logs for the reason.`,
    });
  }
);

export default notificationRoutes;
