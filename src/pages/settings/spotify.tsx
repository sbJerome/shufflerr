import SettingsDiscover from '@app/components/Settings/SettingsDiscover';
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import type { NextPage } from 'next';

const SettingsSpotifyPage: NextPage = () => (
  <SettingsLayout>
    <SettingsDiscover source="spotify" />
  </SettingsLayout>
);

export default SettingsSpotifyPage;
