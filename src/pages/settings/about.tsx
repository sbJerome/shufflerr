// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import SettingsAbout from '@app/components/Settings/SettingsAbout';
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import type { NextPage } from 'next';

const SettingsAboutPage: NextPage = () => (
  <SettingsLayout>
    <SettingsAbout />
  </SettingsLayout>
);

export default SettingsAboutPage;
