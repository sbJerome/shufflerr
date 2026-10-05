// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: src/components/Settings/SettingsUsers/index.tsx at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import Field from '@app/components/Common/Field';
import Panel from '@app/components/Common/Panel';
import SwitchRow from '@app/components/Common/SwitchRow';
import PermissionEdit from '@app/components/PermissionEdit';
import {
  NumberInput,
  PanelError,
  SaveButton,
  SettingsPage,
  useSection,
} from '@app/components/Settings/shared';
import { useToasts } from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type { UsersSettingsResponse } from '@server/interfaces/api/settingsInterfaces';
import Link from 'next/link';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Settings.SettingsUsers', {
  title: 'Users',
  description: 'How people sign in, and what new users can do.',
  manageUsers: 'Manage users',
  signIn: 'Sign-in methods',
  signInSub: 'At least one has to stay on.',
  localLogin: 'Shufflerr accounts',
  localLoginTip: 'Email and password accounts you create on the Users page.',
  plexLogin: 'Plex sign-in',
  plexLoginTip: 'People sign in with the Plex account they listen with.',
  newPlexLogin: 'Let new Plex users sign in',
  newPlexLoginTip:
    'Anyone you’ve shared your Plex music with gets an account the first time.',
  jellyfinLogin: 'Jellyfin sign-in',
  jellyfinLoginTip: 'People sign in with their Jellyfin username and password.',
  newJellyfinLogin: 'Let new Jellyfin users sign in',
  newJellyfinLoginTip:
    'Creates an account for Jellyfin users the first time they sign in.',
  atLeastOne: 'At least one sign-in method has to stay on.',
  limits: 'Global request limits',
  limitsSub:
    'Applies to everyone without their own limits. People who can manage users have no limit.',
  albums: 'Albums',
  albumPeriod: 'Album period',
  tracks: 'Tracks',
  trackPeriod: 'Track period',
  zeroHint: '0 means no limit',
  days: '{days} days',
  discographyReview: 'Always review discography requests',
  discographyReviewTip:
    'Only admins skip the queue for whole discographies, even if a user can auto-approve.',
  defaultPermissions: 'Default permissions',
  defaultPermissionsSub:
    'What new users can do when they’re created or imported.',
  savePermissions: 'Save permissions',
  permissionsSaved: 'Default permissions saved.',
  limitsSaved: 'Request limits saved.',
});

const PERIODS = [7, 14, 30];

