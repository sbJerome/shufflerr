// Jellyfin-compatible API, mounted at /jellyfin (docs/CLIENT_API.md).
// Mounted outside /api/v1: no session, no CSRF, no OpenAPI validation. Apps
// sign in with a username and an app password and get an access token that is
// tied to that app password.
import type { ClientIdentity } from '@server/clientapi/common/credentials';
import {
  issueAccessToken,
  noteClientUse,
  signInWithAccessToken,
  signInWithPassword,
} from '@server/clientapi/common/credentials';
import type { LibAlbum, LibTrack } from '@server/clientapi/common/library';
import {
  artistTracks,
  getLibrary,
  shuffled,
} from '@server/clientapi/common/library';
import {
  getAlbumCover,
  sendCover,
  sendTrack,
  streamOptionsFrom,
} from '@server/clientapi/common/media';
import {
  appendPlaylistTracks,
  createPlaylist,
  deletePlaylist,
  getPlayStats,
  getPlaylist,
  getStars,
  listPlaylists,
  removePlaylistEntries,
  replacePlaylistTracks,
  reportNowPlaying,
  reportPlayed,
  reportProgress,
  setStar,
  updatePlaylistMeta,
} from '@server/clientapi/common/userData';
import type { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { getAppVersion } from '@server/utils/appVersion';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import express, { Router } from 'express';
import type { Dto } from './dto';
import {
  TICKS_PER_MS,
  favouriteDto,
  mediaSourceOf,
  userDto,
  viewDto,
} from './dto';
import {
  parseItemId,
  playlistItemId,
  serverId,
  trackItemId,
  userItemId,
} from './ids';
import type { Entry, Query, QueryContext } from './query';
import {
  paginate,
  playlistTracksOf,
  queryArtists,
  queryItems,
  resolveEntry,
  toDto,
} from './query';

/** Version reported to apps. Clients gate features on it, so it tracks the Jellyfin API level implemented here. */
const JELLYFIN_API_VERSION = '10.10.7';

interface Locals {
  q: Query;
  identity: ClientIdentity;
  client: string;
  device: string;
  deviceId: string;
}

const locals = (res: Response): Locals => res.locals as Locals;

const router = Router();

router.use(express.json({ limit: '2mb' }));

router.use((_req, res, next) => {
  if (!getSettings().clients.jellyfinApi) {
    return res.status(404).json({ message: 'The Jellyfin API is turned off.' });
  }
  next();
});

/* -------------------------------------------------------------- request ctx */

const lowerKeys = (source: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!source || typeof source !== 'object') {
    return out;
  }
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) {
      continue;
    }
    out[key.toLowerCase()] = Array.isArray(value)
      ? value.map(String).join(',')
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  }
  return out;
};

const parseAuthHeader = (
  header: string | undefined
): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!header) {
    return out;
  }
  const pattern = /(\w+)\s*=\s*"([^"]*)"|(\w+)\s*=\s*([^,\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(header))) {
    const key = (match[1] ?? match[3]).toLowerCase();
    const raw = match[2] ?? match[4] ?? '';
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
};

router.use((req, res, next) => {
  const q = lowerKeys(req.query);
  const auth = {
    ...parseAuthHeader(req.header('x-emby-authorization')),
    ...parseAuthHeader(req.header('authorization')),
  };
  const l = locals(res);
  l.q = q;
  l.client = auth.client || 'Jellyfin app';
  l.device = auth.device || '';
  l.deviceId = auth.deviceid || q.deviceid || '';
  res.locals.token =
    auth.token ||
    req.header('x-emby-token') ||
    req.header('x-mediabrowser-token') ||
    q.api_key ||
    q.apikey ||
    '';
  next();
});

const requireAuth: RequestHandler = async (_req, res, next) => {
  try {
    const identity = await signInWithAccessToken(String(res.locals.token));
    if (!identity) {
      return res.status(401).end();
    }
    const l = locals(res);
    l.identity = identity;
    noteClientUse(
      identity,
      [l.client, l.device].filter(Boolean).join(' on ') || null
    );
    next();
  } catch (e) {
    next(e);
  }
};

type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;

const run =
  (handler: AsyncHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };

