import type { ClientIdentity } from '@server/clientapi/common/credentials';
import { usernameOf } from '@server/clientapi/common/credentials';
import type {
  LibAlbum,
  LibArtist,
  LibTrack,
  LibraryIndex,
} from '@server/clientapi/common/library';
import {
  IGNORED_ARTICLES,
  artistTracks,
  getLibrary,
  searchLibrary,
  shuffled,
} from '@server/clientapi/common/library';
import {
  getAlbumCover,
  sendCover,
  sendTrack,
  streamOptionsFrom,
} from '@server/clientapi/common/media';
import type { PlayStats, UserStars } from '@server/clientapi/common/userData';
import {
  appendPlaylistTracks,
  createPlaylist,
  deletePlaylist,
  getNowPlayingEntries,
  getPlayStats,
  getPlaylist,
  getStars,
  listPlaylists,
  removePlaylistIndexes,
  replacePlaylistTracks,
  reportNowPlaying,
  reportPlayed,
  setStar,
  updatePlaylistMeta,
} from '@server/clientapi/common/userData';
import type Playlist from '@server/entity/Playlist';
import type { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import type { Request, Response } from 'express';
import type { Params } from './params';
import { albumId, artistId, parseId, playlistId, trackId } from './params';
import type { Payload } from './response';
import { SubsonicError, SubsonicErrorCode } from './response';

export interface Context {
  req: Request;
  res: Response;
  params: Params;
  user: User;
  identity: ClientIdentity;
  client: string;
}

/** Return a payload for the envelope, or `null` when the handler already answered (binary). */
export type Handler = (ctx: Context) => Promise<Payload | null | void>;

interface UserView {
  stars: UserStars;
  plays: Map<number, PlayStats>;
}

const loadView = async (user: User): Promise<UserView> => {
  const [stars, plays] = await Promise.all([
    getStars(user.id),
    getPlayStats(user.id),
  ]);
  return { stars, plays };
};

const iso = (date: Date): string => new Date(date).toISOString();
const seconds = (ms: number): number => Math.round(ms / 1000);

const notFound = (what: string): SubsonicError =>
  new SubsonicError(SubsonicErrorCode.NOT_FOUND, `${what} not found.`);

/* ------------------------------------------------------------------ mappers */

const songOf = (track: LibTrack, view: UserView): Payload => {
  const starred = view.stars.tracks.get(track.id);
  const plays = view.plays.get(track.id);
  const album = track.album;
  return {
    id: trackId(track.id),
    parent: albumId(album.mediaId),
    isDir: false,
    title: track.title,
    album: album.name,
    artist: track.artist,
    track: track.trackNumber || undefined,
    discNumber: track.discNumber,
    year: album.year,
    coverArt: albumId(album.mediaId),
    contentType: track.contentType,
    suffix: track.suffix || undefined,
    duration: seconds(track.durationMs),
    bitRate: track.bitRate,
    bitDepth: track.bitDepth,
    samplingRate: track.sampleRate,
    path: track.path,
    isVideo: false,
    type: 'music',
    mediaType: 'song',
    albumId: albumId(album.mediaId),
    artistId: artistId(album.artist.key),
    created: iso(track.created),
    starred: starred ? iso(starred) : undefined,
    playCount: plays?.count,
    played: plays ? iso(plays.lastPlayed) : undefined,
    musicBrainzId: track.recordingMbid,
    sortName: track.sortName,
    displayArtist: track.artist,
    displayAlbumArtist: album.artist.name,
    albumArtists: [{ id: artistId(album.artist.key), name: album.artist.name }],
  };
};

const albumPlays = (
  album: LibAlbum,
  view: UserView
): { count: number; last?: Date } => {
  let count = 0;
  let last: Date | undefined;
  for (const track of album.tracks) {
    const stats = view.plays.get(track.id);
    if (stats) {
      count += stats.count;
      if (!last || stats.lastPlayed > last) {
        last = stats.lastPlayed;
      }
    }
  }
  return { count, last };
};

const albumOf = (album: LibAlbum, view: UserView): Payload => {
  const starred = view.stars.media.get(album.mediaId);
  const plays = albumPlays(album, view);
  return {
    id: albumId(album.mediaId),
    // `name` is the ID3 field, `title`/`album`/`parent`/`isDir` serve folder-based clients.
    name: album.name,
    title: album.name,
    album: album.name,
    parent: artistId(album.artist.key),
    isDir: true,
    artist: album.artist.name,
    artistId: artistId(album.artist.key),
    coverArt: albumId(album.mediaId),
    songCount: album.tracks.length,
    duration: seconds(album.durationMs),
    created: iso(album.created),
    year: album.year,
    starred: starred ? iso(starred) : undefined,
    playCount: plays.count || undefined,
    played: plays.last ? iso(plays.last) : undefined,
    musicBrainzId: album.mbid,
    sortName: album.sortName,
    displayArtist: album.artist.name,
    isCompilation: album.isCompilation,
    releaseTypes: [album.primaryType, ...album.secondaryTypes].filter(Boolean),
    artists: [{ id: artistId(album.artist.key), name: album.artist.name }],
  };
};

const artistOf = (artist: LibArtist, view: UserView): Payload => {
  const starred = artist.mediaId
    ? view.stars.media.get(artist.mediaId)
    : undefined;
  return {
    id: artistId(artist.key),
    name: artist.name,
    albumCount: artist.albums.length,
    starred: starred ? iso(starred) : undefined,
    musicBrainzId: artist.mbid,
    sortName: artist.sortName,
  };
};

const playlistTracks = (playlist: Playlist, index: LibraryIndex): LibTrack[] =>
  playlist.items
    .map((item) =>
      item.track ? index.trackById.get(item.track.id) : undefined
    )
    .filter((t): t is LibTrack => !!t);

const playlistOf = (
  playlist: Playlist,
  index: LibraryIndex,
  view?: UserView
): Payload => {
  const tracks = playlistTracks(playlist, index);
  return {
    id: playlistId(playlist.id),
    name: playlist.name,
    comment: playlist.comment ?? undefined,
    owner: playlist.user ? usernameOf(playlist.user) : undefined,
    public: playlist.isPublic,
    songCount: tracks.length,
    duration: seconds(tracks.reduce((sum, t) => sum + t.durationMs, 0)),
    created: iso(playlist.createdAt),
    changed: iso(playlist.updatedAt ?? playlist.createdAt),
    coverArt: tracks.length ? playlistId(playlist.id) : undefined,
    entry: view ? tracks.map((t) => songOf(t, view)) : undefined,
  };
};

const indexLetter = (sortName: string): string => {
  const first = sortName.charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
};

const groupArtists = (
  artists: LibArtist[],
  view: UserView
): { name: string; artist: Payload[] }[] => {
  const groups = new Map<string, Payload[]>();
  for (const artist of artists) {
    const letter = indexLetter(artist.sortName);
    groups.set(letter, [...(groups.get(letter) ?? []), artistOf(artist, view)]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))
    .map(([name, artist]) => ({ name, artist }));
};

/* ------------------------------------------------------------------ lookups */

const findArtist = (
  index: LibraryIndex,
  raw: string | undefined
): LibArtist => {
  const id = parseId(raw);
  const artist =
    id?.kind === 'artist' ? index.artistByKey.get(id.key) : undefined;
  if (!artist) {
    throw notFound('Artist');
  }
  return artist;
};

const findAlbum = (index: LibraryIndex, raw: string | undefined): LibAlbum => {
  const id = parseId(raw);
  const album = id?.kind === 'album' ? index.albumById.get(id.id) : undefined;
  if (!album) {
    throw notFound('Album');
  }
  return album;
};

const findTrack = (index: LibraryIndex, raw: string | undefined): LibTrack => {
  const id = parseId(raw);
  const track = id?.kind === 'track' ? index.trackById.get(id.id) : undefined;
  if (!track) {
    throw notFound('Song');
  }
  return track;
};

const ownPlaylist = async (user: User, raw: string): Promise<Playlist> => {
  const id = parseId(raw);
  const playlist =
    id?.kind === 'playlist' ? await getPlaylist(user.id, id.id) : null;
  if (!playlist) {
    throw notFound('Playlist');
  }
  if (playlist.user?.id !== user.id && !user.hasPermission(Permission.ADMIN)) {
    throw new SubsonicError(
      SubsonicErrorCode.NOT_AUTHORIZED,
      'Only the owner can change this playlist.'
    );
  }
  return playlist;
};

const trackIdsFrom = (index: LibraryIndex, raws: string[]): number[] =>
  raws
    .map((raw) => parseId(raw))
    .filter(
      (id): id is { kind: 'track'; id: number } =>
        id?.kind === 'track' && index.trackById.has(id.id)
    )
    .map((id) => id.id);

const page = <T>(items: T[], offset: number, size: number): T[] =>
  items.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(0, size));

