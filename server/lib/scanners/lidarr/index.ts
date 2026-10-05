// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: server/lib/scanners/radarr/index.ts at commit 2cfbcf8940225f1597d44f507fd78040887c5597
//
// Syncs artists and albums from every Lidarr server with "Enable scan" on
// into Media rows (lidarrServerId / lidarrArtistId / lidarrAlbumId), so
// Shufflerr knows what Lidarr already manages. Library scanners (Plex,
// Jellyfin, Navidrome, local files) stay the source of truth for what is
// actually available; Lidarr's file counts are only used as a hint when no
// library source is switched on.
import type { LidarrAlbum, LidarrArtist } from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
  RequestScope,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import type { ScanStatus } from '@server/interfaces/api/settingsInterfaces';
import type { StatusBase } from '@server/lib/scanners/baseScanner';
import type { LibraryScanner } from '@server/lib/scanners/stub';
import type { LidarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

const secondaryTypeNames = (album: LidarrAlbum): string[] =>
  (album.secondaryTypes ?? [])
    .map((t) => (typeof t === 'string' ? t : t?.name))
    .filter((t): t is string => !!t);

class LidarrScanner implements LibraryScanner {
  private running = false;
  private cancelled = false;
  private progress = 0;
  private total = 0;
  private lastFullScan?: number;
  private error?: string;
  private currentServer: LidarrSettings | null = null;
  private albums = 0;

  public status = (): Partial<ScanStatus> & StatusBase => ({
    running: this.running,
    progress: this.progress,
    total: this.total,
    current: this.progress,
    currentLibrary: this.currentServer
      ? { id: String(this.currentServer.id), name: this.currentServer.name }
      : null,
    lastFullScan: this.lastFullScan,
    albums: this.albums,
    error: this.error,
  });

  public cancel = (): void => {
    this.cancelled = true;
  };

  public run = async (): Promise<void> => {
    if (this.running) {
      return;
    }

    const servers = getSettings().lidarr.filter((s) => s.syncEnabled);
    this.running = true;
    this.cancelled = false;
    this.progress = 0;
    this.total = 0;
    this.albums = 0;
    this.error = undefined;

    try {
      for (const server of servers) {
        if (this.cancelled) {
          break;
        }
        this.currentServer = server;
        await this.scanServer(server);
      }

      if (!this.cancelled) {
        this.lastFullScan = Date.now();
      }
      this.log(this.cancelled ? 'Scan cancelled' : 'Scan complete', 'info', {
        albums: this.albums,
      });
    } catch (e) {
      this.error = e.message;
      this.log('Scan interrupted', 'error', { errorMessage: e.message });
    } finally {
      this.running = false;
      this.currentServer = null;
    }
  };

  private async scanServer(server: LidarrSettings): Promise<void> {
    const api = LidarrAPI.fromSettings(server);
    const artists = (await api.getArtists()).filter(
      (artist) => !!artist.id && !!artist.foreignArtistId
    );
    this.total += artists.length;

    this.log(`Scanning ${artists.length} artists on ${server.name}`, 'info');

    for (const artist of artists) {
      if (this.cancelled) {
        return;
      }

      try {
        const albums = await api.getAlbums(artist.id as number);
        await this.processArtist(server, artist, albums);
      } catch (e) {
        this.log(`Failed to sync ${artist.artistName}`, 'error', {
          errorMessage: e.message,
        });
      }

      this.progress++;
    }
  }

  private async upsert(
    mbid: string,
    mediaType: MediaType,
    apply: (media: Media, isNew: boolean) => void
  ): Promise<Media | undefined> {
    const mediaRepository = getRepository(Media);

    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await mediaRepository.findOne({
        where: { mbid, mediaType },
      });
      const media =
        existing ?? new Media({ mbid, mediaType, status: MediaStatus.UNKNOWN });
      apply(media, !existing);

      try {
        return await mediaRepository.save(media);
      } catch (e) {
        // Another stream created the row between our read and write: retry once.
        if (existing || attempt === 1) {
          throw e;
        }
      }
    }

    return undefined;
  }

  private async processArtist(
    server: LidarrSettings,
    artist: LidarrArtist,
    albums: LidarrAlbum[]
  ): Promise<void> {
    const { integrations } = getSettings();
    // With a library source on, its scanner decides what is available.
    const useFileHints = !(
      integrations.plex ||
      integrations.jellyfin ||
      integrations.navidrome ||
      integrations.localFiles
    );

    const artistMedia = await this.upsert(
      artist.foreignArtistId,
      MediaType.ARTIST,
      (media) => {
        media.title = artist.artistName || media.title;
        media.artistName = artist.artistName || media.artistName;
        media.lidarrServerId = server.id;
        media.lidarrArtistId = artist.id as number;
      }
    );

    const relevant = albums.filter(
      (album) =>
        !!album.id &&
        !!album.foreignAlbumId &&
        (album.monitored || (album.statistics?.trackFileCount ?? 0) > 0)
    );

    for (const album of relevant) {
      const files = album.statistics?.trackFileCount ?? 0;
      const trackCount = album.statistics?.trackCount ?? 0;

      const media = await this.upsert(
        album.foreignAlbumId,
        MediaType.RELEASE_GROUP,
        (row, isNew) => {
          row.lidarrServerId = server.id;
          row.lidarrArtistId = artist.id as number;
          row.lidarrAlbumId = album.id as number;
          row.artistMbid = row.artistMbid ?? artist.foreignArtistId;
          row.artistName = row.artistName ?? artist.artistName;
          if (isNew || !row.title) {
            row.title = album.title;
          }
          row.primaryType = row.primaryType ?? album.albumType ?? null;
          if (!row.secondaryTypes?.length) {
            row.secondaryTypes = secondaryTypeNames(album);
          }
          if (!row.firstReleaseDate && album.releaseDate) {
            row.firstReleaseDate = album.releaseDate.slice(0, 10);
          }

          if (useFileHints && !row.lastScanAt) {
            row.trackCount = row.trackCount ?? (trackCount || null);
            row.tracksAvailable = files;
            if (files > 0 && !row.mediaAddedAt) {
              row.mediaAddedAt = new Date();
            }
          }
        }
      );

      if (media) {
        this.albums++;
        if (useFileHints && !media.lastScanAt) {
          await MediaRequest.refreshMediaStatus(media.id);
          await MediaRequest.completeSatisfied(media.id);
        }
      }
    }

    if (artistMedia) {
      await this.completeDiscography(artistMedia, albums);
    }
  }

  /** A discography request is done when every monitored album has all its files. */
  private async completeDiscography(
    artistMedia: Media,
    albums: LidarrAlbum[]
  ): Promise<void> {
    const monitored = albums.filter((album) => album.monitored);
    if (
      monitored.length === 0 ||
      !monitored.every(
        (album) =>
          (album.statistics?.trackCount ?? 0) > 0 &&
          (album.statistics?.trackFileCount ?? 0) >=
            (album.statistics?.trackCount ?? 0)
      )
    ) {
      return;
    }

    const requestRepository = getRepository(MediaRequest);
    const requests = await requestRepository.find({
      where: {
        media: { id: artistMedia.id },
        scope: RequestScope.DISCOGRAPHY,
        status: MediaRequestStatus.APPROVED,
      },
    });

    for (const request of requests) {
      request.status = MediaRequestStatus.COMPLETED;
      request.downloadProgress = 100;
      await requestRepository.save(request);
    }
  }

  private log(
    message: string,
    level: 'info' | 'error' | 'debug' | 'warn' = 'debug',
    optional?: Record<string, unknown>
  ): void {
    logger[level](message, { label: 'Lidarr Scan', ...optional });
  }
}

export const lidarrScanner: LibraryScanner = new LidarrScanner();
