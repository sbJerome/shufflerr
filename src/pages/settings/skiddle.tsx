import SettingsDiscover from '@app/components/Settings/SettingsDiscover';
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import type { NextPage } from 'next';

const SettingsSkiddlePage: NextPage = () => (
  <SettingsLayout>
    <SettingsDiscover source="skiddle" />
  </SettingsLayout>
);

export default SettingsSkiddlePage;
