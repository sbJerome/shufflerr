// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: src/components/UserList/index.tsx at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import Field from '@app/components/Common/Field';
import Modal from '@app/components/Common/Modal';
import { apiErrorMessage } from '@app/components/UserProfile/shared';
import useSettings from '@app/hooks/useSettings';
import type { User } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import validator from 'validator';

const messages = defineMessages('components.UserList.CreateUserModal', {
  title: 'Create local user',
  username: 'Username',
  email: 'Email address',
  autogenerate: 'Email them a generated password',
  autogenerateUnavailable:
    'Turn on the email agent in Settings → Notifications to email generated passwords.',
  password: 'Password',
  passwordHint: 'At least 8 characters',
  note: 'New users get the default permissions from Settings → Users.',
  create: 'Create user',
  creating: 'Creating…',
  cancel: 'Cancel',
  errorUsername: 'Enter a username.',
  errorEmail: 'Enter a valid email address.',
  errorEmailUsed: 'That email address is already used.',
  errorPassword: 'The password needs at least 8 characters.',
  errorUnknown: 'The user wasn’t created. Check the server logs and try again.',
});

interface CreateUserModalProps {
  onClose: () => void;
  onCreated: (user: User, emailed: boolean) => void;
}

interface Errors {
  username?: string;
  email?: string;
  password?: string;
  form?: string;
}

const CreateUserModal = ({ onClose, onCreated }: CreateUserModalProps) => {
  const intl = useIntl();
  const { currentSettings } = useSettings();
  const emailOn = !!currentSettings.emailEnabled;
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [autogenerate, setAutogenerate] = useState(emailOn);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const next: Errors = {};
    if (!username.trim()) {
      next.username = intl.formatMessage(messages.errorUsername);
    }
    if (!validator.isEmail(email.trim())) {
      next.email = intl.formatMessage(messages.errorEmail);
    }
    if (!autogenerate && password.length < 8) {
      next.password = intl.formatMessage(messages.errorPassword);
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      return;
    }

    setSaving(true);
    try {
      const { data } = await axios.post<User>('/api/v1/user', {
        username: username.trim(),
        email: email.trim(),
        password: autogenerate ? undefined : password,
      });
      onCreated(data, autogenerate);
    } catch (e) {
      const message = apiErrorMessage(
        e,
        intl.formatMessage(messages.errorUnknown)
      );
      // Route the server's sentence to the field it is about.
      if (/email/i.test(message)) {
        setErrors({ email: message });
      } else if (/username/i.test(message)) {
        setErrors({ username: message });
      } else if (/password/i.test(message)) {
        setErrors({ password: message });
      } else {
        setErrors({ form: message });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={intl.formatMessage(messages.title)}
      onCancel={onClose}
      cancelText={intl.formatMessage(messages.cancel)}
      onOk={submit}
      okText={intl.formatMessage(saving ? messages.creating : messages.create)}
      okButtonType="primary"
      okDisabled={saving}
    >
      <div className="sh-fields">
        <Field
          label={intl.formatMessage(messages.username)}
          error={errors.username}
          required
        >
          {(p) => (
            <input
              {...p}
              type="text"
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={intl.formatMessage(messages.email)}
          error={errors.email}
          required
        >
          {(p) => (
            <input
              {...p}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
      </div>
      <div>
        <label className="sh-check">
          <input
            type="checkbox"
            checked={autogenerate}
            disabled={!emailOn}
            onChange={(e) => setAutogenerate(e.target.checked)}
          />{' '}
          {intl.formatMessage(messages.autogenerate)}
        </label>
        {!emailOn && (
          <p className="sh-sub mt-1">
            {intl.formatMessage(messages.autogenerateUnavailable)}
          </p>
        )}
      </div>
      {!autogenerate && (
        <div className="sh-fields">
          <Field
            label={intl.formatMessage(messages.password)}
            hint={intl.formatMessage(messages.passwordHint)}
            error={errors.password}
            required
          >
            {(p) => (
              <input
                {...p}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
        </div>
      )}
      <p className="sh-sub m-0">{intl.formatMessage(messages.note)}</p>
      {errors.form && (
        <p role="alert" className="m-0 text-sm text-st-declined">
          {errors.form}
        </p>
      )}
    </Modal>
  );
};

export default CreateUserModal;
