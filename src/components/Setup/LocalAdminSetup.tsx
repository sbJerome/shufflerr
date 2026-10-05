import Field from '@app/components/Common/Field';
import defineMessages from '@app/utils/defineMessages';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Setup.LocalAdminSetup', {
  title: 'Create a local admin account',
  lede: 'This account becomes the Shufflerr owner. You sign in with the email address and password you choose here.',
  username: 'Username',
  email: 'Email address',
  password: 'Password',
  confirm: 'Confirm password',
  create: 'Create account',
  creating: 'Creating…',
  back: 'Back',
  usernameRequired: 'Enter a username.',
  emailInvalid: 'Enter a valid email address.',
  passwordShort: 'The password needs at least 8 characters.',
  passwordMismatch: 'The passwords don’t match.',
  failed:
    'The account couldn’t be created. If an owner already exists, sign in instead.',
});

interface LocalAdminSetupProps {
  onCancel: () => void;
  /** Called once the owner exists and is signed in. */
  onCreated: () => void | Promise<void>;
}

/** First-run owner without a media server: POST /api/v1/auth/setup-local. */
const LocalAdminSetup = ({ onCancel, onCreated }: LocalAdminSetupProps) => {
  const intl = useIntl();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!username.trim()) {
      next.username = intl.formatMessage(messages.usernameRequired);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = intl.formatMessage(messages.emailInvalid);
    }
    if (password.length < 8) {
      next.password = intl.formatMessage(messages.passwordShort);
    } else if (password !== confirm) {
      next.confirm = intl.formatMessage(messages.passwordMismatch);
    }
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) {
      return;
    }
    setBusy(true);
    try {
      await axios.post('/api/v1/auth/setup-local', {
        username: username.trim(),
        email: email.trim(),
        password,
      });
      await onCreated();
    } catch (err) {
      const message: unknown = axios.isAxiosError(err)
        ? err.response?.data?.message
        : undefined;
      setFormError(
        typeof message === 'string' && /\s/.test(message)
          ? message
          : intl.formatMessage(messages.failed)
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-[18px]" onSubmit={submit} noValidate>
      <h2 className="text-[22px] font-semibold">
        {intl.formatMessage(messages.title)}
      </h2>
      <p className="lede">{intl.formatMessage(messages.lede)}</p>
      {formError && (
        <p className="sh-err" role="alert">
          {formError}
        </p>
      )}
      <div className="sh-fields">
        <Field
          required
          label={intl.formatMessage(messages.username)}
          error={errors.username}
        >
          {(p) => (
            <input
              {...p}
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          )}
        </Field>
        <Field
          required
          label={intl.formatMessage(messages.email)}
          error={errors.email}
        >
          {(p) => (
            <input
              {...p}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field
          required
          label={intl.formatMessage(messages.password)}
          error={errors.password}
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
        <Field
          required
          label={intl.formatMessage(messages.confirm)}
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
      <div className="flex flex-wrap gap-3">
        <button className="sh-btn primary" type="submit" disabled={busy}>
          {intl.formatMessage(busy ? messages.creating : messages.create)}
        </button>
        <button className="sh-btn" type="button" onClick={onCancel}>
          {intl.formatMessage(messages.back)}
        </button>
      </div>
    </form>
  );
};

export default LocalAdminSetup;
