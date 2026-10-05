import defineMessages from '@app/utils/defineMessages';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.Carousel', {
  previous: 'Scroll {title} back',
  next: 'Scroll {title} forward',
});

interface CarouselProps {
  title: string;
  sub?: React.ReactNode;
  linkHref?: string;
  linkText?: React.ReactNode;
  children: React.ReactNode;
  /** Wider columns, e.g. for round artist cards. */
  className?: string;
}

/** A titled row of cards that pages left and right with round arrow buttons. */
const Carousel = ({
  title,
  sub,
  linkHref,
  linkText,
  children,
  className,
}: CarouselProps) => {
  const intl = useIntl();
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) {
      return;
    }
    setEdges({
      start: el.scrollLeft <= 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, children]);

  const page = (direction: 1 | -1) => {
    const el = track.current;
    if (!el) {
      return;
    }
    const reduce = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    el.scrollBy({
      left: direction * el.clientWidth * 0.85,
      behavior: reduce ? 'auto' : 'smooth',
    });
  };

  return (
    <section className={`sh-dx-carousel ${className ?? ''}`}>
      <div className="sh-dx-head">
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {linkHref && (
          <Link href={linkHref} className="sh-dx-more">
            {linkText}
            <ChevronRightIcon aria-hidden="true" />
          </Link>
        )}
      </div>
      <div className="sh-dx-stage">
        {!edges.start && (
          <button
            type="button"
            className="sh-dx-arrow prev"
            onClick={() => page(-1)}
            aria-label={intl.formatMessage(messages.previous, { title })}
          >
            <ChevronLeftIcon aria-hidden="true" />
          </button>
        )}
        <div className="sh-dx-track" ref={track} onScroll={measure}>
          {children}
        </div>
        {!edges.end && (
          <button
            type="button"
            className="sh-dx-arrow next"
            onClick={() => page(1)}
            aria-label={intl.formatMessage(messages.next, { title })}
          >
            <ChevronRightIcon aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
};

export default Carousel;
