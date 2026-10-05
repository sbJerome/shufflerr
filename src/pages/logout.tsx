import PageTitle from '@app/components/Common/PageTitle';
import AuthShell from '@app/components/Login/AuthShell';
import useSettings from '@app/hooks/useSettings';
import defineMessages from '@app/utils/defineMessages';
import { loginMethods } from '@app/utils/publicSettings';
import type { NextPage } from 'next';
import Link from 'next/link';
import { useIntl } from 'react-intl';

const messages = defineMessages('pages.logout', {
  title: 'You’ve signed out',
  lede: 'Your requests keep going while you’re away. You’ll get a notification when your music arrives.',
  onlyshufflerr:
    'This signed you out of Shufflerr only. You’re still signed in to {mediaServerName}.',
  again: 'Sign in again',
});

const LogoutPage: NextPage = () => {
  const intl = useIntl();
  const { currentSettings } = useSettings();
  const methods = loginMethods(currentSettings);
  const serverName = methods.plex
    ? 'Plex'
    : methods.jellyfin
      ? methods.jellyfinName
      : undefined;

  return (
    <AuthShell>
      <PageTitle title={intl.formatMessage(messages.title)} />
      <section
        className="sh-auth-card sh-signed-out"
        aria-labelledby="logout-title"
      >
        <div className="tick" aria-hidden="true">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 id="logout-title">{intl.formatMessage(messages.title)}</h1>
        <p className="lede">{intl.formatMessage(messages.lede)}</p>
        {serverName && (
          <p className="hint m-0">
            {intl.formatMessage(messages.onlyshufflerr, {
              mediaServerName: serverName,
            })}
          </p>
        )}
        <Link className="sh-btn outline-accent" href="/login">
          {intl.formatMessage(messages.again)}
        </Link>
      </section>
    </AuthShell>
  );
};

export default LogoutPage;