const loadContext = async (user: User): Promise<QueryContext> => {
  const [index, stars, plays, playlists] = await Promise.all([
    getLibrary(),
    getStars(user.id),
    getPlayStats(user.id),
    listPlaylists(user.id),
  ]);
  return { index, view: { stars, plays }, playlists };
};

const bodyOf = (req: Request): Record<string, string> => lowerKeys(req.body);

const param = (req: Request, name: string): string =>
  String((req.params as Record<string, string | string[]>)[name] ?? '');

/* ------------------------------------------------------------------- public */

const systemInfo = (): Dto => ({
  LocalAddress: getSettings().main.applicationUrl
    ? `${getSettings().main.applicationUrl}/jellyfin`
    : undefined,
  ServerName: getSettings().main.applicationTitle || 'Shufflerr',
  Version: JELLYFIN_API_VERSION,
  ProductName: 'Shufflerr',
  OperatingSystem: '',
  Id: serverId(),
  StartupWizardCompleted: true,
});

router.get('/System/Info/Public', (_req, res) => {
  res.json(systemInfo());
});

router.all('/System/Ping', (_req, res) => {
  res.json('Jellyfin Server');
});

router.get('/Users/Public', (_req, res) => {
  // Never list accounts to signed-out apps.
  res.json([]);
});

router.get('/Branding/Configuration', (_req, res) => {
  res.json({ LoginDisclaimer: '', CustomCss: '', SplashscreenEnabled: false });
});

router.get('/Branding/Css', (_req, res) => {
  res.type('text/css').send('');
});
router.get('/Branding/Css.css', (_req, res) => {
  res.type('text/css').send('');
});

router.get('/QuickConnect/Enabled', (_req, res) => {
  res.json(false);
});

router.post(
  '/Users/AuthenticateByName',
  run(async (req, res) => {
    const body = bodyOf(req);
    const username = body.username ?? '';
    const password = body.pw ?? body.password ?? '';
    const identity = await signInWithPassword(username, password);
    if (!identity) {
      // Same answer for unknown users and wrong passwords.
      return res.status(401).json({
        message:
          'Wrong username or password. Use an app password from your Shufflerr profile.',
      });
    }

    const l = locals(res);
    noteClientUse(
      identity,
      [l.client, l.device].filter(Boolean).join(' on ') || null
    );
    const token = await issueAccessToken(identity.appPasswordId);
    const now = new Date().toISOString();
    res.json({
      User: {
        ...userDto(identity.user),
        LastLoginDate: now,
        LastActivityDate: now,
      },
      SessionInfo: sessionDto(identity.user, l, identity.appPasswordId),
      AccessToken: token,
      ServerId: serverId(),
    });
  })
);

const sessionDto = (user: User, l: Locals, appPasswordId: number): Dto => ({
  PlayState: {
    CanSeek: false,
    IsPaused: false,
    IsMuted: false,
    RepeatMode: 'RepeatNone',
  },
  AdditionalUsers: [],
  Capabilities: {
    PlayableMediaTypes: ['Audio'],
    SupportedCommands: [],
    SupportsMediaControl: false,
    SupportsPersistentIdentifier: true,
  },
  RemoteEndPoint: '',
  PlayableMediaTypes: ['Audio'],
  Id: `ap${appPasswordId}`,
  UserId: userItemId(user.id),
  UserName: userDto(user).Name,
  Client: l.client,
  LastActivityDate: new Date().toISOString(),
  LastPlaybackCheckIn: new Date(0).toISOString(),
  DeviceName: l.device,
  DeviceId: l.deviceId,
  ApplicationVersion: '',
  IsActive: true,
  SupportsMediaControl: false,
  SupportsRemoteControl: false,
  NowPlayingQueue: [],
  NowPlayingQueueFullItems: [],
  HasCustomDeviceName: false,
  ServerId: serverId(),
  SupportedCommands: [],
});

/* ------------------------------------------------------------------- images */

