import defineMessages from '@app/utils/defineMessages';
import { tintFor } from '@app/utils/format';
import type { SlideshowResponse } from '@server/interfaces/api/mediaInterfaces';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Login.AuthShell', {
  footer:
    'Background shows album art from your library. Sign-in and request approvals work like Seerr.',
  footerplain: 'Sign-in and request approvals work like Seerr.',
});

const SLIDESHOW_URL = '/api/v1/public/slideshow?take=70';
const TILES = 70;
const LAYERS = 3;
const INTERVAL_MS = 6000;

/** Deterministic shuffle so each layer shows the covers in a different order. */
const shuffled = (list: string[], seed: number): string[] => {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = (i * 7 + seed * 13) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/**
 * Album-art slideshow behind the auth screens: three tilted mosaics of
 * recently added covers that crossfade every 6 seconds. With an empty library
 * it renders nothing (plain dark background). Static under reduced motion.
 */
export const LoginSlideshow = () => {
  const { data } = useSWR<SlideshowResponse>(SLIDESHOW_URL, {
    revalidateOnFocus: false,
    refreshInterval: 0,
    shouldRetryOnError: false,
  });
  const [active, setActive] = useState(0);
  const images = useMemo(
    () => (data?.covers ?? []).map((cover) => cover.url),
    [data]
  );

  const layers = useMemo(() => {
    if (!images.length) return [];
    return Array.from({ length: LAYERS }, (_, seed) => {
      const order = shuffled(images, seed);
      return Array.from(
        { length: TILES },
        (_, k) => order[(k + seed * 3) % order.length]
      );
    });
  }, [images]);

  useEffect(() => {
    if (
      layers.length < 2 ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    const timer = setInterval(
      () => setActive((i) => (i + 1) % layers.length),
      INTERVAL_MS
    );
    return () => clearInterval(timer);
  }, [layers.length]);

  if (!layers.length) {
    return null;
  }

  return (
    <div className="sh-fader" aria-hidden="true">
      {layers.map((tiles, seed) => (
        <div key={seed} className={`sh-mosaic ${seed === active ? 'on' : ''}`}>
          {tiles.map((src, k) => {
            const [bg, ink] = tintFor(src);
            return (
              <div
                key={k}
                className="sh-tile"
                style={{ '--tint': bg, '--ink': ink } as CSSProperties}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  loading={seed === 0 ? 'eager' : 'lazy'}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

interface AuthShellProps {
  children: React.ReactNode;
  /** Hide the footer line (setup wizard). */
  footer?: boolean;
}

/** Full-screen dark frame for sign-in, sign-out, password reset and setup. */
const AuthShell = ({ children, footer = true }: AuthShellProps) => {
  const intl = useIntl();
  const { data } = useSWR<SlideshowResponse>(SLIDESHOW_URL, {
    revalidateOnFocus: false,
    refreshInterval: 0,
    shouldRetryOnError: false,
  });

  return (
    <div className="sh-auth sh-force-dark">
      <LoginSlideshow />
      <Link className="sh-wordmark" href="/login" aria-label="Shufflerr">
        SHUFFLE<span>RR</span>
      </Link>
      {children}
      {footer && (
        <p className="sh-auth-foot">
          {intl.formatMessage(
            data?.covers?.length ? messages.footer : messages.footerplain
          )}
        </p>
      )}
    </div>
  );
};

export default AuthShell;
