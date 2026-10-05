import logger from '@server/logger';
import { appDataPath } from '@server/utils/appDataVolume';
import fs from 'fs';
import path from 'path';
import type { LibrarySource } from './types';

/**
 * Scanner bookkeeping that does not belong in the schema: which source album
 * resolved to which release group, what it looked like when it was last
 * ingested (so unchanged albums are skipped), and which albums MusicBrainz
 * could not identify yet (so they are retried later instead of being lost or
 * given an invented id).
 *
 * Stored as JSON next to the database: <config>/db/library-state.json.
 * Deleting the file is safe — the next scan simply re-ingests everything.
 */
export interface AlbumState {
  /** Fingerprint of the album's contents at the last ingest attempt. */
  signature: string;
  /** Release-group MBID it resolved to; null = MusicBrainz had no match. */
  mbid: string | null;
  mediaId?: number;
  /** Source track ids that were attached at the last ingest (keeps skipped albums out of the removal sweep). */
  trackIds: string[];
  /** Tracks of the album that matched nothing on the canonical tracklist. */
  unmatched?: number;
  attempts: number;
  lastTried: number;
  /** Shown to admins for unresolved albums. */
  label?: string;
}

export interface LocalFileState {
  mtimeMs: number;
  size: number;
  /** Parsed tags (see scanners/local/tags.ts). */
  tags: unknown;
}

interface StateFile {
  version: 1;
  albums: Record<string, AlbumState>;
  files: Record<string, LocalFileState>;
}

/** How long before an album MusicBrainz could not identify is looked up again. */
export const UNRESOLVED_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

const emptyState = (): StateFile => ({ version: 1, albums: {}, files: {} });

class LibraryState {
  private data: StateFile | undefined;
  private saveTimer: NodeJS.Timeout | undefined;
  private filePath: string | null | undefined;

  /** Tests: keep state in memory only. */
  public useMemory(): void {
    this.filePath = null;
    this.data = emptyState();
  }

  private path(): string | null {
    if (this.filePath === undefined) {
      this.filePath =
        process.env.NODE_ENV === 'test'
          ? null
          : path.join(appDataPath(), 'db', 'library-state.json');
    }
    return this.filePath;
  }

  private load(): StateFile {
    if (this.data) {
      return this.data;
    }
    const file = this.path();
    this.data = emptyState();
    if (file && fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as StateFile;
        if (parsed?.version === 1) {
          this.data = {
            version: 1,
            albums: parsed.albums ?? {},
            files: parsed.files ?? {},
          };
        }
      } catch (e) {
        logger.warn('Library scan state was unreadable and has been reset', {
          label: 'Library',
          errorMessage: e.message,
        });
      }
    }
    return this.data;
  }

  private key(source: LibrarySource, albumId: string): string {
    return `${source}:${albumId}`;
  }

  public getAlbum(
    source: LibrarySource,
    albumId: string
  ): AlbumState | undefined {
    return this.load().albums[this.key(source, albumId)];
  }

  public setAlbum(
    source: LibrarySource,
    albumId: string,
    state: AlbumState
  ): void {
    this.load().albums[this.key(source, albumId)] = state;
    this.scheduleSave();
  }

  /** Drop entries of a source whose album id was not seen in a full run. */
  public pruneAlbums(source: LibrarySource, seen: Set<string>): number {
    const albums = this.load().albums;
    const prefix = `${source}:`;
    let removed = 0;
    for (const key of Object.keys(albums)) {
      if (key.startsWith(prefix) && !seen.has(key.slice(prefix.length))) {
        delete albums[key];
        removed++;
      }
    }
    if (removed) {
      this.scheduleSave();
    }
    return removed;
  }

  public albumsOf(source: LibrarySource): [string, AlbumState][] {
    const prefix = `${source}:`;
    return Object.entries(this.load().albums)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), value]);
  }

  /** Albums of a source MusicBrainz could not identify (admin-facing). */
  public unresolved(source: LibrarySource): string[] {
    return this.albumsOf(source)
      .filter(([, state]) => state.mbid === null)
      .map(([id, state]) => state.label ?? id);
  }

  public getFile(filePath: string): LocalFileState | undefined {
    return this.load().files[filePath];
  }

  public setFile(filePath: string, state: LocalFileState): void {
    this.load().files[filePath] = state;
    this.scheduleSave();
  }

  public pruneFiles(seen: Set<string>): void {
    const files = this.load().files;
    let removed = false;
    for (const key of Object.keys(files)) {
      if (!seen.has(key)) {
        delete files[key];
        removed = true;
      }
    }
    if (removed) {
      this.scheduleSave();
    }
  }

  private scheduleSave(): void {
    if (!this.path() || this.saveTimer) {
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.flush();
    }, 2000);
    this.saveTimer.unref?.();
  }

  public flush(): void {
    const file = this.path();
    if (!file || !this.data) {
      return;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, file);
    } catch (e) {
      logger.error('Could not save the library scan state', {
        label: 'Library',
        errorMessage: e.message,
      });
    }
  }
}

const libraryState = new LibraryState();
export default libraryState;
