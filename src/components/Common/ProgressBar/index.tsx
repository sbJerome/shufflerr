import type { StatusTone } from '@app/utils/status';
import { toneColor } from '@app/utils/status';

interface ProgressBarProps {
  /** 0–100. */
  value: number;
  /** Accessible name, e.g. "9 of 13 tracks in library". */
  label: string;
  tone?: StatusTone | 'accent';
  className?: string;
}

const ProgressBar = ({
  value,
  label,
  tone = 'partial',
  className,
}: ProgressBarProps) => {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={`sh-progress ${className ?? ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
    >
      <span
        style={{
          width: `${pct}%`,
          background: tone === 'accent' ? 'var(--accent)' : toneColor(tone),
        }}
      />
    </div>
  );
};

export default ProgressBar;
