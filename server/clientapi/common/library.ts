import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import Track from '@server/entity/Track';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { createHash } from 'crypto';
import path from 'path';
import { In } from 'typeorm';

/**
 * The library the client APIs (OpenSubsonic, Jellyfin-compatible) expose:
 * every Track that is AVAILABLE and has a playable source, grouped into its
 * release group ("album") and album artist. Nothing here is invented — an
 * empty library is an empty index.
 *
 * The index is a short-lived in-memory snapshot so browse/search/sort/random
 * endpoints don't each re-query and re-group the whole library.
 */

export interface LibArtist {
  /** `m<mediaId>` for artists with a Media row, `x<hash>` for name-only artists. */
  key: string;
  mediaId?: number;
  mbid?: string;
  name: string;
  sortName: string;
  albums: LibAlbum[];
  created: Date;
}

export interface LibAlbum {
  mediaId: number;
  mbid: string;
  name: string;
  sortName: string;
  artist: LibArtist;
  year?: number;
  releaseDate?: string;
  primaryType?: string;
  secondaryTypes: string[];
  isCompilation: boolean;
  created: Date;
  durationMs: number;
  tracks: LibTrack[];
}

export interface LibTrack {
  id: number;
  recordingMbid?: string;
  title: string;
  sortName: string;
  /** Track artist credit; falls back to the album artist. */
  artist: string;
  album: LibAlbum;
  discNumber: number;
  trackNumber: number;
  durationMs: number;
  created: Date;
  /** File extension without the dot, lower case ("flac", "mp3"). */
  suffix: string;
  contentType: string;
  /** kbit/s when known */
  bitRate?: number;
  bitDepth?: number;
  /** Hz when known */
  sampleRate?: number;
  /** Path relative to the library root, for clients that show it. */
  path: string;
}

export interface LibraryIndex {
  builtAt: number;
  artists: LibArtist[];
  albums: LibAlbum[];
  tracks: LibTrack[];
  artistByKey: Map<string, LibArtist>;
  albumById: Map<number, LibAlbum>;
  trackById: Map<number, LibTrack>;
}

const TTL_MS = 20 * 1000;

let current: LibraryIndex | undefined;
let building: Promise<LibraryIndex> | undefined;

const CONTENT_TYPES: Record<string, string> = {
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  alac: 'audio/mp4',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  wma: 'audio/x-ms-wma',
  ape: 'audio/x-monkeys-audio',
  wv: 'audio/x-wavpack',
  dsf: 'audio/x-dsf',
};

const CODEC_SUFFIX: Record<string, string> = {
  flac: 'flac',
  mp3: 'mp3',
  mpeg: 'mp3',
  aac: 'm4a',
  alac: 'm4a',
  m4a: 'm4a',
  mp4: 'm4a',
  ogg: 'ogg',
  vorbis: 'ogg',
  opus: 'opus',
  wav: 'wav',
  wave: 'wav',
  pcm: 'wav',
  aiff: 'aiff',
  wma: 'wma',
  ape: 'ape',
  wavpack: 'wv',
  dsf: 'dsf',
  dsd: 'dsf',
};

export const contentTypeFor = (suffix: string): string =>
  CONTENT_TYPES[suffix.toLowerCase()] ?? 'application/octet-stream';

/**
 * Derive suffix / bit rate / bit depth / sample rate from what the scanners
 * store: the local file extension when there is one, and `Track.fileFormat`
 * ("FLAC 16/44.1", "MP3 320", "AAC 256").
 */
export const describeFormat = (
  fileFormat?: string | null,
  localPath?: string | null
): Pick<LibTrack, 'suffix' | 'contentType' | 'bitRate'> & {
  bitDepth?: number;
  sampleRate?: number;
} => {
  let suffix = '';
  const ext = localPath?.match(/\.([A-Za-z0-9]{2,5})$/)?.[1]?.toLowerCase();
  if (ext && CONTENT_TYPES[ext]) {
    suffix = ext;
  }

  let bitRate: number | undefined;
  let bitDepth: number | undefined;
  let sampleRate: number | undefined;

  const format = (fileFormat ?? '').trim();
  if (format) {
    const [codec, ...rest] = format.split(/\s+/);
    if (!suffix) {
      suffix = CODEC_SUFFIX[codec.toLowerCase()] ?? '';
    }
    const detail = rest.join(' ');
    const lossless = detail.match(/(\d{1,2})\s*\/\s*(\d{2,3}(?:\.\d+)?)/);
    if (lossless) {
      bitDepth = Number(lossless[1]);
      sampleRate = Math.round(Number(lossless[2]) * 1000);
    } else {
      const rate = detail.match(/(\d{2,4})/);
      if (rate) {
        bitRate = Number(rate[1]);
      }
    }
  }

  return {
    suffix,
    contentType: suffix ? contentTypeFor(suffix) : 'application/octet-stream',
    bitRate,
    bitDepth,
    sampleRate,
  };
};

