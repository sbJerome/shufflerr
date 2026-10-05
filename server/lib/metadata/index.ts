/* eslint-disable @typescript-eslint/no-unused-vars -- stub signatures; remove when implemented */
// STREAM(SV1): implement. Shared helpers every other stream calls to turn an
// MBID into Media/Track rows. Keep these signatures stable.
import type { MediaType } from '@server/constants/media';
import type Media from '@server/entity/Media';

export interface EnsureMediaOptions {
  /** Also make sure the canonical tracklist is stored in Track (release groups only). */
  withTracks?: boolean;
  /** Prefer this MusicBrainz release (e.g. the one Lidarr has) as the canonical tracklist. */
  preferReleaseMbid?: string;
}

/**
 * Find or create the Media row for an artist / release-group MBID, filling the
 * cached display fields (title, artistName, artistMbid, types, dates) from
 * MusicBrainz. Does not change `status`.
 */
export const ensureMedia = async (
  _mbid: string,
  _mediaType: MediaType,
  _options: EnsureMediaOptions = {}
): Promise<Media> => {
  throw new Error('ensureMedia() is not implemented');
};

/**
 * (Re)sync the canonical tracklist of a release group into Track rows,
 * preserving ids, status, sourceIds and peaks of tracks that still match.
 * Canonical release pick: the one Lidarr has → official, earliest, digital,
 * most tracks (docs/INTEGRATIONS.md §MusicBrainz).
 */
export const syncTracklist = async (
  _media: Media,
  _options: Pick<EnsureMediaOptions, 'preferReleaseMbid'> = {}
): Promise<Media> => {
  throw new Error('syncTracklist() is not implemented');
};

/** Release-group MBIDs in an artist's discography after the metadata-profile style type filter. */
export const getDiscographyReleaseGroups = async (
  _artistMbid: string
): Promise<{ mbid: string; title: string; primaryType?: string }[]> => {
  throw new Error('getDiscographyReleaseGroups() is not implemented');
};

/** Image-proxy URL for a release group's cover, or null when Cover Art Archive is off. */
export const coverUrlFor = (
  releaseGroupMbid: string,
  size: 250 | 500 | 1200 = 500
): string | null =>
  `/imageproxy/caa/release-group/${releaseGroupMbid}/front-${size}`;
