import SettingsLayout from '@app/components/Settings/SettingsLayout';
import SettingsNavidrome from '@app/components/Settings/SettingsNavidrome';
import type { NextPage } from 'next';

const SettingsNavidromePage: NextPage = () => (
  <SettingsLayout>
    <SettingsNavidrome />
  </SettingsLayout>
);

export default SettingsNavidromePage;
