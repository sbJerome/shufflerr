// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: src/components/Settings/SettingsLogs/index.tsx at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import { SettingsPage, useCopy } from '@app/components/Settings/shared';
import useDebouncedState from '@app/hooks/useDebouncedState';
import defineMessages from '@app/utils/defineMessages';
import type {
  LogMessage,
  LogsResultsResponse,
} from '@server/interfaces/api/settingsInterfaces';
import { useId, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Settings.SettingsLogs', {
  title: 'Logs',
  description: 'What the server has been doing. New lines appear at the top.',
  filterLabel: 'Filter logs',
  levelLabel: 'Level',
  all: 'All levels',
  debug: 'Debug',
  info: 'Info',
  warn: 'Warning',
  error: 'Error',
  pause: 'Pause',
  resume: 'Resume',
  paused: 'Paused. New lines aren’t shown until you resume.',
  time: 'Time',
  level: 'Level',
  label: 'Label',
  message: 'Message',
  empty: 'No log lines match.',
  details: 'Details',
  detailsLabel: 'Show details for the log line from {time}',
  detailsTitle: 'Log line',
  extra: 'Extra data',
  copy: 'Copy to clipboard',
  copied: 'Copied the log line.',
  close: 'Close',
  showing: 'Showing {from, number}–{to, number} of {total, number} lines',
  previous: 'Newer',
  next: 'Older',
  rows: 'Lines per page',
});

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const GRID = '170px 80px 130px minmax(260px,1fr) 90px';

