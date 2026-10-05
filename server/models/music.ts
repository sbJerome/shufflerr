/**
 * Domain result shapes returned by the browse/search/discover API.
 * These are the contract between the server streams and the front end —
 * see docs/API_CONTRACT.md.
 *
 * Conventions
 * - Every image URL is a same-origin path through the image proxy
 *   (`/imageproxy/<type>/...`) or null. The browser never talks to a
 *   third-party CDN. A URL may 404 (no art exists); the UI then shows the
 *   tinted placeholder slot.
 * - `status` is the library status (MediaStatus). UNKNOWN = "Not in library".
 * - Nothing here is ever sample data: when a source is off or has no data the
 *   arrays are empty.
 */
import type {
  MediaRequestStatus,
  MediaStatus,
  RequestScope,
} from '@server/constants/media';

export interface ArtistCredit {
  mbid: string;
  name: string;
  /** Join phrase that follows this artist (", ", " & ", " feat. ", ""). */
  joinPhrase?: string;
}

/** The active (PENDING/APPROVED) or latest request for an item, as much as lists need. */
export interface RequestSummary {
  id: number;
  status: MediaRequestStatus;
  scope: RequestScope;
  requestedBy: { id: number; displayName: string; avatar?: string };
  isAutoApproved: boolean;
  downloadProgress?: number | null;
  createdAt: string;
  /** For tracks scope: Track row ids covered by the request. */
  trackIds?: number[];
}

export interface MediaInfoSummary {
  /** Media row id */
  id: number;
  status: MediaStatus;
  trackCount?: number | null;
  tracksAvailable: number;
  mediaAddedAt?: string | null;
}

export interface ArtistResult {
  mbid: string;
  name: string;
  sortName?: string;
  disambiguation?: string;
  /** Person / Group / Orchestra … */
  type?: string;
  country?: string;
  /** e.g. "Chicago, US" */
  area?: string;
  /** Artist photo via the image proxy (fanart.tv / media server), else null → initials. */
  imageUrl: string | null;
  tags?: string[];
  /** AVAILABLE when the library holds anything by this artist, else UNKNOWN. */
  status: MediaStatus;
  /** Number of release groups by this artist that are (partly) in the library. */
  albumsInLibrary?: number;
  mediaInfo?: MediaInfoSummary;
  /** MusicBrainz search score 0–100 (search results only). */
  score?: number;
}

export interface AlbumResult {
  /** Release-group MBID */
  mbid: string;
  title: string;
  artistMbid: string;
  artistName: string;
  artistCredit?: ArtistCredit[];
  /** Album / Single / EP / Broadcast / Other */
  primaryType?: string;
  secondaryTypes?: string[];
  /** YYYY or YYYY-MM-DD */
  firstReleaseDate?: string;
  year?: number;
  /** `/imageproxy/caa/release-group/<mbid>/front-500` (or media-server art), or null. */
  coverUrl: string | null;
  status: MediaStatus;
  trackCount?: number | null;
  tracksAvailable?: number;
  mediaInfo?: MediaInfoSummary;
  /** Active request covering this album (own or anyone's, by permission). */
  request?: RequestSummary;
  score?: number;
}

export interface TrackResult {
  recordingMbid: string;
  title: string;
  artistMbid?: string;
  artistName: string;
  artistCredit?: ArtistCredit[];
  lengthMs?: number | null;
  /** First/best release group this recording appears on. */
  album?: Pick<AlbumResult, 'mbid' | 'title' | 'coverUrl' | 'year'>;
  status: MediaStatus;
  /** Track row id when the recording is known to the library index. Needed to play it. */
  trackId?: number;
  /** True when /api/v1/stream/track/:trackId will work. */
  playable: boolean;
  score?: number;
}