/* ----------------------------------------------------------------- handlers */

const albumList = async (ctx: Context): Promise<Payload[]> => {
  const { params } = ctx;
  const type = params.required('type');
  const size = Math.min(params.int('size', 10), 500);
  const offset = params.int('offset', 0);
  const index = await getLibrary();
  const view = await loadView(ctx.user);
  let albums: LibAlbum[];

  switch (type) {
    case 'random':
      albums = shuffled(index.albums);
      break;
    case 'newest':
      albums = [...index.albums].sort(
        (a, b) => b.created.getTime() - a.created.getTime()
      );
      break;
    case 'recent':
      albums = index.albums
        .map((album) => ({ album, last: albumPlays(album, view).last }))
        .filter((x): x is { album: LibAlbum; last: Date } => !!x.last)
        .sort((a, b) => b.last.getTime() - a.last.getTime())
        .map((x) => x.album);
      break;
    case 'frequent':
      albums = index.albums
        .map((album) => ({ album, count: albumPlays(album, view).count }))
        .filter((x) => x.count > 0)
        .sort((a, b) => b.count - a.count)
        .map((x) => x.album);
      break;
    case 'alphabeticalByName':
      albums = index.albums;
      break;
    case 'alphabeticalByArtist':
      albums = [...index.albums].sort(
        (a, b) =>
          a.artist.sortName.localeCompare(b.artist.sortName) ||
          a.sortName.localeCompare(b.sortName)
      );
      break;
    case 'starred':
      albums = index.albums
        .filter((a) => view.stars.media.has(a.mediaId))
        .sort(
          (a, b) =>
            (view.stars.media.get(b.mediaId)?.getTime() ?? 0) -
            (view.stars.media.get(a.mediaId)?.getTime() ?? 0)
        );
      break;
    case 'byYear': {
      const from = Number(params.required('fromYear'));
      const to = Number(params.required('toYear'));
      const [low, high] = from <= to ? [from, to] : [to, from];
      albums = index.albums
        .filter((a) => a.year !== undefined && a.year >= low && a.year <= high)
        .sort((a, b) =>
          from <= to
            ? (a.year ?? 0) - (b.year ?? 0)
            : (b.year ?? 0) - (a.year ?? 0)
        );
      break;
    }
    case 'byGenre':
      params.required('genre');
      // Shufflerr does not index genres yet, so no album matches a genre.
      albums = [];
      break;
    case 'highest':
      // No ratings are stored.
      albums = [];
      break;
    default:
      throw new SubsonicError(
        SubsonicErrorCode.GENERIC,
        `Unknown album list type: ${type}`
      );
  }

  return page(albums, offset, size).map((a) => albumOf(a, view));
};

