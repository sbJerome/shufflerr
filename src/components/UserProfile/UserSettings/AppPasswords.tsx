import Button from '@app/components/Common/Button';
import Field from '@app/components/Common/Field';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Panel from '@app/components/Common/Panel';
import {
  apiErrorMessage,
  timeAgo,
  useProfileUser,
} from '@app/components/UserProfile/shared';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type {
  AppPasswordCreatedResponse,
  AppPasswordItem,
  UserSettingsAppPasswordsResponse,
} from '@server/interfaces/api/userSettingsInterfaces';
import axios from 'axios';
import copy from 'copy-to-clipboard';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages(
  'components.UserProfile.UserSettings.AppPasswords',
  {
    appPasswords: 'App passwords',
    description:
      'Use these to sign in from music apps like Symfonium, Finamp, Feishin, Amperfy and Jellify. Each app gets its own password so you can revoke one without changing the others.',
    apisOff:
      'The app APIs are switched off right now. An admin can turn them on in Settings → Apps and devices.',
    server: 'Server',
    username: 'Username',
    copy: 'Copy',
    copyServer: 'Copy server URL',
    copyUsername: 'Copy username',
    copied: 'Copied.',
    none: 'No app passwords yet.',
    created: 'Created {date}, last used {last}',
    createdNever: 'Created {date}, not used yet',
    createdWith: 'Created {date}, last used {last} by {client}',
    revoke: 'Revoke',
    revokeLabel: 'Revoke {name}',
    revoked: 'Revoked {name}. Apps using it are signed out.',
    revokeError: '{name} wasn’t revoked. Try again.',
    newName: 'New app password name',
    newNamePlaceholder: 'For example: Finamp on my phone',
    create: 'Create password',
    creating: 'Creating…',
    errorName: 'Give the password a name so you can recognise it later.',
    createError: 'The password wasn’t created. Try again.',
    createdBox:
      'Password for {name}: {password}. Copy it now, it won’t be shown again.',
    copyPassword: 'Copy password',
    onlyOwn:
      'Only {name} can create app passwords. You can revoke the ones listed here.',
    loadError: 'This page didn’t load. Reload to try again.',
  }
);

const AppPasswords = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, isSelf } = useProfileUser();
  const { data, error, mutate } = useSWR<UserSettingsAppPasswordsResponse>(
    user ? `/api/v1/user/${user.id}/settings/app-passwords` : null
  );
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<AppPasswordCreatedResponse | null>(
    null
  );
  const [revoking, setRevoking] = useState<number | null>(null);

  if (!user) {
    return null;
  }
  if (error && !data) {
    return (
      <Panel title={intl.formatMessage(messages.appPasswords)}>
        <p role="alert" className="m-0 text-st-declined">
          {intl.formatMessage(messages.loadError)}
        </p>
      </Panel>
    );
  }
  if (!data) {
    return <LoadingSpinner />;
  }

  const copyValue = (value: string) => {
    copy(value);
    addToast(intl.formatMessage(messages.copied), { appearance: 'success' });
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError(intl.formatMessage(messages.errorName));
      return;
    }
    setNameError(undefined);
    setCreating(true);
    try {
      const { data: result } = await axios.post<AppPasswordCreatedResponse>(
        `/api/v1/user/${user.id}/settings/app-passwords`,
        { name: name.trim() }
      );
      setCreated(result);
      setName('');
      mutate();
    } catch (err) {
      setNameError(
        apiErrorMessage(err, intl.formatMessage(messages.createError))
      );
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (item: AppPasswordItem) => {
    setRevoking(item.id);
    try {
      await axios.delete(
        `/api/v1/user/${user.id}/settings/app-passwords/${item.id}`
      );
      if (created?.id === item.id) {
        setCreated(null);
      }
      addToast(intl.formatMessage(messages.revoked, { name: item.name }), {
        appearance: 'success',
      });
      mutate();
    } catch (err) {
      addToast(
        apiErrorMessage(
          err,
          intl.formatMessage(messages.revokeError, { name: item.name })
        ),
        { appearance: 'error' }
      );
    } finally {
      setRevoking(null);
    }
  };

  const describe = (item: AppPasswordItem) => {
    const date = intl.formatDate(item.createdAt, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    if (!item.lastUsedAt) {
      return intl.formatMessage(messages.createdNever, { date });
    }
    const last = timeAgo(item.lastUsedAt, intl.locale);
    return item.lastUsedClient
      ? intl.formatMessage(messages.createdWith, {
          date,
          last,
          client: item.lastUsedClient,
        })
      : intl.formatMessage(messages.created, { date, last });
  };

  return (
    <Panel
      title={intl.formatMessage(messages.appPasswords)}
      sub={intl.formatMessage(messages.description)}
    >
      {!data.openSubsonicEnabled && !data.jellyfinApiEnabled && (
        <p className="sh-sub m-0" role="status">
          {intl.formatMessage(messages.apisOff)}
        </p>
      )}
      <div className="sh-endpoint">
        <span className="sh-feat">{intl.formatMessage(messages.server)}</span>
        <b className="min-w-0 flex-1">{data.serverUrl}</b>
        <button
          type="button"
          className="sh-btn small"
          aria-label={intl.formatMessage(messages.copyServer)}
          onClick={() => copyValue(data.serverUrl)}
        >
          {intl.formatMessage(messages.copy)}
        </button>
      </div>
      <div className="sh-endpoint">
        <span className="sh-feat">{intl.formatMessage(messages.username)}</span>
        <b className="min-w-0 flex-1">{data.username}</b>
        <button
          type="button"
          className="sh-btn small"
          aria-label={intl.formatMessage(messages.copyUsername)}
          onClick={() => copyValue(data.username)}
        >
          {intl.formatMessage(messages.copy)}
        </button>
      </div>

      {data.passwords.length > 0 ? (
        <div className="sh-box">
          {data.passwords.map((item) => (
            <div className="sh-linked" key={item.id}>
              <div className="grow">
                <b>{item.name}</b>
                <span className="sh-feat">{describe(item)}</span>
              </div>
              <button
                type="button"
                className="sh-btn small no"
                disabled={revoking === item.id}
                aria-label={intl.formatMessage(messages.revokeLabel, {
                  name: item.name,
                })}
                onClick={() => revoke(item)}
              >
                {intl.formatMessage(messages.revoke)}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="sh-sub m-0">{intl.formatMessage(messages.none)}</p>
      )}

      {isSelf ? (
        <form className="sh-inline items-end" onSubmit={create} noValidate>
          <div className="min-w-[240px] flex-1">
            <Field
              label={intl.formatMessage(messages.newName)}
              error={nameError}
            >
              {(p) => (
                <input
                  {...p}
                  type="text"
                  autoComplete="off"
                  placeholder={intl.formatMessage(messages.newNamePlaceholder)}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Button type="submit" disabled={creating}>
            {intl.formatMessage(creating ? messages.creating : messages.create)}
          </Button>
        </form>
      ) : (
        <p className="sh-sub m-0">
          {intl.formatMessage(messages.onlyOwn, { name: user.displayName })}
        </p>
      )}

      {created && (
        <div className="sh-outcome auto" role="status">
          <span className="min-w-0 flex-1 break-words">
            {intl.formatMessage(messages.createdBox, {
              name: created.name,
              password: (
                <b key="pw" className="font-mono">
                  {created.password}
                </b>
              ),
            })}
          </span>
          <button
            type="button"
            className="sh-btn small"
            onClick={() => copyValue(created.password)}
          >
            {intl.formatMessage(messages.copyPassword)}
          </button>
        </div>
      )}
    </Panel>
  );
};

export default AppPasswords;
