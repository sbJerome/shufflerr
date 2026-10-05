// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import AppDataWarning from '@app/components/AppDataWarning';
import Alert from '@app/components/Common/Alert';
import PageTitle from '@app/components/Common/PageTitle';
import AuthShell from '@app/components/Login/AuthShell';
import SettingsJellyfin from '@app/components/Settings/SettingsJellyfin';
import SettingsPlex from '@app/components/Settings/SettingsPlex';
import SettingsServices from '@app/components/Settings/SettingsServices';
import SetupSteps from '@app/components/Setup/SetupSteps';
import useLocale from '@app/hooks/useLocale';
import useSettings from '@app/hooks/useSettings';
import defineMessages from '@app/utils/defineMessages';
import { MediaServerType } from '@server/constants/server';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';
import SetupLogin from './SetupLogin';

const messages = defineMessages('components.Setup', {
  setup: 'Set up',
  welcome: 'Welcome to Shufflerr',
  subtitle:
    'Pick the media server you listen with. You sign in with it, and Shufflerr reads its music libraries to know what you already have.',
  configplex: 'Set up with Plex',
  configjellyfin: 'Set up with Jellyfin',
  configemby: 'Set up with Emby',
  servertype: 'Choose a media server',
  signin: 'Sign in',
  configuremediaserver: 'Pick music libraries',
  configureservices: 'Connect Lidarr',
  librariestitle: 'Pick music libraries',
  librariessub:
    'Turn on the music libraries Shufflerr should scan. You can change this later in Settings.',
  servicestitle: 'Connect Lidarr',
  servicessub:
    'Approved requests are sent to Lidarr to download. Add your Lidarr server now, or skip and do it later in Settings → Lidarr.',
  continue: 'Continue',
  finish: 'Finish setup',
  finishing: 'Finishing…',
  finisherror:
    'Setup couldn’t be finished. Check the Shufflerr logs and try again.',
  librarieserror:
    'Shufflerr couldn’t load libraries from your media server. Check that it is reachable and the connection details are right.',
});

