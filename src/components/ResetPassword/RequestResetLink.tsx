// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import PageTitle from '@app/components/Common/PageTitle';
import AuthShell from '@app/components/Login/AuthShell';
import defineMessages from '@app/utils/defineMessages';
import axios from 'axios';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import validator from 'validator';

const messages = defineMessages('components.ResetPassword.RequestResetLink', {
  passwordreset: 'Reset password',
  resetpassword: 'Reset your password',
  requestlede:
    'Enter the email address of your Shufflerr account and we’ll send you a link to choose a new password.',
  email: 'Email',
  validationemailrequired: 'Enter a valid email address.',
  emailresetlink: 'Email me a reset link',
  sending: 'Sending…',
  gobacklogin: 'Back to sign in',
  requestresetlinksuccessmessage:
    'If email notifications are set up, a reset link is sent to your address.',
});

const RequestResetLink = () => {
  const intl = useIntl();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hasSubmitted, setSubmitted] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validator.isEmail(email.trim())) {
      setError(intl.formatMessage(messages.validationemailrequired));
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await axios.post('/api/v1/auth/reset-password', { email: email.trim() });
    } catch {
      // The answer is the same whether or not the address has an account.
    } finally {
      setSubmitting(false);
      setSubmitted(true);
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
              {intl.formatMessage(messages.requestresetlinksuccessmessage)}
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
            <p className="lede">{intl.formatMessage(messages.requestlede)}</p>
            {error && (
              <p className="sh-err" role="alert">
                {error}
              </p>
            )}
            <div className="sh-fl">
              <input
                id="email"
                type="email"
                placeholder=" "
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <label htmlFor="email">
                {intl.formatMessage(messages.email)}
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                className="sh-btn outline-accent"
                type="submit"
                disabled={submitting}
              >
                {intl.formatMessage(
                  submitting ? messages.sending : messages.emailresetlink
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

export default RequestResetLink;
