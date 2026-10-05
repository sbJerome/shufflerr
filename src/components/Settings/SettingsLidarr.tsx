// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: src/components/Settings/SettingsServices.tsx at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import EmptyState from '@app/components/Common/EmptyState';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageHeader from '@app/components/Common/PageHeader';
import StatusDot from '@app/components/Common/StatusDot';
import LidarrModal from '@app/components/Settings/LidarrModal';
import { apiMessage } from '@app/components/Settings/shared';
import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type { LidarrTestResponse } from '@server/interfaces/api/serviceInterfaces';
import type { LidarrSettingsResponse } from '@server/interfaces/api/settingsInterfaces';
import type { LidarrSettings } from '@server/lib/settings';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate as globalMutate } from 'swr';

const messages = defineMessages('components.Settings.SettingsLidarr', {
  title: 'Lidarr',
  description:
    'Approved requests are sent to Lidarr, which finds and downloads them.',
  add: 'Add Lidarr server',
  defaultTag: 'Default',
  hiResTag: 'Hi-res',
  quality: 'Quality',
  metadata: 'Metadata profile',
  folder: 'Folder',
  connection: 'Connection',
  connected: 'Connected',
  connectedVersion: 'Connected · Lidarr {version}',
  notConnected: 'Not connected',
  checking: 'Checking…',
  test: 'Test',
  testing: 'Testing…',
  edit: 'Edit',
  remove: 'Remove',
  testLabel: 'Test {name}',
  editLabel: 'Edit {name}',
  removeLabel: 'Remove {name}',
  testOk: 'Connected to {name}.',
  testFailed:
    'Shufflerr couldn’t reach {name}. Check the address and API key in Edit.',
  removeTitle: 'Remove {name}?',
  removeBody:
    'Shufflerr stops sending requests to {name}. Nothing is deleted in Lidarr.',
  removeOk: 'Remove server',
  removed: 'Removed {name}.',
  removeFailed: 'The server couldn’t be removed. Try again.',
  emptyTitle: 'No Lidarr server yet',
  emptyBody:
    'Add your Lidarr server so approved requests have somewhere to go.',
  loadFailed:
    'Lidarr servers couldn’t be loaded. Check that the server is running, then reload the page.',
  noDefault:
    'No server is marked as default. Edit a server and turn on “Default server”, or requests can’t be sent.',
  cancel: 'Cancel',
});

type ServerRow = LidarrSettingsResponse[number];

interface SettingsLidarrProps {
  /** Embedded in the setup wizard: no page header. */
  isSetupSettings?: boolean;
}

