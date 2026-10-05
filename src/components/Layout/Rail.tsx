import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { importEnabled } from '@app/utils/publicSettings';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Layout.Rail', {
  primary: 'Primary',
  home: 'Shufflerr home',
  discover: 'Discover',
  search: 'Search',
  artists: 'Artists',
  albums: 'Albums',
  requests: 'Requests',
  requestspending: 'Requests, {count} waiting',
  import: 'Import playlists',
  users: 'Users',
  settings: 'Settings',
});

const icon = (children: React.ReactNode) => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const ICONS = {
  discover: icon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  search: icon(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  artists: icon(
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
    </>
  ),
  albums: icon(
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  requests: icon(<path d="M4 6h16M4 12h16M4 18h10" />),
  import: icon(
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 21h16" />
    </>
  ),
  users: icon(
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
      <path d="M18.5 14.4c1.8.8 3 2.8 3 5.6" />
    </>
  ),
  settings: icon(
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
};

interface RailProps {
  pendingCount: number;
}

/** 76px icon rail; becomes a sticky horizontal bar below 760px. */
const Rail = ({ pendingCount }: RailProps) => {
  const intl = useIntl();
  const router = useRouter();
  const { hasPermission } = useUser();
  const { currentSettings } = useSettings();
  const path = router.pathname;

  const items: {
    key: keyof typeof ICONS;
    href: string;
    label: string;
    active: RegExp;
    show?: boolean;
    count?: number;
  }[] = [
    {
      key: 'discover',
      href: '/discover',
      label: intl.formatMessage(messages.discover),
      active: /^\/(discover)?$/,
    },
    {
      key: 'search',
      href: '/search',
      label: intl.formatMessage(messages.search),
      active: /^\/search/,
    },
    {
      key: 'artists',
      href: '/artists',
      label: intl.formatMessage(messages.artists),
      active: /^\/artists?(\/|$)/,
    },
    {
      key: 'albums',
      href: '/albums',
      label: intl.formatMessage(messages.albums),
      active: /^\/albums?(\/|$)/,
    },
    {
      key: 'requests',
      href: '/requests',
      label: pendingCount
        ? intl.formatMessage(messages.requestspending, { count: pendingCount })
        : intl.formatMessage(messages.requests),
      active: /^\/requests/,
      count: pendingCount,
    },
    {
      key: 'import',
      href: '/import',
      label: intl.formatMessage(messages.import),
      active: /^\/import/,
      show: importEnabled(currentSettings),
    },
    {
      key: 'users',
      href: '/users',
      label: intl.formatMessage(messages.users),
      active: /^\/users/,
      show: hasPermission(Permission.MANAGE_USERS),
    },
  ];

  return (
    <nav className="sh-rail" aria-label={intl.formatMessage(messages.primary)}>
      <Link
        className="sh-brand"
        href="/discover"
        aria-label={intl.formatMessage(messages.home)}
      >
        s/
      </Link>
      {items
        .filter((item) => item.show !== false)
        .map((item) => (
          <Link
            key={item.key}
            className="nav"
            href={item.href}
            aria-label={item.label}
            title={item.label}
            aria-current={item.active.test(path) ? 'page' : undefined}
            data-testid={`rail-${item.key}`}
          >
            {ICONS[item.key]}
            {!!item.count && (
              <span className="count" aria-hidden="true">
                {item.count > 99 ? '99+' : item.count}
              </span>
            )}
          </Link>
        ))}
      <div className="grow" />
      {hasPermission(Permission.MANAGE_SETTINGS) && (
        <Link
          className="nav"
          href="/settings"
          aria-label={intl.formatMessage(messages.settings)}
          title={intl.formatMessage(messages.settings)}
          aria-current={/^\/settings/.test(path) ? 'page' : undefined}
          data-testid="rail-settings"
        >
          {ICONS.settings}
        </Link>
      )}
    </nav>
  );
};

export default Rail;
