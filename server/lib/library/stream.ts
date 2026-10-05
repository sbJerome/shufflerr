// Audio serving shared by the web player (/api/v1/stream/track/:id) and the
// client APIs (/rest/stream, /jellyfin/Audio). Auth is the caller's job.
import JellyfinAPI from '@server/api/jellyfin';
import PlexAPI from '@server/api/plexapi';
import SubsonicAPI from '@server/api/subsonic';
import { getRepository } from '@server/datasource';
import Track from '@server/entity/Track';
import { User } from '@server/entity/User';
import type { MobileTranscode } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { getHostname } from '@server/utils/getHostname';
import axios from 'axios';
import { spawn } from 'child_process';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { decodePeaks, ensurePeaks } from './peaks';

export interface StreamOptions {
  /** Transcode target; 'original'/'raw' or undefined = direct play. */
  format?: MobileTranscode | 'mp3' | 'opus' | 'raw';
  /** kbit/s cap for 'mp3' / 'opus'. */
  maxBitRate?: number;
  /** Force a download disposition (client API `download`). */
  download?: boolean;
}

export type TrackSource = 'local' | 'plex' | 'jellyfin' | 'navidrome';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const LABEL = 'Stream';

const CONTENT_TYPES: Record<string, string> = {
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.wma': 'audio/x-ms-wma',
  '.ape': 'audio/x-ape',
  '.wv': 'audio/x-wavpack',
  '.dsf': 'audio/x-dsf',
  '.webm': 'audio/webm',
};

export const contentTypeFor = (filePath: string): string =>
  CONTENT_TYPES[path.extname(filePath).toLowerCase()] ??
  'application/octet-stream';

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse a single-range `Range` header against a resource size.
 * undefined = no (usable) range header → send everything;
 * null = unsatisfiable → 416.
 */
export const parseRange = (
  header: string | undefined,
  size: number
): ByteRange | null | undefined => {
  if (!header) {
    return undefined;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    // multi-range and malformed headers are ignored (RFC 9110 allows a 200)
    return undefined;
  }
  let start: number;
  let end: number;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0) {
      return null;
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) {
    return null;
  }
  return { start, end };
};

/** Only files under a configured music folder may be served. */
const isInsideLibrary = (filePath: string): boolean => {
  const resolved = path.resolve(filePath);
  return getSettings().localFiles.folders.some((folder) => {
    const root = path.resolve(folder);
    return resolved === root || resolved.startsWith(`${root}${path.sep}`);
  });
};

const localFileFor = async (track: Track): Promise<string | null> => {
  const filePath = track.sourceIds?.localPath;
  if (!filePath || !isInsideLibrary(filePath)) {
    return null;
  }
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
    return filePath;
  } catch {
    return null;
  }
};

const resolveSource = async (
  track: Track
): Promise<{ source: TrackSource; localPath?: string } | null> => {
  const integrations = getSettings().integrations;
  const localPath = await localFileFor(track);
  if (localPath) {
    return { source: 'local', localPath };
  }
  if (integrations.plex && track.sourceIds?.plex) {
    return { source: 'plex' };
  }
  if (integrations.jellyfin && track.sourceIds?.jellyfin) {
    return { source: 'jellyfin' };
  }
  if (integrations.navidrome && track.sourceIds?.navidrome) {
    return { source: 'navidrome' };
  }
  return null;
};

const ownerAccount = (): Promise<User | null> =>
  getRepository(User).findOne({
    select: {
      id: true,
      plexToken: true,
      jellyfinUserId: true,
      jellyfinDeviceId: true,
    },
    where: { id: 1 },
  });

interface RemoteTarget {
  url: string;
  headers: Record<string, string>;
}

/** Where a remote copy of the track can be fetched (original file, no transcode). */
const remoteTargetFor = async (
  track: Track,
  source: Exclude<TrackSource, 'local'>
): Promise<RemoteTarget | null> => {
  const settings = getSettings();

  if (source === 'plex') {
    const owner = await ownerAccount();
    if (!owner?.plexToken || !track.sourceIds?.plex) {
      return null;
    }
    const base = `${settings.plex.useSsl ? 'https' : 'http'}://${
      settings.plex.ip
    }:${settings.plex.port}`;
    let partKey = track.sourceIds.plexPartKey;
    if (!partKey) {
      const plex = new PlexAPI({ plexToken: owner.plexToken });
      partKey = await plex.getTrackPartKey(track.sourceIds.plex);
      if (partKey) {
        await getRepository(Track).update(track.id, {
          sourceIds: { ...track.sourceIds, plexPartKey: partKey },
        });
      }
    }
    return partKey
      ? {
          url: `${base}${partKey}`,
          headers: {
            'X-Plex-Token': owner.plexToken,
            'X-Plex-Client-Identifier': settings.clientId,
          },
        }
      : null;
  }

  if (source === 'jellyfin') {
    if (!track.sourceIds?.jellyfin || !settings.jellyfin.apiKey) {
      return null;
    }
    const owner = await ownerAccount();
    const client = new JellyfinAPI(
      getHostname(),
      settings.jellyfin.apiKey,
      owner?.jellyfinDeviceId
    );
    return {
      url: `${getHostname()}/Audio/${track.sourceIds.jellyfin}/stream?static=true`,
      headers: client.authHeaders(),
    };
  }

  if (!track.sourceIds?.navidrome) {
    return null;
  }
  return {
    url: SubsonicAPI.fromSettings().streamUrl(track.sourceIds.navidrome),
    headers: {},
  };
};

