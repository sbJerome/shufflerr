import SettingsLayout from '@app/components/Settings/SettingsLayout';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

/** /settings opens the General page. */
const SettingsIndexPage: NextPage = () => {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings/general');
  }, [router]);
  return <SettingsLayout>{null}</SettingsLayout>;
};

export default SettingsIndexPage;