const coverAlbum = async (
  rawId: string,
  userId?: number
): Promise<LibAlbum | undefined> => {
  const index = await getLibrary();
  const id = parseItemId(rawId);
  if (id?.kind === 'album') {
    return index.albumById.get(id.id);
  }
  if (id?.kind === 'track') {
    return index.trackById.get(id.id)?.album;
  }
  if (id?.kind === 'playlist' && userId !== undefined) {
    const playlist = await getPlaylist(userId, id.id);
    return playlist
      ? playlistTracksOf(playlist, index)[0]?.track.album
      : undefined;
  }
  return undefined;
};

// Like Jellyfin, images are readable without a token (apps load them from
// plain <img>/widget requests). Ids are opaque and only album art is served.
const imageHandler = run(async (req, res) => {
  if (param(req, 'type').toLowerCase() !== 'primary') {
    return res.status(404).end();
  }
  const identity = await signInWithAccessToken(String(res.locals.token));
  const album = await coverAlbum(param(req, 'itemId'), identity?.user.id);
  const q = locals(res).q;
  const size = Math.max(
    ...[
      'maxwidth',
      'maxheight',
      'fillwidth',
      'fillheight',
      'width',
      'height',
    ].map((k) => Number(q[k]) || 0)
  );
  const image = album ? await getAlbumCover(album.mbid, size) : null;
  if (!image) {
    return res.status(404).end();
  }
  sendCover(res, image);
});

router.get('/Items/:itemId/Images/:type', imageHandler);
router.get('/Items/:itemId/Images/:type/:index', imageHandler);

/* -------------------------------------------------- everything else: signed in */

router.use(requireAuth);

router.get('/System/Info', (_req, res) => {
  res.json({
    ...systemInfo(),
    OperatingSystemDisplayName: '',
    HasPendingRestart: false,
    IsShuttingDown: false,
    SupportsLibraryMonitor: false,
    WebSocketPortNumber: 0,
    CanSelfRestart: false,
    CanLaunchWebBrowser: false,
    HasUpdateAvailable: false,
    ServerVersion: getAppVersion(),
  });
});

router.get('/System/Endpoint', (_req, res) => {
  res.json({ IsLocal: false, IsInNetwork: true });
});

const sameUser = (req: Request, res: Response): boolean => {
  const id = parseItemId(param(req, 'userId'));
  return id?.kind === 'user' && id.id === locals(res).identity.user.id;
};

router.get('/Users', (_req, res) => {
  res.json([userDto(locals(res).identity.user)]);
});

router.get('/Users/Me', (_req, res) => {
  res.json(userDto(locals(res).identity.user));
});

router.get('/Users/:userId', (req, res) => {
  if (!sameUser(req, res)) {
    return res.status(404).end();
  }
  res.json(userDto(locals(res).identity.user));
});

router.get('/Sessions', (_req, res) => {
  const l = locals(res);
  res.json([sessionDto(l.identity.user, l, l.identity.appPasswordId)]);
});

const noContent: RequestHandler = (_req, res) => {
  res.status(204).end();
};

router.post('/Sessions/Capabilities', noContent);
router.post('/Sessions/Capabilities/Full', noContent);
router.post('/Sessions/Logout', noContent);
router.post('/Sessions/Playing/Ping', noContent);

router.get('/DisplayPreferences/:id', (req, res) => {
  res.json({
    Id: param(req, 'id'),
    SortBy: 'SortName',
    RememberIndexing: false,
    PrimaryImageHeight: 250,
    PrimaryImageWidth: 250,
    CustomPrefs: {},
    ScrollDirection: 'Horizontal',
    ShowBackdrop: true,
    RememberSorting: false,
    SortOrder: 'Ascending',
    ShowSidebar: false,
    Client: locals(res).q.client ?? 'emby',
  });
});
router.post('/DisplayPreferences/:id', noContent);

/* -------------------------------------------------------------------- views */

const views: RequestHandler = (_req, res) => {
  res.json({ Items: [viewDto()], TotalRecordCount: 1, StartIndex: 0 });
};
router.get('/UserViews', views);
router.get('/Users/:userId/Views', views);
router.get('/Library/MediaFolders', views);
router.get('/Users/:userId/GroupingOptions', (_req, res) => {
  res.json([]);
});

/* -------------------------------------------------------------------- items */

const itemsHandler = run(async (_req, res) => {
  const l = locals(res);
  const ctx = await loadContext(l.identity.user);
  res.json(queryItems(l.q, ctx));
});