const Setup = () => {
  const intl = useIntl();
  const [isUpdating, setIsUpdating] = useState(false);
  const [finishError, setFinishError] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [mediaServerType, setMediaServerType] = useState(
    MediaServerType.NOT_CONFIGURED
  );
  const router = useRouter();
  const { locale } = useLocale();
  const settings = useSettings();

  const finishSetup = async () => {
    setIsUpdating(true);
    setFinishError(false);
    try {
      const response = await axios.post<{ initialized: boolean }>(
        '/api/v1/settings/initialize'
      );
      if (response.data.initialized) {
        await axios.post('/api/v1/settings/main', { locale });
        mutate('/api/v1/settings/public');
        router.push('/');
        return;
      }
      setFinishError(true);
    } catch {
      setFinishError(true);
    } finally {
      setIsUpdating(false);
    }
  };

  const mediaServerSettingsEndpoint: Record<MediaServerType, string | null> = {
    [MediaServerType.JELLYFIN]: '/api/v1/settings/jellyfin',
    [MediaServerType.EMBY]: '/api/v1/settings/jellyfin',
    [MediaServerType.PLEX]: '/api/v1/settings/plex',
    [MediaServerType.NOT_CONFIGURED]: null,
  };

  const { data: mediaServerSettings, error: mediaServerSettingsError } =
    useSWR<{ libraries: { enabled: boolean }[] }>(
      currentStep === 3 ? mediaServerSettingsEndpoint[mediaServerType] : null,
      { refreshInterval: 3000 }
    );

  const mediaServerSettingsComplete = !!mediaServerSettings?.libraries?.some(
    (library) => library.enabled
  );

  useEffect(() => {
    if (settings.currentSettings.initialized) {
      router.push('/');
    }

    if (
      settings.currentSettings.mediaServerType !==
      MediaServerType.NOT_CONFIGURED
    ) {
      setMediaServerType(settings.currentSettings.mediaServerType);
      if (currentStep < 3) {
        setCurrentStep(3);
      }
    }
  }, [
    settings.currentSettings.mediaServerType,
    settings.currentSettings.initialized,
    router,
    currentStep,
  ]);

  if (settings.currentSettings.initialized) return <></>;

  const choose = (type: MediaServerType) => {
    setMediaServerType(type);
    setCurrentStep(2);
  };

  return (
    <AuthShell footer={false}>
      <PageTitle title={intl.formatMessage(messages.setup)} />
      <div className="sh-auth-card sh-auth-wide">
        <AppDataWarning />
        <nav aria-label={intl.formatMessage(messages.setup)}>
          <ol className="sh-steps">
            <SetupSteps
              stepNumber={1}
              description={intl.formatMessage(messages.servertype)}
              active={currentStep === 1}
              completed={currentStep > 1}
            />
            <SetupSteps
              stepNumber={2}
              description={intl.formatMessage(messages.signin)}
              active={currentStep === 2}
              completed={currentStep > 2}
            />
            <SetupSteps
              stepNumber={3}
              description={intl.formatMessage(messages.configuremediaserver)}
              active={currentStep === 3}
              completed={currentStep > 3}
            />
            <SetupSteps
              stepNumber={4}
              description={intl.formatMessage(messages.configureservices)}
              active={currentStep === 4}
              isLastStep
            />
          </ol>
        </nav>

        {currentStep === 1 && (
          <div className="flex flex-col gap-[18px]">
            <h1>{intl.formatMessage(messages.welcome)}</h1>
            <p className="lede">{intl.formatMessage(messages.subtitle)}</p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="sh-btn plex"
                onClick={() => choose(MediaServerType.PLEX)}
                data-testid="setup-plex"
              >
                {intl.formatMessage(messages.configplex)}
              </button>
              <button
                type="button"
                className="sh-btn jellyfin"
                onClick={() => choose(MediaServerType.JELLYFIN)}
                data-testid="setup-jellyfin"
              >
                {intl.formatMessage(messages.configjellyfin)}
              </button>
              <button
                type="button"
                className="sh-btn min-h-[52px]"
                onClick={() => choose(MediaServerType.EMBY)}
                data-testid="setup-emby"
              >
                {intl.formatMessage(messages.configemby)}
              </button>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <SetupLogin
            serverType={mediaServerType}
            onCancel={() => {
              setMediaServerType(MediaServerType.NOT_CONFIGURED);
              setCurrentStep(1);
            }}
            onComplete={() => setCurrentStep(3)}
          />
        )}

        {currentStep === 3 && (
          <div className="flex flex-col gap-[18px]">
            <h2 className="text-[22px] font-semibold text-white">
              {intl.formatMessage(messages.librariestitle)}
            </h2>
            <p className="lede">{intl.formatMessage(messages.librariessub)}</p>
            {!!mediaServerSettingsError && (
              <Alert
                title={intl.formatMessage(messages.librarieserror)}
                type="error"
              />
            )}
            {mediaServerType === MediaServerType.PLEX ? (
              <SettingsPlex isSetupSettings />
            ) : (
              <SettingsJellyfin isSetupSettings />
            )}
            <div className="flex justify-end">
              <button
                type="button"
                className="sh-btn primary"
                disabled={!mediaServerSettingsComplete}
                onClick={() => setCurrentStep(4)}
              >
                {intl.formatMessage(messages.continue)}
              </button>
            </div>
          </div>
        )}

        {currentStep === 4 && (
          <div className="flex flex-col gap-[18px]">
            <h2 className="text-[22px] font-semibold text-white">
              {intl.formatMessage(messages.servicestitle)}
            </h2>
            <p className="lede">{intl.formatMessage(messages.servicessub)}</p>
            <SettingsServices />
            {finishError && (
              <p className="sh-err" role="alert">
                {intl.formatMessage(messages.finisherror)}
              </p>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                className="sh-btn primary"
                onClick={() => finishSetup()}
                disabled={isUpdating}
                data-testid="setup-finish"
              >
                {intl.formatMessage(
                  isUpdating ? messages.finishing : messages.finish
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </AuthShell>
  );
};

export default Setup;
