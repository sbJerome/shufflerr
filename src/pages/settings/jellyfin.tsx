// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import SettingsJellyfin from '@app/components/Settings/SettingsJellyfin';
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import type { NextPage } from 'next';

const SettingsJellyfinPage: NextPage = () => (
  <SettingsLayout>
    <SettingsJellyfin />
  </SettingsLayout>
);

export default SettingsJellyfinPage;
