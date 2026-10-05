import SettingsLayout from '@app/components/Settings/SettingsLayout';
import type { NotificationAgentName } from '@app/components/Settings/SettingsNotifications';
import SettingsNotifications, {
  NOTIFICATION_AGENTS,
} from '@app/components/Settings/SettingsNotifications';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

const SettingsNotificationAgentPage: NextPage = () => {
  const router = useRouter();
  const agent = NOTIFICATION_AGENTS.find(
    (item) => item.key === router.query.agent
  )?.key as NotificationAgentName | undefined;

  useEffect(() => {
    if (router.isReady && !agent) {
      router.replace('/settings/notifications/email');
    }
  }, [router, agent]);

  return (
    <SettingsLayout>
      {agent ? <SettingsNotifications agent={agent} /> : null}
    </SettingsLayout>
  );
};

export default SettingsNotificationAgentPage;