const SettingsLidarr = ({ isSetupSettings }: SettingsLidarrProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { data, error, mutate } = useSWR<LidarrSettingsResponse>(
    '/api/v1/settings/lidarr'
  );
  const [editing, setEditing] = useState<{
    open: boolean;
    server: LidarrSettings | null;
  }>({ open: false, server: null });
  const [removing, setRemoving] = useState<ServerRow | null>(null);
  const [busy, setBusy] = useState(false);
  // Outcome of a manual Test, by server id; overrides the status from the list.
  const [tested, setTested] = useState<
    Record<number, { connected: boolean; version?: string } | 'testing'>
  >({});

  const refresh = () => {
    mutate();
    globalMutate('/api/v1/settings/public');
    globalMutate('/api/v1/service/lidarr');
  };

  const test = async (server: ServerRow) => {
    setTested((t) => ({ ...t, [server.id]: 'testing' }));
    try {
      const response = await axios.post<LidarrTestResponse>(
        '/api/v1/settings/lidarr/test',
        {
          hostname: server.hostname,
          port: server.port,
          apiKey: server.apiKey,
          useSsl: server.useSsl,
          baseUrl: server.baseUrl ?? '',
          id: server.id,
        }
      );
      setTested((t) => ({
        ...t,
        [server.id]: { connected: true, version: response.data.version },
      }));
      addToast(intl.formatMessage(messages.testOk, { name: server.name }), {
        appearance: 'success',
      });
    } catch (e) {
      setTested((t) => ({ ...t, [server.id]: { connected: false } }));
      addToast(
        apiMessage(
          e,
          intl.formatMessage(messages.testFailed, { name: server.name })
        ),
        { appearance: 'error' }
      );
    }
  };

  const remove = async () => {
    if (!removing) {
      return;
    }
    setBusy(true);
    try {
      await axios.delete(`/api/v1/settings/lidarr/${removing.id}`);
      addToast(intl.formatMessage(messages.removed, { name: removing.name }), {
        appearance: 'success',
      });
      setRemoving(null);
      refresh();
    } catch (e) {
      addToast(apiMessage(e, intl.formatMessage(messages.removeFailed)), {
        appearance: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const addButton = (
    <Button
      buttonType="primary"
      onClick={() => setEditing({ open: true, server: null })}
    >
      {intl.formatMessage(messages.add)}
    </Button>
  );

  const status = (server: ServerRow) => {
    const manual = tested[server.id];
    if (manual === 'testing') {
      return (
        <StatusDot tone="processing">
          {intl.formatMessage(messages.checking)}
        </StatusDot>
      );
    }
    const state = manual ?? server.status;
    if (!state) {
      return (
        <StatusDot tone="none">
          {intl.formatMessage(messages.checking)}
        </StatusDot>
      );
    }
    return state.connected ? (
      <StatusDot tone="available">
        {state.version
          ? intl.formatMessage(messages.connectedVersion, {
              version: state.version,
            })
          : intl.formatMessage(messages.connected)}
      </StatusDot>
    ) : (
      <StatusDot tone="declined">
        {intl.formatMessage(messages.notConnected)}
      </StatusDot>
    );
  };

  return (
    <>
      {!isSetupSettings && (
        <PageHeader
          title={intl.formatMessage(messages.title)}
          description={intl.formatMessage(messages.description)}
          actions={addButton}
        />
      )}
      {error && !data ? (
        <Alert title={intl.formatMessage(messages.loadFailed)} type="error" />
      ) : !data ? (
        <LoadingSpinner />
      ) : data.length === 0 ? (
        <EmptyState
          title={intl.formatMessage(messages.emptyTitle)}
          action={addButton}
        >
          {intl.formatMessage(messages.emptyBody)}
        </EmptyState>
      ) : (
        <div className="sh-stack">
          {!data.some((server) => server.isDefault && !server.isHiRes) && (
            <Alert
              title={intl.formatMessage(messages.noDefault)}
              type="warning"
            />
          )}
          {data.map((server) => (
            <article key={server.id} className="sh-server">
              <div className="min-w-[180px] flex-1">
                <div className="name flex flex-wrap items-center gap-2">
                  {server.name}
                  {server.isDefault && (
                    <span className="sh-tag s">
                      {intl.formatMessage(messages.defaultTag)}
                    </span>
                  )}
                  {server.isHiRes && (
                    <span className="sh-tag s">
                      {intl.formatMessage(messages.hiResTag)}
                    </span>
                  )}
                </div>
                <div className="url break-all">
                  {`${server.useSsl ? 'https' : 'http'}://${server.hostname}:${server.port}${server.baseUrl ?? ''}`}
                </div>
              </div>
              <dl>
                <div>
                  <dt>{intl.formatMessage(messages.quality)}</dt>
                  <dd>{server.activeQualityProfileName || '—'}</dd>
                </div>
                <div>
                  <dt>{intl.formatMessage(messages.folder)}</dt>
                  <dd className="break-all font-mono">
                    {server.activeDirectory || '—'}
                  </dd>
                </div>
                <div>
                  <dt>{intl.formatMessage(messages.connection)}</dt>
                  <dd>{status(server)}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button
                  buttonSize="sm"
                  disabled={tested[server.id] === 'testing'}
                  aria-label={intl.formatMessage(messages.testLabel, {
                    name: server.name,
                  })}
                  onClick={() => test(server)}
                >
                  {intl.formatMessage(
                    tested[server.id] === 'testing'
                      ? messages.testing
                      : messages.test
                  )}
                </Button>
                <Button
                  buttonSize="sm"
                  aria-label={intl.formatMessage(messages.editLabel, {
                    name: server.name,
                  })}
                  onClick={() => setEditing({ open: true, server })}
                >
                  {intl.formatMessage(messages.edit)}
                </Button>
                <Button
                  buttonSize="sm"
                  aria-label={intl.formatMessage(messages.removeLabel, {
                    name: server.name,
                  })}
                  onClick={() => setRemoving(server)}
                >
                  {intl.formatMessage(messages.remove)}
                </Button>
              </div>
            </article>
          ))}
          {isSetupSettings && <div>{addButton}</div>}
        </div>
      )}

      {editing.open && (
        <LidarrModal
          server={editing.server}
          first={!data?.length}
          onClose={() => setEditing({ open: false, server: null })}
          onSave={() => {
            setEditing({ open: false, server: null });
            setTested({});
            refresh();
          }}
        />
      )}
      {removing && (
        <Modal
          title={intl.formatMessage(messages.removeTitle, {
            name: removing.name,
          })}
          okText={intl.formatMessage(messages.removeOk)}
          okButtonType="danger"
          okDisabled={busy}
          cancelText={intl.formatMessage(messages.cancel)}
          onOk={remove}
          onCancel={() => setRemoving(null)}
        >
          <p>
            {intl.formatMessage(messages.removeBody, { name: removing.name })}
          </p>
        </Modal>
      )}
    </>
  );
};

export default SettingsLidarr;