const search = async (
  ctx: Context
): Promise<{ artist: Payload[]; album: Payload[]; song: Payload[] }> => {
  const { params } = ctx;
  const index = await getLibrary();
  const view = await loadView(ctx.user);
  const found = searchLibrary(index, params.str('query') ?? '');
  return {
    artist: page(
      found.artists,
      params.int('artistOffset', 0),
      params.int('artistCount', 20)
    ).map((a) => artistOf(a, view)),
    album: page(
      found.albums,
      params.int('albumOffset', 0),
      params.int('albumCount', 20)
    ).map((a) => albumOf(a, view)),
    song: page(
      found.tracks,
      params.int('songOffset', 0),
      params.int('songCount', 20)
    ).map((t) => songOf(t, view)),
  };
};

const starred = async (
  ctx: Context
): Promise<{ artist: Payload[]; album: Payload[]; song: Payload[] }> => {
  const index = await getLibrary();
  const view = await loadView(ctx.user);
  return {
    artist: index.artists
      .filter((a) => a.mediaId && view.stars.media.has(a.mediaId))
      .map((a) => artistOf(a, view)),
    album: index.albums
      .filter((a) => view.stars.media.has(a.mediaId))
      .map((a) => albumOf(a, view)),
    song: index.tracks
      .filter((t) => view.stars.tracks.has(t.id))
      .map((t) => songOf(t, view)),
  };
};

