// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import PageTitle from '@app/components/Common/PageTitle';
import AuthShell from '@app/components/Login/AuthShell';
import defineMessages from '@app/utils/defineMessages';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.ResetPassword', {
  passwordreset: 'Reset password',
  resetpassword: 'Choose a new password',
  lede: 'Pick a password with at least 8 characters.',
  password: 'New password',
  confirmpassword: 'Confirm new password',
  validationpasswordminchars: 'The new password needs at least 8 characters.',
  validationpasswordmatch: 'The passwords don’t match.',
  save: 'Save password',
  saving: 'Saving…',
  failed:
    'This reset link has expired or was already used. Ask for a new one from the sign-in page.',
  gobacklogin: 'Back to sign in',
  resetpasswordsuccessmessage:
    'Password saved. Sign in with your new password.',
});

const ResetPassword = () => {
  const intl = useIntl();
  const router = useRouter();
  const [hasSubmitted, setSubmitted] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const guid = router.query.guid;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError(intl.formatMessage(messages.validationpasswordminchars));
      return;
    }
    if (password !== confirm) {
      setError(intl.formatMessage(messages.validationpasswordmatch));
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await axios.post(`/api/v1/auth/reset-password/${guid}`, { password });
      setSubmitted(true);
    } catch {
      setError(intl.formatMessage(messages.failed));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell footer={false}>
      <PageTitle title={intl.formatMessage(messages.passwordreset)} />
      <section
        className="sh-auth-card sh-signed-out !items-stretch !text-left"
        aria-labelledby="reset-title"
      >
        <h1 id="reset-title">{intl.formatMessage(messages.resetpassword)}</h1>
        {hasSubmitted ? (
          <>
            <p className="lede" role="status">
              {intl.formatMessage(messages.resetpasswordsuccessmessage)}
            </p>
            <Link className="sh-btn self-start outline-accent" href="/login">
              {intl.formatMessage(messages.gobacklogin)}
            </Link>
          </>
        ) : (
          <form
            noValidate
            onSubmit={submit}
            className="flex flex-col gap-[18px]"
          >
            <p className="lede">{intl.formatMessage(messages.lede)}</p>
            {error && (
              <p className="sh-err" role="alert">
                {error}
              </p>
            )}
            <div className="sh-fl">
              <input
                id="password"
                type="password"
                placeholder=" "
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <label htmlFor="password">
                {intl.formatMessage(messages.password)}
              </label>
            </div>
            <div className="sh-fl">
              <input
                id="confirmPassword"
                type="password"
                placeholder=" "
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <label htmlFor="confirmPassword">
                {intl.formatMessage(messages.confirmpassword)}
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                className="sh-btn outline-accent"
                type="submit"
                disabled={submitting}
              >
                {intl.formatMessage(
                  submitting ? messages.saving : messages.save
                )}
              </button>
              <Link href="/login">
                {intl.formatMessage(messages.gobacklogin)}
              </Link>
            </div>
          </form>
        )}
      </section>
    </AuthShell>
  );
};

export default ResetPassword;
