import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageHeader from '@app/components/Common/PageHeader';
import Panel from '@app/components/Common/Panel';
import ProgressBar from '@app/components/Common/ProgressBar';
import StatusDot from '@app/components/Common/StatusDot';
import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type {
  ConnectionTestResponse,
  ScanStatus,
} from '@server/interfaces/api/settingsInterfaces';
import axios from 'axios';
import { cloneDeep, set as setIn } from 'lodash';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate as globalMutate } from 'swr';

const messages = defineMessages('components.Settings.shared', {
  save: 'Save changes',
  saving: 'Saving…',
  saved: 'Settings saved.',
  saveFailed: 'The settings couldn’t be saved. Check the values and try again.',
  loadFailed:
    'These settings couldn’t be loaded. Check that the server is running, then reload the page.',
  show: 'Show',
  hide: 'Hide',
  copy: 'Copy',
  copied: 'Copied.',
  copyFailed: 'Copying didn’t work. Select the text and copy it yourself.',
  test: 'Test',
  testing: 'Testing…',
  testOk: 'Connected to {name}.',
  testOkPlain: 'The connection works.',
  testFailed:
    'The connection didn’t work. Check the address and credentials, then test again.',
  connected: 'Connected',
  notConnected: 'Not connected',
  notTested: 'Not tested yet',
  scanTitle: 'Library scan',
  scanSub: 'Shufflerr checks {source} to mark what’s already available.',
  scanning: 'Scanning… {progress}%',
  scanningLibrary: 'Scanning {library}… {progress}%',
  scanProgressLabel: 'Library scan progress',
  lastScan:
    'Last full scan finished {time}. {albums, number} {albums, plural, one {album} other {albums}}, {tracks, number} {tracks, plural, one {track} other {tracks}}.',
  neverScanned:
    'No full scan has finished yet. {albums, number} {albums, plural, one {album} other {albums}}, {tracks, number} {tracks, plural, one {track} other {tracks}} so far.',
  scanError: 'The last scan stopped with an error: {error}',
  scanRecent: 'Scan recently added',
  scanFull: 'Start full scan',
  scanCancel: 'Cancel scan',
  scanStarted: 'Scan started.',
  scanCancelled: 'Scan cancelled.',
  scanFailed: 'The scan couldn’t be started. Save a working connection first.',
  scanUnavailable:
    'Scan status isn’t available. Check the connection settings above.',
});

/** Pull the server's own sentence out of an axios error, else use the fallback. */
export const apiMessage = (e: unknown, fallback: string): string => {
  if (axios.isAxiosError(e)) {
    const message: unknown = e.response?.data?.message;
    if (typeof message === 'string' && /\s/.test(message)) {
      return message;
    }
  }
  return fallback;
};

interface SaveOptions {
  /** Toast shown on success. */
  okMessage?: string;
  /** Body to send instead of the whole draft. */
  body?: unknown;
  /** URL to POST to instead of the section URL. */
  url?: string;
}

/**
 * One settings section: loads it with SWR, keeps an editable draft, and saves
 * the draft back with a toast. Masked secrets round-trip unchanged, which the
 * server reads as "keep the stored value".
 */
export function useSection<T extends object>(url: string | null) {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { data, error, mutate } = useSWR<T>(url, {
    revalidateOnFocus: false,
  });
  const [draft, setDraft] = useState<T | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (data && !loaded.current) {
      loaded.current = true;
      setDraft(cloneDeep(data));
    }
  }, [data]);

  /** Set one value by path, e.g. `set('musicbrainz.url', value)`. */
  const set = useCallback((path: string, value: unknown) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const next = cloneDeep(current);
      setIn(next, path, value);
      return next;
    });
  }, []);

  const save = useCallback(
    async (options: SaveOptions = {}): Promise<T | undefined> => {
      if (!url) {
        return undefined;
      }
      setSaving(true);
      setSaveError(null);
      try {
        const response = await axios.post<T>(
          options.url ?? url,
          options.body ?? draft
        );
        const fresh =
          response.data && typeof response.data === 'object'
            ? response.data
            : undefined;
        if (fresh && !options.url) {
          setDraft(cloneDeep(fresh));
          mutate(fresh, false);
        } else {
          const revalidated = await mutate();
          if (revalidated) {
            setDraft(cloneDeep(revalidated));
          }
        }
        globalMutate('/api/v1/settings/public');
        addToast(options.okMessage ?? intl.formatMessage(messages.saved), {
          appearance: 'success',
        });
        return fresh;
      } catch (e) {
        const message = apiMessage(e, intl.formatMessage(messages.saveFailed));
        setSaveError(message);
        addToast(message, { appearance: 'error' });
        return undefined;
      } finally {
        setSaving(false);
      }
    },
    [url, draft, mutate, addToast, intl]
  );

  /** Replace the draft with a fresh server copy (after a side-channel change). */
  const reload = useCallback(async () => {
    const fresh = await mutate();
    if (fresh) {
      setDraft(cloneDeep(fresh));
    }
    return fresh;
  }, [mutate]);

  return {
    data,
    draft,
    setDraft,
    set,
    save,
    saving,
    saveError,
    loadError: error,
    loading: !draft && !error,
    reload,
  };
}

