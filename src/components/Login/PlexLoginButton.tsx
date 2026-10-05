// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import usePlexLogin from '@app/hooks/usePlexLogin';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Login.PlexLoginButton', {
  signinwithplex: 'Sign in with Plex',
  waitingforplex: 'Waiting for Plex…',
});

interface PlexLoginButtonProps {
  onAuthToken: (authToken: string) => void;
  isProcessing?: boolean;
  onError?: (message: string) => void;
  /** `solid` = Plex-orange primary button; `outline` = accent outline (side panel). */
  variant?: 'solid' | 'outline';
  /** Kept for compatibility with Seerr callers. */
  large?: boolean;
  children?: React.ReactNode;
}

const PlexLoginButton = ({
  onAuthToken,
  onError,
  isProcessing,
  variant = 'solid',
  children,
}: PlexLoginButtonProps) => {
  const intl = useIntl();
  const { loading, login } = usePlexLogin({ onAuthToken, onError });
  const busy = loading || !!isProcessing;

  return (
    <button
      type="button"
      className={`sh-btn ${variant === 'solid' ? 'plex' : 'outline-accent'}`}
      onClick={login}
      disabled={busy}
      data-testid="plex-login-button"
    >
      {busy && variant === 'solid' && (
        <span className="spin" aria-hidden="true" />
      )}
      {busy
        ? intl.formatMessage(messages.waitingforplex)
        : (children ?? intl.formatMessage(messages.signinwithplex))}
    </button>
  );
};

export default PlexLoginButton;