const SettingsLogs = () => {
  const intl = useIntl();
  const copy = useCopy();
  const searchId = useId();
  const levelId = useId();
  const rowsId = useId();
  const [level, setLevel] = useState<'all' | (typeof LEVELS)[number]>('all');
  const [searchText, search, setSearch] = useDebouncedState('', 300);
  const [paused, setPaused] = useState(false);
  const [page, setPage] = useState(0);
  const [take, setTake] = useState(25);
  const [active, setActive] = useState<LogMessage | null>(null);

  const query = new URLSearchParams({
    take: String(take),
    skip: String(page * take),
  });
  if (level !== 'all') {
    query.set('filter', level);
  }
  if (search) {
    query.set('search', search);
  }

  const { data, error } = useSWR<LogsResultsResponse>(
    `/api/v1/settings/logs?${query.toString()}`,
    {
      // Live append: newest first, so polling page 0 shows new lines at the top.
      refreshInterval: paused ? 0 : 5000,
      revalidateOnFocus: !paused,
      isPaused: () => paused,
      keepPreviousData: true,
    }
  );

  const formatTime = (timestamp: string) =>
    intl.formatDate(timestamp, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

  const lineText = (line: LogMessage) =>
    `${line.timestamp} [${line.level}]${line.label ? `[${line.label}]` : ''}: ${line.message}${
      line.data ? ` ${JSON.stringify(line.data)}` : ''
    }`;

  const total = data?.pageInfo?.results ?? 0;
  const from = total === 0 ? 0 : page * take + 1;
  const to = Math.min(total, (page + 1) * take);

  return (
    <SettingsPage
      title={intl.formatMessage(messages.title)}
      description={intl.formatMessage(messages.description)}
      loading={!data && !error}
      loadError={error && !data ? error : undefined}
    >
      <div className="sh-toolbar">
        <div className="sh-field min-w-[220px] flex-1">
          <label htmlFor={searchId}>
            {intl.formatMessage(messages.filterLabel)}
          </label>
          <input
            id={searchId}
            type="search"
            placeholder={intl.formatMessage(messages.filterLabel)}
            value={searchText}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <div className="sh-field">
          <label htmlFor={levelId}>
            {intl.formatMessage(messages.levelLabel)}
          </label>
          <select
            id={levelId}
            value={level}
            onChange={(e) => {
              setLevel(e.target.value as typeof level);
              setPage(0);
            }}
          >
            <option value="all">{intl.formatMessage(messages.all)}</option>
            {LEVELS.map((value) => (
              <option key={value} value={value}>
                {intl.formatMessage(messages[value])}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          aria-pressed={paused}
          onClick={() => setPaused((p) => !p)}
        >
          {intl.formatMessage(paused ? messages.resume : messages.pause)}
        </Button>
      </div>
      {paused && (
        <p className="sh-sub" role="status">
          {intl.formatMessage(messages.paused)}
        </p>
      )}

      <div className="sh-box sh-scroll-x">
        <div
          className="sh-table"
          role="table"
          aria-label={intl.formatMessage(messages.title)}
        >
          <div
            className="sh-tr head"
            role="row"
            style={{ gridTemplateColumns: GRID }}
          >
            <span role="columnheader">{intl.formatMessage(messages.time)}</span>
            <span role="columnheader">
              {intl.formatMessage(messages.level)}
            </span>
            <span role="columnheader">
              {intl.formatMessage(messages.label)}
            </span>
            <span role="columnheader">
              {intl.formatMessage(messages.message)}
            </span>
            <span role="columnheader" className="sr-only">
              {intl.formatMessage(messages.details)}
            </span>
          </div>
          {(data?.results ?? []).map((line, index) => (
            <div
              key={`${line.timestamp}-${index}`}
              className="sh-tr"
              role="row"
              style={{ gridTemplateColumns: GRID }}
            >
              <span role="cell" className="sh-mono-s dim">
                {formatTime(line.timestamp)}
              </span>
              <span role="cell">
                <span
                  className={`sh-lvl ${
                    (LEVELS as readonly string[]).includes(line.level)
                      ? line.level
                      : 'info'
                  }`}
                >
                  {line.level}
                </span>
              </span>
              <span role="cell" className="sh-mono-s dim break-all">
                {line.label ?? ''}
              </span>
              <span role="cell" className="sh-mono-s break-words">
                {line.message}
              </span>
              <span role="cell" className="actions">
                <Button
                  type="button"
                  buttonSize="sm"
                  aria-label={intl.formatMessage(messages.detailsLabel, {
                    time: formatTime(line.timestamp),
                  })}
                  onClick={() => setActive(line)}
                >
                  {intl.formatMessage(messages.details)}
                </Button>
              </span>
            </div>
          ))}
          {data && data.results.length === 0 && (
            <div className="sh-tr" role="row">
              <span role="cell" className="dim">
                {intl.formatMessage(messages.empty)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="sh-sub">
          {intl.formatMessage(messages.showing, { from, to, total })}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={rowsId} className="!mb-0">
            {intl.formatMessage(messages.rows)}
          </label>
          <select
            id={rowsId}
            className="!w-auto !flex-none"
            value={take}
            onChange={(e) => {
              setTake(Number(e.target.value));
              setPage(0);
            }}
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <Button
            type="button"
            buttonSize="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            {intl.formatMessage(messages.previous)}
          </Button>
          <Button
            type="button"
            buttonSize="sm"
            disabled={to >= total}
            onClick={() => {
              // Paging back in time while new lines arrive would shift rows: pause.
              setPaused(true);
              setPage((p) => p + 1);
            }}
          >
            {intl.formatMessage(messages.next)}
          </Button>
        </div>
      </div>

      {active && (
        <Modal
          title={intl.formatMessage(messages.detailsTitle)}
          onCancel={() => setActive(null)}
          cancelText={intl.formatMessage(messages.close)}
          onOk={() =>
            copy(lineText(active), intl.formatMessage(messages.copied))
          }
          okText={intl.formatMessage(messages.copy)}
          okButtonType="primary"
        >
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-[14px] [&_dt]:text-faint">
            <dt>{intl.formatMessage(messages.time)}</dt>
            <dd className="font-mono">{formatTime(active.timestamp)}</dd>
            <dt>{intl.formatMessage(messages.level)}</dt>
            <dd>
              <span
                className={`sh-lvl ${
                  (LEVELS as readonly string[]).includes(active.level)
                    ? active.level
                    : 'info'
                }`}
              >
                {active.level}
              </span>
            </dd>
            {active.label && (
              <>
                <dt>{intl.formatMessage(messages.label)}</dt>
                <dd className="font-mono">{active.label}</dd>
              </>
            )}
            <dt>{intl.formatMessage(messages.message)}</dt>
            <dd className="break-words font-mono text-[13px]">
              {active.message}
            </dd>
          </dl>
          {active.data && Object.keys(active.data).length > 0 && (
            <div>
              <span className="group-label">
                {intl.formatMessage(messages.extra)}
              </span>
              <pre className="max-h-[320px] overflow-auto rounded-ctl border border-line bg-raised p-3 font-mono text-[12px]">
                {JSON.stringify(active.data, null, 2)}
              </pre>
            </div>
          )}
        </Modal>
      )}
    </SettingsPage>
  );
};

export default SettingsLogs;
