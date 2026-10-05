// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Alert from '@app/components/Common/Alert';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.AppDataWarning', {
  dockerVolumeMissingDescription:
    'The data folder <code>{appDataPath}</code> is not a mounted volume. Settings, users and requests will be lost when the container stops. Mount a volume at that path and restart.',
});

const AppDataWarning = () => {
  const intl = useIntl();
  const { data, error } = useSWR<{ appData: boolean; appDataPath: string }>(
    '/api/v1/status/appdata'
  );

  if (!data && !error) {
    return null;
  }

  if (!data) {
    return null;
  }

  return (
    <>
      {!data.appData && (
        <Alert
          type="warning"
          title={intl.formatMessage(messages.dockerVolumeMissingDescription, {
            code: (msg: React.ReactNode) => (
              <code className="font-mono">{msg}</code>
            ),
            appDataPath: data.appDataPath,
          })}
        />
      )}
    </>
  );
};

export default AppDataWarning;
