// STREAM(SV3): implement — walk settings.localFiles.folders, read tags with
// music-metadata, generate waveform peaks, upsert Media/Track.
import type { LibraryScanner } from '@server/lib/scanners/stub';
import { notImplementedScanner } from '@server/lib/scanners/stub';

export const localFilesScanner: LibraryScanner =
  notImplementedScanner('Local Files Scan');

/**
 * Start/stop the chokidar watcher according to settings.localFiles.watch.
 * Called at boot (server/index.ts) and by the Local files settings route
 * whenever the section is saved. Must be idempotent.
 */
export const syncLocalFilesWatcher = async (): Promise<void> => undefined;