interface TranscodeProfile {
  args: string[];
  contentType: string;
  extension: string;
}

const transcodeProfile = (options: StreamOptions): TranscodeProfile | null => {
  const opus = (kbps: number): TranscodeProfile => ({
    args: ['-c:a', 'libopus', '-b:a', `${kbps}k`, '-vbr', 'on', '-f', 'ogg'],
    contentType: 'audio/ogg',
    extension: 'opus',
  });
  const mp3 = (kbps: number): TranscodeProfile => ({
    args: ['-c:a', 'libmp3lame', '-b:a', `${kbps}k`, '-f', 'mp3'],
    contentType: 'audio/mpeg',
    extension: 'mp3',
  });
  const cap = (fallback: number): number =>
    options.maxBitRate && options.maxBitRate > 0
      ? Math.min(Math.max(Math.round(options.maxBitRate), 32), 320)
      : fallback;

  switch (options.format) {
    case 'opus-160':
      return opus(160);
    case 'mp3-320':
      return mp3(320);
    case 'mp3-128':
      return mp3(128);
    case 'opus':
      return opus(cap(128));
    case 'mp3':
      return mp3(cap(192));
    default:
      return null;
  }
};

const downloadName = (track: Track, extension: string): string => {
  const safe = `${track.position} ${track.title}`
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .trim();
  return `${safe || `track-${track.id}`}.${extension.replace(/^\./, '')}`;
};

const setDisposition = (res: Response, name: string): void => {
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
  );
};

const sendLocalFile = async (
  req: Request,
  res: Response,
  track: Track,
  filePath: string,
  options: StreamOptions
): Promise<void> => {
  const stat = await fs.promises.stat(filePath);
  const range = parseRange(req.headers.range, stat.size);

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentTypeFor(filePath));
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (options.download) {
    setDisposition(res, downloadName(track, path.extname(filePath)));
  }

  if (range === null) {
    res.setHeader('Content-Range', `bytes */${stat.size}`);
    res.status(416).end();
    return;
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? stat.size - 1;
  res.status(range ? 206 : 200);
  res.setHeader('Content-Length', String(end - start + 1));
  if (range) {
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  }
  if (req.method === 'HEAD' || stat.size === 0) {
    res.end();
    return;
  }

  await new Promise<void>((resolve) => {
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', (e) => {
      logger.warn('Reading an audio file failed mid-stream', {
        label: LABEL,
        trackId: track.id,
        errorMessage: e.message,
      });
      res.destroy(e);
      resolve();
    });
    res.on('close', () => {
      stream.destroy();
      resolve();
    });
    stream.pipe(res);
  });
};

const PASS_THROUGH_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag',
];

const proxyRemote = async (
  req: Request,
  res: Response,
  track: Track,
  target: RemoteTarget,
  options: StreamOptions
): Promise<void> => {
  const upstream = await axios.request({
    url: target.url,
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    responseType: 'stream',
    headers: {
      ...target.headers,
      ...(req.headers.range ? { Range: req.headers.range } : {}),
    },
    // 206/416 are answers, not errors
    validateStatus: (status) => status < 500,
    timeout: 30000,
  });

  if (upstream.status >= 400 && upstream.status !== 416) {
    upstream.data?.destroy?.();
    res.status(upstream.status === 404 ? 404 : 502).json({
      message: 'The media server did not return this track.',
    });
    return;
  }

  res.status(upstream.status);
  for (const header of PASS_THROUGH_HEADERS) {
    const value = upstream.headers[header];
    if (value) {
      res.setHeader(header, value as string);
    }
  }
  if (!upstream.headers['accept-ranges']) {
    res.setHeader('Accept-Ranges', 'bytes');
  }
  if (options.download) {
    setDisposition(
      res,
      downloadName(
        track,
        (track.fileFormat ?? 'audio').split(' ')[0].toLowerCase()
      )
    );
  }
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  await new Promise<void>((resolve) => {
    upstream.data.on('error', (e: Error) => {
      res.destroy(e);
      resolve();
    });
    res.on('close', () => {
      upstream.data.destroy();
      resolve();
    });
    upstream.data.pipe(res);
  });
};