const latestHandler = run(async (_req, res) => {
  const l = locals(res);
  const ctx = await loadContext(l.identity.user);
  const limit = Number(l.q.limit) || 20;
  const wantsTracks = (l.q.includeitemtypes ?? '').toLowerCase() === 'audio';
  const entries: Entry[] = wantsTracks
    ? [...ctx.index.tracks]
        .sort((a, b) => b.created.getTime() - a.created.getTime())
        .map((track) => ({ kind: 'track' as const, track }))
    : [...ctx.index.albums]
        .sort((a, b) => b.created.getTime() - a.created.getTime())
        .map((album) => ({ kind: 'album' as const, album }));
  // Jellyfin answers "latest" with a bare array, not a query result.
  res.json(entries.slice(0, limit).map((e) => toDto(e, ctx.view)));
});

const emptyResult: RequestHandler = (_req, res) => {
  res.json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
};

const itemHandler = run(async (req, res) => {
  const ctx = await loadContext(locals(res).identity.user);
  const entry = resolveEntry(parseItemId(param(req, 'itemId')), ctx);
  if (!entry) {
    return res.status(404).end();
  }
  res.json(toDto(entry, ctx.view));
});

router.get('/Items', itemsHandler);
router.get('/Users/:userId/Items', itemsHandler);
router.get('/Items/Latest', latestHandler);
router.get('/Users/:userId/Items/Latest', latestHandler);
router.get('/Items/Resume', emptyResult);
router.get('/UserItems/Resume', emptyResult);
router.get('/Users/:userId/Items/Resume', emptyResult);
router.get('/Items/Filters', (_req, res) => {
  res.json({ Genres: [], Tags: [], OfficialRatings: [], Years: [] });
});
router.get('/Items/Filters2', (_req, res) => {
  res.json({ Genres: [], Tags: [] });
});
router.get(
  '/Items/Counts',
  run(async (_req, res) => {
    const index = await getLibrary();
    res.json({
      MovieCount: 0,
      SeriesCount: 0,
      EpisodeCount: 0,
      ArtistCount: index.artists.length,
      ProgramCount: 0,
      TrailerCount: 0,
      SongCount: index.tracks.length,
      AlbumCount: index.albums.length,
      MusicVideoCount: 0,
      BoxSetCount: 0,
      BookCount: 0,
      ItemCount: index.tracks.length + index.albums.length,
    });
  })
);

const artistsHandler = run(async (_req, res) => {
  const l = locals(res);
  const ctx = await loadContext(l.identity.user);
  res.json(queryArtists(l.q, ctx));
});
router.get('/Artists', artistsHandler);
router.get('/Artists/AlbumArtists', artistsHandler);

// Shufflerr has no genre index yet, so the genre lists are empty.
router.get('/MusicGenres', emptyResult);
router.get('/Genres', emptyResult);
router.get('/Studios', emptyResult);
router.get('/Persons', emptyResult);

router.get('/Items/:itemId', itemHandler);
router.get('/Users/:userId/Items/:itemId', itemHandler);

router.get('/Items/:itemId/Similar', emptyResult);
router.get('/Albums/:itemId/Similar', emptyResult);
router.get('/Artists/:itemId/Similar', emptyResult);
router.get('/Items/:itemId/ThemeMedia', (_req, res) => {
  const empty = { Items: [], TotalRecordCount: 0, StartIndex: 0 };
  res.json({
    ThemeVideosResult: empty,
    ThemeSongsResult: empty,
    SoundtrackSongsResult: empty,
  });
});
router.get('/Audio/:itemId/Lyrics', (_req, res) => {
  // No lyrics are stored.
  res.status(404).end();
});

/**
 * Instant mix: the seed's own tracks first (the song's album, the album, or
 * the artist's catalogue), then a shuffle of the rest of the library.
 */