interface SettingsPageProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  loading?: boolean;
  loadError?: unknown;
  /** Leave out the page header (used when a page is embedded in the setup wizard). */
  bare?: boolean;
  children?: React.ReactNode;
}

/** H1 + description, then the stacked panels (or the loading / error state). */
export const SettingsPage = ({
  title,
  description,
  actions,
  loading,
  loadError,
  bare,
  children,
}: SettingsPageProps) => {
  const intl = useIntl();
  return (
    <>
      {!bare && (
        <PageHeader title={title} description={description} actions={actions} />
      )}
      {loadError ? (
        <Alert title={intl.formatMessage(messages.loadFailed)} type="error" />
      ) : loading ? (
        <LoadingSpinner />
      ) : (
        <div className="sh-stack">{children}</div>
      )}
    </>
  );
};

export const SaveButton = ({
  saving,
  disabled,
  label,
}: {
  saving?: boolean;
  disabled?: boolean;
  label?: string;
}) => {
  const intl = useIntl();
  return (
    <Button buttonType="primary" type="submit" disabled={saving || disabled}>
      {saving
        ? intl.formatMessage(messages.saving)
        : (label ?? intl.formatMessage(messages.save))}
    </Button>
  );
};

/** Inline error under a panel's fields. */
export const PanelError = ({ message }: { message?: string | null }) =>
  message ? (
    <p className="sh-err" role="alert">
      {message}
    </p>
  ) : null;

type ControlProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
};

interface SecretInputProps extends ControlProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
}

/**
 * Secret field. GET returns the masked value (`••••` + last 4); leaving it
 * untouched keeps the stored secret. Typing replaces it.
 */
export const SecretInput = ({
  value,
  onChange,
  placeholder,
  autoComplete = 'off',
  ...control
}: SecretInputProps) => {
  const intl = useIntl();
  const [shown, setShown] = useState(false);
  return (
    <div className="sh-copyrow">
      <input
        {...control}
        type={shown ? 'text' : 'password'}
        className="font-mono"
        value={value ?? ''}
        placeholder={placeholder}
        autoComplete={autoComplete}
        data-form-type="other"
        data-1p-ignore="true"
        data-lpignore="true"
        onFocus={(e) => {
          // A masked value can't be edited in place: select it so typing replaces it.
          if (e.target.value.startsWith('••••')) {
            e.target.select();
          }
        }}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button
        type="button"
        buttonSize="sm"
        aria-pressed={shown}
        onClick={() => setShown((s) => !s)}
      >
        {intl.formatMessage(shown ? messages.hide : messages.show)}
      </Button>
    </div>
  );
};

export const useCopy = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  return useCallback(
    async (text: string, okMessage?: string) => {
      try {
        await navigator.clipboard.writeText(text);
        addToast(okMessage ?? intl.formatMessage(messages.copied), {
          appearance: 'success',
        });
      } catch {
        addToast(intl.formatMessage(messages.copyFailed), {
          appearance: 'error',
        });
      }
    },
    [addToast, intl]
  );
};

