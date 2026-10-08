// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import useRouteGuard from '@app/hooks/useRouteGuard';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type { EnabledIntegrations } from '@server/lib/settings';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useId } from 'react';
import type { MessageDescriptor } from 'react-intl';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Settings.SettingsLayout', {
  navLabel: 'Settings',
  selectLabel: 'Settings page',
  on: 'On',
  off: 'Off',
  groupGeneral: 'General',
  groupStream: 'Stream from',
  groupApps: 'Connect your apps',
  groupDownloads: 'Downloads',
  groupMetadata: 'Metadata',
  groupDiscover: 'Discover and import',
  groupScrobble: 'Scrobble to',
  groupNotifications: 'Notifications',
  groupManagement: 'Management',
  groupSystem: 'System',
  general: 'General',
  users: 'Users',
  issues: 'Issues',
  blocklist: 'Blocklist',
  network: 'Network',
  plex: 'Plex',
  jellyfin: 'Jellyfin',
  navidrome: 'Navidrome',
  local: 'Local files',
  youtube: 'YouTube',
  clients: 'Apps and devices',
  lidarr: 'Lidarr',
  metadata: 'MusicBrainz and Last.fm',
  spotify: 'Spotify',
  deezer: 'Deezer',
  itunes: 'iTunes',
  ticketmaster: 'Ticketmaster',
  skiddle: 'Skiddle',
  scrobbling: 'ListenBrainz and Last.fm',
  notifications: 'Notification agents',
  logs: 'Logs',
  jobs: 'Jobs and cache',
  about: 'About',
});

interface NavItem {
  /** Path segment after /settings/, or the key used by the mobile selector. */
  route: string;
  label: MessageDescriptor;
  /** Integration whose on/off state the status dot shows. */
  integration?: keyof EnabledIntegrations;
  /** Absolute link that overrides /settings/<route> (for top-level admin pages). */
  href?: string;
  /** Only show when the viewer holds at least one of these permissions. */
  permissions?: Permission[];
}

interface NavGroup {
  label: MessageDescriptor;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: messages.groupGeneral,
    items: [
      { route: 'general', label: messages.general },
      { route: 'users', label: messages.users },
      { route: 'network', label: messages.network },
    ],
  },
  {
    label: messages.groupStream,
    items: [
      { route: 'plex', label: messages.plex, integration: 'plex' },
      { route: 'jellyfin', label: messages.jellyfin, integration: 'jellyfin' },
      {
        route: 'navidrome',
        label: messages.navidrome,
        integration: 'navidrome',
      },
      { route: 'local', label: messages.local, integration: 'localFiles' },
      { route: 'youtube', label: messages.youtube, integration: 'youtube' },
    ],
  },
  {
    label: messages.groupApps,
    items: [{ route: 'clients', label: messages.clients }],
  },
  {
    label: messages.groupDownloads,
    items: [{ route: 'lidarr', label: messages.lidarr }],
  },
  {
    label: messages.groupMetadata,
    items: [{ route: 'metadata', label: messages.metadata }],
  },
  {
    label: messages.groupDiscover,
    items: [
      { route: 'spotify', label: messages.spotify, integration: 'spotify' },
      { route: 'deezer', label: messages.deezer, integration: 'deezer' },
      { route: 'itunes', label: messages.itunes, integration: 'itunes' },
      {
        route: 'ticketmaster',
        label: messages.ticketmaster,
        integration: 'ticketmaster',
      },
      { route: 'skiddle', label: messages.skiddle, integration: 'skiddle' },
    ],
  },
  {
    label: messages.groupScrobble,
    items: [{ route: 'scrobbling', label: messages.scrobbling }],
  },
  {
    label: messages.groupNotifications,
    items: [{ route: 'notifications', label: messages.notifications }],
  },
  {
    label: messages.groupManagement,
    items: [
      {
        route: 'issues',
        href: '/issues',
        label: messages.issues,
        permissions: [
          Permission.MANAGE_ISSUES,
          Permission.VIEW_ISSUES,
          Permission.CREATE_ISSUES,
        ],
      },
      {
        route: 'blocklist',
        href: '/blocklist',
        label: messages.blocklist,
        permissions: [
          Permission.MANAGE_BLOCKLIST,
          Permission.VIEW_BLOCKLIST,
        ],
      },
    ],
  },
  {
    label: messages.groupSystem,
    items: [
      { route: 'logs', label: messages.logs },
      { route: 'jobs', label: messages.jobs },
      { route: 'about', label: messages.about },
    ],
  },
];

interface SettingsLayoutProps {
  children: React.ReactNode;
}

/** Grouped sidebar on wide screens, a select with optgroups below 980px. */
const SettingsLayout = ({ children }: SettingsLayoutProps) => {
  useRouteGuard(Permission.MANAGE_SETTINGS);
  const intl = useIntl();
  const router = useRouter();
  const selectId = useId();
  const { currentSettings } = useSettings();
  const { user, hasPermission } = useUser();

  // /settings/notifications/<agent> keeps "Notification agents" active.
  const active = router.pathname.split('/')[2] ?? 'general';

  if (user && !hasPermission(Permission.MANAGE_SETTINGS)) {
    return null;
  }

  // Drop items the viewer can't access, then any group left empty.
  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        !item.permissions || hasPermission(item.permissions, { type: 'or' })
    ),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="sh-admin">
      <nav
        className="sh-snav"
        aria-label={intl.formatMessage(messages.navLabel)}
      >
        {groups.map((group) => (
          <div key={group.label.id} className="contents">
            <h3>{intl.formatMessage(group.label)}</h3>
            {group.items.map((item) => {
              const on = item.integration
                ? !!currentSettings.integrations?.[item.integration]
                : undefined;
              return (
                <Link
                  key={item.route}
                  href={item.href ?? `/settings/${item.route}`}
                  aria-current={active === item.route ? 'page' : undefined}
                >
                  <span>{intl.formatMessage(item.label)}</span>
                  {on !== undefined && (
                    <span
                      className={`dot ${on ? '' : 'off'}`}
                      role="img"
                      aria-label={intl.formatMessage(
                        on ? messages.on : messages.off
                      )}
                      title={intl.formatMessage(
                        on ? messages.on : messages.off
                      )}
                    />
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="min-w-0">
        <div className="sh-snav-select sh-field mb-4">
          <label htmlFor={selectId}>
            {intl.formatMessage(messages.selectLabel)}
          </label>
          <select
            id={selectId}
            value={active}
            onChange={(e) => {
              const v = e.target.value;
              router.push(v.startsWith('/') ? v : `/settings/${v}`);
            }}
          >
            {groups.map((group) => (
              <optgroup
                key={group.label.id}
                label={intl.formatMessage(group.label)}
              >
                {group.items.map((item) => (
                  <option key={item.route} value={item.href ?? item.route}>
                    {intl.formatMessage(item.label)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {children}
      </div>
    </div>
  );
};

export default SettingsLayout;
