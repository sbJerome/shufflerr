// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: src/components/Settings/RadarrModal/index.tsx at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import Button from '@app/components/Common/Button';
import Field from '@app/components/Common/Field';
import Modal from '@app/components/Common/Modal';
import SwitchRow from '@app/components/Common/SwitchRow';
import {
  apiMessage,
  NumberInput,
  SecretInput,
} from '@app/components/Settings/shared';
import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type { LidarrTestResponse } from '@server/interfaces/api/serviceInterfaces';
import type { LidarrSettings } from '@server/lib/settings';
import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Settings.LidarrModal', {
  createTitle: 'Add Lidarr server',
  editTitle: 'Edit {name}',
  add: 'Add server',
  save: 'Save changes',
  saving: 'Saving…',
  cancel: 'Cancel',
  isDefault: 'Default server',
  isDefaultTip: 'Requests go here unless someone picks another server.',
  isHiRes: 'Hi-res server',
  isHiResTip: 'Use this server for hi-res requests.',
  name: 'Server name',
  hostname: 'Hostname or IP address',
  port: 'Port',
  useSsl: 'Use SSL',
  apiKey: 'API key',
  apiKeyHint: 'Settings → General → Security in Lidarr',
  baseUrl: 'URL base',
  baseUrlHint: 'Only if Lidarr runs under a sub-path, for example /lidarr.',
  test: 'Test',
  testing: 'Testing…',
  testOk: 'Connected to Lidarr {version}. Profiles and folders are loaded.',
  testOkPlain: 'Connected to Lidarr. Profiles and folders are loaded.',
  testFailed:
    'Shufflerr couldn’t reach Lidarr. Check the address, port and API key, then test again.',
  testFirst: 'Test the connection to load profiles and folders.',
  qualityProfile: 'Quality profile',
  metadataProfile: 'Metadata profile',
  metadataProfileHint:
    'Decides which release types Lidarr tracks for an artist.',
  rootFolder: 'Root folder',
  choose: 'Choose…',
  tags: 'Tags',
  noTags: 'This Lidarr server has no tags.',
  syncEnabled: 'Enable scan',
  syncEnabledTip:
    'Shufflerr reads what Lidarr monitors and has already downloaded.',
  autoSearch: 'Enable automatic search',
  autoSearchTip: 'Lidarr starts searching as soon as a request is approved.',
  externalUrl: 'External URL',
  externalUrlHint: 'The address people use to open Lidarr in a browser.',
  nameRequired: 'Enter a name for this server.',
  hostRequired: 'Enter the hostname or IP address of Lidarr.',
  portRequired: 'Enter a port between 1 and 65535.',
  keyRequired: 'Enter the Lidarr API key.',
  baseUrlInvalid:
    'Start the URL base with a slash and leave off the slash at the end.',
  profileRequired: 'Choose a quality profile.',
  metadataRequired: 'Choose a metadata profile.',
  folderRequired: 'Choose a root folder.',
  created: 'Added {name}.',
  updated: 'Saved {name}.',
  saveFailed: 'The server couldn’t be saved. Check the values and try again.',
});

type Draft = Omit<LidarrSettings, 'id'> & { id?: number };

const emptyServer: Draft = {
  name: '',
  hostname: '',
  port: 8686,
  apiKey: '',
  useSsl: false,
  baseUrl: '',
  isDefault: false,
  isHiRes: false,
  activeQualityProfileId: 0,
  activeQualityProfileName: '',
  activeMetadataProfileId: 0,
  activeMetadataProfileName: '',
  activeDirectory: '',
  tags: [],
  externalUrl: '',
  syncEnabled: true,
  preventSearch: false,
};

interface LidarrModalProps {
  /** Server to edit, or null to add one. */
  server: LidarrSettings | null;
  /** True when no server exists yet: the first one becomes the default. */
  first?: boolean;
  onClose: () => void;
  onSave: () => void;
}

