import SettingsLayout from '@app/components/Settings/SettingsLayout';
import SettingsPlex from '@app/components/Settings/SettingsPlex';
import type { NextPage } from 'next';

const SettingsPlexPage: NextPage = () => (
  <SettingsLayout>
    <SettingsPlex />
  </SettingsLayout>
);

export default SettingsPlexPage;