export interface AlbumTrack {
  /** Track row id (undefined until the tracklist has been synced into the DB). */
  id?: number;
  recordingMbid?: string | null;
  /** "01" or "1-07" */
  position: string;
  discNumber: number;
  trackNumber: number;
  title: string;
  /** e.g. "John Summit, Devault, Julia Church" */
  artistCredit: string;
  lengthMs?: number | null;
  status: MediaStatus;
  /** e.g. "FLAC 16/44.1"; null when missing */
  fileFormat?: string | null;
  playable: boolean;
  /** True when waveform peaks exist at /api/v1/stream/track/:id/peaks. */
  hasPeaks: boolean;
  /** Set when an active request covers this track. */
  requestStatus?: MediaRequestStatus;
  /** Which sources hold the track. */
  sources?: ('plex' | 'jellyfin' | 'navidrome' | 'local')[];
}

export interface ExternalLink {
  type:
    | 'musicbrainz'
    | 'lidarr'
    | 'plex'
    | 'jellyfin'
    | 'navidrome'
    | 'lastfm'
    | 'discogs'
    | 'spotify'
    | 'bandcamp'
    | 'apple'
    | 'official'
    | 'other';
  url: string;
  label?: string;
}

export interface AlbumDetails extends AlbumResult {
  /** The MusicBrainz release (edition) the tracklist comes from. */
  releaseMbid?: string | null;
  label?: string;
  discCount: number;
  totalLengthMs?: number;
  genres?: string[];
  tracks: AlbumTrack[];
  /** Requests for this album the viewer may see, newest first. */
  requests: RequestSummary[];
  /** Covering discography request for the artist, if active. */
  discographyRequest?: RequestSummary;
  links: ExternalLink[];
  lidarr?: {
    serverId: number;
    albumId?: number | null;
    artistId?: number | null;
    monitored: boolean;
  } | null;
  /** Open issues count (backlog UI). */
  openIssues?: number;
}

export interface ArtistDetails extends ArtistResult {
  /** Wide background image via the image proxy, or null. */
  backgroundUrl: string | null;
  /** Bio text (plain, may be truncated) with required attribution link. Null when no source is on. */
  bio: { text: string; url: string; source: 'lastfm' | 'musicbrainz' } | null;
  lifeSpan?: { begin?: string; end?: string; ended?: boolean };
  facts: {
    /** Release groups on MusicBrainz (after type filters) */
    releases: number;
    /** …of which (partly) in the library */
    inLibrary: number;
    /** …with an active approved request / in the Lidarr queue */
    downloading: number;
    /** …with primary type Album */
    albums: number;
  };
  lidarr: {
    serverId: number;
    artistId: number;
    monitored: boolean;
    /** Lidarr "monitor new items" is on (Watch for new releases). */
    monitorNewItems: boolean;
    qualityProfileName?: string;
    metadataProfileName?: string;
    rootFolder?: string;
  } | null;
  /** All release groups, newest first; each carries status and any active request. */
  discography: AlbumResult[];
  similar: ArtistResult[];
  links: ExternalLink[];
  /** Active discography request for this artist, if any. */
  discographyRequest?: RequestSummary;
}

export interface SearchBucket<T> {
  total: number;
  results: T[];
}

export interface SearchResults {
  query: string;
  page: number;
  pageSize: number;
  artists: SearchBucket<ArtistResult>;
  albums: SearchBucket<AlbumResult>;
  tracks: SearchBucket<TrackResult>;
}

/** Wrapper for every Discover row and optional section. */
export interface SourcedList<T> {
  /** False when the integration behind this row is off — the UI hides the row. */
  enabled: boolean;
  /** Why it is empty/off, safe to show to admins. */
  reason?: string;
  results: T[];
}

export interface ConcertResult {
  id: number;
  provider: 'ticketmaster' | 'skiddle';
  artistMbid?: string | null;
  artistName: string;
  name?: string | null;
  venue?: string | null;
  city?: string | null;
  country?: string | null;
  startsAt: string;
  /** Ticket page on the provider (attribution link). */
  url: string;
  imageUrl?: string | null;
}

/** A play from the scrobble log / media-server history. */
export interface PlayResult {
  id: number;
  playedAt: string;
  source: 'plex' | 'jellyfin' | 'navidrome' | 'apps' | 'web';
  title: string;
  artistName: string;
  albumTitle?: string | null;
  albumMbid?: string | null;
  coverUrl: string | null;
  trackId?: number | null;
  playable: boolean;
}
