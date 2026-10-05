// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type { User } from '@app/hooks/useUser';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { hasPermission } from '@server/lib/permissions';
import { useId } from 'react';
import type { MessageDescriptor } from 'react-intl';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.PermissionEdit', {
  groupAccess: 'Access',
  groupManagement: 'Management',
  groupRequests: 'Requests',
  groupAutoApprove: 'Auto-approve',
  admin: 'Admin',
  adminDescription: 'Full access to everything. Overrides every other setting.',
  settings: 'Manage settings',
  settingsDescription: 'Change servers, sign-in and notifications.',
  users: 'Manage users',
  usersDescription: 'Import users and edit their permissions.',
  managerequests: 'Manage requests',
  managerequestsDescription:
    'Approve, decline and retry anyone’s requests. Can go over limits.',
  viewrequests: 'See all requests',
  viewrequestsDescription: 'See what everyone has requested.',
  request: 'Request anything',
  requestDescription: 'Albums, tracks and discographies.',
  requestAlbum: 'Request albums',
  requestTrack: 'Request tracks',
  requestDiscography: 'Request discographies',
  autoapprove: 'Approve everything automatically',
  autoapproveDescription: 'Requests skip the queue and go straight to Lidarr.',
  autoapproveAlbum: 'Approve albums automatically',
  autoapproveTrack: 'Approve tracks automatically',
  autoapproveDiscography: 'Approve discographies automatically',
  autoapproveDiscographyDescription: 'Unless discographies always need review.',
});

interface PermissionNode {
  bit: Permission;
  name: MessageDescriptor;
  description?: MessageDescriptor;
  children?: PermissionNode[];
}

interface PermissionGroup {
  title: MessageDescriptor;
  items: PermissionNode[];
}

/** The music permission tree (docs/PERMISSIONS_AND_APPROVALS.md §Permission editor UI). */
const PERMISSION_TREE: PermissionGroup[] = [
  {
    title: messages.groupAccess,
    items: [
      {
        bit: Permission.ADMIN,
        name: messages.admin,
        description: messages.adminDescription,
      },
    ],
  },
  {
    title: messages.groupManagement,
    items: [
      {
        bit: Permission.MANAGE_SETTINGS,
        name: messages.settings,
        description: messages.settingsDescription,
      },
      {
        bit: Permission.MANAGE_USERS,
        name: messages.users,
        description: messages.usersDescription,
      },
      {
        bit: Permission.MANAGE_REQUESTS,
        name: messages.managerequests,
        description: messages.managerequestsDescription,
        children: [
          {
            bit: Permission.REQUEST_VIEW,
            name: messages.viewrequests,
            description: messages.viewrequestsDescription,
          },
        ],
      },
    ],
  },
  {
    title: messages.groupRequests,
    items: [
      {
        bit: Permission.REQUEST,
        name: messages.request,
        description: messages.requestDescription,
        children: [
          { bit: Permission.REQUEST_ALBUM, name: messages.requestAlbum },
          { bit: Permission.REQUEST_TRACK, name: messages.requestTrack },
          {
            bit: Permission.REQUEST_DISCOGRAPHY,
            name: messages.requestDiscography,
          },
        ],
      },
    ],
  },
  {
    title: messages.groupAutoApprove,
    items: [
      {
        bit: Permission.AUTO_APPROVE,
        name: messages.autoapprove,
        description: messages.autoapproveDescription,
        children: [
          {
            bit: Permission.AUTO_APPROVE_ALBUM,
            name: messages.autoapproveAlbum,
          },
          {
            bit: Permission.AUTO_APPROVE_TRACK,
            name: messages.autoapproveTrack,
          },
          {
            bit: Permission.AUTO_APPROVE_DISCOGRAPHY,
            name: messages.autoapproveDiscography,
            description: messages.autoapproveDiscographyDescription,
          },
        ],
      },
    ],
  },
];

interface PermissionEditProps {
  /** Who is editing. Defaults to the signed-in user. */
  actingUser?: User;
  /** Whose permissions are being edited (omit for bulk edit and default permissions). */
  currentUser?: User;
  currentPermission: number;
  onUpdate: (newPermissions: number) => void;
}

export const PermissionEdit = ({
  actingUser,
  currentUser,
  currentPermission,
  onUpdate,
}: PermissionEditProps) => {
  const intl = useIntl();
  const { user: signedIn } = useUser();
  const baseId = useId();
  const actor = actingUser ?? signedIn;
  const isAdmin = !!(currentPermission & Permission.ADMIN);

  // Seerr rule: only the owner hands out ADMIN, and nobody grants a management
  // permission they don't hold themselves. Nobody but the owner edits the owner.
  const locked = (bit: Permission): boolean => {
    if (!actor) {
      return true;
    }
    if (currentUser && currentUser.id === 1 && actor.id !== 1) {
      return true;
    }
    if (bit === Permission.ADMIN) {
      return actor.id !== 1;
    }
    if (bit === Permission.MANAGE_SETTINGS && actor.id !== 1) {
      return !hasPermission(Permission.MANAGE_SETTINGS, actor.permissions);
    }
    return false;
  };

  const toggle = (node: PermissionNode, checked: boolean) => {
    let next = checked
      ? currentPermission | node.bit
      : currentPermission & ~node.bit;
    // A checked parent covers its children: only the parent bit is stored.
    if (checked) {
      (node.children ?? []).forEach((child) => {
        next &= ~child.bit;
      });
    }
    // "If ADMIN is set, store just ADMIN."
    if (next & Permission.ADMIN) {
      next = Permission.ADMIN;
    }
    onUpdate(next);
  };

  const renderNode = (node: PermissionNode, parent?: PermissionNode) => {
    const coveredByAdmin = isAdmin && node.bit !== Permission.ADMIN;
    const coveredByParent = !!parent && !!(currentPermission & parent.bit);
    const disabled = coveredByAdmin || coveredByParent || locked(node.bit);
    const checked =
      !!(currentPermission & node.bit) || coveredByAdmin || coveredByParent;
    const id = `${baseId}-perm-${node.bit}`;
    return (
      <label key={node.bit} htmlFor={id} className={parent ? 'child' : ''}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={node.description ? `${id}-d` : undefined}
          onChange={(e) => toggle(node, e.target.checked)}
        />
        <span>
          <b>{intl.formatMessage(node.name)}</b>
          {node.description && (
            <small id={`${id}-d`}>{intl.formatMessage(node.description)}</small>
          )}
        </span>
      </label>
    );
  };

  return (
    <div className="sh-perm">
      {PERMISSION_TREE.map((group) => (
        <div
          key={group.title.id}
          role="group"
          aria-label={intl.formatMessage(group.title)}
        >
          <h3>{intl.formatMessage(group.title)}</h3>
          {group.items.map((item) => (
            <div key={item.bit}>
              {renderNode(item)}
              {(item.children ?? []).map((child) => renderNode(child, item))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default PermissionEdit;
