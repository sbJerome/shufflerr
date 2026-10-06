// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import TopNav from '@app/components/Layout/TopNav';
import UserWarnings from '@app/components/Layout/UserWarnings';
import Player from '@app/components/Player';
import { PlayerProvider } from '@app/context/PlayerContext';
import useLocale from '@app/hooks/useLocale';
import { useRealtime } from '@app/hooks/useRealtime';
import useScrobbleTargets from '@app/hooks/useScrobbleTargets';
import useSettings from '@app/hooks/useSettings';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type { AvailableLocale } from '@server/types/languages';
import { useRouter } from 'next/router';
import { useEffect, useRef } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Layout', {
  skip: 'Skip to content',
});

type LayoutProps = {
  children: React.ReactNode;
};

const Shell = ({ children }: LayoutProps) => {
  const intl = useIntl();
  const { user } = useUser();
  const router = useRouter();
  const { currentSettings } = useSettings();
  const { setLocale } = useLocale();
  const scrobbleTargets = useScrobbleTargets();
  useRealtime();
  const mainRef = useRef<HTMLElement>(null);
  const { data: requestCount, mutate: revalidateCount } = useSWR<{
    pending: number;
  }>('/api/v1/request/count', {
    revalidateOnMount: true,
    // Push keeps this live; the poll is just a fallback.
    refreshInterval: 60000,
  });

  useEffect(() => {
    if (setLocale && user) {
      setLocale(
        (user?.settings?.locale
          ? user.settings.locale
          : currentSettings.locale) as AvailableLocale
      );
    }
  }, [setLocale, currentSettings.locale, user]);

  // after a route change: refresh the pending count and move focus to the page
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    revalidateCount();
    mainRef.current?.focus({ preventScroll: true });
  }, [router.pathname, revalidateCount]);

  const pending = requestCount?.pending ?? 0;

  return (
    <>
      <a className="sh-skip" href="#sh-view">
        {intl.formatMessage(messages.skip)}
      </a>
      <div className="sh-app">
        <TopNav pendingCount={pending} />
        <div className="sh-main">
          <main className="sh-view" id="sh-view" tabIndex={-1} ref={mainRef}>
            <UserWarnings />
            {children}
          </main>
        </div>
      </div>
      <Player scrobbleTargets={scrobbleTargets} />
    </>
  );
};

/** App shell: top navigation, page content and the docked player. */
const Layout = ({ children }: LayoutProps) => (
  <PlayerProvider>
    <Shell>{children}</Shell>
  </PlayerProvider>
);

export default Layout;
