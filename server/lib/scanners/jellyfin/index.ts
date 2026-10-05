// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Jellyfin / Emby scanner, music libraries only: MusicAlbum → Audio → library core.
import type { JellyfinMusicItem } from '@server/api/jellyfin';
import JellyfinAPI from '@server/api/jellyfin';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { asMbid } from '@server/lib/library/normalize';
import type { AlbumStub, ScanMode } from '@server/lib/library/sourceScanner';
import { SourceScanner } from '@server/lib/library/sourceScanner';
import type { ScannedAlbum, ScannedTrack } from '@server/lib/library/types';
import { getSettings } from '@server/lib/settings';
import { getHostname } from '@server/utils/getHostname';

const PAGE_SIZE = 200;
const RECENT_LIMIT = 50;
const LOSSLESS = new Set(['flac', 'alac', 'wav', 'aiff', 'ape', 'wv', 'dsf']);

const jellyfinFormat = (item: JellyfinMusicItem): string | undefined => {
  const source = item.MediaSources?.[0];
  const audio = source?.MediaStreams?.find((stream) => stream.Type === 'Audio');
  const codec = (audio?.Codec ?? source?.Container ?? item.Container ?? '')
    .split(',')[0]
    .toLowerCase();
  if (!codec) {
    return undefined;
  }
  const name = codec === 'mp3' ? 'MP3' : codec.toUpperCase();
  if (LOSSLESS.has(codec)) {
    return audio?.BitDepth && audio?.SampleRate
      ? `${name} ${audio.BitDepth}/${Math.round(audio.SampleRate / 100) / 10}`
      : name;
  }
  const bitrate = audio?.BitRate ?? source?.Bitrate;
  return bitrate ? `${name} ${Math.round(bitrate / 1000)}` : name;
};

export const jellyfinAlbumToScanned = (
  album: JellyfinMusicItem,
  tracks: JellyfinMusicItem[]
): ScannedAlbum => ({
  source: 'jellyfin',
  sourceAlbumId: album.Id,
  artistName:
    album.AlbumArtist ??
    album.AlbumArtists?.[0]?.Name ??
    album.Artists?.[0] ??
    '',
  albumTitle: album.Name,
  year: album.ProductionYear,
  releaseGroupMbid: asMbid(album.ProviderIds?.MusicBrainzReleaseGroup),
  releaseMbid: asMbid(album.ProviderIds?.MusicBrainzAlbum),
  artistMbid: asMbid(album.ProviderIds?.MusicBrainzAlbumArtist),
  addedAt: album.DateCreated ? new Date(album.DateCreated) : undefined,
  tracks: tracks.map((track): ScannedTrack => {
    // Jellyfin's "MusicBrainzTrack" is the release-track id on current
    // versions and the recording id on older ones — matched as either
    const trackId = asMbid(track.ProviderIds?.MusicBrainzTrack);
    return {
      sourceId: track.Id,
      title: track.Name,
      discNumber: track.ParentIndexNumber ?? 1,
      trackNumber: track.IndexNumber,
      durationMs: track.RunTimeTicks
        ? Math.round(track.RunTimeTicks / 10000)
        : undefined,
      fileFormat: jellyfinFormat(track),
      recordingMbid: asMbid(track.ProviderIds?.MusicBrainzRecording),
      otherMbids: trackId ? [trackId] : undefined,
    };
  }),
});

class JellyfinScanner extends SourceScanner {
  constructor(mode: ScanMode) {
    super(
      mode === 'full' ? 'Jellyfin Full Scan' : 'Jellyfin Recently Added Scan',
      'jellyfin',
      mode
    );
  }

  protected async collect(): Promise<AlbumStub[]> {
    const settings = getSettings();

    if (!settings.jellyfin.apiKey) {
      throw new Error(
        'Add a Jellyfin API key (Dashboard → API keys in Jellyfin) before scanning.'
      );
    }

    const owner = await getRepository(User).findOne({
      select: { id: true, jellyfinUserId: true, jellyfinDeviceId: true },
      where: { id: 1 },
    });
    const jellyfin = new JellyfinAPI(
      getHostname(),
      settings.jellyfin.apiKey,
      owner?.jellyfinDeviceId
    );
    if (owner?.jellyfinUserId) {
      jellyfin.setUserId(owner.jellyfinUserId);
    }

    const libraries = settings.jellyfin.libraries.filter(
      (library) => library.enabled
    );
    const stubs: AlbumStub[] = [];

    for (const library of libraries) {
      let startIndex = 0;
      let total = Infinity;

      while (startIndex < total) {
        this.assertNotCancelled();
        const page = await jellyfin.getMusicAlbums(library.id, {
          startIndex,
          limit: this.mode === 'recent' ? RECENT_LIMIT : PAGE_SIZE,
          recentFirst: this.mode === 'recent',
        });
        total = this.mode === 'recent' ? 0 : page.total;
        if (page.items.length === 0) {
          break;
        }
        startIndex += page.items.length;

        for (const album of page.items) {
          stubs.push({
            id: album.Id,
            label: `${album.AlbumArtist ?? 'Unknown artist'} – ${album.Name}`,
            signature: [album.DateCreated ?? '', album.ChildCount ?? ''].join(
              '|'
            ),
            library: { id: library.id, name: library.name },
            load: async () =>
              jellyfinAlbumToScanned(
                album,
                await jellyfin.getAlbumTracks(album.Id)
              ),
          });
        }
      }

      library.lastScan = Date.now();
    }

    return stubs;
  }
}

export const jellyfinFullScanner = new JellyfinScanner('full');
export const jellyfinRecentScanner = new JellyfinScanner('recent');