const SettingsUsers = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const section = useSection<UsersSettingsResponse>('/api/v1/settings/users');
  const { draft, set } = section;

  // Turning the last sign-in method off is refused before it reaches the server.
  const setMethod = (
    key: 'localLogin' | 'plexLogin' | 'jellyfinLogin',
    value: boolean
  ) => {
    if (!draft) {
      return;
    }
    const next = { ...draft, [key]: value };
    if (!next.localLogin && !next.plexLogin && !next.jellyfinLogin) {
      addToast(intl.formatMessage(messages.atLeastOne), {
        appearance: 'error',
      });
      return;
    }
    set(key, value);
  };

  const periodSelect = (p: object, path: string, value: number | undefined) => (
    <select
      {...p}
      value={value ?? 7}
      onChange={(e) => set(path, Number(e.target.value))}
    >
      {PERIODS.map((days) => (
        <option key={days} value={days}>
          {intl.formatMessage(messages.days, { days })}
        </option>
      ))}
    </select>
  );

  return (
    <SettingsPage
      title={intl.formatMessage(messages.title)}
      description={intl.formatMessage(messages.description)}
      loading={section.loading}
      loadError={section.loadError}
      actions={
        hasPermission(Permission.MANAGE_USERS) ? (
          <Link href="/users" className="sh-btn">
            {intl.formatMessage(messages.manageUsers)}
          </Link>
        ) : undefined
      }
    >
      {draft && (
        <>
          <Panel
            as="form"
            title={intl.formatMessage(messages.signIn)}
            sub={intl.formatMessage(messages.signInSub)}
            onSubmit={(e) => {
              e.preventDefault();
              section.save();
            }}
            actions={<SaveButton saving={section.saving} />}
          >
            <div className="sh-box">
              <SwitchRow
                label={intl.formatMessage(messages.localLogin)}
                description={intl.formatMessage(messages.localLoginTip)}
                checked={!!draft.localLogin}
                onChange={(v) => setMethod('localLogin', v)}
              />
              <SwitchRow
                label={intl.formatMessage(messages.plexLogin)}
                description={intl.formatMessage(messages.plexLoginTip)}
                checked={!!draft.plexLogin}
                onChange={(v) => setMethod('plexLogin', v)}
              />
              <SwitchRow
                label={intl.formatMessage(messages.newPlexLogin)}
                description={intl.formatMessage(messages.newPlexLoginTip)}
                checked={!!draft.newPlexLogin}
                disabled={!draft.plexLogin}
                onChange={(v) => set('newPlexLogin', v)}
              />
              <SwitchRow
                label={intl.formatMessage(messages.jellyfinLogin)}
                description={intl.formatMessage(messages.jellyfinLoginTip)}
                checked={!!draft.jellyfinLogin}
                onChange={(v) => setMethod('jellyfinLogin', v)}
              />
              <SwitchRow
                label={intl.formatMessage(messages.newJellyfinLogin)}
                description={intl.formatMessage(messages.newJellyfinLoginTip)}
                checked={!!draft.newJellyfinLogin}
                disabled={!draft.jellyfinLogin}
                onChange={(v) => set('newJellyfinLogin', v)}
              />
            </div>
            <PanelError message={section.saveError} />
          </Panel>

          <Panel
            as="form"
            title={intl.formatMessage(messages.limits)}
            sub={intl.formatMessage(messages.limitsSub)}
            onSubmit={(e) => {
              e.preventDefault();
              section.save({
                okMessage: intl.formatMessage(messages.limitsSaved),
              });
            }}
            actions={<SaveButton saving={section.saving} />}
          >
            <div className="sh-fields">
              <Field
                label={intl.formatMessage(messages.albums)}
                hint={intl.formatMessage(messages.zeroHint)}
              >
                {(p) => (
                  <NumberInput
                    {...p}
                    min={0}
                    value={draft.defaultQuotas?.album?.quotaLimit ?? 0}
                    onChange={(v) =>
                      set('defaultQuotas.album.quotaLimit', Math.max(0, v))
                    }
                  />
                )}
              </Field>
              <Field label={intl.formatMessage(messages.albumPeriod)}>
                {(p) =>
                  periodSelect(
                    p,
                    'defaultQuotas.album.quotaDays',
                    draft.defaultQuotas?.album?.quotaDays
                  )
                }
              </Field>
              <Field
                label={intl.formatMessage(messages.tracks)}
                hint={intl.formatMessage(messages.zeroHint)}
              >
                {(p) => (
                  <NumberInput
                    {...p}
                    min={0}
                    value={draft.defaultQuotas?.track?.quotaLimit ?? 0}
                    onChange={(v) =>
                      set('defaultQuotas.track.quotaLimit', Math.max(0, v))
                    }
                  />
                )}
              </Field>
              <Field label={intl.formatMessage(messages.trackPeriod)}>
                {(p) =>
                  periodSelect(
                    p,
                    'defaultQuotas.track.quotaDays',
                    draft.defaultQuotas?.track?.quotaDays
                  )
                }
              </Field>
            </div>
            <div className="sh-box">
              <SwitchRow
                label={intl.formatMessage(messages.discographyReview)}
                description={intl.formatMessage(messages.discographyReviewTip)}
                checked={!!draft.discographyAlwaysReview}
                onChange={(v) => set('discographyAlwaysReview', v)}
              />
            </div>
          </Panel>

          <Panel
            as="form"
            title={intl.formatMessage(messages.defaultPermissions)}
            sub={intl.formatMessage(messages.defaultPermissionsSub)}
            onSubmit={(e) => {
              e.preventDefault();
              section.save({
                okMessage: intl.formatMessage(messages.permissionsSaved),
              });
            }}
            actions={
              <SaveButton
                saving={section.saving}
                label={intl.formatMessage(messages.savePermissions)}
              />
            }
          >
            <PermissionEdit
              actingUser={user}
              currentPermission={draft.defaultPermissions ?? 0}
              onUpdate={(permissions) => set('defaultPermissions', permissions)}
            />
          </Panel>
        </>
      )}
    </SettingsPage>
  );
};

export default SettingsUsers;
