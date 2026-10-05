import AccountMenu from '@app/components/Layout/AccountMenu';
import useTheme from '@app/hooks/useTheme';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Layout.TopBar', {
  searchlabel: 'Search music',
  searchplaceholder: 'Search artists, albums and tracks',
  waiting: '{count} waiting for approval',
  yourswaiting: '{count} of yours waiting',
  theme: 'Switch light or dark theme',
});

interface TopBarProps {
  pendingCount: number;
}

const TopBar = ({ pendingCount }: TopBarProps) => {
  const intl = useIntl();
  const router = useRouter();
  const { hasPermission } = useUser();
  const { theme, toggleTheme } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const routeQuery =
    router.pathname.startsWith('/search') &&
    typeof router.query.query === 'string'
      ? router.query.query
      : '';
  const [value, setValue] = useState(routeQuery);

  // keep the box in sync when the route's query changes (back/forward, links)
  useEffect(() => {
    setValue(routeQuery);
  }, [routeQuery]);

  // "/" focuses search unless the user is typing somewhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="sh-tools">
      <form
        className="sh-searchbox"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = value.trim();
          router.push(
            q ? { pathname: '/search', query: { query: q } } : '/search'
          );
        }}
      >
        <label htmlFor="sh-search" className="sr-only">
          {intl.formatMessage(messages.searchlabel)}
        </label>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          aria-hidden="true"
          style={{ color: 'var(--faint)', flex: 'none' }}
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          id="sh-search"
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={intl.formatMessage(messages.searchplaceholder)}
          autoComplete="off"
          data-testid="search-input"
        />
        <kbd aria-hidden="true">/</kbd>
      </form>
      <div className="spacer" />
      {pendingCount > 0 && (
        <Link className="sh-pill sh-hide-sm" href="/requests?filter=pending">
          <span
            className="sh-status"
            style={{ '--c': 'var(--st-pending)' } as CSSProperties}
          >
            {intl.formatMessage(
              hasPermission(Permission.MANAGE_REQUESTS)
                ? messages.waiting
                : messages.yourswaiting,
              { count: pendingCount }
            )}
          </span>
        </Link>
      )}
      <button
        className="sh-pill"
        type="button"
        aria-label={intl.formatMessage(messages.theme)}
        aria-pressed={theme === 'light'}
        onClick={toggleTheme}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      </button>
      <AccountMenu />
    </div>
  );
};

export default TopBar;
