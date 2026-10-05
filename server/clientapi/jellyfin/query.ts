import type {
  LibAlbum,
  LibArtist,
  LibraryIndex,
  LibTrack,
} from '@server/clientapi/common/library';
import {
  artistTracks,
  shuffled,
  sortNameOf,
} from '@server/clientapi/common/library';
import type Playlist from '@server/entity/Playlist';
import type { Dto, UserView } from './dto';
import { albumDto, artistDto, playlistDto, trackDto, viewDto } from './dto';
import type { JellyfinId } from './ids';
import { parseItemId } from './ids';

/** Lower-cased query parameters (Jellyfin treats parameter names case-insensitively). */
export type Query = Record<string, string>;

export type Entry =
  | { kind: 'track'; track: LibTrack; playlistEntryId?: number }
  | { kind: 'album'; album: LibAlbum }
  | { kind: 'artist'; artist: LibArtist }
  | { kind: 'playlist'; playlist: Playlist; tracks: LibTrack[] }
  | { kind: 'view' };

export interface QueryContext {
  index: LibraryIndex;
  view: UserView;
  playlists: Playlist[];
}

const TYPE_KIND: Record<string, Entry['kind']> = {
  audio: 'track',
  musicalbum: 'album',
  musicartist: 'artist',
  playlist: 'playlist',
};

const csv = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

export const toDto = (entry: Entry, view: UserView): Dto => {
  switch (entry.kind) {
    case 'track': {
      const dto = trackDto(entry.track, view);
      if (entry.playlistEntryId !== undefined) {
        dto.PlaylistItemId = String(entry.playlistEntryId);
      }
      return dto;
    }
    case 'album':
      return albumDto(entry.album, view);
    case 'artist':
      return artistDto(entry.artist, view);
    case 'playlist':
      return playlistDto(entry.playlist, entry.tracks);
    case 'view':
      return viewDto();
  }
};

export const playlistTracksOf = (
  playlist: Playlist,
  index: LibraryIndex
): { track: LibTrack; entryId: number }[] =>
  (playlist.items ?? [])
    .map((item) => ({
      track: item.track ? index.trackById.get(item.track.id) : undefined,
      entryId: item.id,
    }))
    .filter((x): x is { track: LibTrack; entryId: number } => !!x.track);

export const resolveEntry = (
  id: JellyfinId | null,
  ctx: QueryContext
): Entry | null => {
  if (!id) {
    return null;
  }
  switch (id.kind) {
    case 'view':
      return { kind: 'view' };
    case 'track': {
      const track = ctx.index.trackById.get(id.id);
      return track ? { kind: 'track', track } : null;
    }
    case 'album': {
      const album = ctx.index.albumById.get(id.id);
      return album ? { kind: 'album', album } : null;
    }
    case 'artist': {
      const artist = ctx.index.artistByKey.get(id.key);
      return artist ? { kind: 'artist', artist } : null;
    }
    case 'playlist': {
      const playlist = ctx.playlists.find((p) => p.id === id.id);
      return playlist
        ? {
            kind: 'playlist',
            playlist,
            tracks: playlistTracksOf(playlist, ctx.index).map((x) => x.track),
          }
        : null;
    }
    default:
      return null;
  }
};

const nameOf = (entry: Entry): string => {
  switch (entry.kind) {
    case 'track':
      return entry.track.title;
    case 'album':
      return entry.album.name;
    case 'artist':
      return entry.artist.name;
    case 'playlist':
      return entry.playlist.name;
    case 'view':
      return 'Music';
  }
};

const albumOfEntry = (entry: Entry): LibAlbum | undefined =>
  entry.kind === 'track'
    ? entry.track.album
    : entry.kind === 'album'
      ? entry.album
      : undefined;

const playsOf = (
  entry: Entry,
  view: UserView
): { count: number; last: number } => {
  const tracks =
    entry.kind === 'track'
      ? [entry.track]
      : entry.kind === 'album'
        ? entry.album.tracks
        : entry.kind === 'artist'
          ? artistTracks(entry.artist)
          : [];
  let count = 0;
  let last = 0;
  for (const track of tracks) {
    const stats = view.plays.get(track.id);
    if (stats) {
      count += stats.count;
      last = Math.max(last, stats.lastPlayed.getTime());
    }
  }
  return { count, last };
};

const createdOf = (entry: Entry): number => {
  switch (entry.kind) {
    case 'track':
      return entry.track.created.getTime();
    case 'album':
      return entry.album.created.getTime();
    case 'artist':
      return entry.artist.created.getTime();
    case 'playlist':
      return new Date(entry.playlist.createdAt).getTime();
    case 'view':
      return 0;
  }
};

type SortValue = string | number;

