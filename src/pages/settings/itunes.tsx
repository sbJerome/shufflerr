import SettingsDiscover from '@app/components/Settings/SettingsDiscover';
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import type { NextPage } from 'next';

const SettingsItunesPage: NextPage = () => (
  <SettingsLayout>
    <SettingsDiscover source="itunes" />
  </SettingsLayout>
);

export default SettingsItunesPage;
