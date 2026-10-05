// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import JellyfinQuickConnectModal from '@app/components/Login/JellyfinQuickConnectModal';
import { useLockBodyScroll } from '@app/hooks/useLockBodyScroll';
import useSettings from '@app/hooks/useSettings';
import defineMessages from '@app/utils/defineMessages';
import { ApiErrorCode } from '@server/constants/error';
import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Login.JellyfinLogin', {
  title: 'Sign in with {mediaServerName}',
  lede: 'Use your {mediaServerName} username and password.',
  username: 'Username',
  password: 'Password',
  cancel: 'Cancel',
  signin: 'Sign in',
  signingin: 'Signing in…',
  quickconnect: 'Use Quick Connect',
  forgotpassword: 'Forgot password?',
  usernamerequired: 'Enter your {mediaServerName} username.',
  credentialerror:
    '{mediaServerName} didn’t accept that username and password.',
  connectionerror:
    'Shufflerr couldn’t reach the {mediaServerName} server. Ask an admin to check the connection in Settings.',
  noaccount:
    'Your {mediaServerName} account doesn’t have a Shufflerr account yet. Ask an admin to import you.',
  loginerror: 'Signing in didn’t work. Try again in a moment.',
  quickconnecterror: 'Quick Connect didn’t finish. Try again.',
});

interface JellyfinLoginProps {
  /** 'Jellyfin' or 'Emby'. */
  mediaServerName: string;
  revalidate: () => void;
  onClose: () => void;
}

/** Username/password dialog for Jellyfin (and Emby) sign-in. */
const JellyfinLogin = ({
  mediaServerName,
  revalidate,
  onClose,
}: JellyfinLoginProps) => {
  const intl = useIntl();
  const { currentSettings } = useSettings();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [quickConnect, setQuickConnect] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);
  const values = { mediaServerName };
  useLockBodyScroll(true);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const baseUrl = currentSettings.jellyfinExternalHost;
  const forgotUrl =
    currentSettings.jellyfinForgotPasswordUrl ||
    (baseUrl ? `${baseUrl}/web/index.html#!/forgotpassword.html` : undefined);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError(intl.formatMessage(messages.usernamerequired, values));
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await axios.post('/api/v1/auth/jellyfin', {
        username: username.trim(),
        password,
        email: username.trim(),
      });
      revalidate();
      onClose();
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const code: unknown = axios.isAxiosError(err)
        ? err.response?.data?.message
        : undefined;
      let message = messages.loginerror;
      if (
        code === ApiErrorCode.InvalidCredentials ||
        (status === 401 && typeof code !== 'string')
      ) {
        message = messages.credentialerror;
      } else if (
        code === ApiErrorCode.InvalidUrl ||
        code === ApiErrorCode.ConnectionError
      ) {
        message = messages.connectionerror;
      } else if (code === ApiErrorCode.Unauthorized || status === 403) {
        message = messages.noaccount;
      }
      if (
        typeof code === 'string' &&
        /\s/.test(code) &&
        message === messages.loginerror
      ) {
        setError(code);
      } else {
        setError(intl.formatMessage(message, values));
      }
      setSubmitting(false);
    }
  };

  if (quickConnect) {
    return (
      <JellyfinQuickConnectModal
        mediaServerName={mediaServerName}
        onClose={() => setQuickConnect(false)}
        onAuthenticated={() => {
          revalidate();
          onClose();
        }}
        onError={() => {
          setQuickConnect(false);
          setError(intl.formatMessage(messages.quickconnecterror));
        }}
      />
    );
  }

  return ReactDOM.createPortal(
    // Backdrop click closes; Esc and Cancel are the keyboard paths.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="sh-pop sh-force-dark"
      role="dialog"
      aria-modal="true"
      aria-labelledby="jf-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="win">
        <div className="bar">{mediaServerName}</div>
        <div className="in">
          <h2 id="jf-title">{intl.formatMessage(messages.title, values)}</h2>
          <p>{intl.formatMessage(messages.lede, values)}</p>
          <form
            onSubmit={submit}
            noValidate
            className="flex flex-col gap-[14px]"
            data-form-type="login"
          >
            <div className="sh-fl">
              <input
                id="username"
                ref={firstField}
                placeholder=" "
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <label htmlFor="username">
                {intl.formatMessage(messages.username)}
              </label>
            </div>
            <div className="sh-fl">
              <input
                id="jf-password"
                type="password"
                placeholder=" "
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <label htmlFor="jf-password">
                {intl.formatMessage(messages.password)}
              </label>
            </div>
            {error && (
              <p className="sh-err" role="alert">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-[10px]">
              <button
                type="button"
                className="border-0 bg-transparent p-0 text-[13px] text-[#B9A7F0] hover:underline"
                onClick={() => setQuickConnect(true)}
              >
                {intl.formatMessage(messages.quickconnect)}
              </button>
              <div className="flex gap-[10px]">
                <button className="sh-btn" type="button" onClick={onClose}>
                  {intl.formatMessage(messages.cancel)}
                </button>
                <button
                  className="sh-btn jellyfin !min-h-[46px] !text-sm"
                  type="submit"
                  disabled={submitting}
                >
                  {intl.formatMessage(
                    submitting ? messages.signingin : messages.signin
                  )}
                </button>
              </div>
            </div>
            {forgotUrl && (
              <a
                href={forgotUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] !text-[#B9A7F0]"
              >
                {intl.formatMessage(messages.forgotpassword)}
              </a>
            )}
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default JellyfinLogin;
