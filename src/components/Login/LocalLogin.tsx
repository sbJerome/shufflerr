// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import axios from 'axios';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Login.LocalLogin', {
  email: 'Email',
  password: 'Password',
  signin: 'Sign in',
  signingin: 'Signing in…',
  forgotpassword: 'Forgot password?',
  emptyerror: 'Enter your email and password.',
  unknownaccount:
    'No Shufflerr account uses that email. Try signing in with Plex or Jellyfin.',
  wrongpassword:
    'That password isn’t right. Try again, or use “Forgot password?”.',
  loginerror:
    'Signing in didn’t work. Check that Shufflerr is reachable and try again.',
  resetunavailable:
    'If email notifications are set up, a reset link is sent to your address.',
});

interface LocalLoginProps {
  revalidate: () => void;
  onError: (message: string) => void;
}

/** Email + password form with underline inputs and floating labels. */
const LocalLogin = ({ revalidate, onError }: LocalLoginProps) => {
  const intl = useIntl();
  const { currentSettings } = useSettings();
  const { addToast } = useToasts();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const passwordResetEnabled =
    !!currentSettings.applicationUrl && currentSettings.emailEnabled;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      onError(intl.formatMessage(messages.emptyerror));
      return;
    }
    setSubmitting(true);
    onError('');
    try {
      await axios.post('/api/v1/auth/local', {
        email: email.trim(),
        password,
      });
      revalidate();
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const serverMessage: unknown = axios.isAxiosError(err)
        ? err.response?.data?.message
        : undefined;
      // The API answers with ready-to-show sentences (docs/AUTH.md); anything
      // else falls back to copy by status.
      if (typeof serverMessage === 'string' && /\s/.test(serverMessage)) {
        onError(serverMessage);
      } else if (status === 403 || status === 401) {
        onError(intl.formatMessage(messages.wrongpassword));
      } else if (status === 404) {
        onError(intl.formatMessage(messages.unknownaccount));
      } else {
        onError(intl.formatMessage(messages.loginerror));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-[18px]"
      data-form-type="login"
    >
      <div className="sh-fl">
        <input
          id="email"
          name="email"
          type="email"
          placeholder=" "
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="email"
        />
        <label htmlFor="email">{intl.formatMessage(messages.email)}</label>
      </div>
      <div className="sh-fl">
        <input
          id="password"
          name="password"
          type="password"
          placeholder=" "
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="password"
        />
        <label htmlFor="password">
          {intl.formatMessage(messages.password)}
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          className="sh-btn outline-accent"
          type="submit"
          disabled={submitting}
          data-testid="local-signin-button"
        >
          {intl.formatMessage(
            submitting ? messages.signingin : messages.signin
          )}
        </button>
        {passwordResetEnabled ? (
          <Link href="/resetpassword">
            {intl.formatMessage(messages.forgotpassword)}
          </Link>
        ) : (
          <button
            type="button"
            className="border-0 bg-transparent p-0 text-[#FF5C7A] hover:underline"
            onClick={() =>
              addToast(intl.formatMessage(messages.resetunavailable), {
                appearance: 'info',
              })
            }
          >
            {intl.formatMessage(messages.forgotpassword)}
          </button>
        )}
      </div>
    </form>
  );
};

export default LocalLogin;
