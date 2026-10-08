import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import { ShareIcon } from '@heroicons/react/24/outline';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Common.ShareButton', {
  share: 'Share',
  copied: 'Link copied to clipboard.',
  failed: 'Couldn’t copy the link — copy the page address from your browser.',
});

type ShareButtonProps = {
  /** Title passed to the native share sheet; the link itself is the page URL. */
  title?: string;
  /** Link to share; defaults to the current page URL. */
  url?: string;
  className?: string;
};

/** Copies text to the clipboard, with a legacy fallback for insecure (http) origins. */
const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

/** Share/copy the direct link to the current page (album or artist). */
const ShareButton = ({ title, url, className }: ShareButtonProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const label = intl.formatMessage(messages.share);

  const onShare = async () => {
    const link =
      url ?? (typeof window !== 'undefined' ? window.location.href : '');
    if (!link) {
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: title ?? document.title, url: link });
        return;
      } catch (e) {
        // The user dismissed the share sheet — don't fall back to copying.
        if ((e as Error)?.name === 'AbortError') {
          return;
        }
      }
    }
    if (await copyText(link)) {
      addToast(intl.formatMessage(messages.copied), { appearance: 'success' });
    } else {
      addToast(intl.formatMessage(messages.failed), { appearance: 'error' });
    }
  };

  return (
    <button
      type="button"
      className={className}
      onClick={onShare}
      aria-label={label}
      title={label}
    >
      <ShareIcon aria-hidden="true" />
    </button>
  );
};

export default ShareButton;
