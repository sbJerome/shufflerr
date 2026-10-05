import type { CSSProperties } from 'react';

interface QuotaRingProps {
  /** Requests used in the current period. */
  used: number;
  /** Limit for the period; 0 or undefined = unlimited. */
  limit?: number;
  /** Accessible description, e.g. "3 of 10 albums used". */
  label: string;
}

/** Conic ring for the profile "Albums left / Tracks left" cards. */
export const QuotaRing = ({ used, limit, label }: QuotaRingProps) => {
  const unlimited = !limit;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div
      className="sh-ring"
      style={{ '--p': pct } as CSSProperties}
      role="img"
      aria-label={label}
    >
      <span>{unlimited ? '∞' : `${pct}%`}</span>
    </div>
  );
};

interface LimitMeterProps {
  used: number;
  limit?: number;
  /** Text above the bar, e.g. "3 of 10 albums used this week". */
  children: React.ReactNode;
}

/** Dashed box with a thin usage bar (request modal, requests page). */
export const LimitMeter = ({ used, limit, children }: LimitMeterProps) => {
  const pct = !limit ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="sh-quota">
      <span>{children}</span>
      {!!limit && (
        <div className="bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
};

export default QuotaRing;