/** Read-only value with a Copy button (API key, endpoints). */
export const CopyRow = ({
  value,
  label,
  children,
  ...control
}: ControlProps & {
  value: string;
  /** Accessible name when used outside a Field. */
  label?: string;
  /** Extra buttons after Copy. */
  children?: React.ReactNode;
}) => {
  const intl = useIntl();
  const copy = useCopy();
  return (
    <div className="sh-copyrow">
      <input
        {...control}
        readOnly
        className="font-mono"
        value={value}
        aria-label={label}
        onFocus={(e) => e.target.select()}
      />
      <Button type="button" buttonSize="sm" onClick={() => copy(value)}>
        {intl.formatMessage(messages.copy)}
      </Button>
      {children}
    </div>
  );
};

export const NumberInput = ({
  value,
  onChange,
  min,
  max,
  ...control
}: ControlProps & {
  value: number | undefined;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) => (
  <input
    {...control}
    type="number"
    inputMode="numeric"
    className="font-mono"
    min={min}
    max={max}
    value={value ?? ''}
    onChange={(e) =>
      onChange(e.target.value === '' ? 0 : Number(e.target.value))
    }
  />
);

export type TestState =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; detail?: string }
  | { state: 'failed'; detail?: string };

/**
 * Runs a real connection test against the server and reports the outcome as a
 * toast plus a status the page can show.
 */
export const useConnectionTest = (url: string) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [result, setResult] = useState<TestState>({ state: 'idle' });

  const run = useCallback(
    async (body?: unknown, quiet = false) => {
      setResult({ state: 'testing' });
      try {
        const { data } = await axios.post<ConnectionTestResponse>(url, body);
        if (data && data.ok === false) {
          const detail =
            data.message ?? intl.formatMessage(messages.testFailed);
          setResult({ state: 'failed', detail });
          if (!quiet) {
            addToast(detail, { appearance: 'error' });
          }
          return false;
        }
        const detail = [data?.name, data?.version].filter(Boolean).join(' ');
        setResult({ state: 'ok', detail });
        if (!quiet) {
          addToast(
            detail
              ? intl.formatMessage(messages.testOk, { name: detail })
              : intl.formatMessage(messages.testOkPlain),
            { appearance: 'success' }
          );
        }
        return true;
      } catch (e) {
        const detail = apiMessage(e, intl.formatMessage(messages.testFailed));
        setResult({ state: 'failed', detail });
        if (!quiet) {
          addToast(detail, { appearance: 'error' });
        }
        return false;
      }
    },
    [url, addToast, intl]
  );

  return { result, run };
};

export const TestButton = ({
  result,
  onClick,
  disabled,
}: {
  result: TestState;
  onClick: () => void;
  disabled?: boolean;
}) => {
  const intl = useIntl();
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled || result.state === 'testing'}
    >
      {intl.formatMessage(
        result.state === 'testing' ? messages.testing : messages.test
      )}
    </Button>
  );
};

/** Dot + label for the outcome of the last real test. */
export const ConnectionStatus = ({ result }: { result: TestState }) => {
  const intl = useIntl();
  if (result.state === 'ok') {
    return (
      <StatusDot tone="available">
        {intl.formatMessage(messages.connected)}
        {result.detail ? ` · ${result.detail}` : ''}
      </StatusDot>
    );
  }
  if (result.state === 'failed') {
    return (
      <StatusDot tone="declined">
        {intl.formatMessage(messages.notConnected)}
      </StatusDot>
    );
  }
  if (result.state === 'testing') {
    return (
      <StatusDot tone="processing">
        {intl.formatMessage(messages.testing)}
      </StatusDot>
    );
  }
  return (
    <StatusDot tone="none">{intl.formatMessage(messages.notTested)}</StatusDot>
  );
};

interface ScanPanelProps {
  /** `/api/v1/settings/<source>/sync` */
  url: string;
  /** Name used in the sub-line, e.g. "your Plex music libraries". */
  source: string;
  /** Plex and Jellyfin can scan only what was recently added. */
  recent?: boolean;
  disabled?: boolean;
}

