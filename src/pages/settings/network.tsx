// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import SettingsNetwork from '@app/components/Settings/SettingsNetwork';
import type { NextPage } from 'next';

const SettingsNetworkPage: NextPage = () => (
  <SettingsLayout>
    <SettingsNetwork />
  </SettingsLayout>
);

export default SettingsNetworkPage;
