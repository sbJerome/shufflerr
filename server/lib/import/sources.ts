import DeezerAPI, { DeezerApiError } from '@server/api/deezer';
import ItunesAPI, { itunesArtworkToProxy } from '@server/api/itunes';
import type { SpotifyAlbum } from '@server/api/spotify';
import SpotifyAPI, {
  getPublicSpotify,
  refreshAccessToken,
} from '@server/api/spotify';
import type { ImportSourceKey } from '@server/interfaces/api/importInterfaces';
import type { AlbumCandidate } from '@server/lib/import/match';
import type { ParsedImportUrl } from '@server/lib/import/parse';
import { ImportLinkError, parseImportUrl } from '@server/lib/import/parse';
import { getLinked, saveLinkedSecret } from '@server/lib/scrobble/linked';
import { getSettings } from '@server/lib/settings';
import axios from 'axios';

/** Hard cap on albums taken from one link (MusicBrainz allows one lookup a second). */
export const MAX_ALBUMS_PER_IMPORT = 200;

export interface SourceAlbumList {
  source: ImportSourceKey;
  title?: string;
  albums: AlbumCandidate[];
  /** Albums beyond MAX_ALBUMS_PER_IMPORT that were left out. */
  truncated: number;
}

/** CDN URL → same-origin image-proxy path (null for hosts the proxy does not serve). */
export const toProxyUrl = (url?: string | null): string | null => {
  if (!url) {
    return null;
  }
  const match = url.match(/^https?:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    return null;
  }
  const [, host, path] = match;
  if (host === 'i.scdn.co') {
    return `/imageproxy/spotify/${path}`;
  }
  if (/(^|\.)dzcdn\.net$/.test(host)) {
    return `/imageproxy/deezer/${path}`;
  }
  if (/^is\d-ssl\.mzstatic\.com$/.test(host)) {
    return itunesArtworkToProxy(url);
  }
  if (host === 's1.ticketm.net') {
    return `/imageproxy/ticketmaster/${path}`;
  }
  if (host === 'd1plawd8huk6hh.cloudfront.net') {
    return `/imageproxy/skiddle/${path}`;
  }
  if (host === 'i.ytimg.com') {
    return `/imageproxy/youtube/${path}`;
  }
  return null;
};

const sourceOff = (name: string): ImportLinkError =>
  new ImportLinkError(
    `${name} import is switched off. An admin can turn it on in Settings → ${name}.`
  );

const cap = (
  source: ImportSourceKey,
  title: string | undefined,
  albums: AlbumCandidate[]
): SourceAlbumList => ({
  source,
  title,
  albums: albums.slice(0, MAX_ALBUMS_PER_IMPORT),
  truncated: Math.max(0, albums.length - MAX_ALBUMS_PER_IMPORT),
});

// ---- Spotify ----------------------------------------------------------------

export const spotifyAlbumToCandidate = (
  album: SpotifyAlbum,
  isrcs: string[] = []
): AlbumCandidate => ({
  key: `spotify:${album.id}`,
  sourceId: album.id,
  title: album.name,
  artist: (album.artists ?? []).map((a) => a.name).join(', '),
  upc: album.external_ids?.upc ?? null,
  isrcs: [
    ...isrcs,
    ...(album.tracks?.items ?? [])
      .map((t) => t.external_ids?.isrc)
      .filter((i): i is string => !!i),
  ],
  trackCount: album.total_tracks ?? null,
  coverUrl: toProxyUrl(album.images?.[0]?.url),
});

const userTokens = new Map<number, { token: string; expiresAt: number }>();

/** Spotify client acting as a user who linked their account, or null when not linked. */
export const getSpotifyForUser = async (
  userId: number
): Promise<{ api: SpotifyAPI; linkedAs: string; linkedAt: Date } | null> => {
  const linked = await getLinked(userId, 'spotify');
  if (!linked) {
    return null;
  }
  const cached = userTokens.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      api: new SpotifyAPI(cached.token),
      linkedAs: linked.externalUsername,
      linkedAt: linked.createdAt,
    };
  }
  const tokens = await refreshAccessToken(linked.secret);
  userTokens.set(userId, {
    token: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in - 60) * 1000,
  });
  if (tokens.refresh_token && tokens.refresh_token !== linked.secret) {
    await saveLinkedSecret(linked.id, tokens.refresh_token);
  }
  return {
    api: new SpotifyAPI(tokens.access_token),
    linkedAs: linked.externalUsername,
    linkedAt: linked.createdAt,
  };
};

