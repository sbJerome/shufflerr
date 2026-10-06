/**
 * Image URL helpers. Every third-party image is served through Shufflerr's
 * image proxy (`/imageproxy/<type>/...`); the browser never talks to Cover Art
 * Archive, fanart.tv, Last.fm, Spotify, Plex or Jellyfin directly.
 */

export type CoverSize = 250 | 500 | 1200;

const PROXY_HOSTS: [RegExp, string][] = [
  [/^https?:\/\/coverartarchive\.org\//, '/imageproxy/caa/'],
  [/^https?:\/\/assets\.fanart\.tv\//, '/imageproxy/fanart/'],
  [/^https?:\/\/lastfm\.freetls\.fastly\.net\//, '/imageproxy/lastfm/'],
  [/^https?:\/\/i\.scdn\.co\//, '/imageproxy/spotify/'],
  [/^https?:\/\/(?:e-)?cdn(?:s)?-images\.dzcdn\.net\//, '/imageproxy/deezer/'],
  [/^https?:\/\/is\d-ssl\.mzstatic\.com\//, '/imageproxy/itunes/'],
  [/^https?:\/\/(?:[\w-]+\.)?archive\.org\//, '/imageproxy/archive/'],
  [/^https?:\/\/s1\.ticketm\.net\//, '/imageproxy/ticketmaster/'],
  [/^https?:\/\/d1plawd8huk6hh\.cloudfront\.net\//, '/imageproxy/skiddle/'],
  [/^https?:\/\/i\.ytimg\.com\//, '/imageproxy/youtube/'],
];

/** Front cover of a MusicBrainz release group, through the image proxy. */
export const coverUrl = (
  releaseGroupMbid: string,
  size: CoverSize = 250
): string => `/imageproxy/caa/release-group/${releaseGroupMbid}/front-${size}`;

/**
 * Turn any image reference the API returns into a same-origin URL.
 * Relative URLs (already proxied) pass through unchanged. Unknown absolute
 * hosts return `undefined` so the caller falls back to the tinted slot.
 */
export const proxied = (src?: string | null): string | undefined => {
  if (!src) {
    return undefined;
  }
  if (src.startsWith('/') || src.startsWith('data:')) {
    return src;
  }
  for (const [pattern, prefix] of PROXY_HOSTS) {
    if (pattern.test(src)) {
      return src.replace(pattern, prefix);
    }
  }
  return undefined;
};

/** Hosts whose avatar URLs the browser loads directly, as Seerr does. */
const AVATAR_HOSTS = [
  /^https:\/\/plex\.tv\/users\/[a-z0-9]+\/avatar/i,
  /^https:\/\/(www\.|secure\.)?gravatar\.com\/avatar\//i,
];

/**
 * User avatar: Jellyfin avatars come through `/avatarproxy`, Plex and Gravatar
 * ones are loaded from their own hosts (the same way Seerr shows them).
 */
export const avatarUrl = (avatar?: string | null): string | undefined => {
  if (!avatar) {
    return undefined;
  }
  if (avatar.startsWith('/')) {
    return avatar;
  }
  if (AVATAR_HOSTS.some((pattern) => pattern.test(avatar))) {
    return avatar;
  }
  return proxied(avatar);
};
