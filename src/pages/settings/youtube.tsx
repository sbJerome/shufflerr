import SettingsLayout from '@app/components/Settings/SettingsLayout';
import SettingsYoutube from '@app/components/Settings/SettingsYoutube';
import type { NextPage } from 'next';

const SettingsYoutubePage: NextPage = () => (
  <SettingsLayout>
    <SettingsYoutube />
  </SettingsLayout>
);

export default SettingsYoutubePage;
