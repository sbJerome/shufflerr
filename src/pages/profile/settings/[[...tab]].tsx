import UserProfile from '@app/components/UserProfile';
import UserSettings, {
  resolveSettingsTab,
} from '@app/components/UserProfile/UserSettings';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';

/** /settings, /settings/<tab> and /settings/notifications/<channel>. */
const UserSettingsPage: NextPage = () => {
  const router = useRouter();
  const segments = Array.isArray(router.query.tab) ? router.query.tab : [];

  return (
    <UserProfile tab="settings">
      <UserSettings
        tab={resolveSettingsTab(segments[0])}
        channel={segments[1]}
      />
    </UserProfile>
  );
};

export default UserSettingsPage;
