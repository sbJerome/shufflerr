import StatusBadge from '@app/components/StatusBadge';
import { initials, tintFor } from '@app/utils/format';
import { PhotoIcon, UserIcon } from '@heroicons/react/24/outline';
import type { MediaStatus } from '@server/constants/media';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

export interface CoverArtProps {
  /** Same-origin image URL (see `coverUrl` / `proxied` in `@app/utils/images`). */
  src?: string | null;
  /** MBID (or any stable key) — picks the placeholder tint. */
  mbid?: string | number | null;
  /** Used for the alt text and, with `showInitials`, the fallback slot. */
  title?: string;
  /** Round slot for artists. */
  round?: boolean;
  /** 48px thumbnail for lists and the player. */
  thumb?: boolean;
  /** Library status badge in the top-left corner. */
  status?: MediaStatus | null;
  /** Show initials instead of the generic icon when there is no image. */
  showInitials?: boolean;
  /** Decorative covers (next to a visible title) should pass `true`. */
  decorative?: boolean;
  loading?: 'lazy' | 'eager';
  className?: string;
  style?: CSSProperties;
}

/**
 * Square (or round) art slot. Shows the tinted placeholder until the image
 * loads and keeps it when the image is missing or fails.
 */
const CoverArt = ({
  src,
  mbid,
  title,
  round = false,
  thumb = false,
  status,
  showInitials = false,
  decorative = false,
  loading = 'lazy',
  className,
  style,
}: CoverArtProps) => {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [bg, ink] = tintFor(mbid ?? title);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

  const showImage = !!src && !failed;
  const Icon = round ? UserIcon : PhotoIcon;

  return (
    <div
      className={`sh-cover ${round ? 'round' : ''} ${thumb ? 'sh-thumb' : ''} ${
        className ?? ''
      }`}
      style={{ '--tint': bg, '--ink': ink, ...style } as CSSProperties}
    >
      {!(showImage && loaded) &&
        (showInitials && title ? (
          <span className="initials" aria-hidden="true">
            {initials(title)}
          </span>
        ) : (
          <Icon aria-hidden="true" strokeWidth={1.5} />
        ))}
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src as string}
          alt={decorative || !title ? '' : title}
          loading={loading}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          style={{ opacity: loaded ? 1 : 0 }}
        />
      )}
      {status != null && <StatusBadge status={status} variant="badge" />}
    </div>
  );
};

export default CoverArt;
