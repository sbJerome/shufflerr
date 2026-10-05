import SettingsLayout from '@app/components/Settings/SettingsLayout';
import SettingsUsers from '@app/components/Settings/SettingsUsers';
import type { NextPage } from 'next';

const SettingsUsersPage: NextPage = () => (
  <SettingsLayout>
    <SettingsUsers />
  </SettingsLayout>
);

export default SettingsUsersPage;
