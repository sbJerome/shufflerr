// Navidrome scanner over the Subsonic / OpenSubsonic API.
import type { SubsonicAlbum } from '@server/api/subsonic';
import SubsonicAPI from '@server/api/subsonic';
import { asMbid } from '@server/lib/library/normalize';
import type { AlbumStub } from '@server/lib/library/sourceScanner';
import { SourceScanner } from '@server/lib/library/sourceScanner';
import type { ScannedAlbum, ScannedTrack } from '@server/lib/library/types';
import { getSettings } from '@server/lib/settings';

const PAGE_SIZE = 500;
const LOSSLESS = new Set([
  'flac',
  'alac',
  'wav',
  'aiff',
  'aif',
  'ape',
  'wv',
  'dsf',
]);

const subsonicFormat = (song: {
  suffix?: string;
  bitRate?: number;
  bitDepth?: number;
  samplingRate?: number;
}): string | undefined => {
  const suffix = (song.suffix ?? '').toLowerCase();
  if (!suffix) {
    return undefined;
  }
  const name = suffix.toUpperCase();
  if (LOSSLESS.has(suffix)) {
    return song.bitDepth && song.samplingRate
      ? `${name} ${song.bitDepth}/${Math.round(song.samplingRate / 100) / 10}`
      : name;
  }
  return song.bitRate ? `${name} ${song.bitRate}` : name;
};

export const subsonicAlbumToScanned = (album: SubsonicAlbum): ScannedAlbum => ({
  source: 'navidrome',
  sourceAlbumId: album.id,
  artistName: album.artist ?? album.artists?.[0]?.name ?? '',
  albumTitle: album.name,
  year: album.year,
  releaseGroupMbid: asMbid(album.releaseGroupMbid),
  // OpenSubsonic `musicBrainzId` on an album is the release id in Navidrome,
  // but the spec does not pin it down — resolved as release, then release group
  ambiguousMbid: asMbid(album.musicBrainzId),
  addedAt: album.created ? new Date(album.created) : undefined,
  tracks: (album.song ?? []).map(
    (song): ScannedTrack => ({
      sourceId: song.id,
      title: song.title,
      discNumber: song.discNumber ?? 1,
      trackNumber: song.track,
      durationMs: song.duration ? song.duration * 1000 : undefined,
      fileFormat: subsonicFormat(song),
      recordingMbid: asMbid(song.musicBrainzId),
    })
  ),
});

class NavidromeScanner extends SourceScanner {
  constructor() {
    super('Navidrome Scan', 'navidrome', 'full');
  }

  protected async collect(): Promise<AlbumStub[]> {
    const { url, username } = getSettings().navidrome;

    if (!url || !username) {
      throw new Error(
        'Add the Navidrome server URL and username before scanning.'
      );
    }

    const navidrome = SubsonicAPI.fromSettings();
    const stubs: AlbumStub[] = [];
    let offset = 0;

    for (;;) {
      this.assertNotCancelled();
      const page = await navidrome.getAlbumList2('alphabeticalByName', {
        size: PAGE_SIZE,
        offset,
      });
      for (const album of page) {
        stubs.push({
          id: album.id,
          label: `${album.artist ?? 'Unknown artist'} – ${album.name}`,
          signature: [
            album.songCount ?? '',
            album.duration ?? '',
            album.created ?? '',
          ].join('|'),
          load: async () => {
            const full = await navidrome.getAlbum(album.id);
            return full ? subsonicAlbumToScanned(full) : null;
          },
        });
      }
      if (page.length < PAGE_SIZE) {
        break;
      }
      offset += page.length;
    }

    return stubs;
  }
}

export const navidromeScanner = new NavidromeScanner();
