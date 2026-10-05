// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import {
  canSeePermissionsTab,
  useProfileUser,
} from '@app/components/UserProfile/shared';
import AppPasswords from '@app/components/UserProfile/UserSettings/AppPasswords';
import General from '@app/components/UserProfile/UserSettings/General';
import LinkedAccounts from '@app/components/UserProfile/UserSettings/LinkedAccounts';
import Notifications from '@app/components/UserProfile/UserSettings/Notifications';
import Password from '@app/components/UserProfile/UserSettings/Password';
import Permissions from '@app/components/UserProfile/UserSettings/Permissions';
import defineMessages from '@app/utils/defineMessages';
import Link from 'next/link';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.UserProfile.UserSettings', {
  userSettings: 'User settings',
  general: 'General',
  password: 'Password',
  linkedAccounts: 'Linked accounts',
  appPasswords: 'App passwords',
  notifications: 'Notifications',
  permissions: 'Permissions',
});

export type UserSettingsTab =
  | 'general'
  | 'password'
  | 'linked-accounts'
  | 'app-passwords'
  | 'notifications'
  | 'permissions';

const ALIASES: Record<string, UserSettingsTab> = {
  main: 'general',
  linked: 'linked-accounts',
  apps: 'app-passwords',
};

export const resolveSettingsTab = (slug?: string): UserSettingsTab => {
  const known: UserSettingsTab[] = [
    'general',
    'password',
    'linked-accounts',
    'app-passwords',
    'notifications',
    'permissions',
  ];
  if (!slug) {
    return 'general';
  }
  if (ALIASES[slug]) {
    return ALIASES[slug];
  }
  return known.includes(slug as UserSettingsTab)
    ? (slug as UserSettingsTab)
    : 'general';
};

interface UserSettingsProps {
  tab: UserSettingsTab;
  /** Notifications sub-route: /settings/notifications/<channel> */
  channel?: string;
}

const UserSettings = ({ tab, channel }: UserSettingsProps) => {
  const intl = useIntl();
  const { user, currentUser, base } = useProfileUser();

  if (!user) {
    return null;
  }

  const showPermissions = canSeePermissionsTab(currentUser, user);
  const items: { key: UserSettingsTab; label: string }[] = [
    { key: 'general', label: intl.formatMessage(messages.general) },
    { key: 'password', label: intl.formatMessage(messages.password) },
    {
      key: 'linked-accounts',
      label: intl.formatMessage(messages.linkedAccounts),
    },
    { key: 'app-passwords', label: intl.formatMessage(messages.appPasswords) },
    { key: 'notifications', label: intl.formatMessage(messages.notifications) },
  ];
  if (showPermissions) {
    items.push({
      key: 'permissions',
      label: intl.formatMessage(messages.permissions),
    });
  }
  const active = tab === 'permissions' && !showPermissions ? 'general' : tab;

  return (
    <>
      <nav
        className="sh-subnav-pills"
        aria-label={intl.formatMessage(messages.userSettings)}
      >
        {items.map((item) => (
          <Link
            key={item.key}
            href={`${base}/settings/${item.key}`}
            aria-current={active === item.key ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="sh-stack">
        {active === 'general' && <General />}
        {active === 'password' && <Password />}
        {active === 'linked-accounts' && <LinkedAccounts />}
        {active === 'app-passwords' && <AppPasswords />}
        {active === 'notifications' && <Notifications channel={channel} />}
        {active === 'permissions' && <Permissions />}
      </div>
    </>
  );
};

export default UserSettings;
