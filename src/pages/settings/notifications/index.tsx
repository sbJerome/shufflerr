import SettingsLayout from '@app/components/Settings/SettingsLayout';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

/** /settings/notifications opens the first agent. */
const SettingsNotificationsIndexPage: NextPage = () => {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings/notifications/email');
  }, [router]);
  return <SettingsLayout>{null}</SettingsLayout>;
};

export default SettingsNotificationsIndexPage;
