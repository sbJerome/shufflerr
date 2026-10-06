import type { ExternalLink } from '@server/models/music';

/** Product names for external links. Names only — no third-party logos. */
export const LINK_NAMES: Partial<Record<ExternalLink['type'], string>> = {
  musicbrainz: 'MusicBrainz',
  plex: 'Plex',
  jellyfin: 'Jellyfin',
  navidrome: 'Navidrome',
  lastfm: 'Last.fm',
  discogs: 'Discogs',
  spotify: 'Spotify',
  bandcamp: 'Bandcamp',
  apple: 'Apple Music',
};

/** Links that open the item in one of the owner's own servers. */
export const SERVER_LINKS: ExternalLink['type'][] = [
  'plex',
  'jellyfin',
  'navidrome',
];

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** Text for a link chip; `openIn` formats "Open in Plex". */
export const linkLabel = (
  link: ExternalLink,
  openIn: (name: string) => string
): string => {
  if (link.label) {
    return link.label;
  }
  const name = LINK_NAMES[link.type];
  if (!name) {
    return hostOf(link.url);
  }
  return SERVER_LINKS.includes(link.type) ? openIn(name) : name;
};
