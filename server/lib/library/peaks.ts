import { getRepository } from '@server/datasource';
import Track from '@server/entity/Track';
import logger from '@server/logger';
import { spawn } from 'child_process';

/** Bars the player draws (docs/FRONTEND.md: 96-bar waveform). */
export const PEAK_BARS = 96;

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const SAMPLE_RATE = 4000;
/** Fine-grained window (in samples) kept while decoding: 50 ms. */
const WINDOW = SAMPLE_RATE / 20;
const MAX_PARALLEL = 2;

export const encodePeaks = (peaks: number[]): string =>
  Buffer.from(Uint8Array.from(peaks)).toString('base64');

export const decodePeaks = (encoded: string | null | undefined): number[] =>
  encoded ? Array.from(Buffer.from(encoded, 'base64')) : [];

/** Reduce fine-grained window maxima to `bars` values scaled to 0–255. */
export const reducePeaks = (windows: number[], bars = PEAK_BARS): number[] => {
  if (windows.length === 0) {
    return [];
  }
  const loudest = Math.max(...windows, 1);
  const out: number[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const from = Math.floor((bar * windows.length) / bars);
    const to = Math.max(
      from + 1,
      Math.floor(((bar + 1) * windows.length) / bars)
    );
    let peak = 0;
    for (let i = from; i < to && i < windows.length; i++) {
      if (windows[i] > peak) {
        peak = windows[i];
      }
    }
    out.push(Math.round((peak / loudest) * 255));
  }
  return out;
};

/**
 * Decode a file with ffmpeg to low-rate mono PCM and return 96 peak values
 * (0–255). Nothing is held in memory beyond one max per 50 ms.
 */
export const computePeaksFromFile = (filePath: string): Promise<number[]> =>
  new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      FFMPEG,
      [
        '-v',
        'error',
        '-nostdin',
        '-i',
        filePath,
        '-vn',
        '-map',
        '0:a:0',
        '-ac',
        '1',
        '-ar',
        String(SAMPLE_RATE),
        '-f',
        's16le',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const windows: number[] = [];
    let current = 0;
    let inWindow = 0;
    let leftover: Buffer | null = null;
    let stderr = '';

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      const data: Buffer = leftover ? Buffer.concat([leftover, chunk]) : chunk;
      const usable = data.length - (data.length % 2);
      for (let i = 0; i < usable; i += 2) {
        const sample = Math.abs(data.readInt16LE(i));
        if (sample > current) {
          current = sample;
        }
        if (++inWindow === WINDOW) {
          windows.push(current);
          current = 0;
          inWindow = 0;
        }
      }
      leftover = usable < data.length ? data.subarray(usable) : null;
    });
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 2000) {
        stderr += chunk.toString();
      }
    });
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (inWindow > 0) {
        windows.push(current);
      }
      if (windows.length === 0) {
        return reject(
          new Error(stderr.trim() || `ffmpeg exited with code ${code}`)
        );
      }
      resolve(reducePeaks(windows));
    });
  });

// ---- background queue -------------------------------------------------------

const queue: number[] = [];
const queued = new Set<number>();
const inflight = new Map<number, Promise<number[]>>();
let active = 0;

const generateFor = async (trackId: number): Promise<number[]> => {
  const repository = getRepository(Track);
  const track = await repository
    .createQueryBuilder('track')
    .addSelect('track.peaks')
    .where('track.id = :trackId', { trackId })
    .getOne();

  if (!track) {
    return [];
  }
  if (track.peaks) {
    return decodePeaks(track.peaks);
  }
  const filePath = track.sourceIds?.localPath;
  if (!filePath) {
    return [];
  }
  const peaks = await computePeaksFromFile(filePath);
  await repository.update(trackId, { peaks: encodePeaks(peaks) });
  return peaks;
};

/** Peaks for a track, generating them from the local file on first use. */
export const ensurePeaks = (trackId: number): Promise<number[]> => {
  const running = inflight.get(trackId);
  if (running) {
    return running;
  }
  const promise = generateFor(trackId)
    .catch((e) => {
      logger.debug('Could not generate waveform peaks', {
        label: 'Library',
        trackId,
        errorMessage: e.message,
      });
      return [] as number[];
    })
    .finally(() => inflight.delete(trackId));
  inflight.set(trackId, promise);
  return promise;
};

const pump = (): void => {
  while (active < MAX_PARALLEL && queue.length > 0) {
    const trackId = queue.shift() as number;
    queued.delete(trackId);
    active++;
    ensurePeaks(trackId).finally(() => {
      active--;
      pump();
    });
  }
};

/** Queue tracks for background peak generation (after a local scan). */
export const enqueuePeaks = (trackIds: number[]): void => {
  for (const trackId of trackIds) {
    if (!queued.has(trackId) && !inflight.has(trackId)) {
      queued.add(trackId);
      queue.push(trackId);
    }
  }
  pump();
};

export const peaksQueueLength = (): number => queue.length + active;

/** Local tracks that have no peaks yet. */
export const tracksMissingPeaks = async (): Promise<number[]> => {
  const rows = await getRepository(Track)
    .createQueryBuilder('track')
    .select('track.id', 'id')
    .where('track.peaks IS NULL')
    .andWhere('track.sourceIds LIKE :pattern', { pattern: '%"localPath":%' })
    .getRawMany<{ id: number }>();
  return rows.map((row) => Number(row.id));
};
