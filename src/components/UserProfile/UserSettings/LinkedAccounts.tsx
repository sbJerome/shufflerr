// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: src/components/UserProfile/UserSettings/UserLinkedAccountsSettings/index.tsx at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import Field from '@app/components/Common/Field';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import Panel from '@app/components/Common/Panel';
import {
  apiErrorMessage,
  useProfileUser,
} from '@app/components/UserProfile/shared';
import LinkJellyfinModal from '@app/components/UserProfile/UserSettings/UserLinkedAccountsSettings/LinkJellyfinModal';
import LinkJellyfinQuickConnectModal from '@app/components/UserProfile/UserSettings/UserLinkedAccountsSettings/LinkJellyfinQuickConnectModal';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import PlexOAuth from '@app/utils/plex';
import { loginMethods } from '@app/utils/publicSettings';
import type {
  LinkableProvider,
  LinkAuthorizeResponse,
  LinkedAccountStatus,
  UserSettingsLinkedAccountsResponse,
} from '@server/interfaces/api/userSettingsInterfaces';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages(
  'components.UserProfile.UserSettings.LinkedAccounts',
  {
    linkedAccounts: 'Linked accounts',
    subSelf: 'Accounts on other services that Shufflerr can use for you.',
    subOther: 'Accounts on other services that Shufflerr can use for {name}.',
    purposePlex: 'Sign in and see what you’ve played on Plex',
    purposeJellyfin: 'Sign in and see what you’ve played on {server}',
    purposeLastfm:
      'Scrobble everything you play in Shufflerr and connected apps',
    purposeListenbrainz: 'Scrobble to ListenBrainz with your user token',
    purposeSpotify: 'Import your playlists and saved albums as requests',
    linkedAs: 'Linked as {username}',
    linked: 'Linked',
    link: 'Link {service}',
    linking: 'Opening {service}…',
    unlink: 'Unlink',
    unlinkLabel: 'Unlink {service}',
    usedToSignIn: 'Used to sign in',
    none: 'No services can be linked yet. An admin can turn them on in Settings.',
    onlyOwn: 'Only {name} can link this',
    toastLinked: 'Linked {service}.',
    toastUnlinked: 'Unlinked {service}.',
    unlinkError: '{service} wasn’t unlinked. Try again.',
    linkError:
      '{service} wasn’t linked. Try again, and check with an admin if it keeps failing.',
    plexUnauthorized: 'Plex didn’t accept that sign-in. Try again.',
    alreadyLinked:
      'That {service} account is already linked to another Shufflerr account.',
    lbTitle: 'Link ListenBrainz',
    lbToken: 'ListenBrainz user token',
    lbHint: 'Copy it from listenbrainz.org → Settings → User token.',
    lbTokenRequired: 'Paste your ListenBrainz user token.',
    lbInvalid:
      'ListenBrainz didn’t accept that token. Copy it again from your ListenBrainz settings.',
    lbLink: 'Link ListenBrainz',
    lbLinking: 'Checking token…',
    cancel: 'Cancel',
    loadError: 'This page didn’t load. Reload to try again.',
  }
);

const plexOAuth = new PlexOAuth();

const TILES: Record<LinkableProvider, { text: string; color: string }> = {
  plex: { text: 'Px', color: '#E5A00D' },
  jellyfin: { text: 'Jf', color: '#7B5CD6' },
  lastfm: { text: 'fm', color: '#D51007' },
  listenbrainz: { text: 'LB', color: '#EB743B' },
  spotify: { text: 'Sp', color: '#1DB954' },
};

const ORDER: LinkableProvider[] = [
  'plex',
  'jellyfin',
  'lastfm',
  'listenbrainz',
  'spotify',
];