const changeStars = async (ctx: Context, value: boolean): Promise<Payload> => {
  const { params, user } = ctx;
  const index = await getLibrary();
  const raws = [
    ...params.list('id'),
    ...params.list('albumId'),
    ...params.list('artistId'),
  ];
  if (!raws.length) {
    throw new SubsonicError(
      SubsonicErrorCode.MISSING_PARAMETER,
      'Required parameter is missing: id'
    );
  }

  for (const raw of raws) {
    const id = parseId(raw);
    if (id?.kind === 'track' && index.trackById.has(id.id)) {
      await setStar(user, { trackId: id.id }, value);
    } else if (id?.kind === 'album' && index.albumById.has(id.id)) {
      await setStar(user, { mediaId: id.id }, value);
    } else if (id?.kind === 'artist') {
      const artist = index.artistByKey.get(id.key);
      if (artist?.mediaId) {
        await setStar(user, { mediaId: artist.mediaId }, value);
      }
    } else {
      throw notFound('Item');
    }
  }
  return {};
};

const userOf = (user: User): Payload => {
  const settings = getSettings();
  return {
    username: usernameOf(user),
    email: user.email,
    scrobblingEnabled: true,
    adminRole: user.hasPermission(Permission.ADMIN),
    settingsRole: false,
    downloadRole: settings.clients.allowDownloads,
    uploadRole: false,
    playlistRole: true,
    coverArtRole: false,
    commentRole: false,
    podcastRole: false,
    streamRole: true,
    jukeboxRole: false,
    shareRole: false,
    videoConversionRole: false,
    folder: [1],
  };
};

const coverAlbumFor = async (
  ctx: Context,
  index: LibraryIndex,
  raw: string
): Promise<LibAlbum | undefined> => {
  const id = parseId(raw);
  if (id?.kind === 'album') {
    return index.albumById.get(id.id);
  }
  if (id?.kind === 'track') {
    return index.trackById.get(id.id)?.album;
  }
  if (id?.kind === 'playlist') {
    const playlist = await getPlaylist(ctx.user.id, id.id);
    return playlist ? playlistTracks(playlist, index)[0]?.album : undefined;
  }
  return undefined;
};

