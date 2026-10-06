// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import StatusDot from '@app/components/Common/StatusDot';
import type { StatusTone } from '@app/utils/status';
import {
  mediaStatusInfo,
  requestStatusInfo,
  toneColor,
} from '@app/utils/status';
import type { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { CSSProperties } from 'react';
import { useIntl } from 'react-intl';

interface StatusBadgeProps {
  /** Library status of an album or artist. */
  status?: MediaStatus | null;
  /** Request status; takes precedence over `status` when both are given. */
  requestStatus?: MediaRequestStatus | null;
  /** Lidarr is really pulling it right now (see `isDownloading`). */
  downloading?: boolean;
  /** `dot` = inline dot + label (lists, tables). `badge` = pill for cover art. */
  variant?: 'dot' | 'badge';
  /** Replace the label (e.g. "9 of 13 in library") while keeping the tone. */
  label?: React.ReactNode;
  tone?: StatusTone;
  className?: string;
}

const StatusBadge = ({
  status,
  requestStatus,
  downloading = false,
  variant = 'dot',
  label,
  tone,
  className,
}: StatusBadgeProps) => {
  const intl = useIntl();
  const info =
    requestStatus != null
      ? requestStatusInfo(requestStatus, downloading)
      : mediaStatusInfo(status, downloading);
  const finalTone = tone ?? info.tone;
  const text = label ?? intl.formatMessage(info.message);

  if (variant === 'badge') {
    return (
      <span
        className={`badge ${className ?? ''}`}
        style={{ '--c': toneColor(finalTone) } as CSSProperties}
      >
        {text}
      </span>
    );
  }

  return (
    <StatusDot tone={finalTone} className={className}>
      {text}
    </StatusDot>
  );
};

export default StatusBadge;
