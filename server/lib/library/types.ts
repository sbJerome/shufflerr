/** What a library scanner hands to the ingest core. Nothing here is ever invented: MBIDs are
 * only set when the source (tags, Plex GUIDs, Jellyfin ProviderIds, OpenSubsonic) supplied them. */
export type LibrarySource = 'plex' | 'jellyfin' | 'navidrome' | 'local';

/** Key under Track.sourceIds that holds this source's id for a track. */
export const SOURCE_ID_KEY = {
  plex: 'plex',
  jellyfin: 'jellyfin',
  navidrome: 'navidrome',
  local: 'localPath',
} as const satisfies Record<LibrarySource, string>;

export const LIBRARY_SOURCES: LibrarySource[] = [
  'local',
  'plex',
  'jellyfin',
  'navidrome',
];

export interface ScannedTrack {
  /** Rating key / item id / song id / absolute file path. */
  sourceId: string;
  title: string;
  discNumber?: number;
  trackNumber?: number;
  durationMs?: number | null;
  /** e.g. "FLAC 16/44.1", "MP3 320" */
  fileFormat?: string | null;
  /** MusicBrainz recording id, when the source knows it. */
  recordingMbid?: string | null;
  /** Any other MusicBrainz id attached to the track (release-track id, ambiguous GUID). */
  otherMbids?: string[];
  /** Plex: the Part key used for direct streaming. */
  plexPartKey?: string;
}

export interface ScannedAlbum {
  source: LibrarySource;
  /** Stable id of the album inside the source (rating key, item id, album id, folder key). */
  sourceAlbumId: string;
  artistName: string;
  albumTitle: string;
  /**
   * Other real spellings of the same album the source offers (local files: the
   * artist and album folder names next to the tags). Tried in order when the
   * primary pair finds nothing on MusicBrainz.
   */
  aliases?: { artistName: string; albumTitle: string }[];
  year?: number;
  releaseGroupMbid?: string | null;
  /** MusicBrainz release (edition) id. */
  releaseMbid?: string | null;
  /** A MusicBrainz id of unknown kind (Plex `mbid://` album GUIDs): tried as release, then release group. */
  ambiguousMbid?: string | null;
  artistMbid?: string | null;
  addedAt?: Date;
  /** Local files: the album folder. */
  localPath?: string;
  tracks: ScannedTrack[];
}

export type IngestOutcome =
  | { result: 'ingested'; mediaId: number; mbid: string; matched: number }
  /** MusicBrainz has no match for this album; retried later. */
  | { result: 'unresolved' }
  /** MusicBrainz (or the metadata layer) could not be reached; retried on the next run. */
  | { result: 'deferred'; reason: string };
