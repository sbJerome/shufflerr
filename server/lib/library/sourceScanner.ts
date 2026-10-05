import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import type { ScanStatus } from '@server/interfaces/api/settingsInterfaces';
import type {
  RunnableScanner,
  StatusBase,
} from '@server/lib/scanners/baseScanner';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { countSource, detachSource } from './availability';
import { ingestAlbum, withLibraryLock } from './ingest';
import libraryState, { UNRESOLVED_RETRY_MS } from './state';
import type { LibrarySource, ScannedAlbum } from './types';

/** A source album as cheaply as the source can list it; `load` fetches the tracks. */
export interface AlbumStub {
  id: string;
  /** "Artist – Album", for logs and the unresolved list */
  label: string;
  /** Changes whenever the album's contents change in the source. */
  signature: string;
  library?: { id: string; name: string };
  load: () => Promise<ScannedAlbum | null>;
}

export interface RunOptions {
  /** Run even when a schedule-based throttle would skip this tick. */
  force?: boolean;
}

export type ScanMode = 'full' | 'recent';

const SETTINGS_SECTION = {
  plex: 'plex',
  jellyfin: 'jellyfin',
  navidrome: 'navidrome',
  local: 'localFiles',
} as const satisfies Record<LibrarySource, string>;

class ScanAborted extends Error {}

/**
 * Run loop shared by the Plex, Jellyfin, Navidrome and local-files scanners:
 * list albums → skip the unchanged ones → ingest the rest through the library
 * core → on a full run, detach whatever the source no longer has.
 */
export abstract class SourceScanner implements RunnableScanner<
  Partial<ScanStatus>
