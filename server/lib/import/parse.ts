import type { ImportSourceKey } from '@server/interfaces/api/importInterfaces';

/** A link the Import page understands, broken into its parts. */
export interface ParsedImportUrl {
  source: ImportSourceKey;
  kind: 'album' | 'playlist' | 'track';
  id: string;
  /** Store country from the link (Apple Music). */
  country?: string;
  /** Share link that has to be followed to find the real URL first. */
  shortLink?: boolean;
}

/** A problem with the link the user pasted; the message is shown as is. */
export class ImportLinkError extends Error {}

const SPOTIFY_ID = /^[A-Za-z0-9]{16,32}$/;

const tryUrl = (input: string): URL | null => {
  try {
    return new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`
    );
  } catch {
    return null;
  }
};

/**
 * Recognise Spotify, Deezer and Apple Music / iTunes links.
 * Throws ImportLinkError with fix-it copy for anything else.
 */
export const parseImportUrl = (raw: string): ParsedImportUrl => {
  const input = (raw ?? '').trim();
  if (!input) {
    throw new ImportLinkError(
      'Paste a link to an album or playlist from Spotify, Deezer or Apple Music.'
    );
  }

  // spotify:album:<id> / spotify:playlist:<id> / spotify:track:<id>
  const uri = input.match(/^spotify:(album|playlist|track):([A-Za-z0-9]+)$/i);
  if (uri) {
    return {
      source: 'spotify',
      kind: uri[1].toLowerCase() as ParsedImportUrl['kind'],
      id: uri[2],
    };
  }

  const url = tryUrl(input);
  if (!url) {
    throw new ImportLinkError(
      "That doesn't look like a link. Paste the address of an album or playlist from Spotify, Deezer or Apple Music."
    );
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);

  // ---- Spotify ------------------------------------------------------------
  if (host === 'open.spotify.com' || host === 'play.spotify.com') {
    // optional locale prefix: /intl-de/album/<id>; embeds: /embed/album/<id>
    const rest = parts.filter(
      (p) => !/^intl-[a-z-]+$/i.test(p) && p !== 'embed'
    );
    // old user playlist form: /user/<name>/playlist/<id>
    if (rest[0] === 'user' && rest[2] === 'playlist' && rest[3]) {
      return { source: 'spotify', kind: 'playlist', id: rest[3] };
    }
    const [kind, id] = rest;
    if ((kind === 'album' || kind === 'playlist' || kind === 'track') && id) {
      if (!SPOTIFY_ID.test(id)) {
        throw new ImportLinkError(
          "That Spotify link is incomplete. Copy it again from Spotify's Share menu."
        );
      }
      return { source: 'spotify', kind, id };
    }
    if (kind === 'artist') {
      throw new ImportLinkError(
        'That link is a Spotify artist. Paste an album or playlist link, or search for the artist here to request a discography.'
      );
    }
    throw new ImportLinkError(
      "That Spotify link isn't an album or playlist. Paste an album or playlist link."
    );
  }
  if (host === 'spotify.link' || host === 'spotify.app.link') {
    return { source: 'spotify', kind: 'album', id: input, shortLink: true };
  }

  // ---- Deezer -------------------------------------------------------------
  if (
    host === 'deezer.com' ||
    (host.endsWith('.deezer.com') && host !== 'link.deezer.com')
  ) {
    // optional locale prefix: /en/album/<id>
    const rest = parts.filter((p) => !/^[a-z]{2}(-[a-z]{2})?$/i.test(p));
    const [kind, id] = rest;
    if (
      (kind === 'album' || kind === 'playlist' || kind === 'track') &&
      /^\d+$/.test(id ?? '')
    ) {
      return { source: 'deezer', kind, id };
    }
    if (kind === 'artist') {
      throw new ImportLinkError(
        'That link is a Deezer artist. Paste an album or playlist link, or search for the artist here to request a discography.'
      );
    }
    throw new ImportLinkError(
      "That Deezer link isn't an album or playlist. Paste an album or playlist link."
    );
  }
  if (
    host === 'deezer.page.link' ||
    host === 'dzr.page.link' ||
    host === 'link.deezer.com'
  ) {
    return { source: 'deezer', kind: 'album', id: input, shortLink: true };
  }

  // ---- Apple Music / iTunes -------------------------------------------------
  if (
    host === 'music.apple.com' ||
    host === 'itunes.apple.com' ||
    host === 'geo.music.apple.com'
  ) {
    const country = /^[a-z]{2}$/i.test(parts[0] ?? '')
      ? parts[0].toLowerCase()
      : undefined;
    const rest = country ? parts.slice(1) : parts;
    const kind = rest[0];
    if (kind === 'playlist') {
      throw new ImportLinkError(
        "Apple Music playlists can't be imported, because Apple only shares them with paid developer accounts. Paste the link of each album instead."
      );
    }
    if (kind === 'album') {
      // /album/<slug>/<id> or /album/<id> (older links carry "id" in front)
      const last = (rest[rest.length - 1] ?? '').replace(/^id/, '');
      if (/^\d+$/.test(last)) {
        return { source: 'itunes', kind: 'album', id: last, country };
      }
    }
    throw new ImportLinkError(
      "That Apple Music link isn't an album. Paste an album link, for example music.apple.com/us/album/…"
    );
  }

  if (
    host === 'youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtu.be'
  ) {
    throw new ImportLinkError(
      "YouTube links can't be imported. Paste an album or playlist link from Spotify, Deezer or Apple Music."
    );
  }

  throw new ImportLinkError(
    "Shufflerr can't read links from that site. Paste an album or playlist link from Spotify, Deezer or Apple Music."
  );
};