const LidarrModal = ({ server, first, onClose, onSave }: LidarrModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [draft, setDraft] = useState<Draft>(
    server ? { ...server } : { ...emptyServer, isDefault: !!first }
  );
  const [details, setDetails] = useState<LidarrTestResponse | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const initialTest = useRef(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  // Changing the connection invalidates the loaded profiles.
  const setConnection = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    set(key, value);
    setDetails(null);
  };

  const test = useCallback(
    async (quiet = false) => {
      setTesting(true);
      setTestError(null);
      try {
        const { data } = await axios.post<LidarrTestResponse>(
          '/api/v1/settings/lidarr/test',
          {
            hostname: draft.hostname.trim(),
            port: Number(draft.port),
            apiKey: draft.apiKey,
            useSsl: draft.useSsl,
            baseUrl: draft.baseUrl ?? '',
            id: draft.id,
          }
        );
        setDetails(data);
        if (!quiet) {
          addToast(
            data.version
              ? intl.formatMessage(messages.testOk, { version: data.version })
              : intl.formatMessage(messages.testOkPlain),
            { appearance: 'success' }
          );
        }
      } catch (e) {
        const message = apiMessage(e, intl.formatMessage(messages.testFailed));
        setDetails(null);
        setTestError(message);
        if (!quiet) {
          addToast(message, { appearance: 'error' });
        }
      } finally {
        setTesting(false);
      }
    },
    [draft, addToast, intl]
  );

  // Editing an existing server: load its profiles straight away.
  useEffect(() => {
    if (server && !initialTest.current) {
      initialTest.current = true;
      test(true);
    }
  }, [server, test]);

  const validate = () => {
    const next: Record<string, string> = {};
    if (!draft.name.trim()) {
      next.name = intl.formatMessage(messages.nameRequired);
    }
    if (!draft.hostname.trim()) {
      next.hostname = intl.formatMessage(messages.hostRequired);
    }
    if (!draft.port || draft.port < 1 || draft.port > 65535) {
      next.port = intl.formatMessage(messages.portRequired);
    }
    if (!draft.apiKey.trim()) {
      next.apiKey = intl.formatMessage(messages.keyRequired);
    }
    const base = draft.baseUrl ?? '';
    if (base && (!base.startsWith('/') || base.endsWith('/'))) {
      next.baseUrl = intl.formatMessage(messages.baseUrlInvalid);
    }
    if (!draft.activeQualityProfileId) {
      next.profile = intl.formatMessage(messages.profileRequired);
    }
    if (!draft.activeMetadataProfileId) {
      next.metadata = intl.formatMessage(messages.metadataRequired);
    }
    if (!draft.activeDirectory) {
      next.folder = intl.formatMessage(messages.folderRequired);
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) {
      return;
    }
    setSaving(true);
    setFormError(null);
    const body = {
      ...draft,
      name: draft.name.trim(),
      hostname: draft.hostname.trim(),
      port: Number(draft.port),
      activeQualityProfileName:
        details?.profiles.find((p) => p.id === draft.activeQualityProfileId)
          ?.name ?? draft.activeQualityProfileName,
      activeMetadataProfileName:
        details?.metadataProfiles.find(
          (p) => p.id === draft.activeMetadataProfileId
        )?.name ?? draft.activeMetadataProfileName,
    };
    try {
      if (server) {
        await axios.put(`/api/v1/settings/lidarr/${server.id}`, body);
      } else {
        await axios.post('/api/v1/settings/lidarr', body);
      }
      addToast(
        intl.formatMessage(server ? messages.updated : messages.created, {
          name: body.name,
        }),
        { appearance: 'success' }
      );
      onSave();
    } catch (e) {
      setFormError(apiMessage(e, intl.formatMessage(messages.saveFailed)));
    } finally {
      setSaving(false);
    }
  };

  const loaded = !!details;
  // Keep the stored choice visible until a test replaces the option lists.
  const profiles =
    details?.profiles ??
    (draft.activeQualityProfileId
      ? [
          {
            id: draft.activeQualityProfileId,
            name: draft.activeQualityProfileName,
          },
        ]
      : []);
  const metadataProfiles =
    details?.metadataProfiles ??
    (draft.activeMetadataProfileId
      ? [
          {
            id: draft.activeMetadataProfileId,
            name: draft.activeMetadataProfileName,
          },
        ]
      : []);
  const rootFolders =
    details?.rootFolders ??
    (draft.activeDirectory ? [{ path: draft.activeDirectory }] : []);

  return (
    <Modal
      title={
        server
          ? intl.formatMessage(messages.editTitle, { name: server.name })
          : intl.formatMessage(messages.createTitle)
      }
      onCancel={onClose}
      cancelText={intl.formatMessage(messages.cancel)}
      onOk={submit}
      okText={intl.formatMessage(
        saving ? messages.saving : server ? messages.save : messages.add
      )}
      okButtonType="primary"
      okDisabled={saving}
    >
      <div className="sh-box">
        <SwitchRow
          label={intl.formatMessage(messages.isDefault)}
          description={intl.formatMessage(messages.isDefaultTip)}
          checked={draft.isDefault}
          onChange={(v) => set('isDefault', v)}
        />
        <SwitchRow
          label={intl.formatMessage(messages.isHiRes)}
          description={intl.formatMessage(messages.isHiResTip)}
          checked={draft.isHiRes}
          onChange={(v) => set('isHiRes', v)}
        />
      </div>
      <div className="sh-fields">
        <Field
          full
          required
          label={intl.formatMessage(messages.name)}
          error={errors.name}
        >
          {(p) => (
            <input
              {...p}
              type="text"
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
            />
          )}
        </Field>
        <Field
          required
          label={intl.formatMessage(messages.hostname)}
          error={errors.hostname}
        >
          {(p) => (
            <input
              {...p}
              type="text"
              className="font-mono"
              value={draft.hostname}
              onChange={(e) => setConnection('hostname', e.target.value)}
            />
          )}
        </Field>
        <Field
          required
          label={intl.formatMessage(messages.port)}
          error={errors.port}
        >
          {(p) => (
            <NumberInput
              {...p}
              min={1}
              max={65535}
              value={draft.port}
              onChange={(v) => setConnection('port', v)}
            />
          )}
        </Field>
        <Field
          required
          label={intl.formatMessage(messages.apiKey)}
          hint={intl.formatMessage(messages.apiKeyHint)}
          error={errors.apiKey}
        >
          {(p) => (
            <SecretInput
              {...p}
              value={draft.apiKey}
              onChange={(v) => setConnection('apiKey', v)}
            />
          )}
        </Field>
        <Field
          label={intl.formatMessage(messages.baseUrl)}
          hint={intl.formatMessage(messages.baseUrlHint)}
          error={errors.baseUrl}
        >
          {(p) => (
            <input
              {...p}
              type="text"
              className="font-mono"
              value={draft.baseUrl ?? ''}
              onChange={(e) => setConnection('baseUrl', e.target.value)}
            />
          )}
        </Field>
      </div>
      <div className="sh-box">
        <SwitchRow
          label={intl.formatMessage(messages.useSsl)}
          checked={draft.useSsl}
          onChange={(v) => setConnection('useSsl', v)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => test()}
          disabled={
            testing || !draft.hostname.trim() || !draft.apiKey || !draft.port
          }
        >
          {intl.formatMessage(testing ? messages.testing : messages.test)}
        </Button>
        {!loaded && !testError && !testing && (
          <span className="sh-sub">
            {intl.formatMessage(messages.testFirst)}
          </span>
        )}
      </div>
      {testError && (
        <p className="sh-err" role="alert">
          {testError}
        </p>
      )}
      <div className="sh-fields">
        <Field
          required
          label={intl.formatMessage(messages.qualityProfile)}
          error={errors.profile}
        >
          {(p) => (
            <select
              {...p}
              disabled={!loaded}
              value={draft.activeQualityProfileId || ''}
              onChange={(e) =>
                set('activeQualityProfileId', Number(e.target.value))
              }
            >
              <option value="">{intl.formatMessage(messages.choose)}</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          required
          label={intl.formatMessage(messages.metadataProfile)}
          hint={intl.formatMessage(messages.metadataProfileHint)}
          error={errors.metadata}
        >
          {(p) => (
            <select
              {...p}
              disabled={!loaded}
              value={draft.activeMetadataProfileId || ''}
              onChange={(e) =>
                set('activeMetadataProfileId', Number(e.target.value))
              }
            >
              <option value="">{intl.formatMessage(messages.choose)}</option>
              {metadataProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          full
          required
          label={intl.formatMessage(messages.rootFolder)}
          error={errors.folder}
        >
          {(p) => (
            <select
              {...p}
              disabled={!loaded}
              className="font-mono"
              value={draft.activeDirectory}
              onChange={(e) => set('activeDirectory', e.target.value)}
            >
              <option value="">{intl.formatMessage(messages.choose)}</option>
              {rootFolders.map((folder) => (
                <option key={folder.path} value={folder.path}>
                  {folder.path}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          full
          label={intl.formatMessage(messages.externalUrl)}
          hint={intl.formatMessage(messages.externalUrlHint)}
        >
          {(p) => (
            <input
              {...p}
              type="url"
              inputMode="url"
              className="font-mono"
              value={draft.externalUrl ?? ''}
              onChange={(e) => set('externalUrl', e.target.value)}
            />
          )}
        </Field>
      </div>
      {loaded && (
        <fieldset>
          <legend className="group-label">
            {intl.formatMessage(messages.tags)}
          </legend>
          {details.tags.length === 0 ? (
            <p className="sh-sub">{intl.formatMessage(messages.noTags)}</p>
          ) : (
            <div className="sh-checks">
              {details.tags.map((tag) => (
                <label key={tag.id} className="sh-check">
                  <input
                    type="checkbox"
                    checked={draft.tags.includes(tag.id)}
                    onChange={(e) =>
                      set(
                        'tags',
                        e.target.checked
                          ? [...draft.tags, tag.id]
                          : draft.tags.filter((id) => id !== tag.id)
                      )
                    }
                  />{' '}
                  {tag.label}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}
      <div className="sh-box">
        <SwitchRow
          label={intl.formatMessage(messages.syncEnabled)}
          description={intl.formatMessage(messages.syncEnabledTip)}
          checked={draft.syncEnabled}
          onChange={(v) => set('syncEnabled', v)}
        />
        <SwitchRow
          label={intl.formatMessage(messages.autoSearch)}
          description={intl.formatMessage(messages.autoSearchTip)}
          checked={!draft.preventSearch}
          onChange={(v) => set('preventSearch', !v)}
        />
      </div>
      {formError && (
        <p className="sh-err" role="alert">
          {formError}
        </p>
      )}
    </Modal>
  );
};

export default LidarrModal;