const resolveSpotifyShortLink = async (url: string): Promise<string> => {
  const response = await axios.get(url, {
    timeout: getSettings().network.apiRequestTimeout,
    maxRedirects: 5,
    responseType: 'text',
    validateStatus: (status) => status < 500,
  });
  const finalUrl: string | undefined = response.request?.res?.responseUrl;
  if (finalUrl && /open\.spotify\.com\//.test(finalUrl)) {
    return finalUrl;
  }
  const inPage = (typeof response.data === 'string' ? response.data : '').match(
    /https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:album|playlist|track)\/[A-Za-z0-9]+/
  );
  if (inPage) {
    return inPage[0];
  }
  throw new ImportLinkError(
    "That Spotify link didn't lead to an album or playlist. Open it in Spotify and copy the link from the Share menu."
  );
};

const fromSpotify = async (
  parsed: ParsedImportUrl,
  userId: number
): Promise<SourceAlbumList> => {
  const settings = getSettings().discover.spotify;
  if (!settings.enabled) {
    throw sourceOff('Spotify');
  }
  if (!settings.clientId || !settings.clientSecret) {
    throw new ImportLinkError(
      'Spotify import needs a client ID and client secret. An admin can add them in Settings → Spotify.'
    );
  }
  if (parsed.shortLink) {
    parsed = parseImportUrl(await resolveSpotifyShortLink(parsed.id));
  }

  // The user's own token can read their private playlists; the app token cannot.
  const asUser =
    parsed.kind === 'playlist' ? await getSpotifyForUser(userId) : null;
  const api = asUser?.api ?? (await getPublicSpotify());

  try {
    if (parsed.kind === 'album') {
      const album = await api.getAlbum(parsed.id);
      return cap('spotify', album.name, [spotifyAlbumToCandidate(album)]);
    }
    if (parsed.kind === 'track') {
      const track = await api.getTrack(parsed.id);
      if (!track.album?.id) {
        throw new ImportLinkError("That Spotify track isn't on an album.");
      }
      const album = await api.getAlbum(track.album.id);
      return cap('spotify', album.name, [
        spotifyAlbumToCandidate(
          album,
          track.external_ids?.isrc ? [track.external_ids.isrc] : []
        ),
      ]);
    }

    const playlist = await api.getPlaylist(parsed.id);
    const tracks = await api.getPlaylistTracks(parsed.id);
    // unique albums in playlist order, remembering one ISRC per album
    const order: string[] = [];
    const isrcByAlbum = new Map<string, string[]>();
    for (const track of tracks) {
      const albumId = track.album?.id;
      if (!albumId) {
        continue;
      }
      if (!isrcByAlbum.has(albumId)) {
        isrcByAlbum.set(albumId, []);
        order.push(albumId);
      }
      if (track.external_ids?.isrc) {
        isrcByAlbum.get(albumId)?.push(track.external_ids.isrc);
      }
    }
    const wanted = order.slice(0, MAX_ALBUMS_PER_IMPORT);
    // the playlist only carries simplified albums; the full ones have the UPC
    const full = await api.getAlbums(wanted);
    const fullById = new Map(full.map((a) => [a.id, a]));
    const albums = wanted
      .map((id) => fullById.get(id))
      .filter((a): a is SpotifyAlbum => !!a)
      .map((a) => spotifyAlbumToCandidate(a, isrcByAlbum.get(a.id) ?? []));
    return {
      source: 'spotify',
      title: playlist.name,
      albums,
      truncated: Math.max(0, order.length - MAX_ALBUMS_PER_IMPORT),
    };
  } catch (e) {
    if (e instanceof ImportLinkError) {
      throw e;
    }
    const status = e.response?.status;
    if (status === 404) {
      throw new ImportLinkError(
        parsed.kind === 'playlist'
          ? "Spotify couldn't find that playlist. If it's private, link your Spotify account in your profile settings first. Playlists made by Spotify itself can't be read by other apps."
          : "Spotify couldn't find that album. Check the link and try again."
      );
    }
    if (status === 401 || status === 403 || status === 400) {
      throw new ImportLinkError(
        "Spotify didn't accept Shufflerr's credentials. An admin should check the client ID and client secret in Settings → Spotify."
      );
    }
    throw e;
  }
};

// ---- Deezer -----------------------------------------------------------------

