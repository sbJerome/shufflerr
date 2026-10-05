import Avatar from '@app/components/Common/Avatar';
import RoleBadge from '@app/components/Common/RoleBadge';
import { usePlayer } from '@app/context/PlayerContext';
import useClickOutside from '@app/hooks/useClickOutside';
import { Permission, UserType, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useId, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Layout.AccountMenu', {
  account: 'Account',
  profile: 'Profile',
  myrequests: 'My requests',
  accountsettings: 'Account settings',
  serversettings: 'Server settings',
  signout: 'Sign out',
  plexuser: 'Plex user',
  jellyfinuser: 'Jellyfin user',
  embyuser: 'Emby user',
  localuser: 'Local user',
});

export const accountTypeMessage = (userType?: number) => {
  switch (userType) {
    case UserType.PLEX:
      return messages.plexuser;
    case UserType.JELLYFIN:
      return messages.jellyfinuser;
    case UserType.EMBY:
      return messages.embyuser;
    default:
      return messages.localuser;
  }
};

/** Avatar + name button in the top bar and its menu. */
const AccountMenu = () => {
  const intl = useIntl();
  const router = useRouter();
  const { user, hasPermission } = useUser();
  const { stop } = usePlayer();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useClickOutside(wrapRef, () => setOpen(false));

  useEffect(() => {
    setOpen(false);
  }, [router.asPath]);

  if (!user) {
    return null;
  }

  const signOut = async () => {
    stop();
    try {
      await axios.post('/api/v1/auth/logout');
    } finally {
      // full navigation so every cached response is dropped
      window.location.href = '/logout';
    }
  };

  return (
    // Esc closes the menu from anywhere inside it.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="sh-acct-wrap"
      ref={wrapRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        className="sh-pill"
        type="button"
        ref={buttonRef}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={intl.formatMessage(messages.account)}
        onClick={() => setOpen((o) => !o)}
        data-testid="user-menu"
      >
        <Avatar name={user.displayName} src={user.avatar} />
        <span className="sh-hide-sm">{user.displayName}</span>
      </button>
      <div className="sh-menu" id={menuId} hidden={!open}>
        <div className="who">
          <b>{user.displayName}</b>
          <span>{user.email}</span>
          <div className="mt-2 flex items-center gap-2">
            <RoleBadge user={user} />
            <span className="sh-feat">
              {intl.formatMessage(accountTypeMessage(user.userType))}
            </span>
          </div>
        </div>
        <Link href="/profile">{intl.formatMessage(messages.profile)}</Link>
        <Link href="/profile/requests">
          {intl.formatMessage(messages.myrequests)}
        </Link>
        <Link href="/profile/settings">
          {intl.formatMessage(messages.accountsettings)}
        </Link>
        {hasPermission(Permission.MANAGE_SETTINGS) && (
          <Link href="/settings">
            {intl.formatMessage(messages.serversettings)}
          </Link>
        )}
        <button type="button" onClick={signOut} data-testid="sign-out">
          {intl.formatMessage(messages.signout)}
        </button>
      </div>
    </div>
  );
};

export default AccountMenu;
