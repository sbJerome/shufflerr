import CoverArt from '@app/components/CoverArt';
import Link from 'next/link';

export interface ArtistCardProps {
  /** Artist MBID. */
  mbid: string;
  name: string;
  /** Proxied artist photo; falls back to initials. */
  imageSrc?: string | null;
  /** Small line under the name, e.g. "8 releases, 4 in library". */
  meta?: React.ReactNode;
  href?: string;
}

const ArtistCard = ({ mbid, name, imageSrc, meta, href }: ArtistCardProps) => (
  <Link href={href ?? `/artist/${mbid}`} className="sh-artist-card">
    <CoverArt
      src={imageSrc}
      mbid={mbid}
      title={name}
      round
      showInitials
      decorative
      className="w-full"
    />
    <b className="max-w-full truncate">{name}</b>
    {meta && <span className="m">{meta}</span>}
  </Link>
);

export default ArtistCard;
