import logger from '@server/logger';
import fs from 'fs';
import path from 'path';

/**
 * Small JSON-file key/value store under <config>/cache. For lookups that are
 * slow or cost third-party quota and must survive restarts (import matches,
 * YouTube search results). Entries expire by age.
 */
interface Entry<T> {
  v: T;
  /** stored at, epoch ms */
  t: number;
}

const cacheDir = (): string =>
  path.join(process.env.CONFIG_DIRECTORY || 'config', 'cache');

export class PersistCache<T> {
  private data: Record<string, Entry<T>> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private name: string,
    private ttlMs: number,
    private maxEntries = 20000
  ) {}

  private get file(): string {
    return path.join(cacheDir(), `${this.name}.json`);
  }

  private load(): Record<string, Entry<T>> {
    if (this.data) {
      return this.data;
    }
    if (process.env.NODE_ENV === 'test') {
      // tests keep everything in memory
      this.data = {};
      return this.data;
    }
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
    } catch {
      this.data = {};
    }
    return this.data as Record<string, Entry<T>>;
  }

  public get(key: string): T | undefined {
    const entry = this.load()[key];
    if (!entry) {
      return undefined;
    }
    if (Date.now() - entry.t > this.ttlMs) {
      delete this.load()[key];
      return undefined;
    }
    return entry.v;
  }

  public has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  public set(key: string, value: T): void {
    const data = this.load();
    data[key] = { v: value, t: Date.now() };
    const keys = Object.keys(data);
    if (keys.length > this.maxEntries) {
      keys
        .sort((a, b) => data[a].t - data[b].t)
        .slice(0, keys.length - this.maxEntries)
        .forEach((k) => delete data[k]);
    }
    this.scheduleWrite();
  }

  /** Forget everything (tests, "clear cache"). */
  public clear(): void {
    this.data = {};
    this.scheduleWrite();
  }

  private scheduleWrite(): void {
    if (this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 2000);
    this.timer.unref?.();
  }

  public flush(): void {
    if (!this.data || process.env.NODE_ENV === 'test') {
      return;
    }
    try {
      fs.mkdirSync(cacheDir(), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      logger.debug('Could not write cache file', {
        label: 'Cache',
        file: this.file,
        errorMessage: e.message,
      });
    }
  }
}
