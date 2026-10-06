import TopBar from '@app/components/Layout/TopBar';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { importEnabled } from '@app/utils/publicSettings';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Layout.TopNav', {
  menu: 'Menu',
  closemenu: 'Close menu',
  primary: 'Primary',
  home: 'Shufflerr home',
  discover: 'Discover',
  search: 'Search',
  artists: 'Artists',
  albums: 'Albums',
  playlists: 'Playlists',
  requests: 'Requests',
  requestspending: 'Requests, {count} waiting',
  import: 'Import',
  users: 'Users',
  issues: 'Issues',
  issuesopen: 'Issues, {count} open',
  blocklist: 'Blocklist',
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
  playlists: icon(
    <>
      <path d="M4 7h10M4 12h10M4 17h6" />
      <circle cx="17" cy="16" r="3" />
      <path d="M20 16V7l-5 1.5" />
    </>
  ),
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
  issues: icon(
    <>
      <path d="M12 3 2.5 20h19z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </>
  ),
  blocklist: icon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.6 5.6 12.8 12.8" />
    </>
  ),
  menu: icon(<path d="M4 7h16M4 12h16M4 17h16" />),
  close: icon(<path d="M6 6l12 12M18 6 6 18" />),
  settings: icon(
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
};

type NavKey = Exclude<keyof typeof ICONS, 'menu' | 'close'>;

interface TopNavProps {
  pendingCount: number;
}

/**
 * Sticky top navigation: brand, the primary links, then search, pending pill,
 * theme toggle and account. Below 1100px the links fold into a menu button.
 */
const TopNav = ({ pendingCount }: TopNavProps) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const intl = useIntl();
  const router = useRouter();
  const { hasPermission } = useUser();
  const { currentSettings } = useSettings();
  const path = router.pathname;

  useEffect(() => {
    setOpen(false);
  }, [path, router.asPath]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const canSeeIssues = hasPermission(
    [Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES],
    { type: 'or' }
  );
  const { data: issueCount } = useSWR<{ open: number }>(
    canSeeIssues ? '/api/v1/issue/count' : null,
    { refreshInterval: 60 * 1000 }
  );
  const openIssues = issueCount?.open ?? 0;

  const items: {
    key: Exclude<keyof typeof ICONS, 'menu' | 'close'>;
    href: string;
    label: string;
    active: RegExp;
    show?: boolean;
    count?: number;
    /** Icon only in the bar (label still read out and shown in the menu). */
    compact?: boolean;
  }[] = [
    {
      key: 'discover',
      href: '/discover',
      label: intl.formatMessage(messages.discover),
      active: /^\/(discover)?$/,
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
      key: 'playlists',
      href: '/playlists',
      label: intl.formatMessage(messages.playlists),
      active: /^\/playlists?(\/|$)/,
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
      compact: true,
      href: '/users',
      label: intl.formatMessage(messages.users),
      active: /^\/users/,
      show: hasPermission(Permission.MANAGE_USERS),
    },
    {
      key: 'issues',
      compact: true,
      href: '/issues',
      label: openIssues
        ? intl.formatMessage(messages.issuesopen, { count: openIssues })
        : intl.formatMessage(messages.issues),
      active: /^\/issues/,
      show: hasPermission(
        [
          Permission.MANAGE_ISSUES,
          Permission.VIEW_ISSUES,
          Permission.CREATE_ISSUES,
        ],
        { type: 'or' }
      ),
      count: openIssues,
    },
    {
      key: 'blocklist',
      compact: true,
      href: '/blocklist',
      label: intl.formatMessage(messages.blocklist),
      active: /^\/blocklist/,
      show: hasPermission(
        [Permission.MANAGE_BLOCKLIST, Permission.VIEW_BLOCKLIST],
        { type: 'or' }
      ),
    },
    {
      key: 'settings',
      compact: true,
      href: '/settings',
      label: intl.formatMessage(messages.settings),
      active: /^\/settings/,
      show: hasPermission(Permission.MANAGE_SETTINGS),
    },
  ];
  const shown = items.filter((item) => item.show !== false);

  return (
    <header className="sh-topnav">
      <div className="sh-topnav-row">
        <Link
          className="sh-brand"
          href="/discover"
          aria-label={intl.formatMessage(messages.home)}
        >
          <span className="tile">s/</span>
          <span className="word">
            SHUFFLE<em>RR</em>
          </span>
        </Link>
        <div className="sh-navwrap" ref={menuRef}>
          <button
            type="button"
            className="sh-menu-btn"
            aria-expanded={open}
            aria-controls="sh-primary-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? ICONS.close : ICONS.menu}
            <span>
              {intl.formatMessage(open ? messages.closemenu : messages.menu)}
            </span>
          </button>
          <nav
            id="sh-primary-nav"
            className={`sh-nav ${open ? 'open' : ''}`}
            aria-label={intl.formatMessage(messages.primary)}
          >
            {shown.map((item) => (
              <Link
                key={item.key}
                className={`nav ${item.compact ? 'compact' : ''}`}
                href={item.href}
                title={item.compact ? item.label : undefined}
                aria-label={item.label}
                aria-current={item.active.test(path) ? 'page' : undefined}
                data-testid={`rail-${item.key}`}
              >
                {ICONS[item.key]}
                <span className="label">
                  {intl.formatMessage(messages[item.key as NavKey])}
                </span>
                {!!item.count && (
                  <span className="count" aria-hidden="true">
                    {item.count > 99 ? '99+' : item.count}
                  </span>
                )}
              </Link>
            ))}
          </nav>
        </div>
        <TopBar pendingCount={pendingCount} />
      </div>
    </header>
  );
};

export default TopNav;
