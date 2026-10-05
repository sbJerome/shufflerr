import { normalizeText } from '@server/lib/library/normalize';
import type { AlbumStub } from '@server/lib/library/sourceScanner';
import type { ScannedAlbum, ScannedTrack } from '@server/lib/library/types';
import { createHash } from 'crypto';
import path from 'path';
import type { FileTags } from './tags';
import { albumFolderOf, guessFromPath } from './tags';

export interface ScannedFile {
  path: string;
  mtimeMs: number;
  size: number;
  tags: FileTags;
}

const mostCommon = <T>(values: (T | undefined)[]): T | undefined => {
  const counts = new Map<T, number>();
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/**
 * Group audio files into albums: one album per folder (disc subfolders fold
 * into their parent) and album tag, so a folder holding two albums splits and
 * an untagged folder still forms one album from its folder name.
 */
export const groupFiles = (files: ScannedFile[]): AlbumStub[] => {
  const groups = new Map<string, ScannedFile[]>();

  for (const file of files) {
    const folder = albumFolderOf(file.path);
    const albumKey =
      file.tags.releaseGroupMbid ??
      normalizeText(file.tags.album ?? guessFromPath(file.path).album);
    const key = `${folder}|${albumKey}`;
    const group = groups.get(key);
    if (group) {
      group.push(file);
    } else {
      groups.set(key, [file]);
    }
  }

  return [...groups.entries()].map(([key, group]) => {
    const sorted = [...group].sort((a, b) => a.path.localeCompare(b.path));
    const folder = albumFolderOf(sorted[0].path);
    const guesses = sorted.map((file) => guessFromPath(file.path));
    const albumTitle =
      mostCommon(sorted.map((f) => f.tags.album)) ?? guesses[0].album ?? '';
    const trackArtists = new Set(
      sorted.map((f) => normalizeText(f.tags.artist)).filter(Boolean)
    );
    const artistName =
      mostCommon(sorted.map((f) => f.tags.albumArtist)) ??
      // a single track artist across the folder is the album artist
      (trackArtists.size === 1
        ? mostCommon(sorted.map((f) => f.tags.artist))
        : undefined) ??
      guesses[0].artist ??
      mostCommon(sorted.map((f) => f.tags.artist)) ??
      '';

    const signature = createHash('sha1')
      .update(sorted.map((f) => `${f.path}|${f.mtimeMs}|${f.size}`).join('\n'))
      .digest('hex');

    const load = async (): Promise<ScannedAlbum> => {
      const tracks: ScannedTrack[] = sorted.map((file, index) => {
        const guess = guesses[index];
        return {
          sourceId: file.path,
          title: file.tags.title ?? guess.title ?? path.basename(file.path),
          discNumber: file.tags.discNo ?? guess.discNo ?? 1,
          trackNumber: file.tags.trackNo ?? guess.trackNo,
          durationMs: file.tags.durationMs,
          fileFormat: file.tags.fileFormat,
          recordingMbid: file.tags.recordingMbid,
          otherMbids: file.tags.trackMbid ? [file.tags.trackMbid] : undefined,
        };
      });

      return {
        source: 'local',
        sourceAlbumId: key,
        artistName,
        albumTitle,
        // the folder names are a second, independent spelling of the album
        aliases:
          guesses[0].artist && guesses[0].album
            ? [{ artistName: guesses[0].artist, albumTitle: guesses[0].album }]
            : undefined,
        year: mostCommon(sorted.map((f) => f.tags.year)) ?? guesses[0].year,
        releaseGroupMbid: mostCommon(
          sorted.map((f) => f.tags.releaseGroupMbid)
        ),
        releaseMbid: mostCommon(sorted.map((f) => f.tags.releaseMbid)),
        artistMbid: mostCommon(sorted.map((f) => f.tags.albumArtistMbid)),
        // the album was complete when its last file landed
        addedAt: new Date(Math.max(...sorted.map((f) => f.mtimeMs))),
        localPath: folder,
        tracks,
      };
    };

    return {
      id: key,
      label: `${artistName || 'Unknown artist'} – ${albumTitle || folder}`,
      signature,
      load,
    };
  });
};
