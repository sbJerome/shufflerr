// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: src/components/UserProfile/UserSettings/UserNotificationSettings/* at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import Button from '@app/components/Common/Button';
import Field from '@app/components/Common/Field';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Panel from '@app/components/Common/Panel';
import SwitchRow from '@app/components/Common/SwitchRow';
import NotificationTypeSelector from '@app/components/NotificationTypeSelector';
import {
  apiErrorMessage,
  useProfileUser,
} from '@app/components/UserProfile/shared';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { Permission } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  subscribeToPushNotifications,
  unsubscribeToPushNotifications,
} from '@app/utils/pushSubscriptionHelpers';
import type { UserSettingsNotificationsResponse } from '@server/interfaces/api/userSettingsInterfaces';
import type { NotificationTypeKey } from '@server/lib/notifications/types';
import { hasPermission } from '@server/lib/permissions';
import axios from 'axios';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages(
  'components.UserProfile.UserSettings.Notifications',
  {
    channels: 'Notification channels',
    email: 'Email',
    webpush: 'Web push',
    discord: 'Discord',
    telegram: 'Telegram',
    pushbullet: 'Pushbullet',
    pushover: 'Pushover',
    panelTitle: '{channel} notifications',
    panelSub: 'Choose what you hear about on this channel.',
    sendMeEmail: 'Send me email notifications',
    sendMeWebpush: 'Send me web push notifications',
    sendMeDiscord: 'Send me Discord notifications',
    sendMeTelegram: 'Send me Telegram notifications',
    sendMePushbullet: 'Send me Pushbullet notifications',
    sendMePushover: 'Send me Pushover notifications',
    webpushHint:
      'Saving with this on asks this browser for permission and registers this device.',
    pgpKey: 'PGP public key',
    pgpKeyHint: 'Optional. Emails to you are encrypted with this key.',
    discordId: 'Discord user ID',
    discordIdHint: 'So Shufflerr can mention you',
    telegramChatId: 'Telegram chat ID',
    telegramSilent: 'Send silently',
    telegramThread: 'Topic (thread) ID',
    telegramThreadHint: 'Only for group chats that use topics.',
    pushoverSound: 'Sound',
    pushoverSoundHint:
      'A Pushover sound name, for example pushover or magic. Leave empty for your device default.',
    pushbulletToken: 'Access token',
    pushoverApp: 'Application token',
    pushoverUser: 'User key',
    save: 'Save changes',
    saving: 'Saving…',
    saved: 'Notification settings saved.',
    error: 'The notification settings weren’t saved. Try again.',
    errorDiscordId: 'A Discord user ID is 17 to 19 digits.',
    none: 'No notification channels are set up yet',
    noneHint:
      'An admin can turn on email, web push, Discord and others in Settings → Notifications.',
    loadError: 'This page didn’t load. Reload to try again.',
  }
);

type Channel = keyof UserSettingsNotificationsResponse['channels'];

const CHANNELS: Channel[] = [
  'email',
  'webpush',
  'discord',
  'telegram',
  'pushbullet',
  'pushover',
];

interface FormState {
  enabled: boolean;
  types: NotificationTypeKey[];
  pgpKey: string;
  discordId: string;
  telegramChatId: string;
  telegramSendSilently: boolean;
  telegramMessageThreadId: string;
  pushoverSound: string;
  pushbulletAccessToken: string;
  pushoverApplicationToken: string;
  pushoverUserKey: string;
}

const emptyForm: FormState = {
  enabled: false,
  types: [],
  pgpKey: '',
  discordId: '',
  telegramChatId: '',
  telegramSendSilently: false,
  telegramMessageThreadId: '',
  pushoverSound: '',
  pushbulletAccessToken: '',
  pushoverApplicationToken: '',
  pushoverUserKey: '',
};