const fromDeezer = async (
  parsed: ParsedImportUrl
): Promise<SourceAlbumList> => {
  if (!getSettings().discover.deezer.enabled) {
    throw sourceOff('Deezer');
  }
  const api = new DeezerAPI();
  try {
    if (parsed.shortLink) {
      parsed = parseImportUrl(await api.resolveShortLink(parsed.id));
    }

    const albumCandidate = async (
      albumId: number | string,
      isrcs: string[] = []
    ): Promise<AlbumCandidate> => {
      const album = await api.getAlbum(albumId);
      return {
        key: `deezer:${album.id}`,
        sourceId: String(album.id),
        title: album.title,
        artist: album.artist?.name ?? '',
        upc: album.upc ?? null,
        isrcs,
        trackCount: album.nb_tracks ?? null,
        coverUrl: toProxyUrl(album.cover_big ?? album.cover_medium),
      };
    };

    if (parsed.kind === 'album') {
      const candidate = await albumCandidate(parsed.id);
      // Album tracklists carry no ISRC; one track lookup gives the matcher a fallback.
      const firstTrack = (await api.getAlbum(parsed.id)).tracks?.data?.[0];
      if (firstTrack) {
        try {
          const isrc = (await api.getTrack(firstTrack.id)).isrc;
          candidate.isrcs = isrc ? [isrc] : [];
        } catch {
          // the barcode and the names are still there to match on
        }
      }
      return cap('deezer', candidate.title, [candidate]);
    }
    if (parsed.kind === 'track') {
      const track = await api.getTrack(parsed.id);
      if (!track.album?.id) {
        throw new ImportLinkError("That Deezer track isn't on an album.");
      }
      const candidate = await albumCandidate(
        track.album.id,
        track.isrc ? [track.isrc] : []
      );
      return cap('deezer', candidate.title, [candidate]);
    }

    const playlist = await api.getPlaylist(parsed.id);
    const tracks = await api.getPlaylistTracks(parsed.id);
    const order: number[] = [];
    const isrcByAlbum = new Map<number, string[]>();
    for (const track of tracks) {
      const albumId = track.album?.id;
      if (!albumId) {
        continue;
      }
      if (!isrcByAlbum.has(albumId)) {
        isrcByAlbum.set(albumId, []);
        order.push(albumId);
      }
      if (track.isrc) {
        isrcByAlbum.get(albumId)?.push(track.isrc);
      }
    }
    const albums: AlbumCandidate[] = [];
    for (const albumId of order.slice(0, MAX_ALBUMS_PER_IMPORT)) {
      try {
        albums.push(
          await albumCandidate(albumId, isrcByAlbum.get(albumId) ?? [])
        );
      } catch {
        // an album Deezer no longer serves: leave it out
      }
    }
    return {
      source: 'deezer',
      title: playlist.title,
      albums,
      truncated: Math.max(0, order.length - MAX_ALBUMS_PER_IMPORT),
    };
  } catch (e) {
    if (e instanceof ImportLinkError) {
      throw e;
    }
    if (e instanceof DeezerApiError) {
      throw new ImportLinkError(
        e.code === 800
          ? "Deezer couldn't find that album or playlist. Check the link, and make sure a playlist is public."
          : e.message
      );
    }
    throw e;
  }
};

// ---- Apple Music / iTunes -----------------------------------------------------

const fromItunes = async (
  parsed: ParsedImportUrl
): Promise<SourceAlbumList> => {
  if (!getSettings().discover.itunes.enabled) {
    throw sourceOff('iTunes');
  }
  const result = await new ItunesAPI().lookupAlbum(parsed.id, parsed.country);
  if (!result) {
    throw new ImportLinkError(
      "Apple Music couldn't find that album. Check the link, including the country in it."
    );
  }
  const { album } = result;
  return cap('itunes', album.collectionName, [
    {
      key: `itunes:${album.collectionId}`,
      sourceId: String(album.collectionId),
      title: album.collectionName,
      artist: album.artistName,
      trackCount: album.trackCount ?? null,
      coverUrl: itunesArtworkToProxy(album.artworkUrl100),
    },
  ]);
};

/** Link → the albums behind it, as the source describes them. */
export const fetchSourceAlbums = async (
  parsed: ParsedImportUrl,
  userId: number
): Promise<SourceAlbumList> => {
  switch (parsed.source) {
    case 'spotify':
      return fromSpotify(parsed, userId);
    case 'deezer':
      return fromDeezer(parsed);
    case 'itunes':
      return fromItunes(parsed);
  }
};
