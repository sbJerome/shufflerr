// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { XMarkIcon } from '@heroicons/react/24/solid';

export interface ToastProps {
  appearance?: 'success' | 'error' | 'info' | 'warning';
  children: React.ReactNode;
  onDismiss: () => void;
  transitionState: 'entering' | 'entered' | 'exiting' | 'exited';
}

/** Bottom-center toast above the player. The Toaster container is aria-live. */
const Toast = ({
  appearance,
  children,
  onDismiss,
  transitionState,
}: ToastProps) => {
  return (
    <div
      className={`sh-toast-item ${appearance === 'error' ? 'bad' : ''} ${
        transitionState === 'entered' ? 'enter' : 'leave'
      }`}
      role={appearance === 'error' ? 'alert' : 'status'}
    >
      <span>{children}</span>
      <button type="button" onClick={() => onDismiss()} aria-label="Dismiss">
        <XMarkIcon className="h-4 w-4" />
      </button>
    </div>
  );
};

export default Toast;
