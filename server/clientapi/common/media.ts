import { getImageSource } from '@server/lib/imageSources';
import type { StreamOptions } from '@server/lib/library/stream';
import { streamTrack } from '@server/lib/library/stream';
import { coverUrlFor } from '@server/lib/metadata';
import type { Request, Response } from 'express';

export interface CoverImage {
  buffer: Buffer;
  contentType: string;
  maxAge: number;
}

const pickSize = (requested?: number): 250 | 500 | 1200 => {
  if (!requested || requested <= 0) {
    return 500;
  }
  if (requested <= 250) {
    return 250;
  }
  return requested <= 500 ? 500 : 1200;
};

/**
 * Album cover bytes through the same image proxy + cache the web UI uses
 * (never a redirect: apps expect the image itself). Null when there is no
 * cover — clients then show their own placeholder.
 */
export const getAlbumCover = async (
  releaseGroupMbid: string,
  requestedSize?: number
): Promise<CoverImage | null> => {
  const url = coverUrlFor(releaseGroupMbid, pickSize(requestedSize));
  const match = url?.match(/^\/imageproxy\/([^/]+)(\/.*)$/);
  if (!match) {
    return null;
  }
  const source = getImageSource(match[1]);
  if (!source) {
    return null;
  }

  try {
    const image = await source.getImage(match[2]);
    return {
      buffer: image.imageBuffer,
      contentType: `image/${image.meta.extension}`,
      maxAge: image.meta.curRevalidate,
    };
  } catch {
    return null;
  }
};

export const sendCover = (res: Response, image: CoverImage): void => {
  res.writeHead(200, {
    'Content-Type': image.contentType,
    'Content-Length': image.buffer.length,
    'Cache-Control': `public, max-age=${image.maxAge}`,
  });
  res.end(image.buffer);
};

/**
 * What a client asked for, reduced to what the shared streamer understands.
 * `raw` (or nothing) = the original file.
 */
export const streamOptionsFrom = (request: {
  format?: string;
  maxBitRateKbps?: number;
  download?: boolean;
}): StreamOptions => {
  const options: StreamOptions = {};
  const format = request.format?.toLowerCase();

  if (request.download) {
    options.download = true;
    options.format = 'raw';
    return options;
  }

  if (format === 'raw') {
    options.format = 'raw';
  } else if (format === 'mp3') {
    options.format = 'mp3';
  } else if (format === 'opus' || format === 'ogg' || format === 'webm') {
    options.format = 'opus';
  }

  if (request.maxBitRateKbps && request.maxBitRateKbps > 0) {
    options.maxBitRate = request.maxBitRateKbps;
  }
  return options;
};

export const sendTrack = (
  req: Request,
  res: Response,
  trackId: number,
  options: StreamOptions
): Promise<void> => streamTrack(req, res, trackId, options);