const instantMix = run(async (req, res) => {
  const l = locals(res);
  const ctx = await loadContext(l.identity.user);
  const entry = resolveEntry(parseItemId(param(req, 'itemId')), ctx);
  if (!entry) {
    return res.status(404).end();
  }
  const limit = Number(l.q.limit) || 50;
  const seed: LibTrack[] =
    entry.kind === 'track'
      ? [entry.track, ...shuffled(entry.track.album.tracks)]
      : entry.kind === 'album'
        ? shuffled(entry.album.tracks)
        : entry.kind === 'artist'
          ? shuffled(artistTracks(entry.artist))
          : entry.kind === 'playlist'
            ? shuffled(entry.tracks)
            : [];
  const seen = new Set<number>();
  const mix = [...seed, ...shuffled(ctx.index.tracks)].filter((t) => {
    if (seen.has(t.id)) {
      return false;
    }
    seen.add(t.id);
    return true;
  });
  res.json(
    paginate(
      mix.slice(0, limit).map((track) => ({ kind: 'track' as const, track })),
      {},
      ctx.view
    )
  );
});
router.get('/Items/:itemId/InstantMix', instantMix);
router.get('/Songs/:itemId/InstantMix', instantMix);
router.get('/Albums/:itemId/InstantMix', instantMix);
router.get('/Artists/:itemId/InstantMix', instantMix);
router.get('/Playlists/:itemId/InstantMix', instantMix);

/* ---------------------------------------------------------------- favourites */

const favouriteHandler = (value: boolean) =>
  run(async (req, res) => {
    const user = locals(res).identity.user;
    const ctx = await loadContext(user);
    const rawId = param(req, 'itemId');
    const entry = resolveEntry(parseItemId(rawId), ctx);

    if (entry?.kind === 'track') {
      await setStar(user, { trackId: entry.track.id }, value);
    } else if (entry?.kind === 'album') {
      await setStar(user, { mediaId: entry.album.mediaId }, value);
    } else if (entry?.kind === 'artist' && entry.artist.mediaId) {
      await setStar(user, { mediaId: entry.artist.mediaId }, value);
    } else {
      return res.status(404).end();
    }
    res.json(favouriteDto(rawId.replace(/-/g, '').toLowerCase(), value));
  });

router.post('/UserFavoriteItems/:itemId', favouriteHandler(true));
router.delete('/UserFavoriteItems/:itemId', favouriteHandler(false));
router.post('/Users/:userId/FavoriteItems/:itemId', favouriteHandler(true));
router.delete('/Users/:userId/FavoriteItems/:itemId', favouriteHandler(false));

/* ---------------------------------------------------------------- playlists */

const trackIdsFromList = (raw: string | undefined): number[] =>
  (raw ?? '')
    .split(',')
    .map((v) => parseItemId(v.trim()))
    .filter((id): id is { kind: 'track'; id: number } => id?.kind === 'track')
    .map((id) => id.id);

const idsFromBody = (req: Request): string | undefined => {
  const ids =
    (req.body as Record<string, unknown> | undefined)?.Ids ??
    (req.body as Record<string, unknown> | undefined)?.ids;
  return Array.isArray(ids) ? ids.map(String).join(',') : undefined;
};

const ownedPlaylist = async (req: Request, res: Response) => {
  const user = locals(res).identity.user;
  const id = parseItemId(param(req, 'itemId'));
  const playlist =
    id?.kind === 'playlist' ? await getPlaylist(user.id, id.id) : null;
  if (!playlist) {
    res.status(404).end();
    return null;
  }
  if (playlist.user?.id !== user.id) {
    res.status(403).end();
    return null;
  }
  return playlist;
};

router.post(
  '/Playlists',
  run(async (req, res) => {
    const l = locals(res);
    const body = bodyOf(req);
    const name = body.name ?? l.q.name ?? '';
    if (!name.trim()) {
      return res.status(400).json({ message: 'Give the playlist a name.' });
    }
    const index = await getLibrary();
    const trackIds = trackIdsFromList(idsFromBody(req) ?? l.q.ids).filter(
      (id) => index.trackById.has(id)
    );
    const playlist = await createPlaylist(l.identity.user, name, trackIds, {
      isPublic: body.ispublic === 'true',
    });
    res.json({ Id: playlistItemId(playlist.id) });
  })
);

