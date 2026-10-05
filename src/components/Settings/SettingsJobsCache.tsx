// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: src/components/Settings/SettingsJobsCache/index.tsx at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import Button from '@app/components/Common/Button';
import Field from '@app/components/Common/Field';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import Panel from '@app/components/Common/Panel';
import {
  apiMessage,
  SettingsPage,
  useRelativeTime,
} from '@app/components/Settings/shared';
import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type {
  CacheItem,
  CacheResponse,
  JobItem,
} from '@server/interfaces/api/settingsInterfaces';
import axios from 'axios';
import cronstrue from 'cronstrue/i18n';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Settings.SettingsJobsCache', {
  title: 'Jobs and cache',
  description: 'Scheduled tasks and cached lookups.',
  jobs: 'Jobs',
  job: 'Job',
  type: 'Type',
  runs: 'Runs',
  nextRun: 'Next run',
  actions: 'Actions',
  process: 'Process',
  command: 'Command',
  running: 'Running…',
  off: 'Off (integration is turned off)',
  notScheduled: 'Not scheduled',
  runNow: 'Run now',
  cancel: 'Cancel',
  edit: 'Edit schedule',
  runLabel: 'Run {name} now',
  cancelLabel: 'Cancel {name}',
  editLabel: 'Edit the schedule for {name}',
  started: 'Started {name}.',
  cancelled: 'Cancelled {name}.',
  runFailed: '{name} couldn’t be started. Check the logs for the reason.',
  cancelFailed: '{name} couldn’t be cancelled.',
  jobsFailed: 'Jobs couldn’t be loaded. Reload the page to try again.',
  editTitle: 'Edit schedule for {name}',
  schedule: 'Schedule (cron, with seconds)',
  scheduleHint:
    'Six fields: second, minute, hour, day of month, month, day of week. For example 0 */5 * * * * runs every 5 minutes.',
  scheduleReads: 'Runs: {text}',
  scheduleInvalid:
    'That isn’t a valid 6-field cron schedule. Check the six fields and try again.',
  saveSchedule: 'Save schedule',
  scheduleSaved: 'Saved the schedule for {name}.',
  scheduleFailed: 'The schedule couldn’t be saved. Check it and try again.',
  close: 'Cancel',
  cache: 'Cache',
  cacheSub: 'Lookups Shufflerr remembers so it asks other services less often.',
  cacheName: 'Cache',
  hits: 'Hits',
  misses: 'Misses',
  keys: 'Keys',
  clear: 'Clear',
  clearLabel: 'Clear the {name} cache',
  cleared: 'Cleared the {name} cache.',
  clearFailed: 'The {name} cache couldn’t be cleared.',
  cacheFailed: 'Cache details couldn’t be loaded.',
  noCaches: 'No caches are in use yet.',
  imageCache: 'Image cache',
  imageCacheSub:
    'Cover art and artist photos stored on this server when “Cache album art” is on.',
  imagesCached: 'Images cached',
  sizeOnDisk: 'Size on disk',
  cleanUp: 'Clean up now',
  cleaningUp: 'Cleaning up…',
  cleanedUp: 'Image cache cleaned up.',
  cleanUpFailed: 'The image cache couldn’t be cleaned up.',
  dnsCache: 'DNS cache',
  dnsCacheSub: 'Hostnames Shufflerr has looked up recently.',
  hostname: 'Hostname',
  activeAddress: 'Active address',
  age: 'Age',
  dnsEmpty: 'No DNS lookups have been cached yet.',
  dnsCleared: 'Cleared the DNS entry for {name}.',
  dnsOff: 'DNS caching is off. Turn it on under Network.',
});

const JOB_GRID = 'minmax(220px,1.5fr) 100px minmax(150px,1fr) 140px 250px';
const CACHE_GRID = 'minmax(180px,1.5fr) 100px 100px 100px 130px';
const DNS_GRID = 'minmax(200px,1.5fr) minmax(140px,1fr) 80px 80px 110px 110px';

