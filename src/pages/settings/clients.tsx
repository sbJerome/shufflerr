import SettingsClients from '@app/components/Settings/SettingsClients';
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import type { NextPage } from 'next';

const SettingsClientsPage: NextPage = () => (
  <SettingsLayout>
    <SettingsClients />
  </SettingsLayout>
);

export default SettingsClientsPage;
