// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Modal from '@app/components/Common/Modal';
import PermissionEdit from '@app/components/PermissionEdit';
import { apiErrorMessage } from '@app/components/UserProfile/shared';
import type { User } from '@app/hooks/useUser';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.UserList.BulkEditModal', {
  title: 'Edit permissions for {count, plural, one {# user} other {# users}}',
  replaces: 'Replaces the permissions of: {names}.',
  save: 'Save permissions',
  saving: 'Saving…',
  cancel: 'Cancel',
  error: 'The permissions weren’t saved. Try again.',
});

interface BulkEditModalProps {
  /** Selected users (the owner is never included). */
  users: User[];
  onClose: () => void;
  onSaved: (count: number) => void;
}

const BulkEditModal = ({ users, onClose, onSaved }: BulkEditModalProps) => {
  const intl = useIntl();
  const { user: currentUser } = useUser();
  const targets = users.filter((u) => u.id !== 1);
  // Pre-fill with what every selected user already has (bitwise AND).
  const [permissions, setPermissions] = useState(() =>
    targets.length
      ? targets.map((u) => u.permissions).reduce((a, b) => a & b)
      : 0
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await axios.put('/api/v1/user', {
        ids: targets.map((u) => u.id),
        permissions,
      });
      onSaved(targets.length);
    } catch (e) {
      setError(apiErrorMessage(e, intl.formatMessage(messages.error)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={intl.formatMessage(messages.title, { count: targets.length })}
      onCancel={onClose}
      cancelText={intl.formatMessage(messages.cancel)}
      onOk={submit}
      okText={intl.formatMessage(saving ? messages.saving : messages.save)}
      okButtonType="primary"
      okDisabled={saving || targets.length === 0}
      dialogClass="!max-w-[760px]"
    >
      <p className="sh-sub m-0">
        {intl.formatMessage(messages.replaces, {
          names: targets.map((u) => u.displayName).join(', '),
        })}
      </p>
      <PermissionEdit
        actingUser={currentUser}
        currentPermission={permissions}
        onUpdate={setPermissions}
      />
      {error && (
        <p role="alert" className="m-0 text-sm text-st-declined">
          {error}
        </p>
      )}
    </Modal>
  );
};

export default BulkEditModal;