// Jellyfin 10.9+: update name / contents / visibility in one call.
router.post(
  '/Playlists/:itemId',
  run(async (req, res) => {
    const playlist = await ownedPlaylist(req, res);
    if (!playlist) {
      return;
    }
    const body = bodyOf(req);
    await updatePlaylistMeta(playlist.id, {
      name: body.name,
      isPublic:
        body.ispublic === undefined ? undefined : body.ispublic === 'true',
    });
    const ids = idsFromBody(req);
    if (ids !== undefined) {
      const index = await getLibrary();
      await replacePlaylistTracks(
        playlist.id,
        trackIdsFromList(ids).filter((id) => index.trackById.has(id))
      );
    }
    res.status(204).end();
  })
);

router.get(
  '/Playlists/:itemId',
  run(async (req, res) => {
    const user = locals(res).identity.user;
    const id = parseItemId(param(req, 'itemId'));
    const playlist =
      id?.kind === 'playlist' ? await getPlaylist(user.id, id.id) : null;
    if (!playlist) {
      return res.status(404).end();
    }
    const index = await getLibrary();
    res.json({
      OpenAccess: playlist.isPublic,
      Shares: [],
      ItemIds: playlistTracksOf(playlist, index).map((x) =>
        trackItemId(x.track.id)
      ),
    });
  })
);

router.get(
  '/Playlists/:itemId/Items',
  run(async (req, res) => {
    const l = locals(res);
    const ctx = await loadContext(l.identity.user);
    const id = parseItemId(param(req, 'itemId'));
    const playlist =
      id?.kind === 'playlist'
        ? ctx.playlists.find((p) => p.id === id.id)
        : undefined;
    if (!playlist) {
      return res.status(404).end();
    }
    const entries: Entry[] = playlistTracksOf(playlist, ctx.index).map((x) => ({
      kind: 'track',
      track: x.track,
      playlistEntryId: x.entryId,
    }));
    res.json(paginate(entries, l.q, ctx.view));
  })
);

router.post(
  '/Playlists/:itemId/Items',
  run(async (req, res) => {
    const playlist = await ownedPlaylist(req, res);
    if (!playlist) {
      return;
    }
    const index = await getLibrary();
    await appendPlaylistTracks(
      playlist.id,
      trackIdsFromList(idsFromBody(req) ?? locals(res).q.ids).filter((id) =>
        index.trackById.has(id)
      )
    );
    res.status(204).end();
  })
);

