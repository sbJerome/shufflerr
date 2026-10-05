import SettingsDiscover from '@app/components/Settings/SettingsDiscover';
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import type { NextPage } from 'next';

const SettingsTicketmasterPage: NextPage = () => (
  <SettingsLayout>
    <SettingsDiscover source="ticketmaster" />
  </SettingsLayout>
);

export default SettingsTicketmasterPage;
