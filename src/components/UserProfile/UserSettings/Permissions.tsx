// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: src/components/UserProfile/UserSettings/UserPermissions/index.tsx at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Panel from '@app/components/Common/Panel';
import PermissionEdit from '@app/components/PermissionEdit';
import {
  apiErrorMessage,
  useProfileUser,
} from '@app/components/UserProfile/shared';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type { UserSettingsPermissionsResponse } from '@server/interfaces/api/userSettingsInterfaces';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages(
  'components.UserProfile.UserSettings.Permissions',
  {
    permissions: 'Permissions',
    ownerNote: 'The owner always has full access.',
    what: 'What {name} can do in Shufflerr.',
    save: 'Save permissions',
    saving: 'Saving…',
    saved: 'Saved {name}’s permissions.',
    error: 'The permissions weren’t saved. Try again.',
    loadError: 'The permissions didn’t load. Reload the page to try again.',
  }
);

const Permissions = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, currentUser, revalidate } = useProfileUser();
  const isOwner = user?.id === 1;
  const { data, error, mutate } = useSWR<UserSettingsPermissionsResponse>(
    user && !isOwner ? `/api/v1/user/${user.id}/settings/permissions` : null
  );
  const [permissions, setPermissions] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setPermissions(data.permissions);
    }
  }, [data]);

  if (!user) {
    return null;
  }

  if (isOwner) {
    return (
      <Panel
        title={intl.formatMessage(messages.permissions)}
        sub={intl.formatMessage(messages.ownerNote)}
      />
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (permissions === null) {
      return;
    }
    setSaving(true);
    try {
      await axios.post(`/api/v1/user/${user.id}/settings/permissions`, {
        permissions,
      });
      addToast(intl.formatMessage(messages.saved, { name: user.displayName }), {
        appearance: 'success',
      });
      mutate();
      revalidate();
    } catch (err) {
      addToast(apiErrorMessage(err, intl.formatMessage(messages.error)), {
        appearance: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      as="form"
      onSubmit={submit}
      title={intl.formatMessage(messages.permissions)}
      sub={intl.formatMessage(messages.what, { name: user.displayName })}
      actions={
        <Button
          buttonType="primary"
          type="submit"
          disabled={saving || permissions === null}
        >
          {intl.formatMessage(saving ? messages.saving : messages.save)}
        </Button>
      }
    >
      {error && !data ? (
        <p role="alert" className="m-0 text-st-declined">
          {intl.formatMessage(messages.loadError)}
        </p>
      ) : permissions === null ? (
        <LoadingSpinner />
      ) : (
        <PermissionEdit
          actingUser={currentUser}
          currentUser={user}
          currentPermission={permissions}
          onUpdate={setPermissions}
        />
      )}
    </Panel>
  );
};

export default Permissions;