const LinkedAccounts = () => {
  const intl = useIntl();
  const router = useRouter();
  const { addToast } = useToasts();
  const { currentSettings } = useSettings();
  const { user, isSelf, base, revalidate } = useProfileUser();
  const { data, error, mutate } = useSWR<UserSettingsLinkedAccountsResponse>(
    user ? `/api/v1/user/${user.id}/settings/linked-accounts` : null
  );
  const [busy, setBusy] = useState<LinkableProvider | null>(null);
  const [jellyfinModal, setJellyfinModal] = useState<
    'password' | 'quickconnect' | null
  >(null);
  const [lbOpen, setLbOpen] = useState(false);
  const [lbToken, setLbToken] = useState('');
  const [lbError, setLbError] = useState<string>();
  const handledReturn = useRef(false);

  const jellyfinName = loginMethods(currentSettings).jellyfinName;
  const serviceName = (provider: LinkableProvider): string =>
    ({
      plex: 'Plex',
      jellyfin: jellyfinName,
      lastfm: 'Last.fm',
      listenbrainz: 'ListenBrainz',
      spotify: 'Spotify',
    })[provider];

  // Back from /api/v1/callback/<provider>: ?linked=<provider> or ?error=<message>.
  useEffect(() => {
    if (!router.isReady || handledReturn.current) {
      return;
    }
    const { linked, error: returnError } = router.query;
    if (!linked && !returnError) {
      return;
    }
    handledReturn.current = true;
    if (typeof returnError === 'string' && returnError) {
      addToast(returnError, { appearance: 'error' });
    } else if (typeof linked === 'string' && linked in TILES) {
      addToast(
        intl.formatMessage(messages.toastLinked, {
          service: serviceName(linked as LinkableProvider),
        }),
        { appearance: 'success' }
      );
    }
    router.replace(`${base}/settings/linked-accounts`, undefined, {
      shallow: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query]);

  if (!user) {
    return null;
  }

  const afterLink = async (provider: LinkableProvider) => {
    await mutate();
    revalidate();
    addToast(
      intl.formatMessage(messages.toastLinked, {
        service: serviceName(provider),
      }),
      { appearance: 'success' }
    );
  };

  const linkFailed = (provider: LinkableProvider, e: unknown) => {
    const status = (e as { response?: { status?: number } })?.response?.status;
    const service = serviceName(provider);
    let fallback = intl.formatMessage(messages.linkError, { service });
    if (status === 422 || status === 409) {
      fallback = intl.formatMessage(messages.alreadyLinked, { service });
    } else if (status === 401 && provider === 'plex') {
      fallback = intl.formatMessage(messages.plexUnauthorized);
    }
    addToast(apiErrorMessage(e, fallback), { appearance: 'error' });
  };

  const linkPlex = async () => {
    setBusy('plex');
    try {
      const authToken = await plexOAuth.login(
        currentSettings.plexClientIdentifier
      );
      await axios.post(
        `/api/v1/user/${user.id}/settings/linked-accounts/plex`,
        {
          authToken,
        }
      );
      await afterLink('plex');
    } catch (e) {
      linkFailed('plex', e);
    } finally {
      setBusy(null);
    }
  };

  const linkOauth = async (provider: 'lastfm' | 'spotify') => {
    setBusy(provider);
    try {
      const { data: authorize } = await axios.get<LinkAuthorizeResponse>(
        `/api/v1/user/${user.id}/settings/linked-accounts/${provider}/authorize`
      );
      window.location.assign(authorize.url);
    } catch (e) {
      linkFailed(provider, e);
      setBusy(null);
    }
  };

  const linkListenbrainz = async () => {
    if (!lbToken.trim()) {
      setLbError(intl.formatMessage(messages.lbTokenRequired));
      return;
    }
    setBusy('listenbrainz');
    setLbError(undefined);
    try {
      await axios.post(
        `/api/v1/user/${user.id}/settings/linked-accounts/listenbrainz`,
        { token: lbToken.trim() }
      );
      setLbOpen(false);
      setLbToken('');
      await afterLink('listenbrainz');
    } catch (e) {
      setLbError(apiErrorMessage(e, intl.formatMessage(messages.lbInvalid)));
    } finally {
      setBusy(null);
    }
  };

  const startLink = (account: LinkedAccountStatus) => {
    switch (account.provider) {
      case 'plex':
        // Open the popup inside the click handler so browsers don't block it.
        plexOAuth.preparePopup();
        setTimeout(() => linkPlex(), 1500);
        break;
      case 'jellyfin':
        setJellyfinModal('password');
        break;
      case 'listenbrainz':
        setLbError(undefined);
        setLbOpen(true);
        break;
      case 'lastfm':
      case 'spotify':
        linkOauth(account.provider);
        break;
    }
  };

  const unlink = async (account: LinkedAccountStatus) => {
    const service = serviceName(account.provider);
    setBusy(account.provider);
    try {
      await axios.delete(
        `/api/v1/user/${user.id}/settings/linked-accounts/${account.provider}`
      );
      await mutate();
      revalidate();
      addToast(intl.formatMessage(messages.toastUnlinked, { service }), {
        appearance: 'success',
      });
    } catch (e) {
      addToast(
        apiErrorMessage(
          e,
          intl.formatMessage(messages.unlinkError, { service })
        ),
        { appearance: 'error' }
      );
    } finally {
      setBusy(null);
    }
  };

  const purpose = (provider: LinkableProvider): string => {
    switch (provider) {
      case 'plex':
        return intl.formatMessage(messages.purposePlex);
      case 'jellyfin':
        return intl.formatMessage(messages.purposeJellyfin, {
          server: jellyfinName,
        });
      case 'lastfm':
        return intl.formatMessage(messages.purposeLastfm);
      case 'listenbrainz':
        return intl.formatMessage(messages.purposeListenbrainz);
      case 'spotify':
        return intl.formatMessage(messages.purposeSpotify);
    }
  };

  const rows = (data?.accounts ?? [])
    .filter((a) => a.available && ORDER.includes(a.provider))
    .sort((a, b) => ORDER.indexOf(a.provider) - ORDER.indexOf(b.provider));

  return (
    <Panel
      title={intl.formatMessage(messages.linkedAccounts)}
      sub={
        isSelf
          ? intl.formatMessage(messages.subSelf)
          : intl.formatMessage(messages.subOther, { name: user.displayName })
      }
    >
      {error && !data ? (
        <p role="alert" className="m-0 text-st-declined">
          {intl.formatMessage(messages.loadError)}
        </p>
      ) : !data ? (
        <LoadingSpinner />
      ) : rows.length === 0 ? (
        <p className="sh-sub m-0">{intl.formatMessage(messages.none)}</p>
      ) : (
        <div className="sh-box">
          {rows.map((account) => {
            const service = serviceName(account.provider);
            const tile = TILES[account.provider];
            return (
              <div className="sh-linked" key={account.provider}>
                <span
                  className="sh-logo"
                  style={{ background: tile.color }}
                  aria-hidden="true"
                >
                  {account.provider === 'jellyfin' && jellyfinName === 'Emby'
                    ? 'Em'
                    : tile.text}
                </span>
                <div className="grow">
                  <b>{service}</b>
                  <span className="sh-feat">
                    {account.linked
                      ? account.externalUsername
                        ? intl.formatMessage(messages.linkedAs, {
                            username: account.externalUsername,
                          })
                        : intl.formatMessage(messages.linked)
                      : purpose(account.provider)}
                  </span>
                </div>
                {account.linked ? (
                  <button
                    type="button"
                    className="sh-btn small"
                    disabled={!account.canUnlink || busy === account.provider}
                    title={
                      account.canUnlink
                        ? undefined
                        : intl.formatMessage(messages.usedToSignIn)
                    }
                    aria-label={intl.formatMessage(messages.unlinkLabel, {
                      service,
                    })}
                    onClick={() => unlink(account)}
                  >
                    {intl.formatMessage(messages.unlink)}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="sh-btn small ghost-accent"
                    disabled={!isSelf || busy === account.provider}
                    title={
                      isSelf
                        ? undefined
                        : intl.formatMessage(messages.onlyOwn, {
                            name: user.displayName,
                          })
                    }
                    onClick={() => startLink(account)}
                  >
                    {busy === account.provider &&
                    account.provider !== 'listenbrainz'
                      ? intl.formatMessage(messages.linking, { service })
                      : intl.formatMessage(messages.link, { service })}
                  </button>
                )}
                {account.linked && !account.canUnlink && (
                  <span className="sh-feat w-full">
                    {intl.formatMessage(messages.usedToSignIn)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {lbOpen && (
        <Modal
          title={intl.formatMessage(messages.lbTitle)}
          onCancel={() => setLbOpen(false)}
          cancelText={intl.formatMessage(messages.cancel)}
          onOk={linkListenbrainz}
          okText={intl.formatMessage(
            busy === 'listenbrainz' ? messages.lbLinking : messages.lbLink
          )}
          okButtonType="primary"
          okDisabled={busy === 'listenbrainz'}
        >
          <Field
            label={intl.formatMessage(messages.lbToken)}
            hint={intl.formatMessage(messages.lbHint)}
            error={lbError}
          >
            {(p) => (
              <input
                {...p}
                type="password"
                autoComplete="off"
                value={lbToken}
                onChange={(e) => setLbToken(e.target.value)}
              />
            )}
          </Field>
        </Modal>
      )}

      <LinkJellyfinModal
        show={jellyfinModal === 'password'}
        onClose={() => setJellyfinModal(null)}
        onSave={() => {
          setJellyfinModal(null);
          afterLink('jellyfin');
        }}
        onSwitchToQuickConnect={() => setJellyfinModal('quickconnect')}
      />
      <LinkJellyfinQuickConnectModal
        show={jellyfinModal === 'quickconnect'}
        onClose={() => setJellyfinModal(null)}
        onSave={() => {
          setJellyfinModal(null);
          afterLink('jellyfin');
        }}
        onSwitchToPassword={() => setJellyfinModal('password')}
      />
    </Panel>
  );
};

export default LinkedAccounts;
