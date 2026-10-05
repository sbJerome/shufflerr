// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import AppDataWarning from '@app/components/AppDataWarning';
import PageTitle from '@app/components/Common/PageTitle';
import AuthShell from '@app/components/Login/AuthShell';
import SettingsJellyfin from '@app/components/Settings/SettingsJellyfin';
import SettingsLidarr from '@app/components/Settings/SettingsLidarr';
import SettingsLocal from '@app/components/Settings/SettingsLocal';
import SettingsNavidrome from '@app/components/Settings/SettingsNavidrome';
import SettingsPlex from '@app/components/Settings/SettingsPlex';
import LocalAdminSetup from '@app/components/Setup/LocalAdminSetup';
import SetupSteps from '@app/components/Setup/SetupSteps';
import useLocale from '@app/hooks/useLocale';
import useSettings from '@app/hooks/useSettings';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { MediaServerType } from '@server/constants/server';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { mutate } from 'swr';
import SetupLogin from './SetupLogin';

const messages = defineMessages('components.Setup', {
  setup: 'Set up',
  welcome: 'Welcome to Shufflerr',
  subtitle:
    'Start by creating the owner account. Sign in with the media server you listen with, or make a local admin account.',
  configplex: 'Sign in with Plex',
  configjellyfin: 'Sign in with Jellyfin',
  configemby: 'Sign in with Emby',
  configlocal: 'Create a local admin account',
  stepOwner: 'Create the owner',
  stepSources: 'Add your music',
  stepLidarr: 'Connect Lidarr',
  sourcestitle: 'Where is your music?',
  sourcessub:
    'Turn on every place Shufflerr should look to know what you already have. You can change this later in Settings.',
  sourceLabel: 'Library sources',
  plex: 'Plex',
  jellyfin: 'Jellyfin',
  emby: 'Emby',
  navidrome: 'Navidrome',
  local: 'Local files',
  servicestitle: 'Connect Lidarr',
  servicessub:
    'Approved requests are sent to Lidarr to download. Add your Lidarr server now, or skip and do it later in Settings → Lidarr.',
  continue: 'Continue',
  skip: 'Skip for now',
  back: 'Back',
  finish: 'Finish setup',
  finishing: 'Finishing…',
  finisherror:
    'Setup couldn’t be finished. Check the Shufflerr logs and try again.',
});

type OwnerChoice = MediaServerType | 'local' | null;
type Source = 'plex' | 'jellyfin' | 'navidrome' | 'local';

