import CoverArt from '@app/components/CoverArt';
import { coverUrl } from '@app/utils/images';
import type { MediaStatus } from '@server/constants/media';
import Link from 'next/link';

export interface AlbumCardProps {
  /** Release-group MBID. */
  mbid: string;
  title: string;
  artistName?: string;
  /** Year or full first-release date. */
  year?: string;
  status?: MediaStatus | null;
  /** Override the cover (defaults to the Cover Art Archive front image). */
  imageSrc?: string | null;
  /** Override the link (defaults to `/album/<mbid>`). */
  href?: string;
  /** Extra line or button under the text, e.g. a Request button. */
  action?: React.ReactNode;
  /** Replaces the default "artist, year" line. */
  meta?: React.ReactNode;
  /** Revealed over the cover on hover/focus (e.g. a Request button). */
  overlay?: React.ReactNode;
}

const AlbumCard = ({
  mbid,
  title,
  artistName,
  year,
  status,
  imageSrc,
  href,
  action,
  meta,
  overlay,
}: AlbumCardProps) => {
  const link = href ?? `/album/${mbid}`;
  const sub = [artistName, year?.slice(0, 4)].filter(Boolean).join(', ');

  return (
    <div className="sh-card">
      <Link
        href={link}
        aria-label={artistName ? `${title} by ${artistName}` : title}
      >
        <CoverArt
          src={imageSrc === undefined ? coverUrl(mbid) : imageSrc}
          mbid={mbid}
          title={title}
          status={status}
          decorative
        />
      </Link>
      {overlay ? <div className="sh-card-ov">{overlay}</div> : null}
      <div className="min-w-0">
        <Link href={link} className="t block" title={title}>
          {title}
        </Link>
        <div className="m truncate">{meta ?? sub}</div>
      </div>
      {action}
    </div>
  );
};

export default AlbumCard;
