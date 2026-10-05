// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
//
// STREAM(SV5): owns this file. All 15 jobs (docs/ADMIN_PAGES.md §Jobs) are
// registered here and call into the owning stream's module, so other streams
// only implement their module and never edit this file.
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
import schedule from 'node-schedule';

export interface ScheduledJob {
  id: JobId;
  job: schedule.Job;
  name: string;
  type: 'process' | 'command';
  interval: 'seconds' | 'minutes' | 'hours' | 'days' | 'fixed';
  cronSchedule: string;
  running?: () => boolean;
  cancelFn?: () => void;
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

/** Guards jobs that are plain async functions against overlapping runs. */
const single = (fn: () => Promise<void>) => {
  let active = false;
  return {
    run: async () => {
      if (active) {
        return;
      }
      active = true;
      try {
        await fn();
      } finally {
        active = false;
      }
    },
    running: () => active,
  };
};

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
      interval: 'seconds',
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
      ...single(syncSpotifySavedAlbums),
    },
    {
      id: 'scrobble-queue',
      name: 'Scrobble queue',
      type: 'command',
      interval: 'seconds',
      quiet: true,
      enabled: () => on().listenbrainz || on().lastfmScrobble,
      ...single(processScrobbleQueue),
    },
    {
      id: 'concerts-refresh',
      name: 'Concert listings refresh',
      type: 'process',
      interval: 'hours',
      enabled: () => on().ticketmaster || on().skiddle,
      ...single(refreshConcerts),
    },
    {
      id: 'image-cache-cleanup',
      name: 'Image cache cleanup',
      type: 'process',
      interval: 'hours',
      run: () => {
        [...imageSourceTypes(), 'avatar'].forEach((key) =>
          ImageProxy.clearCache(key)
        );
      },
    },
  ];
};

/** Run a job's body now (used by the schedule and by "Run now"). */
const execute = (def: JobDefinition, manual = false): void => {
  if (!manual && def.enabled && !def.enabled()) {
    return;
  }
  logger[def.quiet ? 'debug' : 'info'](`Starting scheduled job: ${def.name}`, {
    label: 'Jobs',
  });
  Promise.resolve()
    .then(() => def.run())
    .catch((e) => {
      logger.error(`Scheduled job failed: ${def.name}`, {
        label: 'Jobs',
        errorMessage: e.message,
      });
    });
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
      job: schedule.scheduleJob(cronSchedule, () => execute(def)),
      running: def.running,
      cancelFn: def.cancel,
    });
  }

  logger.info('Scheduled jobs loaded', { label: 'Jobs' });
};

/** "Run now" from Settings → Jobs: runs the job even when its integration is off. */
export const runJobNow = (jobId: JobId): boolean => {
  const def = jobDefinitions().find((d) => d.id === jobId);
  if (!def) {
    return false;
  }
  execute(def, true);
  return true;
};
