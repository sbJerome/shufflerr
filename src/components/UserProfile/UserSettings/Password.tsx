// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: src/components/UserProfile/UserSettings/UserPasswordChange/index.tsx at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import Button from '@app/components/Common/Button';
import Field from '@app/components/Common/Field';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Panel from '@app/components/Common/Panel';
import {
  apiErrorMessage,
  useProfileUser,
} from '@app/components/UserProfile/shared';
import useToasts from '@app/hooks/useToasts';
import { UserType } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type { UserSettingsPasswordResponse } from '@server/interfaces/api/userSettingsInterfaces';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages(
  'components.UserProfile.UserSettings.Password',
  {
    password: 'Password',
    hasPasswordLocal: 'Used to sign in with an email address.',
    hasPasswordServer:
      'Used to sign in with an email address instead of {server}.',
    noPasswordSelf:
      'This account doesn’t have a password yet. Set one so you can also sign in with an email address.',
    noPasswordOther:
      'This account doesn’t have a password yet. Set one so {name} can also sign in with an email address.',
    currentPassword: 'Current password',
    newPassword: 'New password',
    newPasswordHint: 'At least 8 characters',
    confirmPassword: 'Confirm new password',
    save: 'Save password',
    saving: 'Saving…',
    saved: 'Password saved.',
    errorCurrent: 'Enter your current password.',
    errorLength: 'The new password needs at least 8 characters.',
    errorMatch: 'The passwords don’t match.',
    errorUnknown: 'The password wasn’t saved. Try again.',
    loadError: 'This page didn’t load. Reload to try again.',
  }
);

interface Errors {
  current?: string;
  next?: string;
  confirm?: string;
}

const Password = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, isSelf } = useProfileUser();
  const { data, error, mutate } = useSWR<UserSettingsPasswordResponse>(
    user ? `/api/v1/user/${user.id}/settings/password` : null
  );
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  if (!user) {
    return null;
  }
  if (error && !data) {
    return (
      <Panel title={intl.formatMessage(messages.password)}>
        <p role="alert" className="m-0 text-st-declined">
          {intl.formatMessage(messages.loadError)}
        </p>
      </Panel>
    );
  }
  if (!data) {
    return <LoadingSpinner />;
  }

  // Own account with a password: ask for the current one. Admin editing someone else: new + confirm only.
  const needCurrent = isSelf && data.hasPassword;
  const serverName =
    user.userType === UserType.PLEX
      ? 'Plex'
      : user.userType === UserType.JELLYFIN
        ? 'Jellyfin'
        : user.userType === UserType.EMBY
          ? 'Emby'
          : null;
  const sub = data.hasPassword
    ? serverName
      ? intl.formatMessage(messages.hasPasswordServer, { server: serverName })
      : intl.formatMessage(messages.hasPasswordLocal)
    : isSelf
      ? intl.formatMessage(messages.noPasswordSelf)
      : intl.formatMessage(messages.noPasswordOther, {
          name: user.displayName,
        });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found: Errors = {};
    if (needCurrent && !current) {
      found.current = intl.formatMessage(messages.errorCurrent);
    }
    if (next.length < 8) {
      found.next = intl.formatMessage(messages.errorLength);
    }
    if (next !== confirm) {
      found.confirm = intl.formatMessage(messages.errorMatch);
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    setSaving(true);
    try {
      await axios.post(`/api/v1/user/${user.id}/settings/password`, {
        currentPassword: needCurrent ? current : undefined,
        newPassword: next,
        confirmPassword: confirm,
      });
      addToast(intl.formatMessage(messages.saved), { appearance: 'success' });
      setCurrent('');
      setNext('');
      setConfirm('');
      mutate();
    } catch (err) {
      const message = apiErrorMessage(
        err,
        intl.formatMessage(messages.errorUnknown)
      );
      if (/current/i.test(message)) {
        setErrors({ current: message });
      } else if (/match/i.test(message)) {
        setErrors({ confirm: message });
      } else {
        setErrors({ next: message });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      as="form"
      onSubmit={submit}
      title={intl.formatMessage(messages.password)}
      sub={sub}
      actions={
        <Button buttonType="primary" type="submit" disabled={saving}>
          {intl.formatMessage(saving ? messages.saving : messages.save)}
        </Button>
      }
    >
      <div className="sh-fields">
        {needCurrent && (
          <Field
            label={intl.formatMessage(messages.currentPassword)}
            error={errors.current}
          >
            {(p) => (
              <input
                {...p}
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            )}
          </Field>
        )}
        <Field
          label={intl.formatMessage(messages.newPassword)}
          hint={intl.formatMessage(messages.newPasswordHint)}
          error={errors.next}
        >
          {(p) => (
            <input
              {...p}
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={intl.formatMessage(messages.confirmPassword)}
          error={errors.confirm}
        >
          {(p) => (
            <input
              {...p}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Panel>
  );
};

export default Password;
