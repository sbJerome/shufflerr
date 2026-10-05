import { asMbid } from '@server/lib/library/normalize';
import { parseFile } from 'music-metadata';
import path from 'path';

/** What the scanner keeps per audio file (cached in the scan state between runs). */
export interface FileTags {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  durationMs?: number;
  /** "FLAC 16/44.1", "MP3 320" */
  fileFormat?: string;
  releaseGroupMbid?: string;
  releaseMbid?: string;
  recordingMbid?: string;
  /** MusicBrainz release-track id */
  trackMbid?: string;
  albumArtistMbid?: string;
}

export const AUDIO_EXTENSIONS = new Set([
  '.flac',
  '.mp3',
  '.m4a',
  '.m4b',
  '.aac',
  '.ogg',
  '.oga',
  '.opus',
  '.wav',
  '.aif',
  '.aiff',
  '.wma',
  '.ape',
  '.wv',
  '.dsf',
]);

export const isAudioFile = (filePath: string): boolean =>
  AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());

const CODEC_BY_EXTENSION: Record<string, string> = {
  '.flac': 'FLAC',
  '.mp3': 'MP3',
  '.aac': 'AAC',
  '.ogg': 'OGG',
  '.oga': 'OGG',
  '.opus': 'OPUS',
  '.wav': 'WAV',
  '.aif': 'AIFF',
  '.aiff': 'AIFF',
  '.wma': 'WMA',
  '.ape': 'APE',
  '.wv': 'WAVPACK',
  '.dsf': 'DSD',
};

const trimNumber = (value: number): string =>
  String(Math.round(value * 10) / 10);

/** "FLAC 16/44.1" for lossless files, "MP3 320" (kbit/s) for lossy ones. */
export const describeFormat = (
  filePath: string,
  format: {
    codec?: string;
    lossless?: boolean;
    bitsPerSample?: number;
    sampleRate?: number;
    bitrate?: number;
  }
): string => {
  const extension = path.extname(filePath).toLowerCase();
  let codec = CODEC_BY_EXTENSION[extension];
  if (!codec) {
    // MP4 containers hold AAC or ALAC
    codec = /alac/i.test(format.codec ?? '') ? 'ALAC' : 'AAC';
  }
  if (format.lossless && format.bitsPerSample && format.sampleRate) {
    return `${codec} ${format.bitsPerSample}/${trimNumber(
      format.sampleRate / 1000
    )}`;
  }
  if (!format.lossless && format.bitrate) {
    return `${codec} ${Math.round(format.bitrate / 1000)}`;
  }
  return codec;
};

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/** Read the tags Shufflerr needs. Cover art is skipped; MBIDs are only taken when well-formed. */
export const readTags = async (filePath: string): Promise<FileTags> => {
  const { common, format } = await parseFile(filePath, {
    duration: false,
    skipCovers: true,
  });

  return {
    title: clean(common.title),
    artist: clean(common.artist),
    albumArtist: clean(common.albumartist),
    album: clean(common.album),
    year: common.year ?? undefined,
    trackNo: common.track?.no ?? undefined,
    discNo: common.disk?.no ?? undefined,
    durationMs: format.duration
      ? Math.round(format.duration * 1000)
      : undefined,
    fileFormat: describeFormat(filePath, format),
    releaseGroupMbid: asMbid(common.musicbrainz_releasegroupid),
    releaseMbid: asMbid(common.musicbrainz_albumid),
    recordingMbid: asMbid(common.musicbrainz_recordingid),
    trackMbid: asMbid(common.musicbrainz_trackid),
    albumArtistMbid: asMbid(first(common.musicbrainz_albumartistid)),
  };
};

const DISC_FOLDER = /^(cd|disc|disk|vinyl)[\s._-]*\d{1,2}$/i;

/** The album folder of a file: its directory, or the parent of a "CD 1"-style subfolder. */
export const albumFolderOf = (filePath: string): string => {
  const directory = path.dirname(filePath);
  return DISC_FOLDER.test(path.basename(directory))
    ? path.dirname(directory)
    : directory;
};

/** "CTRL ESCAPE (2026)" → { title: "CTRL ESCAPE", year: 2026 } */
export const parseAlbumFolder = (
  folderName: string
): { title: string; year?: number } => {
  let year: number | undefined;
  let title = folderName
    .replace(/[\s._-]*[([{]((?:19|20)\d{2})[)\]}]\s*$/, (_m, y: string) => {
      year = Number(y);
      return '';
    })
    .replace(/^((?:19|20)\d{2})\s*[-–.]\s+/, (_m, y: string) => {
      year = year ?? Number(y);
      return '';
    });
  // trailing "[FLAC]", "[2011 Remaster]" style qualifiers
  title = title.replace(/\s*\[[^\]]*\]\s*$/g, '').trim();
  return { title: title || folderName, year };
};

/**
 * What can be told from the path alone, used only where tags are missing:
 * `<artist>/<album (year)>/<artist> - <album> - <nn> - <title>.ext` and the
 * usual `<nn> <title>` / `<nn> - <title>` file names.
 */
export const guessFromPath = (
  filePath: string
): Pick<
  FileTags,
  'title' | 'artist' | 'album' | 'year' | 'trackNo' | 'discNo'
> => {
  const albumFolder = albumFolderOf(filePath);
  const album = parseAlbumFolder(path.basename(albumFolder));
  const artist = path.basename(path.dirname(albumFolder)) || undefined;
  const discMatch = /(\d{1,2})$/.exec(path.basename(path.dirname(filePath)));
  const discNo =
    albumFolder !== path.dirname(filePath) && discMatch
      ? Number(discMatch[1])
      : undefined;

  const base = path.basename(filePath, path.extname(filePath));
  const parts = base.split(/\s+-\s+/);
  let trackNo: number | undefined;
  let title = base;

  const numberIndex = parts.findIndex((part) => /^\d{1,3}$/.test(part.trim()));
  if (numberIndex >= 0 && numberIndex < parts.length - 1) {
    trackNo = Number(parts[numberIndex]);
    title = parts.slice(numberIndex + 1).join(' - ');
  } else {
    const leading = /^(\d{1,3})[\s._-]+(.+)$/.exec(base);
    if (leading) {
      trackNo = Number(leading[1]);
      title = leading[2];
    }
  }

  return {
    title: title.trim() || base,
    artist,
    album: album.title,
    year: album.year,
    trackNo,
    discNo,
  };
};
