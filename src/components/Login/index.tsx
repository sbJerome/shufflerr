// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import PageTitle from '@app/components/Common/PageTitle';
import AuthShell from '@app/components/Login/AuthShell';
import JellyfinLogin from '@app/components/Login/JellyfinLogin';
import LocalLogin from '@app/components/Login/LocalLogin';
import PlexLoginButton from '@app/components/Login/PlexLoginButton';
import useSettings from '@app/hooks/useSettings';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { loginMethods } from '@app/utils/publicSettings';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Login.Page', {
  signin: 'Sign in',
  ledeplex:
    'Use the Plex account you listen with. Your requests and limits follow you.',
  ledejellyfin:
    'Use the {mediaServerName} account you listen with. Your requests and limits follow you.',
  ledelocal: 'Use your Shufflerr account. Your requests and limits follow you.',
  signinwithjellyfin: 'Sign in with {mediaServerName}',
  orlocal: 'or use a Shufflerr account',
  newhere: 'New here?',
  newplex:
    'If the server owner has shared their Plex library with you, sign in with Plex. Your Shufflerr account is created the first time, with the owner’s default permissions.',
  newjellyfin:
    'If you have a {mediaServerName} account on this server, sign in with it. Your Shufflerr account is created the first time, with the owner’s default permissions.',
  newclosed:
    'Accounts are created by the server owner. Ask them to add or import you, then sign in here.',
  plexerror:
    'Plex sign-in didn’t finish. Try again, and allow the pop-up window if your browser blocked it.',
  plexnoaccount:
    'Your Plex account doesn’t have a Shufflerr account yet. Ask the server owner to import you.',
  nomethods:
    'No sign-in method is turned on. The server owner can fix this in settings.json (main.localLogin).',
});

const Login = () => {
  const intl = useIntl();
  const router = useRouter();
  const { currentSettings } = useSettings();
  const { user, revalidate } = useUser();
  const methods = loginMethods(currentSettings);

  const [error, setError] = useState('');
  const [isProcessing, setProcessing] = useState(false);
  const [authToken, setAuthToken] = useState<string | undefined>(undefined);
  const [showJellyfin, setShowJellyfin] = useState(false);

  // The Plex PIN flow hands back a token; trade it for a Shufflerr session.
  useEffect(() => {
    const login = async () => {
      setProcessing(true);
      setError('');
      try {
        const response = await axios.post('/api/v1/auth/plex', { authToken });
        if (response.data?.id) {
          revalidate();
        }
      } catch (e) {
        const status = axios.isAxiosError(e) ? e.response?.status : undefined;
        const message: unknown = axios.isAxiosError(e)
          ? e.response?.data?.message
          : undefined;
        setError(
          typeof message === 'string' && /\s/.test(message)
            ? message
            : intl.formatMessage(
                status === 403 ? messages.plexnoaccount : messages.plexerror
              )
        );
        setAuthToken(undefined);
        setProcessing(false);
      }
    };
    if (authToken) {
      login();
    }
  }, [authToken, revalidate, intl]);

  // Signed in: go to the app.
  useEffect(() => {
    if (user) {
      router.push('/');
    }
  }, [user, router]);

  const jf = { mediaServerName: methods.jellyfinName };
  const lede = methods.plex
    ? intl.formatMessage(messages.ledeplex)
    : methods.jellyfin
      ? intl.formatMessage(messages.ledejellyfin, jf)
      : intl.formatMessage(messages.ledelocal);

  const jellyfinButton = (
    <button
      type="button"
      className="sh-btn jellyfin"
      onClick={() => {
        setError('');
        setShowJellyfin(true);
      }}
      data-testid="jellyfin-login-button"
    >
      {intl.formatMessage(messages.signinwithjellyfin, jf)}
    </button>
  );

  return (
    <AuthShell>
      <PageTitle title={intl.formatMessage(messages.signin)} />
      <div className="sh-auth-grid">
        <section className="sh-auth-card" aria-labelledby="login-title">
          <h1 id="login-title">{intl.formatMessage(messages.signin)}</h1>
          <p className="lede">{lede}</p>
          {error && (
            <p className="sh-err" role="alert" data-testid="login-error">
              {error}
            </p>
          )}
          {!methods.plex && !methods.jellyfin && !methods.local && (
            <p className="sh-err" role="alert">
              {intl.formatMessage(messages.nomethods)}
            </p>
          )}
          {methods.plex && (
            <PlexLoginButton
              isProcessing={isProcessing}
              onAuthToken={(token) => setAuthToken(token)}
              onError={() => setError(intl.formatMessage(messages.plexerror))}
            />
          )}
          {methods.jellyfin && jellyfinButton}
          {methods.local && (
            <>
              {(methods.plex || methods.jellyfin) && (
                <div className="sh-or">
                  {intl.formatMessage(messages.orlocal)}
                </div>
              )}
              <LocalLogin revalidate={revalidate} onError={setError} />
            </>
          )}
        </section>
        <aside className="sh-auth-side">
          <h2>{intl.formatMessage(messages.newhere)}</h2>
          <p className="lede">
            {methods.plex && methods.newPlex
              ? intl.formatMessage(messages.newplex)
              : methods.jellyfin && methods.newJellyfin
                ? intl.formatMessage(messages.newjellyfin, jf)
                : intl.formatMessage(messages.newclosed)}
          </p>
          {methods.plex && methods.newPlex && (
            <div>
              <PlexLoginButton
                variant="outline"
                isProcessing={isProcessing}
                onAuthToken={(token) => setAuthToken(token)}
                onError={() => setError(intl.formatMessage(messages.plexerror))}
              />
            </div>
          )}
          {!(methods.plex && methods.newPlex) &&
            methods.jellyfin &&
            methods.newJellyfin && (
              <div>
                <button
                  type="button"
                  className="sh-btn outline-accent"
                  onClick={() => setShowJellyfin(true)}
                >
                  {intl.formatMessage(messages.signinwithjellyfin, jf)}
                </button>
              </div>
            )}
        </aside>
      </div>
      {showJellyfin && (
        <JellyfinLogin
          mediaServerName={methods.jellyfinName}
          revalidate={revalidate}
          onClose={() => setShowJellyfin(false)}
        />
      )}
    </AuthShell>
  );
};

export default Login;