/** "The Beatles" sorts under B, like Subsonic's ignoredArticles. */
export const IGNORED_ARTICLES = 'The El La Los Las Le Les';
const ARTICLE_RE = new RegExp(
  `^(?:${IGNORED_ARTICLES.split(' ').join('|')})\\s+`,
  'i'
);

export const sortNameOf = (name: string): string =>
  name
    .replace(ARTICLE_RE, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export const nameArtistKey = (name: string): string =>
  'x' +
  createHash('sha1')
    .update(name.trim().toLowerCase())
    .digest('hex')
    .slice(0, 24);

/**
 * Mirrors the source rules of server/lib/library/stream.ts so the apps are only
 * offered tracks the streamer will actually serve: a local file under a
 * configured music folder, or a copy on a media server that is switched on.
 */
const playableCheck = (): ((track: Track) => boolean) => {
  const settings = getSettings();
  const integrations = settings.integrations;
  const roots = settings.localFiles.folders.map((folder) =>
    path.resolve(folder)
  );

  return (track) => {
    const ids = track.sourceIds;
    if (!ids) {
      return false;
    }
    if (ids.localPath) {
      const resolved = path.resolve(ids.localPath);
      if (
        roots.some(
          (root) =>
            resolved === root || resolved.startsWith(`${root}${path.sep}`)
        )
      ) {
        return true;
      }
    }
    return !!(
      (integrations.plex && ids.plex) ||
      (integrations.jellyfin && ids.jellyfin) ||
      (integrations.navidrome && ids.navidrome)
    );
  };
};

const safeFileName = (value: string): string =>
  value.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Unknown';

/** Find (or create) the artist Media rows behind the albums, so artist ids stay stable. */
const loadArtistRows = async (
  wanted: Map<string, string>
): Promise<Map<string, Media>> => {
  const repository = getRepository(Media);
  const result = new Map<string, Media>();
  const mbids = [...wanted.keys()];

  for (let i = 0; i < mbids.length; i += 500) {
    const rows = await repository.find({
      where: { mediaType: MediaType.ARTIST, mbid: In(mbids.slice(i, i + 500)) },
    });
    rows.forEach((row) => result.set(row.mbid, row));
  }

  for (const [mbid, name] of wanted) {
    if (result.has(mbid)) {
      continue;
    }
    try {
      const row = await repository.save(
        new Media({
          mediaType: MediaType.ARTIST,
          mbid,
          title: name,
          artistName: name,
          status: MediaStatus.UNKNOWN,
        })
      );
      result.set(mbid, row);
    } catch (e) {
      // Another stream created it in the meantime (unique type+mbid).
      const row = await repository.findOne({
        where: { mediaType: MediaType.ARTIST, mbid },
      });
      if (row) {
        result.set(mbid, row);
      } else {
        logger.warn('Could not create an artist row for the client APIs', {
          label: 'Client API',
          mbid,
          errorMessage: e.message,
        });
      }
    }
  }

  return result;
};

const build = async (): Promise<LibraryIndex> => {
  const rows = await getRepository(Track)
    .createQueryBuilder('track')
    .innerJoinAndSelect('track.media', 'media')
    .where('track.status = :status', { status: MediaStatus.AVAILABLE })
    .andWhere('media.mediaType = :type', { type: MediaType.RELEASE_GROUP })
    .getMany();

  const playable = rows.filter(playableCheck());

  const wantedArtists = new Map<string, string>();
  for (const row of playable) {
    if (row.media.artistMbid && !wantedArtists.has(row.media.artistMbid)) {
      wantedArtists.set(
        row.media.artistMbid,
        row.media.artistName || 'Unknown artist'
      );
    }
  }
  const artistRows = await loadArtistRows(wantedArtists);

  const artistByKey = new Map<string, LibArtist>();
  const albumById = new Map<number, LibAlbum>();
  const trackById = new Map<number, LibTrack>();

  const artistFor = (media: Media): LibArtist => {
    const name = media.artistName?.trim() || 'Unknown artist';
    const row = media.artistMbid ? artistRows.get(media.artistMbid) : undefined;
    const key = row ? `m${row.id}` : nameArtistKey(name);

    let artist = artistByKey.get(key);
    if (!artist) {
      artist = {
        key,
        mediaId: row?.id,
        mbid: row?.mbid,
        name: row ? row.title || name : name,
        sortName: sortNameOf(row ? row.title || name : name),
        albums: [],
        created: new Date(row?.createdAt ?? media.createdAt ?? Date.now()),
      };
      artistByKey.set(key, artist);
    }
    return artist;
  };

  for (const row of playable) {
    const media = row.media;
    let album = albumById.get(media.id);
    if (!album) {
      const artist = artistFor(media);
      const year = Number(media.firstReleaseDate?.slice(0, 4));
      const secondaryTypes = (media.secondaryTypes ?? []).filter(Boolean);
      album = {
        mediaId: media.id,
        mbid: media.mbid,
        name: media.title || 'Unknown album',
        sortName: sortNameOf(media.title || ''),
        artist,
        year: Number.isFinite(year) && year > 0 ? year : undefined,
        releaseDate: media.firstReleaseDate ?? undefined,
        primaryType: media.primaryType ?? undefined,
        secondaryTypes,
        isCompilation: secondaryTypes.some(
          (t) => t.toLowerCase() === 'compilation'
        ),
        created: new Date(media.mediaAddedAt ?? media.createdAt ?? Date.now()),
        durationMs: 0,
        tracks: [],
      };
      artist.albums.push(album);
      albumById.set(media.id, album);
    }

    const format = describeFormat(row.fileFormat, row.sourceIds?.localPath);
    const number =
      row.trackNumber || Number(row.position.split('-').pop()) || 0;
    const track: LibTrack = {
      id: row.id,
      recordingMbid: row.recordingMbid ?? undefined,
      title: row.title,
      sortName: sortNameOf(row.title),
      artist: row.artistCredit?.trim() || album.artist.name,
      album,
      discNumber: row.discNumber || 1,
      trackNumber: number,
      durationMs: row.lengthMs ?? 0,
      created: new Date(row.createdAt ?? album.created),
      ...format,
      path: [
        safeFileName(album.artist.name),
        safeFileName(album.name),
        `${String(number).padStart(2, '0')} - ${safeFileName(row.title)}${
          format.suffix ? `.${format.suffix}` : ''
        }`,
      ].join('/'),
    };
    album.tracks.push(track);
    album.durationMs += track.durationMs;
    trackById.set(track.id, track);
  }

  const albums = [...albumById.values()];
  for (const album of albums) {
    album.tracks.sort(
      (a, b) =>
        a.discNumber - b.discNumber ||
        a.trackNumber - b.trackNumber ||
        a.id - b.id
    );
  }
  albums.sort(
    (a, b) => a.sortName.localeCompare(b.sortName) || a.mediaId - b.mediaId
  );

  const artists = [...artistByKey.values()];
  for (const artist of artists) {
    artist.albums.sort(
      (a, b) =>
        (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999') ||
        a.sortName.localeCompare(b.sortName)
    );
  }
  artists.sort(
    (a, b) => a.sortName.localeCompare(b.sortName) || a.key.localeCompare(b.key)
  );

  const tracks = albums.flatMap((album) => album.tracks);

  return {
    builtAt: Date.now(),
    artists,
    albums,
    tracks,
    artistByKey,
    albumById,
    trackById,
  };
};

export const getLibrary = async (): Promise<LibraryIndex> => {
  if (current && Date.now() - current.builtAt < TTL_MS) {
    return current;
  }
  if (!building) {
    building = build()
      .then((index) => {
        current = index;
        return index;
      })
      .finally(() => {
        building = undefined;
      });
  }
  return building;
};

/** Drop the snapshot (tests, and after writes that change what is listed). */
export const invalidateLibrary = (): void => {
  current = undefined;
};

export const artistTracks = (artist: LibArtist): LibTrack[] =>
  artist.albums.flatMap((album) => album.tracks);

const matches = (haystack: string, terms: string[]): boolean =>
  terms.every((term) => haystack.includes(term));

const termsOf = (query: string): string[] =>
  sortNameOf(query.replace(/^"|"$/g, '').replace(/\*/g, ' '))
    .split(/\s+/)
    .filter(Boolean);

export const searchLibrary = (
  index: LibraryIndex,
  query: string
): { artists: LibArtist[]; albums: LibAlbum[]; tracks: LibTrack[] } => {
  const terms = termsOf(query ?? '');
  if (!terms.length) {
    // Empty query = "everything" (clients use it to sync their local database).
    return {
      artists: index.artists,
      albums: index.albums,
      tracks: index.tracks,
    };
  }
  return {
    artists: index.artists.filter((a) => matches(sortNameOf(a.name), terms)),
    albums: index.albums.filter((a) =>
      matches(`${sortNameOf(a.name)} ${sortNameOf(a.artist.name)}`, terms)
    ),
    tracks: index.tracks.filter((t) =>
      matches(
        `${sortNameOf(t.title)} ${sortNameOf(t.artist)} ${sortNameOf(
          t.album.name
        )}`,
        terms
      )
    ),
  };
};

export const shuffled = <T>(items: T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};
