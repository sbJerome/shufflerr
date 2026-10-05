# SV7 — client APIs (Phase 10)

Everything lives in `server/clientapi/**`; no shared file was edited.

## Decision recorded

**Native implementation of both protocols** over Shufflerr's own library index (HANDOFF §6.4,
CLIENT_API "Option A" for OpenSubsonic *and* for the Jellyfin API — no pass-through proxy).
The library an app sees is every `Track` that is `AVAILABLE` and that the shared streamer
(`server/lib/library/stream.ts`) would serve: a local file under a configured music folder, or
a copy on a media server that is switched on. Nothing is seeded or invented; an empty library
is an empty list.

## New (no Seerr source)

| Path | What |
|---|---|
| `common/library.ts` | 20-second in-memory snapshot of the playable library (artists → albums → tracks), search, format parsing (`Track.fileFormat` → suffix / bit rate / bit depth / sample rate) |
| `common/credentials.ts` | App-password sign-in on top of `server/lib/auth/appPasswords.ts`: verification cache, API-key lookup, signed Jellyfin access token, "last used" |
| `common/userData.ts` | Stars, playlists, play counts (from `ScrobbleQueue`), now-playing, hand-off to `server/lib/scrobble` (source `apps`) |
| `common/media.ts` | Cover bytes through the image proxy/cache (`coverUrlFor` → `getImageSource`), stream option mapping |
| `subsonic/*` | OpenSubsonic at `/rest` |
| `jellyfin/*` | Jellyfin-compatible API at `/jellyfin` |
| `testSupport.ts`, `subsonic/subsonic.test.ts`, `jellyfin/jellyfin.test.ts` | 65 contract tests (supertest, test SQLite, no network) |

## OpenSubsonic (`/rest`)

- Subsonic 1.16.1 envelope with `openSubsonic: true`, `type: "shufflerr"`, `serverVersion`;
  JSON, XML (default) and JSONP; `.view` suffix; GET or form POST.
- Auth: `u`+`p` (plain or `enc:`hex), `u`+`t`+`s`, and `apiKey` (the app password alone).
  Errors 10 / 40 / 41 / 43 / 44 / 50 / 70 (and 0 for unsupported calls), always HTTP 200 as
  Subsonic does. 404 while `clients.openSubsonic` is off.
- Endpoints: ping, getLicense, getOpenSubsonicExtensions (public), tokenInfo, getMusicFolders,
  getIndexes, getArtists, getArtist, getAlbum, getSong, getMusicDirectory, getAlbumList,
  getAlbumList2 (random, newest, recent, frequent, alphabeticalByName/Artist, starred, byYear,
  byGenre, highest), getRandomSongs, getSongsByGenre, getGenres, search2, search3, getCoverArt,
  stream, download, scrobble, star, unstar, getStarred, getStarred2, getPlaylists, getPlaylist,
  createPlaylist, updatePlaylist, deletePlaylist, getNowPlaying, getUser, getUsers,
  getScanStatus, getLyrics, getLyricsBySongId, getArtistInfo(2), getAlbumInfo(2), getTopSongs,
  plus empty answers for getSimilarSongs(2), getBookmarks, getPlayQueue, getPodcasts,
  getInternetRadioStations, getShares, getVideos.
- Ids: `ar-<mediaId>`, `al-<mediaId>`, `tr-<trackId>`, `pl-<id>`. Album artists without a
  MusicBrainz id get `ar-x<name hash>`.
- Extensions advertised: `formPost`, `apiKeyAuthentication`, `songLyrics`.

## Jellyfin-compatible API (`/jellyfin`)

- Public: `/System/Info/Public`, `/System/Ping`, `/Users/Public` (always empty),
  `/Branding/*`, `/QuickConnect/Enabled` (false), `/Users/AuthenticateByName`, item images.
- Signed in: `/System/Info`, `/Users`, `/Users/Me`, `/Users/{id}`, `/UserViews`,
  `/Users/{id}/Views`, `/Items` and `/Users/{id}/Items` (IncludeItemTypes MusicAlbum /
  MusicArtist / Audio / Playlist, ParentId, Ids, SortBy/SortOrder incl. Random, StartIndex/
  Limit, SearchTerm, ArtistIds/AlbumArtistIds, AlbumIds, Years, NameStartsWith,
  Filters=IsFavorite), `/Items/{id}`, `/Items/Latest`, `/Items/Counts`, `/Artists`,
  `/Artists/AlbumArtists`, `/MusicGenres`, `/Items/{id}/Images/Primary`,
  `/Audio/{id}/universal`, `/Audio/{id}/stream(.ext)`, `/Items/{id}/File`,
  `/Items/{id}/Download`, `/Items/{id}/PlaybackInfo`, `/Sessions/Playing` (+ `/Progress`,
  `/Stopped`, `/Ping`), `/Sessions/Capabilities(/Full)`, `/Playlists` (create, read, update,
  add, remove), rename/delete a playlist through `/Items/{id}`, `/UserFavoriteItems/{id}` and
  `/Users/{id}/FavoriteItems/{id}`, `*/InstantMix`, `/DisplayPreferences/{id}`.
- Token accepted from `Authorization: MediaBrowser …Token="…"`, `X-Emby-Authorization`,
  `X-Emby-Token`, `X-MediaBrowser-Token`, and `api_key` / `ApiKey`.
- Item ids are 32 hex digits, deterministic and reversible (type tag + entity id). Routes and
  parameter names are case-insensitive.

## App passwords: stored twice (tradeoff from AUTH.md)

Each app password is kept as an **argon2id hash** and as an **AES-256-GCM encrypted copy**
(key derived from `settings.serverSecret`). The encrypted copy exists only because Subsonic
token auth (`t = md5(password + salt)`) cannot be checked against a hash; the API-key lookup
uses it too, because an API key arrives without a username. Consequence: someone holding
both `settings.json` and the database can recover app passwords. They cannot recover account
passwords, an app password only opens `/rest` and `/jellyfin`, and revoking it (deleting the
row) cuts off every client and every Jellyfin token issued for it at the next request.

The Jellyfin access token is `hex(appPasswordId)` + HMAC-SHA256 over the row, keyed with the
server secret. Nothing is stored (the `AppPassword.accessToken` column is unused).

## Deviations / limits

- **Genres** are not indexed anywhere in the data model, so genre lists are empty and a genre
  filter matches nothing.
- **Lyrics, ratings, bookmarks, play queue, shares, artist photos**: not stored; the calls
  answer empty (or 404 for images) rather than with made-up data.
- `stream` ignores `timeOffset` (the `transcodeOffset` extension is not advertised) — the
  shared streamer has no seek-while-transcoding option.
- Jellyfin transcodes target MP3 or Opus only (what `StreamOptions` offers); HLS
  (`main.m3u8`) is not implemented, apps fall back to progressive streaming.
- Album artists get an artist `Media` row created on first listing when one is missing, so
  `ar-<mediaId>` stays stable. That is the only write a read endpoint makes.
- Jellyfin images are readable without a token, as on a real Jellyfin server.
- `server/lib/library/stream.ts` takes a track **id** (not a Track entity); used as is.

## Not verified

- No real phone or desktop app was run (Symfonium, Finamp, Feishin, Amperfy, Jellify). The
  APIs were exercised with curl against the running server and by the contract tests. The
  Jellyfin subset was written from the published API, not from captured client traffic.
- Proxying from Plex / Jellyfin / Navidrome sources was not exercised here (stream SV3 owns
  it); only local files were streamed.