router.delete(
  '/Playlists/:itemId/Items',
  run(async (req, res) => {
    const playlist = await ownedPlaylist(req, res);
    if (!playlist) {
      return;
    }
    const entryIds = (locals(res).q.entryids ?? '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    await removePlaylistEntries(playlist, entryIds);
    res.status(204).end();
  })
);

// Apps rename a playlist by posting the edited item back, and delete it as an item.
router.post(
  '/Items/:itemId',
  run(async (req, res) => {
    const playlist = await ownedPlaylist(req, res);
    if (!playlist) {
      return;
    }
    const body = bodyOf(req);
    await updatePlaylistMeta(playlist.id, {
      name: body.name,
      comment: body.overview,
    });
    res.status(204).end();
  })
);

router.delete(
  '/Items/:itemId',
  run(async (req, res) => {
    const playlist = await ownedPlaylist(req, res);
    if (!playlist) {
      return;
    }
    await deletePlaylist(playlist.id);
    res.status(204).end();
  })
);

/* ----------------------------------------------------------------- playback */

const trackFrom = async (rawId: string): Promise<LibTrack | undefined> => {
  const id = parseItemId(rawId);
  return id?.kind === 'track'
    ? (await getLibrary()).trackById.get(id.id)
    : undefined;
};

const playbackInfo = run(async (req, res) => {
  const track = await trackFrom(param(req, 'itemId'));
  if (!track) {
    return res.status(404).end();
  }
  res.json({
    MediaSources: [mediaSourceOf(track)],
    PlaySessionId: `${locals(res).identity.appPasswordId}-${Date.now().toString(
      36
    )}`,
  });
});
router.get('/Items/:itemId/PlaybackInfo', playbackInfo);
router.post('/Items/:itemId/PlaybackInfo', playbackInfo);

const LOSSLESS = new Set(['flac', 'wav', 'aiff', 'ape', 'wv', 'dsf']);

/** Decide between the original file and a transcode from what the app says it can take. */
const jellyfinStreamOptions = (
  track: LibTrack,
  q: Query,
  extension?: string
) => {
  if (q.static === 'true') {
    return streamOptionsFrom({ format: 'raw' });
  }

  const containers = (q.container ?? '')
    .split(',')
    .map((c) => c.trim().toLowerCase().split('|')[0])
    .filter(Boolean);
  const limitBps = Math.min(
    ...[Number(q.maxstreamingbitrate), Number(q.audiobitrate)].filter(
      (n) => Number.isFinite(n) && n > 0
    ),
    Infinity
  );
  const sourceBps = track.bitRate
    ? track.bitRate * 1000
    : LOSSLESS.has(track.suffix)
      ? 1_000_000
      : 320_000;

  const containerOk =
    !containers.length || !track.suffix || containers.includes(track.suffix);
  const wantedExt = extension?.toLowerCase();
  const extOk = !wantedExt || !track.suffix || wantedExt === track.suffix;

  if (containerOk && extOk && sourceBps <= limitBps) {
    return streamOptionsFrom({});
  }

  const target = (
    wantedExt ||
    q.transcodingcontainer ||
    q.audiocodec ||
    'mp3'
  ).toLowerCase();
  return streamOptionsFrom({
    format: /opus|ogg|webm/.test(target) ? 'opus' : 'mp3',
    // Never ask for more than a lossy target can usefully carry.
    maxBitRateKbps: Number.isFinite(limitBps)
      ? Math.min(320, Math.max(32, Math.round(limitBps / 1000)))
      : undefined,
  });
};

const audioHandler = (download = false) =>
  run(async (req, res) => {
    const track = await trackFrom(param(req, 'itemId'));
    if (!track) {
      return res.status(404).end();
    }
    if (download && !getSettings().clients.allowDownloads) {
      return res.status(403).json({
        message:
          'Downloads for offline listening are turned off on this server.',
      });
    }
    await sendTrack(
      req,
      res,
      track.id,
      download
        ? streamOptionsFrom({ download: true })
        : jellyfinStreamOptions(
            track,
            locals(res).q,
            param(req, 'container') || undefined
          )
    );
  });

router.get('/Audio/:itemId/universal', audioHandler());
router.get('/Audio/:itemId/stream', audioHandler());
router.get('/Audio/:itemId/stream.:container', audioHandler());
router.get('/Items/:itemId/File', audioHandler());
router.get('/Items/:itemId/Download', audioHandler(true));

const playbackReport = (kind: 'start' | 'progress' | 'stop') =>
  run(async (req, res) => {
    const l = locals(res);
    const body = { ...l.q, ...bodyOf(req) };
    const track = await trackFrom(body.itemid ?? '');
    if (track) {
      const positionMs = (Number(body.positionticks) || 0) / TICKS_PER_MS;
      const client = [l.client, l.deviceId].filter(Boolean).join(':');
      if (kind === 'start') {
        await reportNowPlaying(l.identity.user, track, client, positionMs);
      } else if (kind === 'progress') {
        reportProgress(l.identity.user, track, client, positionMs);
      } else {
        await reportPlayed(l.identity.user, track, client, {
          playedSeconds: Math.round(positionMs / 1000),
        });
      }
    }
    res.status(204).end();
  });

router.post('/Sessions/Playing', playbackReport('start'));
router.post('/Sessions/Playing/Progress', playbackReport('progress'));
router.post('/Sessions/Playing/Stopped', playbackReport('stop'));

/* ------------------------------------------------------------------- errors */

router.use((_req, res) => {
  res
    .status(404)
    .json({ message: 'Shufflerr does not support this Jellyfin call.' });
});

router.use(
  (
    err: Error & { status?: number; type?: string },
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: NextFunction
  ) => {
    if (res.headersSent) {
      return res.end();
    }
    if (err.type === 'entity.parse.failed' || err.status === 400) {
      return res
        .status(400)
        .json({ message: 'The request body is not valid JSON.' });
    }
    logger.error('Jellyfin-compatible request failed', {
      label: 'Client API',
      path: req.path,
      errorMessage: err.message,
    });
    res
      .status(500)
      .json({ message: 'Shufflerr could not complete that request.' });
  }
);

export default router;
