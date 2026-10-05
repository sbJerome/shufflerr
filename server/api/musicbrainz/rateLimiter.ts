/**
 * Token bucket shared by every MusicBrainz call in the process. The public
 * server allows one request per second on average; a small burst keeps a
 * three-part search responsive while the long-run rate stays at the limit.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private queue: (() => void)[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private ratePerSecond: number,
    private capacity: number,
    private now: () => number = Date.now
  ) {
    this.tokens = capacity;
    this.last = this.now();
  }

  public configure(ratePerSecond: number, capacity: number): void {
    if (ratePerSecond === this.ratePerSecond && capacity === this.capacity) {
      return;
    }
    this.refill();
    this.ratePerSecond = ratePerSecond;
    this.capacity = capacity;
    this.tokens = Math.min(this.tokens, capacity);
  }

  public get pending(): number {
    return this.queue.length;
  }

  /** Resolves when the caller may send one request. */
  public take(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.drain();
    });
  }

  /** Empty the bucket and hold everything for `ms` (server asked us to slow down). */
  public pause(ms: number): void {
    this.refill();
    this.tokens = 0;
    this.last = this.now() + ms;
    this.schedule();
  }

  private refill(): void {
    const now = this.now();
    if (now <= this.last) {
      return;
    }
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((now - this.last) / 1000) * this.ratePerSecond
    );
    this.last = now;
  }

  private drain(): void {
    this.refill();
    while (this.queue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      this.queue.shift()?.();
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.timer || this.queue.length === 0) {
      return;
    }
    const waitForPause = Math.max(0, this.last - this.now());
    const waitForToken =
      ((1 - Math.min(this.tokens, 1)) / this.ratePerSecond) * 1000;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.drain();
      },
      Math.max(5, Math.ceil(waitForPause + waitForToken))
    );
  }
}