const sortValue = (entry: Entry, field: string, view: UserView): SortValue => {
  const album = albumOfEntry(entry);
  switch (field) {
    case 'sortname':
    case 'name':
      return sortNameOf(nameOf(entry));
    case 'album':
      return album?.sortName ?? '';
    case 'albumartist':
      return album?.artist.sortName ?? sortNameOf(nameOf(entry));
    case 'artist':
      return entry.kind === 'track'
        ? sortNameOf(entry.track.artist)
        : (album?.artist.sortName ?? sortNameOf(nameOf(entry)));
    case 'productionyear':
      return album?.year ?? 0;
    case 'premieredate':
      return album?.releaseDate ?? '';
    case 'datecreated':
      return createdOf(entry);
    case 'playcount':
      return playsOf(entry, view).count;
    case 'dateplayed':
      return playsOf(entry, view).last;
    case 'indexnumber':
      return entry.kind === 'track' ? entry.track.trackNumber : 0;
    case 'parentindexnumber':
      return entry.kind === 'track' ? entry.track.discNumber : 0;
    case 'runtime':
      return entry.kind === 'track'
        ? entry.track.durationMs
        : (album?.durationMs ?? 0);
    default:
      return 0;
  }
};

const isFavourite = (entry: Entry, view: UserView): boolean => {
  switch (entry.kind) {
    case 'track':
      return view.stars.tracks.has(entry.track.id);
    case 'album':
      return view.stars.media.has(entry.album.mediaId);
    case 'artist':
      return (
        !!entry.artist.mediaId && view.stars.media.has(entry.artist.mediaId)
      );
    default:
      return false;
  }
};

const artistKeys = (query: Query): Set<string> | null => {
  const ids = [
    ...csv(query.artistids),
    ...csv(query.albumartistids),
    ...csv(query.contributingartistids),
  ];
  if (!ids.length) {
    return null;
  }
  const keys = new Set<string>();
  for (const raw of ids) {
    const id = parseItemId(raw);
    if (id?.kind === 'artist') {
      keys.add(id.key);
    }
  }
  return keys;
};

const albumIds = (query: Query): Set<number> | null => {
  const ids = csv(query.albumids);
  if (!ids.length) {
    return null;
  }
  const set = new Set<number>();
  for (const raw of ids) {
    const id = parseItemId(raw);
    if (id?.kind === 'album') {
      set.add(id.id);
    }
  }
  return set;
};

const candidates = (query: Query, ctx: QueryContext): Entry[] => {
  const { index } = ctx;
  const kinds = new Set(
    csv(query.includeitemtypes)
      .map((t) => TYPE_KIND[t.toLowerCase()])
      .filter(Boolean)
  );
  const requestedTypes = csv(query.includeitemtypes).length > 0;
  const parent = parseItemId(query.parentid);

  if (parent?.kind === 'album') {
    const album = index.albumById.get(parent.id);
    return (album?.tracks ?? []).map((track) => ({ kind: 'track', track }));
  }
  if (parent?.kind === 'playlist') {
    const playlist = ctx.playlists.find((p) => p.id === parent.id);
    return playlist
      ? playlistTracksOf(playlist, index).map((x) => ({
          kind: 'track' as const,
          track: x.track,
          playlistEntryId: x.entryId,
        }))
      : [];
  }
  if (parent?.kind === 'artist') {
    const artist = index.artistByKey.get(parent.key);
    if (!artist) {
      return [];
    }
    return kinds.has('track') && !kinds.has('album')
      ? artistTracks(artist).map((track) => ({ kind: 'track', track }))
      : artist.albums.map((album) => ({ kind: 'album', album }));
  }

  // Library root (the music view, or no parent at all).
  if (requestedTypes && !kinds.size) {
    return []; // only non-music types were asked for (Movie, Series, …)
  }
  if (!kinds.size) {
    kinds.add('album');
  }
  const entries: Entry[] = [];
  if (kinds.has('artist')) {
    entries.push(
      ...index.artists.map((artist) => ({ kind: 'artist' as const, artist }))
    );
  }
  if (kinds.has('album')) {
    entries.push(
      ...index.albums.map((album) => ({ kind: 'album' as const, album }))
    );
  }
  if (kinds.has('track')) {
    entries.push(
      ...index.tracks.map((track) => ({ kind: 'track' as const, track }))
    );
  }
  if (kinds.has('playlist')) {
    entries.push(
      ...ctx.playlists.map((playlist) => ({
        kind: 'playlist' as const,
        playlist,
        tracks: playlistTracksOf(playlist, index).map((x) => x.track),
      }))
    );
  }
  return entries;
};

export interface QueryResult {
  Items: Dto[];
  TotalRecordCount: number;
  StartIndex: number;
}