const Setup = () => {
  const intl = useIntl();
  const router = useRouter();
  const { locale } = useLocale();
  const settings = useSettings();
  const { user, revalidate } = useUser();
  const [currentStep, setCurrentStep] = useState(1);
  const [ownerChoice, setOwnerChoice] = useState<OwnerChoice>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [finishError, setFinishError] = useState(false);

  const serverType = settings.currentSettings.mediaServerType;
  const jellyfinName =
    serverType === MediaServerType.EMBY || ownerChoice === MediaServerType.EMBY
      ? messages.emby
      : messages.jellyfin;

  useEffect(() => {
    if (settings.currentSettings.initialized) {
      router.push('/');
    }
  }, [settings.currentSettings.initialized, router]);

  // Once an owner is signed in (also after a reload), step 1 is done.
  useEffect(() => {
    if (user && currentStep === 1) {
      setCurrentStep(2);
    }
  }, [user, currentStep]);

  // Open the source that matches how the owner signed in.
  useEffect(() => {
    if (currentStep === 2 && source === null) {
      setSource(
        serverType === MediaServerType.PLEX
          ? 'plex'
          : serverType === MediaServerType.JELLYFIN ||
              serverType === MediaServerType.EMBY
            ? 'jellyfin'
            : 'local'
      );
    }
  }, [currentStep, source, serverType]);

  const finishSetup = async () => {
    setIsUpdating(true);
    setFinishError(false);
    try {
      const response = await axios.post<{ initialized: boolean }>(
        '/api/v1/settings/initialize'
      );
      if (response.data.initialized) {
        await axios.post('/api/v1/settings/main', { locale });
        await mutate('/api/v1/settings/public');
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

  if (settings.currentSettings.initialized) {
    return <></>;
  }

  const sources: { key: Source; label: string }[] = [
    { key: 'plex', label: intl.formatMessage(messages.plex) },
    { key: 'jellyfin', label: intl.formatMessage(jellyfinName) },
    { key: 'navidrome', label: intl.formatMessage(messages.navidrome) },
    { key: 'local', label: intl.formatMessage(messages.local) },
  ];

  return (
    <AuthShell footer={false}>
      <PageTitle title={intl.formatMessage(messages.setup)} />
      <div className="sh-auth-card sh-auth-wide">
        <AppDataWarning />
        <nav aria-label={intl.formatMessage(messages.setup)}>
          <ol className="sh-steps">
            <SetupSteps
              stepNumber={1}
              description={intl.formatMessage(messages.stepOwner)}
              active={currentStep === 1}
              completed={currentStep > 1}
            />
            <SetupSteps
              stepNumber={2}
              description={intl.formatMessage(messages.stepSources)}
              active={currentStep === 2}
              completed={currentStep > 2}
            />
            <SetupSteps
              stepNumber={3}
              description={intl.formatMessage(messages.stepLidarr)}
              active={currentStep === 3}
              isLastStep
            />
          </ol>
        </nav>

        {currentStep === 1 && ownerChoice === null && (
          <div className="flex flex-col gap-[18px]">
            <h1>{intl.formatMessage(messages.welcome)}</h1>
            <p className="lede">{intl.formatMessage(messages.subtitle)}</p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="sh-btn plex"
                onClick={() => setOwnerChoice(MediaServerType.PLEX)}
                data-testid="setup-plex"
              >
                {intl.formatMessage(messages.configplex)}
              </button>
              <button
                type="button"
                className="sh-btn jellyfin"
                onClick={() => setOwnerChoice(MediaServerType.JELLYFIN)}
                data-testid="setup-jellyfin"
              >
                {intl.formatMessage(messages.configjellyfin)}
              </button>
              <button
                type="button"
                className="sh-btn min-h-[52px]"
                onClick={() => setOwnerChoice(MediaServerType.EMBY)}
                data-testid="setup-emby"
              >
                {intl.formatMessage(messages.configemby)}
              </button>
              <button
                type="button"
                className="sh-btn min-h-[52px]"
                onClick={() => setOwnerChoice('local')}
                data-testid="setup-local"
              >
                {intl.formatMessage(messages.configlocal)}
              </button>
            </div>
          </div>
        )}

        {currentStep === 1 && ownerChoice === 'local' && (
          <LocalAdminSetup
            onCancel={() => setOwnerChoice(null)}
            onCreated={async () => {
              const { data: me } = await axios.get('/api/v1/auth/me');
              await revalidate(me, false);
              await mutate('/api/v1/settings/public');
              setCurrentStep(2);
            }}
          />
        )}

        {currentStep === 1 &&
          ownerChoice !== null &&
          ownerChoice !== 'local' && (
            <SetupLogin
              serverType={ownerChoice}
              onCancel={() => setOwnerChoice(null)}
              onComplete={() => {
                mutate('/api/v1/settings/public');
                setCurrentStep(2);
              }}
            />
          )}

        {currentStep === 2 && (
          <div className="flex flex-col gap-[18px]">
            <h2 className="text-[22px] font-semibold">
              {intl.formatMessage(messages.sourcestitle)}
            </h2>
            <p className="lede">{intl.formatMessage(messages.sourcessub)}</p>
            <div
              className="sh-subnav-pills"
              role="group"
              aria-label={intl.formatMessage(messages.sourceLabel)}
            >
              {sources.map((item) => (
                <a
                  key={item.key}
                  href={`#${item.key}`}
                  role="button"
                  aria-current={source === item.key ? 'page' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    setSource(item.key);
                  }}
                >
                  {item.label}
                </a>
              ))}
            </div>
            {source === 'plex' && <SettingsPlex isSetupSettings />}
            {source === 'jellyfin' && <SettingsJellyfin isSetupSettings />}
            {source === 'navidrome' && <SettingsNavidrome isSetupSettings />}
            {source === 'local' && <SettingsLocal isSetupSettings />}
            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                className="sh-btn"
                onClick={() => setCurrentStep(3)}
              >
                {intl.formatMessage(messages.skip)}
              </button>
              <button
                type="button"
                className="sh-btn primary"
                onClick={() => setCurrentStep(3)}
                data-testid="setup-continue"
              >
                {intl.formatMessage(messages.continue)}
              </button>
            </div>
          </div>
        )}

        {currentStep === 3 && (
          <div className="flex flex-col gap-[18px]">
            <h2 className="text-[22px] font-semibold">
              {intl.formatMessage(messages.servicestitle)}
            </h2>
            <p className="lede">{intl.formatMessage(messages.servicessub)}</p>
            <SettingsLidarr isSetupSettings />
            {finishError && (
              <p className="sh-err" role="alert">
                {intl.formatMessage(messages.finisherror)}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                className="sh-btn"
                onClick={() => setCurrentStep(2)}
              >
                {intl.formatMessage(messages.back)}
              </button>
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
