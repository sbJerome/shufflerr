// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: src/components/UserProfile/UserSettings/UserGeneralSettings/index.tsx at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import Button from '@app/components/Common/Button';
import Field from '@app/components/Common/Field';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Panel from '@app/components/Common/Panel';
import RoleBadge from '@app/components/Common/RoleBadge';
import SwitchRow from '@app/components/Common/SwitchRow';
import { accountTypeMessage } from '@app/components/Layout/AccountMenu';
import {
  apiErrorMessage,
  useProfileUser,
} from '@app/components/UserProfile/shared';
import { availableLanguages } from '@app/context/LanguageContext';
import useLocale from '@app/hooks/useLocale';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { Permission } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type {
  UserSettingsGeneralResponse,
  UserSettingsLinkedAccountsResponse,
} from '@server/interfaces/api/userSettingsInterfaces';
import { hasPermission } from '@server/lib/permissions';
import type { AvailableLocale } from '@server/types/languages';
import axios from 'axios';
import { countries } from 'country-flag-icons';
import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import validator from 'validator';

const messages = defineMessages('components.UserProfile.UserSettings.General', {
  general: 'General',
  displayName: 'Display name',
  email: 'Email',
  accountType: 'Account type',
  role: 'Role',
  displayLanguage: 'Display language',
  languageDefault: 'Server default ({language})',
  discoverRegion: 'Discover region',
  discoverRegionHint: 'Trending, charts and concerts for this country',
  regionDefault: 'Server default ({region})',
  regionDefaultNone: 'Server default',
  spotifyAuto: 'Request albums I save on Spotify',
  spotifyAutoDescription:
    'Checks your Spotify saved albums every day and requests new ones.',
  save: 'Save changes',
  saving: 'Saving…',
  saved: 'Settings saved.',
  errorEmail: 'Enter a valid email address.',
  errorUnknown: 'The settings weren’t saved. Try again.',
  loadError: 'This page didn’t load. Reload to try again.',
  limits: 'Request limits',
  limitsSub:
    'Without an override, this user follows the global limits in Settings → Users. People who can manage users have no limit.',
  override: 'Override the global limits',
  albums: 'Albums',
  albumsHint: '0 means no limit',
  albumPeriod: 'Album period',
  tracks: 'Tracks',
  tracksHint: '0 means no limit',
  trackPeriod: 'Track period',
  everyDays: 'Every {days} days',
  globalNow:
    'Global limits right now: {albums} per {albumDays} days, {tracks} per {trackDays} days.',
  globalAlbums:
    '{count, plural, =0 {unlimited albums} one {# album} other {# albums}}',
  globalTracks:
    '{count, plural, =0 {unlimited tracks} one {# track} other {# tracks}}',
  saveLimits: 'Save limits',
  savedLimits: 'Saved request limits.',
  errorLimits: 'Limits need to be whole numbers, 0 or higher.',
});

const PERIODS = [7, 14, 30];

