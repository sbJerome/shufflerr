// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import SettingsMetadata from '@app/components/Settings/SettingsMetadata';
import type { NextPage } from 'next';

const SettingsMetadataPage: NextPage = () => (
  <SettingsLayout>
    <SettingsMetadata />
  </SettingsLayout>
);

export default SettingsMetadataPage;
