import SettingsDiscover from '@app/components/Settings/SettingsDiscover';
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import type { NextPage } from 'next';

const SettingsDeezerPage: NextPage = () => (
  <SettingsLayout>
    <SettingsDiscover source="deezer" />
  </SettingsLayout>
);

export default SettingsDeezerPage;