const General = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { locale: activeLocale, setLocale } = useLocale();
  const { currentSettings } = useSettings();
  const { user, isSelf, revalidate, currentHasPermission } = useProfileUser();
  const { data, error, mutate } = useSWR<UserSettingsGeneralResponse>(
    user ? `/api/v1/user/${user.id}/settings/main` : null,
    { revalidateOnFocus: false }
  );
  const { data: linked } = useSWR<UserSettingsLinkedAccountsResponse>(
    user ? `/api/v1/user/${user.id}/settings/linked-accounts` : null,
    { revalidateOnFocus: false }
  );

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [locale, setLocaleValue] = useState('');
  const [region, setRegion] = useState('');
  const [autoSpotify, setAutoSpotify] = useState(false);
  const [emailError, setEmailError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const [override, setOverride] = useState(false);
  const [albumLimit, setAlbumLimit] = useState('0');
  const [albumDays, setAlbumDays] = useState(7);
  const [trackLimit, setTrackLimit] = useState('0');
  const [trackDays, setTrackDays] = useState(7);
  const [limitError, setLimitError] = useState<string>();
  const [savingLimits, setSavingLimits] = useState(false);

  useEffect(() => {
    if (!data) {
      return;
    }
    setUsername(data.username ?? '');
    setEmail(data.email ?? '');
    setLocaleValue(data.locale ?? '');
    setRegion(data.discoverRegion ?? '');
    setAutoSpotify(!!data.autoRequestSpotifySaved);
    const hasOverride =
      data.albumQuotaLimit != null ||
      data.albumQuotaDays != null ||
      data.trackQuotaLimit != null ||
      data.trackQuotaDays != null;
    setOverride(hasOverride);
    setAlbumLimit(
      String(data.albumQuotaLimit ?? data.globalAlbumQuotaLimit ?? 0)
    );
    setAlbumDays(data.albumQuotaDays ?? data.globalAlbumQuotaDays ?? 7);
    setTrackLimit(
      String(data.trackQuotaLimit ?? data.globalTrackQuotaLimit ?? 0)
    );
    setTrackDays(data.trackQuotaDays ?? data.globalTrackQuotaDays ?? 7);
  }, [data]);

  const regionNames = useMemo(() => {
    let display: Intl.DisplayNames | undefined;
    try {
      display = new Intl.DisplayNames([intl.locale], { type: 'region' });
    } catch {
      display = undefined;
    }
    return countries
      .map((code) => ({ code, name: display?.of(code) ?? code }))
      .filter((c) => c.name && c.name !== c.code)
      .sort((a, b) => a.name.localeCompare(b.name, intl.locale));
  }, [intl.locale]);

  if (!user) {
    return null;
  }
  if (error && !data) {
    return (
      <Panel title={intl.formatMessage(messages.general)}>
        <p role="alert" className="m-0 text-st-declined">
          {intl.formatMessage(messages.loadError)}
        </p>
      </Panel>
    );
  }
  if (!data) {
    return <LoadingSpinner />;
  }

  const canManageUsers = currentHasPermission(Permission.MANAGE_USERS);
  const spotify = linked?.accounts.find((a) => a.provider === 'spotify');
  const showSpotify =
    !!spotify?.available &&
    !!spotify.linked &&
    hasPermission(
      [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_ALBUM],
      user.permissions,
      { type: 'or' }
    );

  const serverLanguage =
    availableLanguages[currentSettings.locale]?.display ??
    currentSettings.locale;
  const serverRegion = currentSettings.discoverRegion
    ? (regionNames.find((r) => r.code === currentSettings.discoverRegion)
        ?.name ?? currentSettings.discoverRegion)
    : undefined;

  const quotaBody = (): Partial<UserSettingsGeneralResponse> =>
    override
      ? {
          albumQuotaLimit: Number(albumLimit),
          albumQuotaDays: albumDays,
          trackQuotaLimit: Number(trackLimit),
          trackQuotaDays: trackDays,
        }
      : {
          albumQuotaLimit: null,
          albumQuotaDays: null,
          trackQuotaLimit: null,
          trackQuotaDays: null,
        };

  const generalBody = (): Partial<UserSettingsGeneralResponse> => ({
    username: username.trim(),
    email: email.trim(),
    locale,
    discoverRegion: region,
    autoRequestSpotifySaved: autoSpotify,
    scrobbleEnabled: data.scrobbleEnabled,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validator.isEmail(email.trim())) {
      setEmailError(intl.formatMessage(messages.errorEmail));
      return;
    }
    setEmailError(undefined);
    setSaving(true);
    try {
      const { data: saved } = await axios.post<UserSettingsGeneralResponse>(
        `/api/v1/user/${user.id}/settings/main`,
        generalBody()
      );
      mutate(saved, false);
      revalidate();
      if (isSelf && setLocale) {
        setLocale(
          ((saved.locale || currentSettings.locale) as AvailableLocale) ??
            activeLocale
        );
      }
      addToast(intl.formatMessage(messages.saved), { appearance: 'success' });
    } catch (err) {
      const message = apiErrorMessage(
        err,
        intl.formatMessage(messages.errorUnknown)
      );
      if (/email/i.test(message)) {
        setEmailError(message);
      } else {
        addToast(message, { appearance: 'error' });
      }
    } finally {
      setSaving(false);
    }
  };

  const submitLimits = async (e: React.FormEvent) => {
    e.preventDefault();
    const valid = (v: string) => /^\d+$/.test(v.trim());
    if (override && (!valid(albumLimit) || !valid(trackLimit))) {
      setLimitError(intl.formatMessage(messages.errorLimits));
      return;
    }
    setLimitError(undefined);
    setSavingLimits(true);
    try {
      const { data: saved } = await axios.post<UserSettingsGeneralResponse>(
        `/api/v1/user/${user.id}/settings/main`,
        {
          // Keep what is stored for the other panel; only limits change here.
          username: data.username,
          email: data.email,
          locale: data.locale,
          discoverRegion: data.discoverRegion,
          autoRequestSpotifySaved: data.autoRequestSpotifySaved,
          scrobbleEnabled: data.scrobbleEnabled,
          ...quotaBody(),
        }
      );
      mutate(saved, false);
      addToast(intl.formatMessage(messages.savedLimits), {
        appearance: 'success',
      });
    } catch (err) {
      addToast(
        apiErrorMessage(err, intl.formatMessage(messages.errorUnknown)),
        { appearance: 'error' }
      );
    } finally {
      setSavingLimits(false);
    }
  };

  const periodSelect = (
    p: { id: string },
    value: number,
    onChange: (v: number) => void
  ) => (
    <select
      {...p}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {(PERIODS.includes(value) ? PERIODS : [...PERIODS, value]).map((d) => (
        <option key={d} value={d}>
          {intl.formatMessage(messages.everyDays, { days: d })}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <Panel
        as="form"
        onSubmit={submit}
        title={intl.formatMessage(messages.general)}
        actions={
          <Button buttonType="primary" type="submit" disabled={saving}>
            {intl.formatMessage(saving ? messages.saving : messages.save)}
          </Button>
        }
      >
        <div className="sh-fields">
          <Field label={intl.formatMessage(messages.displayName)}>
            {(p) => (
              <input
                {...p}
                type="text"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            )}
          </Field>
          <Field label={intl.formatMessage(messages.email)} error={emailError}>
            {(p) => (
              <input
                {...p}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label={intl.formatMessage(messages.accountType)}>
            {(p) => (
              <input
                {...p}
                type="text"
                readOnly
                value={intl.formatMessage(accountTypeMessage(user.userType))}
              />
            )}
          </Field>
          <Field label={intl.formatMessage(messages.role)}>
            <div className="flex min-h-[46px] items-center">
              <RoleBadge user={user} />
            </div>
          </Field>
          <Field label={intl.formatMessage(messages.displayLanguage)}>
            {(p) => (
              <select
                {...p}
                value={locale}
                onChange={(e) => setLocaleValue(e.target.value)}
              >
                <option value="">
                  {intl.formatMessage(messages.languageDefault, {
                    language: serverLanguage,
                  })}
                </option>
                {Object.values(availableLanguages)
                  .sort((a, b) => a.display.localeCompare(b.display))
                  .map((l) => (
                    <option key={l.code} value={l.code} lang={l.code}>
                      {l.display}
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <Field
            label={intl.formatMessage(messages.discoverRegion)}
            hint={intl.formatMessage(messages.discoverRegionHint)}
          >
            {(p) => (
              <select
                {...p}
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              >
                <option value="">
                  {serverRegion
                    ? intl.formatMessage(messages.regionDefault, {
                        region: serverRegion,
                      })
                    : intl.formatMessage(messages.regionDefaultNone)}
                </option>
                {regionNames.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {showSpotify && (
          <div className="sh-box">
            <SwitchRow
              label={intl.formatMessage(messages.spotifyAuto)}
              description={intl.formatMessage(messages.spotifyAutoDescription)}
              checked={autoSpotify}
              onChange={setAutoSpotify}
            />
          </div>
        )}
      </Panel>

      {canManageUsers && (
        <Panel
          as="form"
          onSubmit={submitLimits}
          title={intl.formatMessage(messages.limits)}
          sub={intl.formatMessage(messages.limitsSub)}
          actions={
            <Button buttonType="primary" type="submit" disabled={savingLimits}>
              {intl.formatMessage(
                savingLimits ? messages.saving : messages.saveLimits
              )}
            </Button>
          }
        >
          <label className="sh-check">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
            />{' '}
            {intl.formatMessage(messages.override)}
          </label>
          {override ? (
            <div className="sh-fields">
              <Field
                label={intl.formatMessage(messages.albums)}
                hint={intl.formatMessage(messages.albumsHint)}
                error={limitError}
              >
                {(p) => (
                  <input
                    {...p}
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={albumLimit}
                    onChange={(e) => setAlbumLimit(e.target.value)}
                  />
                )}
              </Field>
              <Field label={intl.formatMessage(messages.albumPeriod)}>
                {(p) => periodSelect(p, albumDays, setAlbumDays)}
              </Field>
              <Field
                label={intl.formatMessage(messages.tracks)}
                hint={intl.formatMessage(messages.tracksHint)}
              >
                {(p) => (
                  <input
                    {...p}
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={trackLimit}
                    onChange={(e) => setTrackLimit(e.target.value)}
                  />
                )}
              </Field>
              <Field label={intl.formatMessage(messages.trackPeriod)}>
                {(p) => periodSelect(p, trackDays, setTrackDays)}
              </Field>
            </div>
          ) : (
            data.globalAlbumQuotaLimit !== undefined && (
              <p className="sh-sub m-0">
                {intl.formatMessage(messages.globalNow, {
                  albums: intl.formatMessage(messages.globalAlbums, {
                    count: data.globalAlbumQuotaLimit ?? 0,
                  }),
                  albumDays: data.globalAlbumQuotaDays ?? 7,
                  tracks: intl.formatMessage(messages.globalTracks, {
                    count: data.globalTrackQuotaLimit ?? 0,
                  }),
                  trackDays: data.globalTrackQuotaDays ?? 7,
                })}
              </p>
            )
          )}
        </Panel>
      )}
    </>
  );
};

export default General;