export const paginate = (
  entries: Entry[],
  query: Query,
  view: UserView
): QueryResult => {
  const start = Math.max(0, Number(query.startindex) || 0);
  const limit = Number(query.limit);
  const pageItems =
    Number.isFinite(limit) && limit > 0
      ? entries.slice(start, start + limit)
      : entries.slice(start);
  return {
    Items: pageItems.map((entry) => toDto(entry, view)),
    TotalRecordCount: entries.length,
    StartIndex: start,
  };
};

export const filterAndSort = (
  input: Entry[],
  query: Query,
  ctx: QueryContext
): Entry[] => {
  const { view } = ctx;
  let entries = input;

  const excluded = new Set(
    csv(query.excludeitemtypes)
      .map((t) => TYPE_KIND[t.toLowerCase()])
      .filter(Boolean)
  );
  if (excluded.size) {
    entries = entries.filter((e) => !excluded.has(e.kind));
  }

  const artists = artistKeys(query);
  if (artists) {
    entries = entries.filter((e) => {
      if (e.kind === 'artist') {
        return artists.has(e.artist.key);
      }
      const album = albumOfEntry(e);
      return !!album && artists.has(album.artist.key);
    });
  }

  const albums = albumIds(query);
  if (albums) {
    entries = entries.filter((e) => {
      const album = albumOfEntry(e);
      return !!album && albums.has(album.mediaId);
    });
  }

  // No genre index yet: a genre filter can't match anything.
  if (query.genres || query.genreids) {
    entries = [];
  }

  const years = csv(query.years).map(Number).filter(Number.isFinite);
  if (years.length) {
    entries = entries.filter((e) => {
      const year = albumOfEntry(e)?.year;
      return year !== undefined && years.includes(year);
    });
  }

  const favouritesOnly =
    csv(query.filters).some((f) => f.toLowerCase() === 'isfavorite') ||
    query.isfavorite === 'true';
  if (favouritesOnly) {
    entries = entries.filter((e) => isFavourite(e, view));
  }

  const term = sortNameOf(query.searchterm ?? '');
  if (term) {
    const terms = term.split(/\s+/).filter(Boolean);
    entries = entries.filter((e) => {
      const album = albumOfEntry(e);
      const haystack = [
        sortNameOf(nameOf(e)),
        e.kind === 'track' ? sortNameOf(e.track.artist) : '',
        e.kind === 'track' && album ? album.sortName : '',
        album ? album.artist.sortName : '',
      ].join(' ');
      return terms.every((t) => haystack.includes(t));
    });
  }

  const prefix = sortNameOf(query.namestartswith ?? '');
  if (prefix) {
    entries = entries.filter((e) => sortNameOf(nameOf(e)).startsWith(prefix));
  }
  if (query.namestartswithorgreater) {
    const from = sortNameOf(query.namestartswithorgreater);
    entries = entries.filter((e) => sortNameOf(nameOf(e)) >= from);
  }
  if (query.namelessthan) {
    const to = sortNameOf(query.namelessthan);
    entries = entries.filter((e) => sortNameOf(nameOf(e)) < to);
  }

  const fields = csv(query.sortby).map((f) => f.toLowerCase());
  if (fields.includes('random')) {
    return shuffled(entries);
  }
  if (fields.length) {
    const orders = csv(query.sortorder).map((o) => o.toLowerCase());
    const keyed = entries.map((entry) => ({
      entry,
      keys: fields.map((field) => sortValue(entry, field, view)),
    }));
    keyed.sort((a, b) => {
      for (let i = 0; i < fields.length; i++) {
        const direction =
          (orders[i] ?? orders[0] ?? 'ascending') === 'descending' ? -1 : 1;
        const x = a.keys[i];
        const y = b.keys[i];
        const cmp =
          typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y));
        if (cmp !== 0) {
          return cmp * direction;
        }
      }
      return 0;
    });
    return keyed.map((k) => k.entry);
  }

  return entries;
};

/** `/Items` and `/Users/{id}/Items`. */
export const queryItems = (query: Query, ctx: QueryContext): QueryResult => {
  const ids = csv(query.ids);
  if (ids.length) {
    const entries = ids
      .map((raw) => resolveEntry(parseItemId(raw), ctx))
      .filter((e): e is Entry => !!e);
    return paginate(entries, query, ctx.view);
  }
  return paginate(
    filterAndSort(candidates(query, ctx), query, ctx),
    query,
    ctx.view
  );
};

export const queryArtists = (query: Query, ctx: QueryContext): QueryResult =>
  paginate(
    filterAndSort(
      ctx.index.artists.map((artist) => ({ kind: 'artist' as const, artist })),
      query,
      ctx
    ),
    query,
    ctx.view
  );