export const handlers: Record<string, Handler> = {
  ping: async () => ({}),

  getLicense: async () => ({ license: { valid: true } }),

  getOpenSubsonicExtensions: async () => ({
    openSubsonicExtensions: [
      { name: 'formPost', versions: [1] },
      { name: 'apiKeyAuthentication', versions: [1] },
      { name: 'songLyrics', versions: [1] },
    ],
  }),

  tokenInfo: async ({ user }) => ({
    tokenInfo: { username: usernameOf(user) },
  }),

  getMusicFolders: async () => ({
    musicFolders: { musicFolder: [{ id: 1, name: 'Music' }] },
  }),

  getIndexes: async (ctx) => {
    const index = await getLibrary();
    const view = await loadView(ctx.user);
    return {
      indexes: {
        lastModified: index.builtAt,
        ignoredArticles: IGNORED_ARTICLES,
        index: groupArtists(index.artists, view),
      },
    };
  },

  getArtists: async (ctx) => {
    const index = await getLibrary();
    const view = await loadView(ctx.user);
    return {
      artists: {
        ignoredArticles: IGNORED_ARTICLES,
        index: groupArtists(index.artists, view),
      },
    };
  },

  getMusicDirectory: async (ctx) => {
    const raw = ctx.params.required('id');
    const index = await getLibrary();
    const view = await loadView(ctx.user);
    const id = parseId(raw);

    if (id?.kind === 'artist') {
      const artist = findArtist(index, raw);
      return {
        directory: {
          id: artistId(artist.key),
          name: artist.name,
          child: artist.albums.map((a) => albumOf(a, view)),
        },
      };
    }
    const album = findAlbum(index, raw);
    return {
      directory: {
        id: albumId(album.mediaId),
        parent: artistId(album.artist.key),
        name: album.name,
        child: album.tracks.map((t) => songOf(t, view)),
      },
    };
  },

  getArtist: async (ctx) => {
    const index = await getLibrary();
    const view = await loadView(ctx.user);
    const artist = findArtist(index, ctx.params.required('id'));
    return {
      artist: {
        ...artistOf(artist, view),
        album: artist.albums.map((a) => albumOf(a, view)),
      },
    };
  },

  getAlbum: async (ctx) => {
    const index = await getLibrary();
    const view = await loadView(ctx.user);
    const album = findAlbum(index, ctx.params.required('id'));
    return {
      album: {
        ...albumOf(album, view),
        song: album.tracks.map((t) => songOf(t, view)),
      },
    };
  },

  getSong: async (ctx) => {
    const index = await getLibrary();
    const view = await loadView(ctx.user);
    return { song: songOf(findTrack(index, ctx.params.required('id')), view) };
  },

  getAlbumList: async (ctx) => ({ albumList: { album: await albumList(ctx) } }),
  getAlbumList2: async (ctx) => ({
    albumList2: { album: await albumList(ctx) },
  }),

  getRandomSongs: async (ctx) => {
    const { params } = ctx;
    const index = await getLibrary();
    const view = await loadView(ctx.user);
    const from = params.int('fromYear');
    const to = params.int('toYear');
    // No genre index: a genre filter matches nothing rather than everything.
    const pool = params.str('genre')
      ? []
      : index.tracks.filter(
          (t) =>
            (from === undefined ||
              (t.album.year !== undefined && t.album.year >= from)) &&
            (to === undefined ||
              (t.album.year !== undefined && t.album.year <= to))
        );
    return {
      randomSongs: {
        song: shuffled(pool)
          .slice(0, Math.min(params.int('size', 10), 500))
          .map((t) => songOf(t, view)),
      },
    };
  },

  getSongsByGenre: async (ctx) => {
    ctx.params.required('genre');
    return { songsByGenre: { song: [] } };
  },

  getGenres: async () => ({ genres: { genre: [] } }),

  search2: async (ctx) => ({ searchResult2: await search(ctx) }),
  search3: async (ctx) => ({ searchResult3: await search(ctx) }),

  getStarred: async (ctx) => ({ starred: await starred(ctx) }),
  getStarred2: async (ctx) => ({ starred2: await starred(ctx) }),
  star: (ctx) => changeStars(ctx, true),
  unstar: (ctx) => changeStars(ctx, false),

  getPlaylists: async (ctx) => {
    const index = await getLibrary();
    const playlists = await listPlaylists(ctx.user.id);
    return {
      playlists: { playlist: playlists.map((p) => playlistOf(p, index)) },
    };
  },

  getPlaylist: async (ctx) => {
    const id = parseId(ctx.params.required('id'));
    const playlist =
      id?.kind === 'playlist' ? await getPlaylist(ctx.user.id, id.id) : null;
    if (!playlist) {
      throw notFound('Playlist');
    }
    const index = await getLibrary();
    return { playlist: playlistOf(playlist, index, await loadView(ctx.user)) };
  },

  createPlaylist: async (ctx) => {
    const { params, user } = ctx;
    const index = await getLibrary();
    const trackIds = trackIdsFrom(index, params.list('songId'));
    let playlist: Playlist | null;

    if (params.has('playlistId')) {
      const existing = await ownPlaylist(user, params.required('playlistId'));
      if (params.str('name')) {
        await updatePlaylistMeta(existing.id, { name: params.str('name') });
      }
      await replacePlaylistTracks(existing.id, trackIds);
      playlist = await getPlaylist(user.id, existing.id);
    } else {
      playlist = await createPlaylist(user, params.required('name'), trackIds);
    }

    if (!playlist) {
      throw notFound('Playlist');
    }
    return { playlist: playlistOf(playlist, index, await loadView(user)) };
  },

  updatePlaylist: async (ctx) => {
    const { params, user } = ctx;
    const index = await getLibrary();
    const playlist = await ownPlaylist(user, params.required('playlistId'));

    await updatePlaylistMeta(playlist.id, {
      name: params.str('name'),
      comment: params.str('comment'),
      isPublic: params.has('public') ? params.bool('public', false) : undefined,
    });
    // Subsonic semantics: removals refer to the list before additions.
    const removals = params
      .list('songIndexToRemove')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0);
    if (removals.length) {
      await removePlaylistIndexes(playlist, removals);
    }
    await appendPlaylistTracks(
      playlist.id,
      trackIdsFrom(index, params.list('songIdToAdd'))
    );
    return {};
  },

  deletePlaylist: async (ctx) => {
    const playlist = await ownPlaylist(ctx.user, ctx.params.required('id'));
    await deletePlaylist(playlist.id);
    return {};
  },

  scrobble: async (ctx) => {
    const { params, user, client } = ctx;
    const index = await getLibrary();
    const ids = params.list('id');
    if (!ids.length) {
      params.required('id');
    }
    const times = params.list('time');
    const submission = params.bool('submission', true);

    for (const [i, raw] of ids.entries()) {
      const track = findTrack(index, raw);
      if (!submission) {
        await reportNowPlaying(user, track, client);
        continue;
      }
      const at = Number(times[i]);
      await reportPlayed(user, track, client, {
        playedAt: Number.isFinite(at) && at > 0 ? new Date(at) : undefined,
      });
    }
    return {};
  },

  getNowPlaying: async (ctx) => {
    const view = await loadView(ctx.user);
    return {
      nowPlaying: {
        entry: getNowPlayingEntries().map((entry, i) => ({
          ...songOf(entry.track, view),
          username: usernameOf(entry.user),
          minutesAgo: Math.floor((Date.now() - entry.updatedAt) / 60000),
          playerId: i + 1,
          playerName: entry.client,
        })),
      },
    };
  },

  getUser: async (ctx) => {
    const wanted = ctx.params.str('username');
    if (
      wanted &&
      wanted.toLowerCase() !== usernameOf(ctx.user).toLowerCase() &&
      wanted.toLowerCase() !== ctx.user.email
    ) {
      throw new SubsonicError(
        SubsonicErrorCode.NOT_AUTHORIZED,
        'You can only look up your own account from a music app.'
      );
    }
    return { user: userOf(ctx.user) };
  },

  getUsers: async (ctx) => ({ users: { user: [userOf(ctx.user)] } }),

  getScanStatus: async () => {
    const index = await getLibrary();
    return { scanStatus: { scanning: false, count: index.tracks.length } };
  },

  startScan: async () => {
    throw new SubsonicError(
      SubsonicErrorCode.NOT_AUTHORIZED,
      'Library scans are started from Shufflerr settings, not from a music app.'
    );
  },

  getLyrics: async () => ({ lyrics: {} }),

  getLyricsBySongId: async (ctx) => {
    const index = await getLibrary();
    findTrack(index, ctx.params.required('id'));
    // Shufflerr stores no lyrics; the structured list is empty, not invented.
    return { lyricsList: { structuredLyrics: [] } };
  },

  getArtistInfo: async (ctx) => {
    const index = await getLibrary();
    const artist = findArtist(index, ctx.params.required('id'));
    return { artistInfo: { musicBrainzId: artist.mbid } };
  },

  getArtistInfo2: async (ctx) => {
    const index = await getLibrary();
    const artist = findArtist(index, ctx.params.required('id'));
    return { artistInfo2: { musicBrainzId: artist.mbid } };
  },

  getAlbumInfo: async (ctx) => {
    const index = await getLibrary();
    const album = findAlbum(index, ctx.params.required('id'));
    return { albumInfo: { musicBrainzId: album.mbid } };
  },

  getAlbumInfo2: async (ctx) => {
    const index = await getLibrary();
    const album = findAlbum(index, ctx.params.required('id'));
    return { albumInfo: { musicBrainzId: album.mbid } };
  },

  getTopSongs: async (ctx) => {
    // "Top songs" = this user's most played tracks by the artist (real plays only).
    const index = await getLibrary();
    const view = await loadView(ctx.user);
    const name = ctx.params.required('artist').trim().toLowerCase();
    const artist = index.artists.find((a) => a.name.toLowerCase() === name);
    const songs = artist
      ? artistTracks(artist)
          .filter((t) => view.plays.has(t.id))
          .sort(
            (a, b) =>
              (view.plays.get(b.id)?.count ?? 0) -
              (view.plays.get(a.id)?.count ?? 0)
          )
          .slice(0, ctx.params.int('count', 50))
      : [];
    return { topSongs: { song: songs.map((t) => songOf(t, view)) } };
  },

  getSimilarSongs: async () => ({ similarSongs: { song: [] } }),
  getSimilarSongs2: async () => ({ similarSongs2: { song: [] } }),
  getBookmarks: async () => ({ bookmarks: {} }),
  getPlayQueue: async () => ({}),
  getPodcasts: async () => ({ podcasts: {} }),
  getNewestPodcasts: async () => ({ newestPodcasts: {} }),
  getInternetRadioStations: async () => ({ internetRadioStations: {} }),
  getShares: async () => ({ shares: {} }),
  getVideos: async () => ({ videos: {} }),

  getCoverArt: async (ctx) => {
    const index = await getLibrary();
    const album = await coverAlbumFor(ctx, index, ctx.params.required('id'));
    const image = album
      ? await getAlbumCover(album.mbid, ctx.params.int('size'))
      : null;
    if (!image) {
      throw notFound('Cover art');
    }
    sendCover(ctx.res, image);
    return null;
  },

  stream: async (ctx) => {
    const { params } = ctx;
    const index = await getLibrary();
    const track = findTrack(index, params.required('id'));
    // `timeOffset` (transcodeOffset extension) is not advertised or applied.
    await sendTrack(
      ctx.req,
      ctx.res,
      track.id,
      streamOptionsFrom({
        format: params.str('format'),
        maxBitRateKbps: params.int('maxBitRate'),
      })
    );
    return null;
  },

  download: async (ctx) => {
    if (!getSettings().clients.allowDownloads) {
      throw new SubsonicError(
        SubsonicErrorCode.NOT_AUTHORIZED,
        'Downloads for offline listening are turned off on this server.'
      );
    }
    const index = await getLibrary();
    const track = findTrack(index, ctx.params.required('id'));
    await sendTrack(
      ctx.req,
      ctx.res,
      track.id,
      streamOptionsFrom({ download: true })
    );
    return null;
  },
};

/** Endpoints that answer without credentials (OpenSubsonic requires this for the extension list). */
export const PUBLIC_METHODS = new Set(['getopensubsonicextensions']);

export const handlersByName = new Map<string, Handler>(
  Object.entries(handlers).map(([name, fn]) => [name.toLowerCase(), fn])
);
