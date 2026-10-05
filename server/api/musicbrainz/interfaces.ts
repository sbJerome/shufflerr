/** Shapes of the MusicBrainz ws/2 JSON API that Shufflerr reads. */

export interface MbArtistCredit {
  name: string;
  joinphrase?: string;
  artist: {
    id: string;
    name: string;
    'sort-name'?: string;
    disambiguation?: string;
  };
}

export interface MbTag {
  name: string;
  count?: number;
}

export interface MbArea {
  id?: string;
  name: string;
  'iso-3166-1-codes'?: string[];
}

export interface MbUrlRelation {
  type: string;
  url?: { id?: string; resource: string };
  ended?: boolean;
}

export interface MbArtist {
  id: string;
  name: string;
  'sort-name'?: string;
  disambiguation?: string;
  type?: string | null;
  country?: string | null;
  area?: MbArea | null;
  'begin-area'?: MbArea | null;
  'life-span'?: { begin?: string | null; end?: string | null; ended?: boolean };
  tags?: MbTag[];
  genres?: MbTag[];
  relations?: MbUrlRelation[];
  /** search results only */
  score?: number;
}

export interface MbMedium {
  position?: number;
  format?: string | null;
  title?: string;
  'track-count'?: number;
  tracks?: MbTrack[];
}

export interface MbTrack {
  id: string;
  number?: string;
  position: number;
  title: string;
  length?: number | null;
  'artist-credit'?: MbArtistCredit[];
  recording?: {
    id: string;
    title: string;
    length?: number | null;
    'artist-credit'?: MbArtistCredit[];
  };
}

export interface MbRelease {
  id: string;
  title: string;
  status?: string | null;
  date?: string;
  country?: string | null;
  barcode?: string | null;
  disambiguation?: string;
  packaging?: string | null;
  media?: MbMedium[];
  'artist-credit'?: MbArtistCredit[];
  'label-info'?: { 'catalog-number'?: string; label?: { name: string } }[];
  'release-group'?: MbReleaseGroup;
  'track-count'?: number;
}

export interface MbReleaseGroup {
  id: string;
  title: string;
  'primary-type'?: string | null;
  'secondary-types'?: string[];
  'first-release-date'?: string;
  disambiguation?: string;
  'artist-credit'?: MbArtistCredit[];
  releases?: MbRelease[];
  tags?: MbTag[];
  genres?: MbTag[];
  score?: number;
}

export interface MbRecording {
  id: string;
  title: string;
  length?: number | null;
  disambiguation?: string;
  'artist-credit'?: MbArtistCredit[];
  releases?: MbRelease[];
  isrcs?: string[];
  'first-release-date'?: string;
  score?: number;
}

export interface MbArtistSearch {
  count: number;
  offset: number;
  artists: MbArtist[];
}

export interface MbReleaseGroupSearch {
  count: number;
  offset: number;
  'release-groups': MbReleaseGroup[];
}

export interface MbRecordingSearch {
  count: number;
  offset: number;
  recordings: MbRecording[];
}

export interface MbReleaseSearch {
  count: number;
  offset: number;
  releases: MbRelease[];
}

export interface MbReleaseGroupBrowse {
  'release-group-count': number;
  'release-group-offset': number;
  'release-groups': MbReleaseGroup[];
}
