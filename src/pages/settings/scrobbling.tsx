import SettingsLayout from '@app/components/Settings/SettingsLayout';
import SettingsScrobbling from '@app/components/Settings/SettingsScrobbling';
import type { NextPage } from 'next';

const SettingsScrobblingPage: NextPage = () => (
  <SettingsLayout>
    <SettingsScrobbling />
  </SettingsLayout>
);

export default SettingsScrobblingPage;
