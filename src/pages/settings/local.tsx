import SettingsLayout from '@app/components/Settings/SettingsLayout';
import SettingsLocal from '@app/components/Settings/SettingsLocal';
import type { NextPage } from 'next';

const SettingsLocalPage: NextPage = () => (
  <SettingsLayout>
    <SettingsLocal />
  </SettingsLayout>
);

export default SettingsLocalPage;
