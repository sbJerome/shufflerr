// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import PlexLoginButton from '@app/components/Login/PlexLoginButton';
import JellyfinSetup from '@app/components/Setup/JellyfinSetup';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { MediaServerType } from '@server/constants/server';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Setup.SetupLogin', {
  signin: 'Sign in as the owner',
  signinWithJellyfin:
    'Enter your Jellyfin server address and an admin account. This account becomes the Shufflerr owner.',
  signinWithEmby:
    'Enter your Emby server address and an admin account. This account becomes the Shufflerr owner.',
  signinWithPlex:
    'Sign in with the Plex account that owns your server. This account becomes the Shufflerr owner.',
  plexerror:
    'Plex sign-in didn’t finish. Try again, and allow the pop-up window if your browser blocked it.',
  back: 'Back',
});

interface LoginWithMediaServerProps {
  serverType: MediaServerType;
  onCancel: () => void;
  onComplete: () => void;
}

const SetupLogin: React.FC<LoginWithMediaServerProps> = ({
  serverType,
  onCancel,
  onComplete,
}) => {
  const intl = useIntl();
  const [authToken, setAuthToken] = useState<string | undefined>(undefined);
  const [error, setError] = useState('');
  const { user, revalidate } = useUser();

  // The Plex PIN flow hands back a token; the first account becomes the owner.
  useEffect(() => {
    const login = async () => {
      try {
        const response = await axios.post('/api/v1/auth/plex', { authToken });
        if (response.data?.id) {
          const { data: me } = await axios.get('/api/v1/auth/me');
          revalidate(me, false);
        }
      } catch (e) {
        const message: unknown = axios.isAxiosError(e)
          ? e.response?.data?.message
          : undefined;
        setError(
          typeof message === 'string' && /\s/.test(message)
            ? message
            : intl.formatMessage(messages.plexerror)
        );
        setAuthToken(undefined);
      }
    };
    if (authToken && serverType === MediaServerType.PLEX) {
      login();
    }
  }, [authToken, serverType, revalidate, intl]);

  useEffect(() => {
    if (user) {
      onComplete();
    }
  }, [user, onComplete]);

  return (
    <div className="flex flex-col gap-[18px]">
      <h2 className="text-[22px] font-semibold text-white">
        {intl.formatMessage(messages.signin)}
      </h2>
      <p className="lede">
        {intl.formatMessage(
          serverType === MediaServerType.JELLYFIN
            ? messages.signinWithJellyfin
            : serverType === MediaServerType.EMBY
              ? messages.signinWithEmby
              : messages.signinWithPlex
        )}
      </p>
      {error && (
        <p className="sh-err" role="alert">
          {error}
        </p>
      )}
      {serverType === MediaServerType.PLEX ? (
        <div className="flex flex-wrap gap-3">
          <PlexLoginButton
            isProcessing={!!authToken}
            onAuthToken={(token) => {
              setError('');
              setAuthToken(token);
            }}
            onError={() => setError(intl.formatMessage(messages.plexerror))}
          />
          <button className="sh-btn" type="button" onClick={onCancel}>
            {intl.formatMessage(messages.back)}
          </button>
        </div>
      ) : (
        <JellyfinSetup
          revalidate={revalidate}
          serverType={serverType}
          onCancel={onCancel}
        />
      )}
    </div>
  );
};

export default SetupLogin;
