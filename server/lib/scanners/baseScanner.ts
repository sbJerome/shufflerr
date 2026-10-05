// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import logger from '@server/logger';
import { randomUUID } from 'crypto';

// Default scan rates (can be overridden)
const BUNDLE_SIZE = 20;
const UPDATE_RATE = 4 * 1000;

export type StatusBase = {
  running: boolean;
  /** Items processed so far in this run */
  progress: number;
  /** Items in this run */
  total: number;
};

export interface RunnableScanner<T = unknown> {
  run: () => Promise<void>;
  status: () => T & StatusBase;
  cancel: () => void;
}

/**
 * Generic run loop shared by the library scanners (Plex, Jellyfin, Navidrome,
 * local files, Lidarr). Seerr's movie/TV processing was removed; the matching
 * and Media/Track upserts live in server/lib/library (stream SV3).
 */
class BaseScanner<T> {
  private bundleSize;
  private updateRate;
  protected progress = 0;
  protected items: T[] = [];
  protected totalSize?: number = 0;
  protected scannerName: string;
  protected sessionId: string;
  protected running = false;

  protected constructor(
    scannerName: string,
    {
      updateRate,
      bundleSize,
    }: {
      updateRate?: number;
      bundleSize?: number;
    } = {}
  ) {
    this.scannerName = scannerName;
    this.bundleSize = bundleSize ?? BUNDLE_SIZE;
    this.updateRate = updateRate ?? UPDATE_RATE;
  }

  /**
   * Call startRun from child class whenever a run is starting to
   * ensure required values are set
   *
   * Returns the session ID which is required for the cleanup method
   */
  protected startRun(): string {
    const sessionId = randomUUID();
    this.sessionId = sessionId;

    this.log('Scan starting', 'info', { sessionId });

    this.running = true;

    return sessionId;
  }

  /**
   * Call at end of run loop to perform cleanup
   */
  protected endRun(sessionId: string): void {
    if (this.sessionId === sessionId) {
      this.running = false;
    }
  }

  public cancel(): void {
    this.running = false;
  }

  protected async loop(
    processFn: (item: T) => Promise<void>,
    {
      start = 0,
      end = this.bundleSize,
      sessionId,
    }: {
      start?: number;
      end?: number;
      sessionId?: string;
    } = {}
  ): Promise<void> {
    const slicedItems = this.items.slice(start, end);

    if (!this.running) {
      throw new Error('Sync was aborted.');
    }

    if (this.sessionId !== sessionId) {
      throw new Error('New session was started. Old session aborted.');
    }

    if (start < this.items.length) {
      this.progress = start;
      await this.processItems(processFn, slicedItems);

      await new Promise<void>((resolve, reject) =>
        setTimeout(() => {
          this.loop(processFn, {
            start: start + this.bundleSize,
            end: end + this.bundleSize,
            sessionId,
          })
            .then(() => resolve())
            .catch((e) => reject(new Error(e.message)));
        }, this.updateRate)
      );
    }
  }

  private async processItems(
    processFn: (items: T) => Promise<void>,
    items: T[]
  ) {
    await Promise.all(
      items.map(async (item) => {
        await processFn(item);
      })
    );
  }

  protected log(
    message: string,
    level: 'info' | 'error' | 'debug' | 'warn' = 'debug',
    optional?: Record<string, unknown>
  ): void {
    logger[level](message, { label: this.scannerName, ...optional });
  }

  get protectedUpdateRate(): number {
    return this.updateRate;
  }

  get protectedBundleSize(): number {
    return this.bundleSize;
  }
}

export default BaseScanner;
