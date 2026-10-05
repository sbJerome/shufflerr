import { usernameOf } from '@server/clientapi/common/credentials';
import type {
  LibAlbum,
  LibArtist,
  LibTrack,
} from '@server/clientapi/common/library';
import type { PlayStats, UserStars } from '@server/clientapi/common/userData';
import type Playlist from '@server/entity/Playlist';
import type { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import {
  VIEW_ID,
  albumItemId,
  artistItemId,
  playlistItemId,
  serverId,
  trackItemId,
  userItemId,
} from './ids';

export type Dto = Record<string, unknown>;

export interface UserView {
  stars: UserStars;
  plays: Map<number, PlayStats>;
}

/** Jellyfin durations are in 100 ns ticks. */
export const TICKS_PER_MS = 10000;
const ticks = (ms: number): number => Math.round(ms * TICKS_PER_MS);
const iso = (date: Date): string => new Date(date).toISOString();

const userData = (
  key: string,
  itemId: string,
  favourite: boolean,
  plays?: { count: number; last?: Date }
): Dto => ({
  PlaybackPositionTicks: 0,
  PlayCount: plays?.count ?? 0,
  IsFavorite: favourite,
  LastPlayedDate: plays?.last ? iso(plays.last) : undefined,
  Played: (plays?.count ?? 0) > 0,
  Key: key,
  ItemId: itemId,
});

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

const artistRef = (artist: LibArtist): Dto => ({
  Name: artist.name,
  Id: artistItemId(artist.key),
});

const codecOf = (suffix: string): string =>
  ({ m4a: 'aac', ogg: 'vorbis', wv: 'wavpack' })[suffix] ?? suffix;

export const mediaSourceOf = (track: LibTrack): Dto => {
  const bitrate = track.bitRate ? track.bitRate * 1000 : undefined;
  return {
    Protocol: 'File',
    Id: trackItemId(track.id),
    Type: 'Default',
    Container: track.suffix || undefined,
    Name: track.title,
    IsRemote: false,
    RunTimeTicks: track.durationMs ? ticks(track.durationMs) : undefined,
    SupportsTranscoding: true,
    SupportsDirectStream: true,
    SupportsDirectPlay: true,
    IsInfiniteStream: false,
    RequiresOpening: false,
    RequiresClosing: false,
    Bitrate: bitrate,
    MediaStreams: [
      {
        Codec: track.suffix ? codecOf(track.suffix) : undefined,
        Type: 'Audio',
        Index: 0,
        IsDefault: true,
        IsExternal: false,
        BitRate: bitrate,
        BitDepth: track.bitDepth,
        SampleRate: track.sampleRate,
      },
    ],
    MediaAttachments: [],
    Formats: [],
  };
};

export const trackDto = (track: LibTrack, view: UserView): Dto => {
  const album = track.album;
  const id = trackItemId(track.id);
  const stats = view.plays.get(track.id);
  return {
    Name: track.title,
    ServerId: serverId(),
    Id: id,
    DateCreated: iso(track.created),
    CanDownload: getSettings().clients.allowDownloads,
    Container: track.suffix || undefined,
    SortName: track.sortName,
    PremiereDate: album.releaseDate
      ? premiereDate(album.releaseDate)
      : undefined,
    ChannelId: null,
    RunTimeTicks: track.durationMs ? ticks(track.durationMs) : undefined,
    ProductionYear: album.year,
    IndexNumber: track.trackNumber || undefined,
    ParentIndexNumber: track.discNumber,
    IsFolder: false,
    ParentId: albumItemId(album.mediaId),
    Type: 'Audio',
    MediaType: 'Audio',
    LocationType: 'FileSystem',
    Genres: [],
    GenreItems: [],
    ProviderIds: {
      ...(track.recordingMbid
        ? { MusicBrainzRecording: track.recordingMbid }
        : {}),
      MusicBrainzReleaseGroup: album.mbid,
      ...(album.artist.mbid
        ? { MusicBrainzAlbumArtist: album.artist.mbid }
        : {}),
    },
    UserData: userData(id, id, view.stars.tracks.has(track.id), {
      count: stats?.count ?? 0,
      last: stats?.lastPlayed,
    }),
    Artists: [track.artist],
    ArtistItems: [artistRef(album.artist)],
    Album: album.name,
    AlbumId: albumItemId(album.mediaId),
    AlbumPrimaryImageTag: album.mbid.replace(/-/g, ''),
    AlbumArtist: album.artist.name,
    AlbumArtists: [artistRef(album.artist)],
    ImageTags: { Primary: album.mbid.replace(/-/g, '') },
    BackdropImageTags: [],
    MediaSources: [mediaSourceOf(track)],
    MediaStreams: (mediaSourceOf(track).MediaStreams as Dto[]) ?? [],
  };
};

const premiereDate = (release: string): string | undefined => {
  const padded =
    release.length === 4
      ? `${release}-01-01`
      : release.length === 7
        ? `${release}-01`
        : release;
  const date = new Date(`${padded}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

export const albumDto = (album: LibAlbum, view: UserView): Dto => {
  const id = albumItemId(album.mediaId);
  return {
    Name: album.name,
    ServerId: serverId(),
    Id: id,
    DateCreated: iso(album.created),
    SortName: album.sortName,
    PremiereDate: album.releaseDate
      ? premiereDate(album.releaseDate)
      : undefined,
    ChannelId: null,
    RunTimeTicks: album.durationMs ? ticks(album.durationMs) : undefined,
    ProductionYear: album.year,
    IsFolder: true,
    ParentId: artistItemId(album.artist.key),
    Type: 'MusicAlbum',
    MediaType: 'Unknown',
    LocationType: 'FileSystem',
    Genres: [],
    GenreItems: [],
    ChildCount: album.tracks.length,
    SongCount: album.tracks.length,
    RecursiveItemCount: album.tracks.length,
    ProviderIds: {
      MusicBrainzReleaseGroup: album.mbid,
      ...(album.artist.mbid
        ? { MusicBrainzAlbumArtist: album.artist.mbid }
        : {}),
    },
    UserData: userData(
      id,
      id,
      view.stars.media.has(album.mediaId),
      albumPlays(album, view)
    ),
    Artists: [album.artist.name],
    ArtistItems: [artistRef(album.artist)],
    AlbumArtist: album.artist.name,
    AlbumArtists: [artistRef(album.artist)],
    ImageTags: { Primary: album.mbid.replace(/-/g, '') },
    BackdropImageTags: [],
  };
};

export const artistDto = (artist: LibArtist, view: UserView): Dto => {
  const id = artistItemId(artist.key);
  return {
    Name: artist.name,
    ServerId: serverId(),
    Id: id,
    DateCreated: iso(artist.created),
    SortName: artist.sortName,
    ChannelId: null,
    IsFolder: true,
    Type: 'MusicArtist',
    MediaType: 'Unknown',
    LocationType: 'FileSystem',
    Genres: [],
    GenreItems: [],
    AlbumCount: artist.albums.length,
    SongCount: artist.albums.reduce((sum, a) => sum + a.tracks.length, 0),
    ProviderIds: artist.mbid ? { MusicBrainzArtist: artist.mbid } : {},
    UserData: userData(
      id,
      id,
      !!artist.mediaId && view.stars.media.has(artist.mediaId)
    ),
    // No artist photos are indexed; clients fall back to their placeholder.
    ImageTags: {},
    BackdropImageTags: [],
  };
};

export const playlistDto = (playlist: Playlist, tracks: LibTrack[]): Dto => {
  const id = playlistItemId(playlist.id);
  const duration = tracks.reduce((sum, t) => sum + t.durationMs, 0);
  return {
    Name: playlist.name,
    ServerId: serverId(),
    Id: id,
    DateCreated: iso(playlist.createdAt),
    SortName: playlist.name.toLowerCase(),
    ChannelId: null,
    RunTimeTicks: duration ? ticks(duration) : undefined,
    IsFolder: true,
    Type: 'Playlist',
    MediaType: 'Audio',
    LocationType: 'FileSystem',
    ChildCount: tracks.length,
    CanDelete: true,
    Overview: playlist.comment ?? undefined,
    UserData: userData(id, id, false),
    ImageTags: tracks.length
      ? { Primary: tracks[0].album.mbid.replace(/-/g, '') }
      : {},
    BackdropImageTags: [],
  };
};

export const viewDto = (): Dto => ({
  Name: 'Music',
  ServerId: serverId(),
  Id: VIEW_ID,
  Etag: VIEW_ID,
  DateCreated: new Date(0).toISOString(),
  CanDelete: false,
  CanDownload: false,
  SortName: 'music',
  ChannelId: null,
  IsFolder: true,
  Type: 'CollectionFolder',
  CollectionType: 'music',
  LocationType: 'FileSystem',
  MediaType: 'Unknown',
  UserData: userData(VIEW_ID, VIEW_ID, false),
  ImageTags: {},
  BackdropImageTags: [],
});

export const userDto = (user: User): Dto => {
  const admin = user.hasPermission(Permission.ADMIN);
  const downloads = getSettings().clients.allowDownloads;
  return {
    Name: usernameOf(user),
    ServerId: serverId(),
    Id: userItemId(user.id),
    HasPassword: true,
    HasConfiguredPassword: true,
    HasConfiguredEasyPassword: false,
    EnableAutoLogin: false,
    Configuration: {
      PlayDefaultAudioTrack: true,
      SubtitleLanguagePreference: '',
      DisplayMissingEpisodes: false,
      GroupedFolders: [],
      SubtitleMode: 'Default',
      DisplayCollectionsView: false,
      EnableLocalPassword: false,
      OrderedViews: [],
      LatestItemsExcludes: [],
      MyMediaExcludes: [],
      HidePlayedInLatest: false,
      RememberAudioSelections: true,
      RememberSubtitleSelections: true,
      EnableNextEpisodeAutoPlay: true,
    },
    Policy: {
      IsAdministrator: admin,
      IsHidden: true,
      IsDisabled: false,
      EnableUserPreferenceAccess: true,
      EnableRemoteControlOfOtherUsers: false,
      EnableSharedDeviceControl: false,
      EnableRemoteAccess: true,
      EnableLiveTvManagement: false,
      EnableLiveTvAccess: false,
      EnableMediaPlayback: true,
      EnableAudioPlaybackTranscoding: true,
      EnableVideoPlaybackTranscoding: false,
      EnablePlaybackRemuxing: true,
      EnableContentDeletion: false,
      EnableContentDownloading: downloads,
      EnableSyncTranscoding: downloads,
      EnableMediaConversion: false,
      EnableAllDevices: true,
      EnableAllChannels: false,
      EnableAllFolders: true,
      EnablePublicSharing: false,
      BlockedTags: [],
      EnabledFolders: [],
      AuthenticationProviderId: 'Shufflerr.AppPasswords',
      PasswordResetProviderId: 'Shufflerr.AppPasswords',
      SyncPlayAccess: 'None',
    },
  };
};

export const favouriteDto = (
  itemId: string,
  favourite: boolean,
  plays?: { count: number; last?: Date }
): Dto => userData(itemId, itemId, favourite, plays);
