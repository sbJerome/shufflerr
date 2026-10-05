import SettingsJobsCache from '@app/components/Settings/SettingsJobsCache';
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import type { NextPage } from 'next';

const SettingsJobsPage: NextPage = () => (
  <SettingsLayout>
    <SettingsJobsCache />
  </SettingsLayout>
);

export default SettingsJobsPage;
