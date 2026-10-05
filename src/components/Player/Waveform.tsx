import { useMemo } from 'react';

export const WAVE_BARS = 96;

/** Resample any peaks array to 96 bars with heights in percent (8–100). */
export const resamplePeaks = (peaks?: number[] | null): number[] | null => {
  if (!peaks || peaks.length < 2) {
    return null;
  }
  const max = Math.max(...peaks) || 1;
  const out: number[] = [];
  for (let i = 0; i < WAVE_BARS; i++) {
    const from = Math.floor((i * peaks.length) / WAVE_BARS);
    const to = Math.max(
      from + 1,
      Math.floor(((i + 1) * peaks.length) / WAVE_BARS)
    );
    let peak = 0;
    for (let j = from; j < to && j < peaks.length; j++) {
      peak = Math.max(peak, peaks[j]);
    }
    out.push(Math.max(8, Math.round((peak / max) * 100)));
  }
  return out;
};

interface WaveformProps {
  peaks?: number[] | null;
  /** 0–1 played fraction. */
  progress: number;
  disabled?: boolean;
  onSeek: (fraction: number) => void;
  /** e.g. "Seek, 1:12 of 3:23". */
  label: string;
  valueText: string;
}

/**
 * 96-bar waveform; the played part is accent. Click or use the arrow keys
 * (5% steps, Home/End) to seek. Without peaks it falls back to a flat bar.
 */
const Waveform = ({
  peaks,
  progress,
  disabled,
  onSeek,
  label,
  valueText,
}: WaveformProps) => {
  const bars = useMemo(() => resamplePeaks(peaks), [peaks]);
  const on = Math.floor(Math.max(0, Math.min(1, progress)) * WAVE_BARS);

  return (
    <div
      className="sh-wave"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      style={disabled ? { cursor: 'default' } : undefined}
      onClick={(e) => {
        if (disabled) return;
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek((e.clientX - rect.left) / rect.width);
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          onSeek(Math.min(1, progress + 0.05));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          onSeek(Math.max(0, progress - 0.05));
        } else if (e.key === 'Home') {
          e.preventDefault();
          onSeek(0);
        } else if (e.key === 'End') {
          e.preventDefault();
          onSeek(0.999);
        }
      }}
    >
      {Array.from({ length: WAVE_BARS }, (_, i) => (
        <i
          key={i}
          className={i < on ? 'on' : undefined}
          style={{ height: bars ? `${bars[i]}%` : '10%' }}
        />
      ))}
    </div>
  );
};

export default Waveform;
