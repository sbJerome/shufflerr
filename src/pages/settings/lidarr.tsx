import SettingsLayout from '@app/components/Settings/SettingsLayout';
import SettingsLidarr from '@app/components/Settings/SettingsLidarr';
import type { NextPage } from 'next';

const SettingsLidarrPage: NextPage = () => (
  <SettingsLayout>
    <SettingsLidarr />
  </SettingsLayout>
);

export default SettingsLidarrPage;
