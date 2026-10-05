/* eslint-disable @typescript-eslint/no-unused-vars -- stub signatures; remove when implemented */
// STREAM(SV3): implement. Audio serving shared by the web player
// (/api/v1/stream/track/:id) and the client APIs (/rest/stream, /jellyfin/Audio).
import type { MobileTranscode } from '@server/lib/settings';
import type { Request, Response } from 'express';

export interface StreamOptions {
  /** Transcode target; 'original' or undefined = direct play. */
  format?: MobileTranscode | 'mp3' | 'opus' | 'raw';
  maxBitRate?: number;
  /** Force a download disposition (client API `download`). */
  download?: boolean;
}

/**
 * Stream a Track to the response honouring Range requests. Source order:
 * local file → Plex → Jellyfin → Navidrome. Responds 404 when the track has no
 * playable source.
 */
export const streamTrack = async (
  _req: Request,
  res: Response,
  _trackId: number,
  _options: StreamOptions = {}
): Promise<void> => {
  res.status(501).json({ message: 'Not implemented' });
};

/** Decoded waveform peaks (0–255 per bar) for a track; [] when none exist. */
export const getTrackPeaks = async (_trackId: number): Promise<number[]> => [];

/** Which source would serve this track right now, or null when not playable. */
export const getTrackSource = async (
  _trackId: number
): Promise<'local' | 'plex' | 'jellyfin' | 'navidrome' | null> => null;