const Notifications = ({ channel }: { channel?: string }) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { currentSettings } = useSettings();
  const { user, isSelf, base } = useProfileUser();
  const { data, error, mutate } = useSWR<UserSettingsNotificationsResponse>(
    user ? `/api/v1/user/${user.id}/settings/notifications` : null,
    { revalidateOnFocus: false }
  );
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldError, setFieldError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const offered = CHANNELS.filter((c) => data?.channels?.[c]?.available);
  const active: Channel | undefined = offered.includes(channel as Channel)
    ? (channel as Channel)
    : offered[0];

  useEffect(() => {
    if (!data || !active) {
      return;
    }
    const c = data.channels;
    setFieldError(undefined);
    setForm({
      enabled: !!c[active].enabled,
      types: c[active].types ?? [],
      pgpKey: c.email?.pgpKey ?? '',
      discordId: c.discord?.discordIds?.[0] ?? '',
      telegramChatId: c.telegram?.telegramChatId ?? '',
      telegramSendSilently: !!c.telegram?.telegramSendSilently,
      telegramMessageThreadId: c.telegram?.telegramMessageThreadId ?? '',
      pushoverSound: c.pushover?.pushoverSound ?? '',
      pushbulletAccessToken: c.pushbullet?.pushbulletAccessToken ?? '',
      pushoverApplicationToken: c.pushover?.pushoverApplicationToken ?? '',
      pushoverUserKey: c.pushover?.pushoverUserKey ?? '',
    });
  }, [data, active]);

  if (!user) {
    return null;
  }
  if (error && !data) {
    return (
      <Panel>
        <p role="alert" className="m-0 text-st-declined">
          {intl.formatMessage(messages.loadError)}
        </p>
      </Panel>
    );
  }
  if (!data) {
    return <LoadingSpinner />;
  }
  if (!active) {
    return (
      <Panel title={intl.formatMessage(messages.none)}>
        <p className="sh-sub m-0">{intl.formatMessage(messages.noneHint)}</p>
      </Panel>
    );
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const isManager = hasPermission(Permission.MANAGE_REQUESTS, user.permissions);

  const channelFields = (): Record<string, unknown> => {
    switch (active) {
      case 'email':
        return { pgpKey: form.pgpKey.trim() };
      case 'discord':
        return {
          discordIds: form.discordId.trim() ? [form.discordId.trim()] : [],
        };
      case 'telegram':
        return {
          telegramChatId: form.telegramChatId.trim(),
          telegramSendSilently: form.telegramSendSilently,
          telegramMessageThreadId: form.telegramMessageThreadId.trim(),
        };
      case 'pushbullet':
        return { pushbulletAccessToken: form.pushbulletAccessToken.trim() };
      case 'pushover':
        return {
          pushoverApplicationToken: form.pushoverApplicationToken.trim(),
          pushoverUserKey: form.pushoverUserKey.trim(),
          pushoverSound: form.pushoverSound.trim(),
        };
      default:
        return {};
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      active === 'discord' &&
      form.discordId.trim() &&
      !/^\d{17,19}$/.test(form.discordId.trim())
    ) {
      setFieldError(intl.formatMessage(messages.errorDiscordId));
      return;
    }
    setFieldError(undefined);
    setSaving(true);
    try {
      const { data: saved } =
        await axios.post<UserSettingsNotificationsResponse>(
          `/api/v1/user/${user.id}/settings/notifications`,
          {
            channels: {
              [active]: {
                enabled: form.enabled,
                types: form.types,
                ...channelFields(),
              },
            },
          }
        );
      mutate(saved?.channels ? saved : undefined, !saved?.channels);
      // Web push lives in the browser: register or drop this device with the switch.
      if (active === 'webpush' && isSelf) {
        try {
          if (form.enabled) {
            await subscribeToPushNotifications(user.id, currentSettings);
          } else {
            await unsubscribeToPushNotifications(user.id);
          }
        } catch {
          // The saved preference stands; the browser can be registered later.
        }
      }
      addToast(intl.formatMessage(messages.saved), { appearance: 'success' });
    } catch (err) {
      addToast(apiErrorMessage(err, intl.formatMessage(messages.error)), {
        appearance: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const sendMe = {
    email: messages.sendMeEmail,
    webpush: messages.sendMeWebpush,
    discord: messages.sendMeDiscord,
    telegram: messages.sendMeTelegram,
    pushbullet: messages.sendMePushbullet,
    pushover: messages.sendMePushover,
  }[active];

  return (
    <>
      <nav
        className="sh-subnav-pills"
        aria-label={intl.formatMessage(messages.channels)}
      >
        {offered.map((c) => (
          <Link
            key={c}
            href={`${base}/settings/notifications/${c}`}
            aria-current={c === active ? 'page' : undefined}
          >
            {intl.formatMessage(messages[c])}
          </Link>
        ))}
      </nav>
      <Panel
        as="form"
        onSubmit={submit}
        title={intl.formatMessage(messages.panelTitle, {
          channel: intl.formatMessage(messages[active]),
        })}
        sub={intl.formatMessage(messages.panelSub)}
        actions={
          <Button buttonType="primary" type="submit" disabled={saving}>
            {intl.formatMessage(saving ? messages.saving : messages.save)}
          </Button>
        }
      >
        <div className="sh-box">
          <SwitchRow
            label={intl.formatMessage(sendMe)}
            description={
              active === 'webpush' && isSelf
                ? intl.formatMessage(messages.webpushHint)
                : undefined
            }
            checked={form.enabled}
            onChange={(v) => set('enabled', v)}
          />
        </div>

        {active === 'email' && (
          <div className="sh-fields">
            <Field
              full
              label={intl.formatMessage(messages.pgpKey)}
              hint={intl.formatMessage(messages.pgpKeyHint)}
            >
              {(p) => (
                <textarea
                  {...p}
                  rows={5}
                  className="font-mono text-xs"
                  value={form.pgpKey}
                  onChange={(e) => set('pgpKey', e.target.value)}
                />
              )}
            </Field>
          </div>
        )}
        {active === 'discord' && (
          <div className="sh-fields">
            <Field
              label={intl.formatMessage(messages.discordId)}
              hint={intl.formatMessage(messages.discordIdHint)}
              error={fieldError}
            >
              {(p) => (
                <input
                  {...p}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.discordId}
                  onChange={(e) => set('discordId', e.target.value)}
                />
              )}
            </Field>
          </div>
        )}
        {active === 'telegram' && (
          <>
            <div className="sh-fields">
              <Field label={intl.formatMessage(messages.telegramChatId)}>
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    autoComplete="off"
                    value={form.telegramChatId}
                    onChange={(e) => set('telegramChatId', e.target.value)}
                  />
                )}
              </Field>
              <Field
                label={intl.formatMessage(messages.telegramThread)}
                hint={intl.formatMessage(messages.telegramThreadHint)}
              >
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={form.telegramMessageThreadId}
                    onChange={(e) =>
                      set('telegramMessageThreadId', e.target.value)
                    }
                  />
                )}
              </Field>
            </div>
            <label className="sh-check">
              <input
                type="checkbox"
                checked={form.telegramSendSilently}
                onChange={(e) => set('telegramSendSilently', e.target.checked)}
              />{' '}
              {intl.formatMessage(messages.telegramSilent)}
            </label>
          </>
        )}
        {active === 'pushbullet' && (
          <div className="sh-fields">
            <Field label={intl.formatMessage(messages.pushbulletToken)}>
              {(p) => (
                <input
                  {...p}
                  type="password"
                  autoComplete="off"
                  value={form.pushbulletAccessToken}
                  onChange={(e) => set('pushbulletAccessToken', e.target.value)}
                />
              )}
            </Field>
          </div>
        )}
        {active === 'pushover' && (
          <div className="sh-fields">
            <Field label={intl.formatMessage(messages.pushoverApp)}>
              {(p) => (
                <input
                  {...p}
                  type="password"
                  autoComplete="off"
                  value={form.pushoverApplicationToken}
                  onChange={(e) =>
                    set('pushoverApplicationToken', e.target.value)
                  }
                />
              )}
            </Field>
            <Field label={intl.formatMessage(messages.pushoverUser)}>
              {(p) => (
                <input
                  {...p}
                  type="password"
                  autoComplete="off"
                  value={form.pushoverUserKey}
                  onChange={(e) => set('pushoverUserKey', e.target.value)}
                />
              )}
            </Field>
            <Field
              label={intl.formatMessage(messages.pushoverSound)}
              hint={intl.formatMessage(messages.pushoverSoundHint)}
            >
              {(p) => (
                <input
                  {...p}
                  type="text"
                  autoComplete="off"
                  value={form.pushoverSound}
                  onChange={(e) => set('pushoverSound', e.target.value)}
                />
              )}
            </Field>
          </div>
        )}

        <NotificationTypeSelector
          currentTypes={form.types}
          onUpdate={(types) => set('types', types)}
          managerOnly={isManager}
          availableTypes={data.availableTypes}
        />
      </Panel>
    </>
  );
};

export default Notifications;
