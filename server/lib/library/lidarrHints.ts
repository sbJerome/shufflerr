import type { LidarrAlbum, LidarrArtist } from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import type { LidarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import path from 'path';
import type { ScannedAlbum } from './types';

const LABEL = 'Library';
const ARTISTS_TTL = 5 * 60 * 1000;
const MISS_TTL = 10 * 60 * 1000;

export interface LidarrFolderHint {
  releaseGroupMbid: string;
  /** The edition Lidarr imported, when it says which. */
  releaseMbid?: string;
  /** File basename → MusicBrainz recording id. */
  recordings: Map<string, string>;
}

const servers = (): LidarrSettings[] =>
  getSettings().lidarr.filter((server) => server.syncEnabled !== false);

const folderName = (p: string): string => path.basename(p).toLowerCase();

let artistCache: { at: number; key: string; artists: LidarrArtist[] } | null =
  null;
const misses = new Map<string, number>();

const listArtists = async (
  server: LidarrSettings,
  api: LidarrAPI
): Promise<LidarrArtist[]> => {
  const key = `${server.id}`;
  if (
    artistCache &&
    artistCache.key === key &&
    Date.now() - artistCache.at < ARTISTS_TTL
  ) {
    return artistCache.artists;
  }
  const artists = await api.getArtists();
  artistCache = { at: Date.now(), key, artists };
  return artists;
};

/**
 * Lidarr knows which MusicBrainz album the files it imported belong to even
 * when their tags do not say. For a local album folder, find the Lidarr album
 * whose files live in a folder of the same name (under an artist folder of the
 * same name, or directly in the artist folder), and return its ids. Null when Lidarr is off, does not have the
 * folder, or cannot be reached. Never throws.
 */
export const lidarrHintForFolder = async (
  folder: string
): Promise<LidarrFolderHint | null> => {
  const missedAt = misses.get(folder);
  if (missedAt && Date.now() - missedAt < MISS_TTL) {
    return null;
  }
  const albumFolder = folderName(folder);
  const artistFolder = folderName(path.dirname(folder));

  for (const server of servers()) {
    try {
      const api = LidarrAPI.fromSettings(server);
      const artists = await listArtists(server, api);
      // Files usually sit in <artist>/<album>/, but a hand-placed album can sit
      // straight in the artist folder; accept either shape.
      const artist =
        artists.find((a) => !!a.path && folderName(a.path) === artistFolder) ??
        artists.find((a) => !!a.path && folderName(a.path) === albumFolder);
      if (!artist?.id) {
        continue;
      }
      const albums = (await api.getAlbums(artist.id)).filter(
        (album: LidarrAlbum) => (album.statistics?.trackFileCount ?? 0) > 0
      );
      for (const album of albums) {
        if (!album.id) {
          continue;
        }
        const files = await api.getTrackFiles(album.id);
        if (
          !files.some((f) => folderName(path.dirname(f.path)) === albumFolder)
        ) {
          continue;
        }
        const tracks = await api.getTracks(album.id);
        const byFile = new Map(tracks.map((t) => [t.trackFileId, t]));
        const recordings = new Map<string, string>();
        for (const file of files) {
          const track = byFile.get(file.id);
          if (track?.foreignRecordingId) {
            recordings.set(
              path.basename(file.path).toLowerCase(),
              track.foreignRecordingId
            );
          }
        }
        const edition = album.releases?.find((r) => r.monitored);
        logger.info('Identified a scanned folder through Lidarr', {
          label: LABEL,
          server: server.name,
          lidarrAlbumId: album.id,
          files: recordings.size,
        });
        return {
          releaseGroupMbid: album.foreignAlbumId,
          releaseMbid: edition?.foreignReleaseId,
          recordings,
        };
      }
    } catch (e) {
      logger.debug('Lidarr could not help identify a folder', {
        label: LABEL,
        server: server.name,
        errorMessage: e.message,
      });
    }
  }
  if (misses.size > 2000) {
    misses.clear();
  }
  misses.set(folder, Date.now());
  return null;
};

/** Apply a Lidarr hint to a scanned album whose tags carry no MusicBrainz ids. */
export const withLidarrHint = (
  album: ScannedAlbum,
  hint: LidarrFolderHint
): ScannedAlbum => ({
  ...album,
  releaseGroupMbid: hint.releaseGroupMbid,
  releaseMbid: hint.releaseMbid ?? album.releaseMbid,
  tracks: album.tracks.map((track) => ({
    ...track,
    recordingMbid:
      track.recordingMbid ??
      hint.recordings.get(path.basename(track.sourceId).toLowerCase()) ??
      null,
  })),
});
