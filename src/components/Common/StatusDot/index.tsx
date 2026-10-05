import type { StatusTone } from '@app/utils/status';
import { toneColor } from '@app/utils/status';
import type { CSSProperties } from 'react';

interface StatusDotProps {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}

/** Dot + label. The label is required: status is never shown by color alone. */
const StatusDot = ({ tone, children, className }: StatusDotProps) => (
  <span
    className={`sh-status ${className ?? ''}`}
    style={{ '--c': toneColor(tone) } as CSSProperties}
  >
    {children}
  </span>
);

export default StatusDot;
