// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Music availability sync: checks that what the library index says is playable
// still exists, steps statuses back when it does not, and completes requests
// whose scope is now fully present.
import { detachSource, recomputeAll } from '@server/lib/library/availability';
import { withLibraryLock } from '@server/lib/library/ingest';
import libraryState from '@server/lib/library/state';
import type { LibrarySource } from '@server/lib/library/types';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import fs from 'fs';
import path from 'path';

const LABEL = 'Availability Sync';

const readable = async (target: string): Promise<boolean> => {
  try {
    await fs.promises.access(target, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

class AvailabilitySync {
  public running = false;
  private cancelled = false;

  async run(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.cancelled = false;

    try {
      logger.info('Starting music availability sync', { label: LABEL });
      const settings = getSettings();
      const integrations = settings.integrations;
      let removed = 0;

      // A source that was switched off no longer provides anything. Its scan
      // state goes too, so switching it back on re-ingests instead of skipping.
      const remote: [LibrarySource, boolean][] = [
        ['plex', integrations.plex],
        ['jellyfin', integrations.jellyfin],
        ['navidrome', integrations.navidrome],
        ['local', integrations.localFiles],
      ];
      for (const [source, enabled] of remote) {
        if (this.cancelled) {
          return;
        }
        if (!enabled) {
          const count = await withLibraryLock(() =>
            detachSource(source, () => false)
          );
          if (count > 0 || libraryState.albumsOf(source).length > 0) {
            libraryState.pruneAlbums(source, new Set());
          }
          removed += count;
        }
      }

      // Local files: every indexed file must still be there. A folder that
      // cannot be read at all (unmounted share) is left alone — its files are
      // not "gone", the folder is.
      if (integrations.localFiles && !this.cancelled) {
        const roots = await Promise.all(
          settings.localFiles.folders.map(async (folder) => ({
            root: path.resolve(folder),
            readable:
              (await readable(folder)) &&
              (await fs.promises.readdir(folder).catch(() => [])).length > 0,
          }))
        );
        removed += await withLibraryLock(() =>
          detachSource('local', async (filePath) => {
            const resolved = path.resolve(filePath);
            const root = roots.find(
              (r) =>
                resolved === r.root ||
                resolved.startsWith(`${r.root}${path.sep}`)
            );
            if (!root) {
              return false; // folder was removed from the settings
            }
            return !root.readable || (await readable(filePath));
          })
        );
      }

      // Plex / Jellyfin / Navidrome removals are detected by their full scans
      // (anything a full scan no longer lists is detached).

      const result = await withLibraryLock(() =>
        recomputeAll(() => !this.cancelled)
      );

      logger.info('Music availability sync complete', {
        label: LABEL,
        tracksRemoved: removed,
        ...result,
      });
    } catch (e) {
      logger.error('Music availability sync failed', {
        label: LABEL,
        errorMessage: e.message,
      });
    } finally {
      libraryState.flush();
      this.running = false;
    }
  }

  public cancel(): void {
    this.cancelled = true;
  }
}

const availabilitySync = new AvailabilitySync();
export default availabilitySync;
