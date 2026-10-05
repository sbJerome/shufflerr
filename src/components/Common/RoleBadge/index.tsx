import defineMessages from '@app/utils/defineMessages';
import { hasPermission, Permission } from '@server/lib/permissions';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Common.RoleBadge', {
  owner: 'Owner',
  admin: 'Admin',
  user: 'User',
});

interface RoleBadgeProps {
  user: { id: number; permissions: number };
}

/** Owner (id 1, amber) / Admin (accent) / User. Display only. */
const RoleBadge = ({ user }: RoleBadgeProps) => {
  const intl = useIntl();
  if (user.id === 1) {
    return (
      <span className="sh-role owner">
        {intl.formatMessage(messages.owner)}
      </span>
    );
  }
  if (hasPermission(Permission.ADMIN, user.permissions)) {
    return (
      <span className="sh-role admin">
        {intl.formatMessage(messages.admin)}
      </span>
    );
  }
  return <span className="sh-role">{intl.formatMessage(messages.user)}</span>;
};

export default RoleBadge;
