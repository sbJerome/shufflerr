// Local files scanner: walks settings.localFiles.folders, reads tags with
// music-metadata, feeds albums to the library core, queues waveform peaks.
import { enqueuePeaks, tracksMissingPeaks } from '@server/lib/library/peaks';
import type { AlbumStub, RunOptions } from '@server/lib/library/sourceScanner';
import { SourceScanner } from '@server/lib/library/sourceScanner';
import libraryState from '@server/lib/library/state';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { FSWatcher } from 'chokidar';
import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import type { ScannedFile } from './group';
import { groupFiles } from './group';
import type { FileTags } from './tags';
import { isAudioFile, readTags } from './tags';

const TAG_READ_PARALLEL = 8;
const WATCH_DEBOUNCE_MS = 5000;
const MAX_DEPTH = 12;

/** Every audio file below a folder. Throws when the folder itself cannot be read. */
export const walkFolder = async (
  root: string,
  shouldContinue: () => boolean = () => true
): Promise<{ path: string; mtimeMs: number; size: number }[]> => {
  const found: { path: string; mtimeMs: number; size: number }[] = [];

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (!shouldContinue() || depth > MAX_DEPTH) {
      return;
    }
    let dir;
    try {
      dir = await fs.promises.opendir(directory);
    } catch (e) {
      if (depth === 0) {
        throw new Error(
          `The folder ${root} can't be read (${e.code ?? e.message}). Check that it is mounted and readable.`
        );
      }
      return;
    }
    for await (const entry of dir) {
      if (entry.name.startsWith('.') || entry.name.startsWith('@')) {
        continue;
      }
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (
        (entry.isFile() || entry.isSymbolicLink()) &&
        isAudioFile(entry.name)
      ) {
        try {
          const stat = await fs.promises.stat(full);
          if (stat.isFile()) {
            found.push({
              path: full,
              mtimeMs: Math.round(stat.mtimeMs),
              size: stat.size,
            });
          }
        } catch {
          // vanished or unreadable between listing and stat
        }
      }
    }
  };

  await walk(root, 0);
  return found;
};

class LocalFilesScanner extends SourceScanner {
  private lastFinished = 0;
  /** A change arrived while a scan was running. */
  public rerunRequested = false;

  constructor() {
    super('Local Files Scan', 'local', 'full');
  }

  /**
   * The schedule ticks every 15 minutes; "Full rescan: hourly / daily" is
   * honoured by skipping scheduled ticks that come too soon. Scans started
   * from the settings page or the folder watcher always run (`force`).
   */
  protected shouldRun(options: RunOptions): boolean {
    if (options.force) {
      return true;
    }
    const minutes = getSettings().localFiles.rescanMinutes;
    return (
      minutes <= 15 ||
      this.lastFinished === 0 ||
      Date.now() - this.lastFinished >= minutes * 60000 - 30000
    );
  }

  protected async collect(): Promise<AlbumStub[]> {
    const folders = getSettings().localFiles.folders;
    const listed: { path: string; mtimeMs: number; size: number }[] = [];

    for (const folder of folders) {
      listed.push(...(await walkFolder(folder, () => !this.cancelled)));
      this.assertNotCancelled();
    }

    // Read tags only for new or changed files
    const files: ScannedFile[] = [];
    const pending = [...listed];
    let done = 0;
    this.setProgress(0, listed.length);

    const worker = async (): Promise<void> => {
      for (;;) {
        const file = pending.pop();
        if (!file || this.cancelled) {
          return;
        }
        const cached = libraryState.getFile(file.path);
        let tags: FileTags | undefined;
        if (
          cached &&
          cached.mtimeMs === file.mtimeMs &&
          cached.size === file.size
        ) {
          tags = cached.tags as FileTags;
        } else {
          try {
            tags = await readTags(file.path);
          } catch (e) {
            // unreadable tags: the file is still music, fall back to its path
            this.log('Tags could not be read', 'debug', {
              file: file.path,
              errorMessage: e.message,
            });
            tags = {};
          }
          libraryState.setFile(file.path, {
            mtimeMs: file.mtimeMs,
            size: file.size,
            tags,
          });
        }
        files.push({ ...file, tags });
        this.setProgress(++done, listed.length);
      }
    };
    await Promise.all(
      Array.from({ length: TAG_READ_PARALLEL }, () => worker())
    );
    this.assertNotCancelled();

    libraryState.pruneFiles(new Set(listed.map((file) => file.path)));

    return groupFiles(files);
  }

  protected async afterRun(): Promise<void> {
    this.lastFinished = Date.now();
    enqueuePeaks(await tracksMissingPeaks());
  }

  public async run(options: RunOptions = {}): Promise<void> {
    await super.run(options);
    if (this.rerunRequested && !this.cancelled) {
      this.rerunRequested = false;
      await super.run({ force: true });
    }
  }
}

export const localFilesScanner = new LocalFilesScanner();

// ---- folder watcher ---------------------------------------------------------

let watcher: FSWatcher | undefined;
let watchedFolders = '';
let debounce: NodeJS.Timeout | undefined;

const onChange = (changedPath: string): void => {
  if (!isAudioFile(changedPath)) {
    return;
  }
  if (debounce) {
    clearTimeout(debounce);
  }
  debounce = setTimeout(() => {
    debounce = undefined;
    if (localFilesScanner.status().running) {
      localFilesScanner.rerunRequested = true;
      return;
    }
    logger.info('Music folder changed, scanning', {
      label: 'Local Files Scan',
    });
    void localFilesScanner.run({ force: true });
  }, WATCH_DEBOUNCE_MS);
};

/**
 * Start/stop the chokidar watcher according to settings.localFiles. Called at
 * boot (server/index.ts) and by the Local files settings route whenever the
 * section is saved. Idempotent.
 */
export const syncLocalFilesWatcher = async (): Promise<void> => {
  const { enabled, watch, folders } = getSettings().localFiles;
  const wanted = enabled && watch && folders.length > 0;
  const key = wanted ? [...folders].sort().join('\n') : '';

  if (key === watchedFolders) {
    return;
  }
  if (watcher) {
    await watcher.close();
    watcher = undefined;
  }
  watchedFolders = key;
  if (!wanted) {
    return;
  }

  watcher = chokidar.watch(folders, {
    ignoreInitial: true,
    depth: MAX_DEPTH,
    ignored: (candidate: string) => path.basename(candidate).startsWith('.'),
    // wait until a copy has finished before looking at the file
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
  });
  watcher
    .on('add', onChange)
    .on('change', onChange)
    .on('unlink', onChange)
    .on('error', (e) =>
      logger.warn('Watching the music folders failed', {
        label: 'Local Files Scan',
        errorMessage: (e as Error).message,
      })
    );
  logger.info('Watching music folders for changes', {
    label: 'Local Files Scan',
    folders,
  });
};
