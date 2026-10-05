// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
//
// All 15 jobs (docs/ADMIN_PAGES.md §Jobs) are registered here and call into the
// module that implements them. Jobs are always registered; a tick is skipped
// while the integration behind the job is switched off.
import type { JobItem } from '@server/interfaces/api/settingsInterfaces';
import availabilitySync from '@server/lib/availabilitySync';
import { refreshConcerts } from '@server/lib/concerts';
import downloadTracker from '@server/lib/downloadtracker';
import { imageSourceTypes } from '@server/lib/imageSources';
import ImageProxy from '@server/lib/imageproxy';
import { syncSpotifySavedAlbums } from '@server/lib/import';
import refreshToken from '@server/lib/refreshToken';
import {
  jellyfinFullScanner,
  jellyfinRecentScanner,
} from '@server/lib/scanners/jellyfin';
import { lidarrScanner } from '@server/lib/scanners/lidarr';
import { localFilesScanner } from '@server/lib/scanners/local';
import { plexFullScanner, plexRecentScanner } from '@server/lib/scanners/plex';
import { navidromeScanner } from '@server/lib/scanners/subsonic';
import { processScrobbleQueue } from '@server/lib/scrobble';
import type { JobId } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import cronstrue from 'cronstrue';
import schedule from 'node-schedule';

export interface ScheduledJob {
  id: JobId;
  job: schedule.Job;
  name: string;
  type: 'process' | 'command';
  interval: 'seconds' | 'minutes' | 'hours' | 'days' | 'fixed';
  cronSchedule: string;
  /** True while the job body is executing (scheduled or "Run now"). */
  running: () => boolean;
  cancelFn?: () => void;
  /** False while the integration behind the job is switched off. */
  enabled: () => boolean;
}

interface JobDefinition {
  id: JobId;
  name: string;
  type: 'process' | 'command';
  interval: ScheduledJob['interval'];
  /** Skip the tick (silently) when the integration behind the job is off. */
  enabled?: () => boolean;
  /** Log at debug instead of info (very frequent jobs). */
  quiet?: boolean;
  run: () => unknown;
  running?: () => boolean;
  cancel?: () => void;
}

export const scheduledJobs: ScheduledJob[] = [];

const scanner = (s: {
  run: () => Promise<void>;
  status: () => { running: boolean };
  cancel: () => void;
}) => ({
  run: () => s.run(),
  running: () => s.status().running,
  cancel: () => s.cancel(),
});

/** Job ids whose body is executing right now. */
const activeRuns = new Set<JobId>();

const jobDefinitions = (): JobDefinition[] => {
  const settings = getSettings();
  const on = () => settings.integrations;

  return [
    {
      id: 'plex-recently-added-scan',
      name: 'Plex recently added scan',
      type: 'process',
      interval: 'minutes',
      enabled: () => on().plex,
      ...scanner(plexRecentScanner),
    },
    {
      id: 'plex-full-scan',
      name: 'Plex full library scan',
      type: 'process',
      interval: 'hours',
      enabled: () => on().plex,
      ...scanner(plexFullScanner),
    },
    {
      id: 'plex-refresh-token',
      name: 'Plex refresh token',
      type: 'process',
      interval: 'fixed',
      run: () => refreshToken.run(),
    },
    {
      id: 'jellyfin-recently-added-scan',
      name: 'Jellyfin recently added scan',
      type: 'process',
      interval: 'minutes',
      enabled: () => on().jellyfin,
      ...scanner(jellyfinRecentScanner),
    },
    {
      id: 'jellyfin-full-scan',
      name: 'Jellyfin full library scan',
      type: 'process',
      interval: 'hours',
      enabled: () => on().jellyfin,
      ...scanner(jellyfinFullScanner),
    },
    {
      id: 'navidrome-scan',
      name: 'Navidrome library scan',
      type: 'process',
      interval: 'minutes',
      enabled: () => on().navidrome,
      ...scanner(navidromeScanner),
    },
    {
      id: 'local-files-scan',
      name: 'Local files scan',
      type: 'process',
      interval: 'minutes',
      enabled: () => on().localFiles,
      ...scanner(localFilesScanner),
    },
    {
      id: 'lidarr-scan',
      name: 'Lidarr scan',
      type: 'process',
      interval: 'hours',
      enabled: () => on().lidarr,
      ...scanner(lidarrScanner),
    },
    {
      id: 'download-sync',
      name: 'Download sync',
      type: 'command',
      interval: 'minutes',
      quiet: true,
      enabled: () => on().lidarr,
      run: () => downloadTracker.updateDownloads(),
    },
    {
      id: 'download-sync-reset',
      name: 'Download sync reset',
      type: 'command',
      interval: 'hours',
      run: () => downloadTracker.resetDownloadTracker(),
    },
    {
      id: 'availability-sync',
      name: 'Music availability sync',
      type: 'process',
      interval: 'hours',
      run: () => availabilitySync.run(),
      running: () => availabilitySync.running,
      cancel: () => availabilitySync.cancel(),
    },
    {
      id: 'spotify-saved-albums-sync',
      name: 'Spotify playlist sync',
      type: 'process',
      interval: 'hours',
      enabled: () =>
        on().spotify && settings.discover.spotify.savedAlbumsSync !== 'never',
      run: () => syncSpotifySavedAlbums(),
    },
    {
      id: 'scrobble-queue',
      name: 'Scrobble queue',
      type: 'command',
      interval: 'seconds',
      quiet: true,
      enabled: () => on().listenbrainz || on().lastfmScrobble,
      run: () => processScrobbleQueue(),
    },
    {
      id: 'concerts-refresh',
      name: 'Concert listings refresh',
      type: 'process',
      interval: 'hours',
      enabled: () => on().ticketmaster || on().skiddle,
      run: () => refreshConcerts(),
    },
    {
      id: 'image-cache-cleanup',
      name: 'Image cache cleanup',
      type: 'process',
      interval: 'hours',
      run: () => cleanImageCache(),
    },
  ];
};

