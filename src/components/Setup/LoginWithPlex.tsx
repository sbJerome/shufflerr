// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import SetupLogin from '@app/components/Setup/SetupLogin';
import { MediaServerType } from '@server/constants/server';

interface LoginWithPlexProps {
  onComplete: () => void;
}

/** Kept for Seerr import compatibility; the wizard uses SetupLogin directly. */
const LoginWithPlex = ({ onComplete }: LoginWithPlexProps) => (
  <SetupLogin
    serverType={MediaServerType.PLEX}
    onCancel={() => undefined}
    onComplete={onComplete}
  />
);

export default LoginWithPlex;