/** Library scan panel with live progress (polls while a scan runs). */
export const ScanPanel = ({
  url,
  source,
  recent,
  disabled,
}: ScanPanelProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { data, error, mutate } = useSWR<ScanStatus>(url, {
    refreshInterval: (latest) => (latest?.running ? 1500 : 15000),
  });
  const [busy, setBusy] = useState(false);

  const command = async (
    body: { start?: boolean; cancel?: boolean; mode?: 'full' | 'recent' },
    okMessage: string
  ) => {
    setBusy(true);
    try {
      const response = await axios.post<ScanStatus>(url, body);
      mutate(response.data, false);
      addToast(okMessage, { appearance: 'success' });
    } catch (e) {
      addToast(apiMessage(e, intl.formatMessage(messages.scanFailed)), {
        appearance: 'error',
      });
    } finally {
      setBusy(false);
      mutate();
    }
  };

  const progress = Math.round(data?.progress ?? 0);

  return (
    <Panel
      title={intl.formatMessage(messages.scanTitle)}
      sub={intl.formatMessage(messages.scanSub, { source })}
      actions={
        data?.running ? (
          <Button
            type="button"
            buttonType="danger"
            disabled={busy}
            onClick={() =>
              command(
                { cancel: true },
                intl.formatMessage(messages.scanCancelled)
              )
            }
          >
            {intl.formatMessage(messages.scanCancel)}
          </Button>
        ) : (
          <>
            {recent && (
              <Button
                type="button"
                disabled={busy || disabled || !data}
                onClick={() =>
                  command(
                    { start: true, mode: 'recent' },
                    intl.formatMessage(messages.scanStarted)
                  )
                }
              >
                {intl.formatMessage(messages.scanRecent)}
              </Button>
            )}
            <Button
              type="button"
              buttonType="primary"
              disabled={busy || disabled || !data}
              onClick={() =>
                command(
                  { start: true, mode: 'full' },
                  intl.formatMessage(messages.scanStarted)
                )
              }
            >
              {intl.formatMessage(messages.scanFull)}
            </Button>
          </>
        )
      }
    >
      {error && !data ? (
        <p className="sh-sub">{intl.formatMessage(messages.scanUnavailable)}</p>
      ) : !data ? (
        <LoadingSpinner />
      ) : data.running ? (
        <div className="flex flex-col gap-2" role="status">
          <ProgressBar
            value={progress}
            tone="processing"
            label={intl.formatMessage(messages.scanProgressLabel)}
          />
          <p className="sh-sub font-mono">
            {data.currentLibrary?.name
              ? intl.formatMessage(messages.scanningLibrary, {
                  library: data.currentLibrary.name,
                  progress,
                })
              : intl.formatMessage(messages.scanning, { progress })}
            {data.total ? ` · ${data.current ?? 0} / ${data.total}` : ''}
          </p>
        </div>
      ) : (
        <>
          <p className="sh-sub">
            {data.lastFullScan
              ? intl.formatMessage(messages.lastScan, {
                  time: intl.formatRelativeTime(
                    Math.round((data.lastFullScan - Date.now()) / 60000) > -60
                      ? Math.round((data.lastFullScan - Date.now()) / 60000)
                      : Math.round((data.lastFullScan - Date.now()) / 3600000) >
                          -48
                        ? Math.round((data.lastFullScan - Date.now()) / 3600000)
                        : Math.round(
                            (data.lastFullScan - Date.now()) / 86400000
                          ),
                    Math.round((data.lastFullScan - Date.now()) / 60000) > -60
                      ? 'minute'
                      : Math.round((data.lastFullScan - Date.now()) / 3600000) >
                          -48
                        ? 'hour'
                        : 'day'
                  ),
                  albums: data.albums,
                  tracks: data.tracks,
                })
              : intl.formatMessage(messages.neverScanned, {
                  albums: data.albums,
                  tracks: data.tracks,
                })}
          </p>
          {data.error && (
            <p className="sh-err" role="alert">
              {intl.formatMessage(messages.scanError, { error: data.error })}
            </p>
          )}
        </>
      )}
    </Panel>
  );
};

/** Relative time for a timestamp ("4 hours ago", "in 3 minutes"). */
export const useRelativeTime = () => {
  const intl = useIntl();
  return useCallback(
    (value: string | number | Date | null | undefined): string => {
      if (!value) {
        return '';
      }
      const diff = new Date(value).getTime() - Date.now();
      const abs = Math.abs(diff);
      if (abs < 60000) {
        return intl.formatRelativeTime(Math.round(diff / 1000), 'second');
      }
      if (abs < 3600000) {
        return intl.formatRelativeTime(Math.round(diff / 60000), 'minute');
      }
      if (abs < 172800000) {
        return intl.formatRelativeTime(Math.round(diff / 3600000), 'hour');
      }
      return intl.formatRelativeTime(Math.round(diff / 86400000), 'day');
    },
    [intl]
  );
};
