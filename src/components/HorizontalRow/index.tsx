import Link from 'next/link';

export interface HorizontalRowProps {
  title: string;
  /** One-line caption under the title. */
  sub?: React.ReactNode;
  /** "See all" style link on the right. */
  linkHref?: string;
  linkText?: React.ReactNode;
  /** Cards (AlbumCard, ArtistCard, …). Renders nothing when empty unless `empty` is set. */
  children?: React.ReactNode;
  /** Shown instead of the row when there are no children. */
  empty?: React.ReactNode;
  /** Use a wrapping grid instead of a scrolling row. */
  grid?: boolean;
  className?: string;
}

/** Section with a heading and a scroll-snap row of cards. */
const HorizontalRow = ({
  title,
  sub,
  linkHref,
  linkText,
  children,
  empty,
  grid = false,
  className,
}: HorizontalRowProps) => {
  const items = Array.isArray(children)
    ? children.filter(Boolean)
    : children
      ? [children]
      : [];

  if (!items.length && !empty) {
    return null;
  }

  return (
    <section className={className}>
      <div className="sh-sec-head">
        <div>
          <h2 className="sh-h-section">{title}</h2>
          {sub && <p className="sh-sub">{sub}</p>}
        </div>
        {linkHref && <Link href={linkHref}>{linkText}</Link>}
      </div>
      {items.length ? (
        <div className={grid ? 'sh-grid' : 'sh-row'}>{children}</div>
      ) : (
        empty
      )}
    </section>
  );
};

export default HorizontalRow;