const transcode = async (
  req: Request,
  res: Response,
  track: Track,
  input: { path?: string; remote?: RemoteTarget },
  profile: TranscodeProfile,
  options: StreamOptions
): Promise<void> => {
  const inputArgs: string[] = [];
  if (input.remote) {
    const headers = Object.entries(input.remote.headers)
      .map(([name, value]) => `${name}: ${value}\r\n`)
      .join('');
    if (headers) {
      inputArgs.push('-headers', headers);
    }
    inputArgs.push('-i', input.remote.url);
  } else {
    inputArgs.push('-i', input.path as string);
  }

  res.status(200);
  res.setHeader('Content-Type', profile.contentType);
  res.setHeader('Accept-Ranges', 'none');
  res.setHeader('Cache-Control', 'no-store');
  if (options.download) {
    setDisposition(res, downloadName(track, profile.extension));
  }
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  await new Promise<void>((resolve) => {
    const ffmpeg = spawn(
      FFMPEG,
      [
        '-v',
        'error',
        '-nostdin',
        ...inputArgs,
        '-vn',
        '-map',
        '0:a:0',
        '-map_metadata',
        '-1',
        ...profile.args,
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stderr = '';
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 1000) {
        stderr += chunk.toString();
      }
    });
    ffmpeg.on('error', (e) => {
      logger.error('ffmpeg could not be started for transcoding', {
        label: LABEL,
        errorMessage: e.message,
      });
      if (!res.headersSent) {
        res.status(500).json({ message: 'Transcoding is not available.' });
      } else {
        res.destroy();
      }
      resolve();
    });
    ffmpeg.on('close', (code) => {
      if (code && stderr) {
        logger.warn('Transcode ended with an error', {
          label: LABEL,
          trackId: track.id,
          errorMessage: stderr.trim(),
        });
      }
      resolve();
    });
    res.on('close', () => ffmpeg.kill('SIGKILL'));
    ffmpeg.stdout.pipe(res);
  });
};

const findTrack = (trackId: number): Promise<Track | null> =>
  Number.isInteger(trackId) && trackId > 0
    ? getRepository(Track).findOne({ where: { id: trackId } })
    : Promise.resolve(null);

/**
 * Stream a Track to the response honouring Range requests. Source order:
 * local file → Plex → Jellyfin → Navidrome. Responds 404 when the track has no
 * playable source. Transcoded output (format ≠ original) is not seekable by
 * byte range and is sent as a plain 200 stream.
 */
export const streamTrack = async (
  req: Request,
  res: Response,
  trackId: number,
  options: StreamOptions = {}
): Promise<void> => {
  const track = await findTrack(trackId);
  const resolved = track ? await resolveSource(track) : null;

  if (!track || !resolved) {
    res.status(404).json({ message: 'This track is not in the library.' });
    return;
  }

  const profile = transcodeProfile(options);

  try {
    if (resolved.source === 'local' && resolved.localPath) {
      return profile
        ? await transcode(
            req,
            res,
            track,
            { path: resolved.localPath },
            profile,
            options
          )
        : await sendLocalFile(req, res, track, resolved.localPath, options);
    }

    const target = await remoteTargetFor(
      track,
      resolved.source as Exclude<TrackSource, 'local'>
    );
    if (!target) {
      res.status(404).json({ message: 'This track is not in the library.' });
      return;
    }
    return profile
      ? await transcode(req, res, track, { remote: target }, profile, options)
      : await proxyRemote(req, res, track, target, options);
  } catch (e) {
    logger.error('Streaming a track failed', {
      label: LABEL,
      trackId,
      source: resolved.source,
      errorMessage: e.message,
    });
    if (!res.headersSent) {
      res
        .status(502)
        .json({ message: 'Could not read this track from its source.' });
    } else {
      res.destroy();
    }
  }
};

/**
 * Decoded waveform peaks (0–255 per bar) for a track; [] when none exist.
 * Generated from the local file on first use.
 */
export const getTrackPeaks = async (trackId: number): Promise<number[]> => {
  if (!Number.isInteger(trackId) || trackId <= 0) {
    return [];
  }
  const track = await getRepository(Track)
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
  return (await localFileFor(track)) ? ensurePeaks(trackId) : [];
};

/** Which source would serve this track right now, or null when not playable. */
export const getTrackSource = async (
  trackId: number
): Promise<TrackSource | null> => {
  const track = await findTrack(trackId);
  return track ? ((await resolveSource(track))?.source ?? null) : null;
};