> {
  protected running = false;
  protected cancelled = false;
  private current = 0;
  private total = 0;
  private currentLibrary: { id: string; name: string } | null = null;
  private error: string | undefined;
  private counts = { albums: 0, tracks: 0 };
  private countsLoadedAt = 0;
  private lastSummary:
    | {
        ingested: number;
        skipped: number;
        unresolved: number;
        deferred: number;
      }
    | undefined;

  protected constructor(
    protected readonly name: string,
    public readonly source: LibrarySource,
    protected readonly mode: ScanMode
  ) {}

  /** List the albums this run should look at. Throw when the source cannot be read. */
  protected abstract collect(): Promise<AlbumStub[]>;

  /** Called after a successful run (not after a cancelled or failed one). */
  protected async afterRun(): Promise<void> {
    return;
  }

  /** Return false to skip this run (schedule throttles). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- overridden by scanners that throttle
  protected shouldRun(_options: RunOptions): boolean {
    return true;
  }

  protected log(
    message: string,
    level: 'info' | 'error' | 'debug' | 'warn' = 'debug',
    meta?: Record<string, unknown>
  ): void {
    logger[level](message, { label: this.name, ...meta });
  }

  protected setProgress(current: number, total: number): void {
    this.current = current;
    this.total = total;
  }

  protected assertNotCancelled(): void {
    if (this.cancelled) {
      throw new ScanAborted('The scan was cancelled.');
    }
  }

  public cancel(): void {
    if (this.running) {
      this.cancelled = true;
    }
  }

  public status(): Partial<ScanStatus> & StatusBase {
    // counts come from the database; refreshed in the background, never awaited here
    if (
      this.countsLoadedAt === 0 ||
      (this.running && Date.now() - this.countsLoadedAt > 10000)
    ) {
      this.countsLoadedAt = Date.now();
      void this.refreshCounts();
    }
    const section = getSettings()[SETTINGS_SECTION[this.source]];

    return {
      running: this.running,
      progress:
        this.running && this.total > 0
          ? Math.min(100, Math.round((this.current / this.total) * 100))
          : 0,
      current: this.current,
      total: this.total,
      currentLibrary: this.running ? this.currentLibrary : null,
      lastFullScan: section.lastFullScan,
      albums: this.counts.albums,
      tracks: this.counts.tracks,
      error: this.error,
    };
  }

  /** Counts of the last finished run (tests, logs). */
  public summary(): typeof this.lastSummary {
    return this.lastSummary;
  }

  public async refreshCounts(): Promise<void> {
    try {
      this.counts = await countSource(this.source);
      this.countsLoadedAt = Date.now();
    } catch (e) {
      this.log('Could not count library items', 'debug', {
        errorMessage: e.message,
      });
    }
  }

  public async run(options: RunOptions = {}): Promise<void> {
    if (this.running || !this.shouldRun(options)) {
      return;
    }
    this.running = true;
    this.cancelled = false;
    this.error = undefined;
    this.currentLibrary = null;
    this.setProgress(0, 0);

    const summary = { ingested: 0, skipped: 0, unresolved: 0, deferred: 0 };
    const startedAt = Date.now();

    try {
      this.log('Scan starting', 'info', { mode: this.mode });

      const stubs = await this.collect();
      this.assertNotCancelled();

      const knownMedia = new Set(
        (
          await getRepository(Media).find({
            select: { id: true },
            where: { mediaType: MediaType.RELEASE_GROUP },
          })
        ).map((media) => media.id)
      );
      const seenTrackIds = new Set<string>();
      const seenAlbumIds = new Set<string>();

      this.setProgress(0, stubs.length);

      for (const [index, stub] of stubs.entries()) {
        this.assertNotCancelled();
        this.currentLibrary = stub.library ?? null;
        seenAlbumIds.add(stub.id);

        const previous = libraryState.getAlbum(this.source, stub.id);
        previous?.trackIds.forEach((id) => seenTrackIds.add(id));

        if (previous && previous.signature === stub.signature) {
          const stillIndexed =
            !!previous.mbid &&
            !!previous.mediaId &&
            knownMedia.has(previous.mediaId);
          const waitingForMusicBrainz =
            previous.mbid === null &&
            Date.now() - previous.lastTried < UNRESOLVED_RETRY_MS;

          if (stillIndexed || waitingForMusicBrainz) {
            summary.skipped++;
            this.setProgress(index + 1, stubs.length);
            continue;
          }
        }

        const album = await stub.load();
        if (album && album.tracks.length > 0) {
          const outcome = await withLibraryLock(() => ingestAlbum(album));

          if (outcome.result === 'ingested') {
            summary.ingested++;
            outcome.apply?.attachedIds.forEach((id) => seenTrackIds.add(id));
            knownMedia.add(outcome.mediaId);
            libraryState.setAlbum(this.source, stub.id, {
              signature: stub.signature,
              mbid: outcome.mbid,
              mediaId: outcome.mediaId,
              trackIds: outcome.apply?.attachedIds ?? [],
              unmatched: outcome.apply?.unmatched.length ?? 0,
              attempts: (previous?.attempts ?? 0) + 1,
              lastTried: Date.now(),
              label: stub.label,
            });
          } else if (outcome.result === 'unresolved') {
            summary.unresolved++;
            libraryState.setAlbum(this.source, stub.id, {
              signature: stub.signature,
              mbid: null,
              trackIds: [],
              attempts: (previous?.attempts ?? 0) + 1,
              lastTried: Date.now(),
              label: stub.label,
            });
          } else {
            // nothing recorded: the next run tries again
            summary.deferred++;
            this.log('Album postponed', 'debug', {
              album: stub.label,
              reason: outcome.reason,
            });
          }
        }
        this.setProgress(index + 1, stubs.length);
      }

      if (this.mode === 'full') {
        if (stubs.length === 0) {
          // An empty listing is far more often an unmounted folder or an
          // unreachable server than a library that was really emptied; the
          // availability sync removes files that are truly gone.
          this.log(
            'The source listed no albums; nothing was removed from the library',
            'warn'
          );
        } else {
          await withLibraryLock(() =>
            detachSource(this.source, (id) => seenTrackIds.has(id))
          );
          libraryState.pruneAlbums(this.source, seenAlbumIds);
        }
        const settings = getSettings();
        settings[SETTINGS_SECTION[this.source]].lastFullScan = Date.now();
        await settings.save();
      }

      await this.afterRun();

      this.log('Scan complete', 'info', {
        ...summary,
        seconds: Math.round((Date.now() - startedAt) / 1000),
      });
    } catch (e) {
      if (e instanceof ScanAborted) {
        this.log('Scan cancelled', 'info');
      } else {
        this.error = e.message;
        this.log('Scan failed', 'error', { errorMessage: e.message });
      }
    } finally {
      this.lastSummary = summary;
      this.running = false;
      this.currentLibrary = null;
      libraryState.flush();
      await this.refreshCounts();
    }
  }
}

/** Merge the status of a source's full and recently-added scanners for the scan panel. */
export const combinedStatus = (
  full: SourceScanner,
  recent?: SourceScanner
): ScanStatus => {
  const active = recent?.status().running ? recent : full;
  const status = active.status();

  return {
    running: status.running,
    progress: status.progress,
    current: status.current,
    total: status.total,
    currentLibrary: status.currentLibrary,
    lastFullScan: status.lastFullScan,
    albums: status.albums ?? 0,
    tracks: status.tracks ?? 0,
    error: full.status().error ?? recent?.status().error,
  };
};
