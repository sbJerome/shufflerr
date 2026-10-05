import type { Request } from 'express';
import { SubsonicError, SubsonicErrorCode } from './response';

/** Subsonic parameters come from the query string or a form POST (formPost extension). */
export class Params {
  private values: Record<string, string[]> = {};

  constructor(req: Request) {
    const add = (source: unknown) => {
      if (!source || typeof source !== 'object') {
        return;
      }
      for (const [key, value] of Object.entries(source)) {
        const list = (Array.isArray(value) ? value : [value])
          .filter((v) => v !== undefined && v !== null && typeof v !== 'object')
          .map(String);
        if (list.length) {
          this.values[key] = [...(this.values[key] ?? []), ...list];
        }
      }
    };
    add(req.body);
    add(req.query);
  }

  public has(name: string): boolean {
    return !!this.values[name]?.length;
  }

  public str(name: string): string | undefined {
    return this.values[name]?.[0];
  }

  public required(name: string): string {
    const value = this.str(name);
    if (value === undefined || value === '') {
      throw new SubsonicError(
        SubsonicErrorCode.MISSING_PARAMETER,
        `Required parameter is missing: ${name}`
      );
    }
    return value;
  }

  public list(name: string): string[] {
    return this.values[name] ?? [];
  }

  public int(name: string): number | undefined;
  public int(name: string, fallback: number): number;
  public int(name: string, fallback?: number): number | undefined {
    const raw = this.str(name);
    if (raw === undefined || raw === '') {
      return fallback;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? Math.trunc(value) : fallback;
  }

  public bool(name: string, fallback: boolean): boolean {
    const raw = this.str(name);
    if (raw === undefined) {
      return fallback;
    }
    return raw === 'true' || raw === '1';
  }
}

export type SubsonicId =
  | { kind: 'artist'; key: string }
  | { kind: 'album'; id: number }
  | { kind: 'track'; id: number }
  | { kind: 'playlist'; id: number };

/** `ar-<mediaId>` (or `ar-x<hash>` for name-only artists), `al-<mediaId>`, `tr-<trackId>`, `pl-<id>`. */
export const parseId = (raw: string | undefined): SubsonicId | null => {
  if (!raw) {
    return null;
  }
  const match = raw.match(/^(ar|al|tr|pl)-(.+)$/);
  if (!match) {
    return null;
  }
  const [, prefix, rest] = match;
  if (prefix === 'ar') {
    if (/^x[0-9a-f]+$/.test(rest)) {
      return { kind: 'artist', key: rest };
    }
    return /^\d+$/.test(rest) ? { kind: 'artist', key: `m${rest}` } : null;
  }
  if (!/^\d+$/.test(rest)) {
    return null;
  }
  const id = Number(rest);
  return prefix === 'al'
    ? { kind: 'album', id }
    : prefix === 'tr'
      ? { kind: 'track', id }
      : { kind: 'playlist', id };
};

export const artistId = (key: string): string =>
  `ar-${key.startsWith('m') ? key.slice(1) : key}`;
export const albumId = (mediaId: number): string => `al-${mediaId}`;
export const trackId = (id: number): string => `tr-${id}`;
export const playlistId = (id: number): string => `pl-${id}`;
