// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import EmptyState from '@app/components/Common/EmptyState';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import RoleBadge from '@app/components/Common/RoleBadge';
import { accountTypeMessage } from '@app/components/Layout/AccountMenu';
import {
  canEditUser,
  useProfileUser,
} from '@app/components/UserProfile/shared';
import { Permission } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { initials } from '@app/utils/format';
import { avatarUrl } from '@app/utils/images';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.UserProfile', {
  profile: 'Profile',
  overview: 'Overview',
  requests: 'Requests',
  settings: 'Settings',
  joined: 'Joined {date}',
  editUser: 'Edit user',
  notFound: 'User not found',
  notFoundHint: 'This account doesn’t exist any more, or the link is wrong.',
  backToUsers: 'Back to users',
  noAccess: 'You can’t open this profile',
  noAccessHint:
    'Only people who can manage users see other people’s profiles. Ask an admin if you need access.',
  noAccessSettings: 'You can’t change this account',
  noAccessSettingsHint:
    'Only the owner can edit the owner, and editing other people needs the “Manage users” permission.',
  backToProfile: 'Go to your profile',
});

type ProfileTab = 'overview' | 'requests' | 'settings';

interface UserProfileProps {
  tab: ProfileTab;
  children: React.ReactNode;
}

/** Header card + Overview / Requests / Settings tabs around a profile page. */
const UserProfile = ({ tab, children }: UserProfileProps) => {
  const intl = useIntl();
  const {
    user,
    currentUser,
    base,
    isSelf,
    loading,
    error,
    currentHasPermission,
  } = useProfileUser();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const avatar = avatarUrl(user?.avatar);
  useEffect(() => setAvatarFailed(false), [avatar]);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!user) {
    const forbidden =
      (error as { response?: { status?: number } } | undefined)?.response
        ?.status === 403 ||
      (!!currentUser && !currentHasPermission(Permission.MANAGE_USERS));
    return (
      <EmptyState
        title={intl.formatMessage(
          forbidden ? messages.noAccess : messages.notFound
        )}
        action={
          forbidden ? (
            <Link href="/profile" className="sh-btn">
              {intl.formatMessage(messages.backToProfile)}
            </Link>
          ) : (
            <Link href="/users" className="sh-btn">
              {intl.formatMessage(messages.backToUsers)}
            </Link>
          )
        }
      >
        {intl.formatMessage(
          forbidden ? messages.noAccessHint : messages.notFoundHint
        )}
      </EmptyState>
    );
  }

  const editable = canEditUser(currentUser, user);
  const tabs: { key: ProfileTab; href: string; label: string }[] = [
    {
      key: 'overview',
      href: base,
      label: intl.formatMessage(messages.overview),
    },
    {
      key: 'requests',
      href: `${base}/requests`,
      label: intl.formatMessage(messages.requests),
    },
  ];
  if (editable) {
    tabs.push({
      key: 'settings',
      href: `${base}/settings`,
      label: intl.formatMessage(messages.settings),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={[user.displayName, intl.formatMessage(messages.profile)]}
      />
      <section className="sh-uhead">
        <span className="big" aria-hidden="true">
          {avatar && !avatarFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" onError={() => setAvatarFailed(true)} />
          ) : (
            initials(user.displayName)
          )}
        </span>
        <div className="min-w-[220px] flex-1">
          <h1>{user.displayName}</h1>
          <div className="sh-meta">
            <span>{user.email}</span>
            <span>{intl.formatMessage(accountTypeMessage(user.userType))}</span>
            <span>
              {intl.formatMessage(messages.joined, {
                date: intl.formatDate(user.createdAt, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                }),
              })}
            </span>
            <RoleBadge user={user} />
          </div>
        </div>
        {!isSelf && editable && (
          <div className="sh-inline">
            <Link href={`${base}/settings`} className="sh-btn">
              {intl.formatMessage(messages.editUser)}
            </Link>
          </div>
        )}
      </section>

      <nav
        className="sh-tabs-h"
        aria-label={intl.formatMessage(messages.profile)}
      >
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={tab === t.key ? 'page' : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'settings' && !editable ? (
        <EmptyState title={intl.formatMessage(messages.noAccessSettings)}>
          {intl.formatMessage(messages.noAccessSettingsHint)}
        </EmptyState>
      ) : (
        children
      )}
    </div>
  );
};

export default UserProfile;