/** Removes expired files from every image cache folder. */
export const cleanImageCache = async (): Promise<void> => {
  for (const key of [...imageSourceTypes(), 'avatar']) {
    await ImageProxy.clearCache(key);
  }
};

const isRunning = (def: JobDefinition): boolean =>
  activeRuns.has(def.id) || (def.running ? def.running() : false);

/**
 * Run a job's body now (used by the schedule and by "Run now"). A job never
 * overlaps itself: a tick that arrives while the previous run is still going
 * is dropped.
 */
const execute = async (def: JobDefinition, manual = false): Promise<void> => {
  if (!manual && def.enabled && !def.enabled()) {
    return;
  }
  if (isRunning(def)) {
    logger.debug(`Skipped job, the last run is still going: ${def.name}`, {
      label: 'Jobs',
    });
    return;
  }
  logger[def.quiet && !manual ? 'debug' : 'info'](
    `Starting ${manual ? 'job (run now)' : 'scheduled job'}: ${def.name}`,
    { label: 'Jobs' }
  );
  activeRuns.add(def.id);
  try {
    await def.run();
  } catch (e) {
    logger.error(`Job failed: ${def.name}`, {
      label: 'Jobs',
      errorMessage: e.message,
    });
  } finally {
    activeRuns.delete(def.id);
  }
};

export const startJobs = (): void => {
  // Idempotent: the first user being created (setup) may call this again.
  if (scheduledJobs.length > 0) {
    return;
  }

  const jobs = getSettings().jobs;

  for (const def of jobDefinitions()) {
    const cronSchedule = jobs[def.id].schedule;
    scheduledJobs.push({
      id: def.id,
      name: def.name,
      type: def.type,
      interval: def.interval,
      cronSchedule,
      job: schedule.scheduleJob(cronSchedule, () => void execute(def)),
      running: () => isRunning(def),
      cancelFn: def.cancel,
      enabled: () => (def.enabled ? def.enabled() : true),
    });
  }

  logger.info('Scheduled jobs loaded', { label: 'Jobs' });
};

/** Stops every job timer (tests, shutdown). */
export const stopJobs = (): void => {
  for (const job of scheduledJobs) {
    job.job?.cancel();
  }
  scheduledJobs.length = 0;
};

/** "Run now" from Settings → Jobs: runs the job even when its integration is off. */
export const runJobNow = (jobId: JobId): boolean => {
  const def = jobDefinitions().find((d) => d.id === jobId);
  if (!def) {
    return false;
  }
  void execute(def, true);
  return true;
};

/** Asks a running job to stop. Returns false when the job can't be cancelled. */
export const cancelJob = (jobId: JobId): boolean => {
  const job = scheduledJobs.find((j) => j.id === jobId);
  if (!job?.cancelFn) {
    return false;
  }
  job.cancelFn();
  return true;
};

/** "Every 5 minutes", "At 03:00 AM" … for a 6-field cron expression. */
export const describeSchedule = (cron: string): string => {
  try {
    return cronstrue.toString(cron, { verbose: false });
  } catch {
    return cron;
  }
};

/** A 6-field (seconds first) cron expression node-schedule can run. */
export const isValidSchedule = (cron: unknown): cron is string => {
  if (typeof cron !== 'string' || cron.trim().split(/\s+/).length !== 6) {
    return false;
  }
  try {
    cronstrue.toString(cron);
  } catch {
    return false;
  }
  // node-schedule is the final judge: an expression it can't parse never fires.
  const probe = schedule.scheduleJob(cron, () => undefined);
  if (!probe) {
    return false;
  }
  const next = probe.nextInvocation();
  probe.cancel();
  return !!next;
};

/**
 * Changes when a job runs: saved in settings.jobs and applied to the live
 * timer. Returns false when the job is unknown or the expression is invalid.
 */
export const setJobSchedule = async (
  jobId: JobId,
  cron: string
): Promise<boolean> => {
  const settings = getSettings();
  if (!settings.jobs[jobId] || !isValidSchedule(cron)) {
    return false;
  }
  const cronSchedule = cron.trim();

  const job = scheduledJobs.find((j) => j.id === jobId);
  if (job) {
    if (!schedule.rescheduleJob(job.job, cronSchedule)) {
      return false;
    }
    job.cronSchedule = cronSchedule;
  }

  settings.jobs[jobId].schedule = cronSchedule;
  await settings.save();
  return true;
};

/** GET /settings/jobs item. */
export const jobItem = (job: ScheduledJob): JobItem => {
  const next = job.job?.nextInvocation();
  return {
    id: job.id,
    name: job.name,
    type: job.type,
    interval: job.interval,
    cronSchedule: job.cronSchedule,
    scheduleText: describeSchedule(job.cronSchedule),
    nextExecutionTime: next ? new Date(next.getTime()).toISOString() : null,
    running: job.running(),
    enabled: job.enabled(),
    cancellable: !!job.cancelFn,
  };
};