const formatBytes = (bytes: number) => {
  if (!bytes) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

const SettingsJobsCache = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const relative = useRelativeTime();
  const {
    data: jobs,
    error: jobsError,
    mutate: revalidateJobs,
  } = useSWR<JobItem[]>('/api/v1/settings/jobs', { refreshInterval: 5000 });
  const {
    data: cache,
    error: cacheError,
    mutate: revalidateCache,
  } = useSWR<CacheResponse>('/api/v1/settings/cache', {
    refreshInterval: 15000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<JobItem | null>(null);
  const [schedule, setSchedule] = useState('');
  const [scheduleError, setScheduleError] = useState<string | undefined>();
  const [cleaning, setCleaning] = useState(false);

  const describe = (cron: string): string | null => {
    try {
      return cronstrue.toString(cron, {
        locale: intl.locale.split('-')[0],
        throwExceptionOnParseError: true,
      });
    } catch {
      try {
        return cronstrue.toString(cron, { throwExceptionOnParseError: true });
      } catch {
        return null;
      }
    }
  };

  const jobAction = async (
    job: JobItem,
    action: 'run' | 'cancel',
    ok: string,
    failed: string
  ) => {
    setBusy(`${action}:${job.id}`);
    try {
      await axios.post(`/api/v1/settings/jobs/${job.id}/${action}`);
      addToast(ok, { appearance: 'success' });
    } catch (e) {
      addToast(apiMessage(e, failed), { appearance: 'error' });
    } finally {
      setBusy(null);
      revalidateJobs();
    }
  };

  const saveSchedule = async () => {
    if (!editing) {
      return;
    }
    const value = schedule.trim().replace(/\s+/g, ' ');
    if (value.split(' ').length !== 6 || !describe(value)) {
      setScheduleError(intl.formatMessage(messages.scheduleInvalid));
      return;
    }
    setBusy(`schedule:${editing.id}`);
    try {
      await axios.post(`/api/v1/settings/jobs/${editing.id}/schedule`, {
        schedule: value,
      });
      addToast(
        intl.formatMessage(messages.scheduleSaved, { name: editing.name }),
        { appearance: 'success' }
      );
      setEditing(null);
      revalidateJobs();
    } catch (e) {
      setScheduleError(
        apiMessage(e, intl.formatMessage(messages.scheduleFailed))
      );
    } finally {
      setBusy(null);
    }
  };

  const flush = async (item: CacheItem) => {
    setBusy(`cache:${item.id}`);
    try {
      await axios.post(`/api/v1/settings/cache/${item.id}/flush`);
      addToast(intl.formatMessage(messages.cleared, { name: item.name }), {
        appearance: 'success',
      });
    } catch (e) {
      addToast(
        apiMessage(
          e,
          intl.formatMessage(messages.clearFailed, { name: item.name })
        ),
        { appearance: 'error' }
      );
    } finally {
      setBusy(null);
      revalidateCache();
    }
  };

  const flushDns = async (hostname: string) => {
    setBusy(`dns:${hostname}`);
    try {
      await axios.post(
        `/api/v1/settings/cache/dns/${encodeURIComponent(hostname)}/flush`
      );
      addToast(intl.formatMessage(messages.dnsCleared, { name: hostname }), {
        appearance: 'success',
      });
    } catch (e) {
      addToast(
        apiMessage(
          e,
          intl.formatMessage(messages.clearFailed, { name: hostname })
        ),
        { appearance: 'error' }
      );
    } finally {
      setBusy(null);
      revalidateCache();
    }
  };

  const cleanUpImages = async () => {
    setCleaning(true);
    try {
      await axios.post('/api/v1/settings/cache/images/cleanup');
      addToast(intl.formatMessage(messages.cleanedUp), {
        appearance: 'success',
      });
    } catch (e) {
      addToast(apiMessage(e, intl.formatMessage(messages.cleanUpFailed)), {
        appearance: 'error',
      });
    } finally {
      setCleaning(false);
      revalidateCache();
    }
  };

  const imageTotals = Object.values(cache?.imageCache ?? {}).reduce(
    (total, entry) => ({
      size: total.size + (entry?.size ?? 0),
      imageCount: total.imageCount + (entry?.imageCount ?? 0),
    }),
    { size: 0, imageCount: 0 }
  );
  const dnsEntries = Object.entries(
    (cache?.dnsCache?.entries ?? {}) as Record<
      string,
      {
        activeAddress?: string;
        age?: number;
        hits?: number;
        misses?: number;
      }
    >
  );
  const preview = describe(schedule.trim());

  return (
    <SettingsPage
      title={intl.formatMessage(messages.title)}
      description={intl.formatMessage(messages.description)}
    >
      <Panel title={intl.formatMessage(messages.jobs)}>
        {jobsError && !jobs ? (
          <p className="sh-err" role="alert">
            {intl.formatMessage(messages.jobsFailed)}
          </p>
        ) : !jobs ? (
          <LoadingSpinner />
        ) : (
          <div className="sh-box sh-scroll-x">
            <div
              className="sh-table"
              role="table"
              aria-label={intl.formatMessage(messages.jobs)}
            >
              <div
                className="sh-tr head"
                role="row"
                style={{ gridTemplateColumns: JOB_GRID }}
              >
                <span role="columnheader">
                  {intl.formatMessage(messages.job)}
                </span>
                <span role="columnheader">
                  {intl.formatMessage(messages.type)}
                </span>
                <span role="columnheader">
                  {intl.formatMessage(messages.runs)}
                </span>
                <span role="columnheader">
                  {intl.formatMessage(messages.nextRun)}
                </span>
                <span role="columnheader" className="sr-only">
                  {intl.formatMessage(messages.actions)}
                </span>
              </div>
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="sh-tr"
                  role="row"
                  style={{ gridTemplateColumns: JOB_GRID }}
                >
                  <span role="cell">
                    <span className="sh-title">{job.name}</span>
                    <span className="sh-mono-s dim block">{job.id}</span>
                  </span>
                  <span role="cell" className="dim">
                    {intl.formatMessage(
                      job.type === 'command'
                        ? messages.command
                        : messages.process
                    )}
                  </span>
                  <span role="cell">
                    {job.scheduleText ??
                      describe(job.cronSchedule) ??
                      job.cronSchedule}
                  </span>
                  <span role="cell" className="sh-mono-s">
                    {job.running ? (
                      <span className="sh-running">
                        {intl.formatMessage(messages.running)}
                      </span>
                    ) : job.enabled === false ? (
                      <span className="dim">
                        {intl.formatMessage(messages.off)}
                      </span>
                    ) : job.nextExecutionTime ? (
                      <time
                        dateTime={job.nextExecutionTime}
                        title={intl.formatDate(job.nextExecutionTime, {
                          dateStyle: 'medium',
                          timeStyle: 'medium',
                        })}
                      >
                        {relative(job.nextExecutionTime)}
                      </time>
                    ) : (
                      <span className="dim">
                        {intl.formatMessage(messages.notScheduled)}
                      </span>
                    )}
                  </span>
                  <span role="cell" className="actions">
                    <Button
                      type="button"
                      buttonSize="sm"
                      aria-label={intl.formatMessage(messages.editLabel, {
                        name: job.name,
                      })}
                      onClick={() => {
                        setSchedule(job.cronSchedule);
                        setScheduleError(undefined);
                        setEditing(job);
                      }}
                    >
                      {intl.formatMessage(messages.edit)}
                    </Button>
                    {job.running ? (
                      <Button
                        type="button"
                        buttonSize="sm"
                        buttonType="danger"
                        disabled={
                          job.cancellable === false ||
                          busy === `cancel:${job.id}`
                        }
                        aria-label={intl.formatMessage(messages.cancelLabel, {
                          name: job.name,
                        })}
                        onClick={() =>
                          jobAction(
                            job,
                            'cancel',
                            intl.formatMessage(messages.cancelled, {
                              name: job.name,
                            }),
                            intl.formatMessage(messages.cancelFailed, {
                              name: job.name,
                            })
                          )
                        }
                      >
                        {intl.formatMessage(messages.cancel)}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        buttonSize="sm"
                        buttonType="accent"
                        disabled={busy === `run:${job.id}`}
                        aria-label={intl.formatMessage(messages.runLabel, {
                          name: job.name,
                        })}
                        onClick={() =>
                          jobAction(
                            job,
                            'run',
                            intl.formatMessage(messages.started, {
                              name: job.name,
                            }),
                            intl.formatMessage(messages.runFailed, {
                              name: job.name,
                            })
                          )
                        }
                      >
                        {intl.formatMessage(messages.runNow)}
                      </Button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title={intl.formatMessage(messages.cache)}
        sub={intl.formatMessage(messages.cacheSub)}
      >
        {cacheError && !cache ? (
          <p className="sh-err" role="alert">
            {intl.formatMessage(messages.cacheFailed)}
          </p>
        ) : !cache ? (
          <LoadingSpinner />
        ) : cache.apiCaches.length === 0 ? (
          <p className="sh-sub">{intl.formatMessage(messages.noCaches)}</p>
        ) : (
          <div className="sh-box sh-scroll-x">
            <div
              className="sh-table"
              role="table"
              aria-label={intl.formatMessage(messages.cache)}
            >
              <div
                className="sh-tr head"
                role="row"
                style={{ gridTemplateColumns: CACHE_GRID }}
              >
                <span role="columnheader">
                  {intl.formatMessage(messages.cacheName)}
                </span>
                <span role="columnheader">
                  {intl.formatMessage(messages.hits)}
                </span>
                <span role="columnheader">
                  {intl.formatMessage(messages.misses)}
                </span>
                <span role="columnheader">
                  {intl.formatMessage(messages.keys)}
                </span>
                <span role="columnheader" className="sr-only">
                  {intl.formatMessage(messages.actions)}
                </span>
              </div>
              {cache.apiCaches.map((item) => (
                <div
                  key={item.id}
                  className="sh-tr"
                  role="row"
                  style={{ gridTemplateColumns: CACHE_GRID }}
                >
                  <span role="cell" className="sh-title">
                    {item.name}
                  </span>
                  <span role="cell" className="num">
                    {intl.formatNumber(item.stats.hits)}
                  </span>
                  <span role="cell" className="num">
                    {intl.formatNumber(item.stats.misses)}
                  </span>
                  <span role="cell" className="num">
                    {intl.formatNumber(item.stats.keys)}
                  </span>
                  <span role="cell" className="actions">
                    <Button
                      type="button"
                      buttonSize="sm"
                      disabled={busy === `cache:${item.id}`}
                      aria-label={intl.formatMessage(messages.clearLabel, {
                        name: item.name,
                      })}
                      onClick={() => flush(item)}
                    >
                      {intl.formatMessage(messages.clear)}
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title={intl.formatMessage(messages.imageCache)}
        sub={intl.formatMessage(messages.imageCacheSub)}
        actions={
          <Button
            type="button"
            disabled={cleaning || !cache}
            onClick={cleanUpImages}
          >
            {intl.formatMessage(
              cleaning ? messages.cleaningUp : messages.cleanUp
            )}
          </Button>
        }
      >
        {!cache ? (
          cacheError ? (
            <p className="sh-err" role="alert">
              {intl.formatMessage(messages.cacheFailed)}
            </p>
          ) : (
            <LoadingSpinner />
          )
        ) : (
          <dl className="sh-kvs">
            <div>
              <dt>{intl.formatMessage(messages.imagesCached)}</dt>
              <dd className="font-mono">
                {intl.formatNumber(imageTotals.imageCount)}
              </dd>
            </div>
            <div>
              <dt>{intl.formatMessage(messages.sizeOnDisk)}</dt>
              <dd className="font-mono">{formatBytes(imageTotals.size)}</dd>
            </div>
          </dl>
        )}
      </Panel>

      {cache && (
        <Panel
          title={intl.formatMessage(messages.dnsCache)}
          sub={intl.formatMessage(messages.dnsCacheSub)}
        >
          {!cache.dnsCache?.entries && !cache.dnsCache?.stats ? (
            <p className="sh-sub">{intl.formatMessage(messages.dnsOff)}</p>
          ) : dnsEntries.length === 0 ? (
            <p className="sh-sub">{intl.formatMessage(messages.dnsEmpty)}</p>
          ) : (
            <div className="sh-box sh-scroll-x">
              <div
                className="sh-table"
                role="table"
                aria-label={intl.formatMessage(messages.dnsCache)}
              >
                <div
                  className="sh-tr head"
                  role="row"
                  style={{ gridTemplateColumns: DNS_GRID }}
                >
                  <span role="columnheader">
                    {intl.formatMessage(messages.hostname)}
                  </span>
                  <span role="columnheader">
                    {intl.formatMessage(messages.activeAddress)}
                  </span>
                  <span role="columnheader">
                    {intl.formatMessage(messages.hits)}
                  </span>
                  <span role="columnheader">
                    {intl.formatMessage(messages.misses)}
                  </span>
                  <span role="columnheader">
                    {intl.formatMessage(messages.age)}
                  </span>
                  <span role="columnheader" className="sr-only">
                    {intl.formatMessage(messages.actions)}
                  </span>
                </div>
                {dnsEntries.map(([hostname, entry]) => (
                  <div
                    key={hostname}
                    className="sh-tr"
                    role="row"
                    style={{ gridTemplateColumns: DNS_GRID }}
                  >
                    <span role="cell" className="sh-mono-s break-all">
                      {hostname}
                    </span>
                    <span role="cell" className="sh-mono-s break-all">
                      {entry.activeAddress ?? '—'}
                    </span>
                    <span role="cell" className="num">
                      {intl.formatNumber(entry.hits ?? 0)}
                    </span>
                    <span role="cell" className="num">
                      {intl.formatNumber(entry.misses ?? 0)}
                    </span>
                    <span role="cell" className="num">
                      {entry.age !== undefined
                        ? `${Math.round(entry.age / 1000)} s`
                        : '—'}
                    </span>
                    <span role="cell" className="actions">
                      <Button
                        type="button"
                        buttonSize="sm"
                        disabled={busy === `dns:${hostname}`}
                        aria-label={intl.formatMessage(messages.clearLabel, {
                          name: hostname,
                        })}
                        onClick={() => flushDns(hostname)}
                      >
                        {intl.formatMessage(messages.clear)}
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      )}

      {editing && (
        <Modal
          title={intl.formatMessage(messages.editTitle, { name: editing.name })}
          onCancel={() => setEditing(null)}
          cancelText={intl.formatMessage(messages.close)}
          onOk={saveSchedule}
          okText={intl.formatMessage(messages.saveSchedule)}
          okButtonType="primary"
          okDisabled={busy === `schedule:${editing.id}`}
        >
          <Field
            label={intl.formatMessage(messages.schedule)}
            hint={intl.formatMessage(messages.scheduleHint)}
            error={scheduleError}
          >
            {(p) => (
              <input
                {...p}
                type="text"
                className="font-mono"
                spellCheck={false}
                value={schedule}
                onChange={(e) => {
                  setSchedule(e.target.value);
                  setScheduleError(undefined);
                }}
              />
            )}
          </Field>
          {preview && (
            <p className="sh-sub" role="status">
              {intl.formatMessage(messages.scheduleReads, { text: preview })}
            </p>
          )}
        </Modal>
      )}
    </SettingsPage>
  );
};

export default SettingsJobsCache;
