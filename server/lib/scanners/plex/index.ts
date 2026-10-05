// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Plex scanner, music libraries only: albums → tracks → library core.
import type { PlexAlbum, PlexTrack } from '@server/api/plexapi';
import PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { asMbid } from '@server/lib/library/normalize';
import type { AlbumStub, ScanMode } from '@server/lib/library/sourceScanner';
import { SourceScanner } from '@server/lib/library/sourceScanner';
import type { ScannedAlbum, ScannedTrack } from '@server/lib/library/types';
import { getSettings } from '@server/lib/settings';

const PAGE_SIZE = 200;
/** Window the recently-added scan looks back over (unchanged albums are skipped anyway). */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

const LOSSLESS = new Set([
  'flac',
  'alac',
  'wav',
  'aiff',
  'ape',
  'wavpack',
  'dsd',
]);

/** MusicBrainz ids among a Plex item's GUIDs (`mbid://<uuid>`). */
export const plexMbids = (guids: { id: string }[] | undefined): string[] =>
  (guids ?? [])
    .map((guid) =>
      guid.id.startsWith('mbid://') ? asMbid(guid.id.slice(7)) : undefined
    )
    .filter((id): id is string => !!id);

const plexFormat = (track: PlexTrack): string | undefined => {
  const media = track.Media?.[0];
  const codec = (media?.audioCodec ?? media?.container ?? '').toLowerCase();
  if (!codec) {
    return undefined;
  }
  const name = codec === 'mp3' ? 'MP3' : codec.toUpperCase();
  return LOSSLESS.has(codec) || !media?.bitrate
    ? name
    : `${name} ${media.bitrate}`;
};

export const plexAlbumToScanned = (
  album: PlexAlbum,
  tracks: PlexTrack[]
): ScannedAlbum => ({
  source: 'plex',
  sourceAlbumId: album.ratingKey,
  artistName: album.parentTitle ?? '',
  albumTitle: album.title,
  year: album.year,
  // Plex does not say whether the id is a release or a release group
  ambiguousMbid: plexMbids(album.Guid)[0],
  addedAt: album.addedAt ? new Date(album.addedAt * 1000) : undefined,
  tracks: tracks.map(
    (track): ScannedTrack => ({
      sourceId: track.ratingKey,
      title: track.title,
      discNumber: track.parentIndex ?? 1,
      trackNumber: track.index,
      durationMs: track.duration ?? track.Media?.[0]?.duration,
      fileFormat: plexFormat(track),
      otherMbids: plexMbids(track.Guid),
      plexPartKey: track.Media?.[0]?.Part?.[0]?.key,
    })
  ),
});

class PlexScanner extends SourceScanner {
  constructor(mode: ScanMode) {
    super(
      mode === 'full' ? 'Plex Full Scan' : 'Plex Recently Added Scan',
      'plex',
      mode
    );
  }

  protected async collect(): Promise<AlbumStub[]> {
    const settings = getSettings();
    const owner = await getRepository(User).findOne({
      select: { id: true, plexToken: true },
      where: { id: 1 },
    });

    if (!owner?.plexToken) {
      throw new Error(
        'Plex needs the owner to sign in with Plex before libraries can be scanned.'
      );
    }

    const plex = new PlexAPI({ plexToken: owner.plexToken });
    const libraries = settings.plex.libraries.filter(
      (library) => library.enabled
    );
    const stubs: AlbumStub[] = [];

    for (const library of libraries) {
      const addedSince =
        this.mode === 'recent' ? Date.now() - RECENT_WINDOW_MS : undefined;
      let offset = 0;
      let total = Infinity;

      while (offset < total) {
        this.assertNotCancelled();
        const page = await plex.getAlbums(library.id, {
          offset,
          size: PAGE_SIZE,
          addedSince,
        });
        total = page.totalSize;
        if (page.items.length === 0) {
          break;
        }
        offset += page.items.length;

        for (const album of page.items) {
          stubs.push({
            id: album.ratingKey,
            label: `${album.parentTitle ?? 'Unknown artist'} – ${album.title}`,
            signature: [
              album.updatedAt ?? '',
              album.addedAt ?? '',
              album.leafCount ?? '',
            ].join('|'),
            library: { id: library.id, name: library.name },
            load: async () =>
              plexAlbumToScanned(
                album,
                await plex.getAlbumTracks(album.ratingKey)
              ),
          });
        }
      }

      library.lastScan = Date.now();
    }

    return stubs;
  }
}

export const plexFullScanner = new PlexScanner('full');
export const plexRecentScanner = new PlexScanner('recent');
