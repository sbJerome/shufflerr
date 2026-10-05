# Client APIs (Connect your apps)

Goal: any OpenSubsonic or Jellyfin music app can browse and play the Shufflerr library.
Tested list from the mockup: **Symfonium** (OpenSubsonic, Jellyfin), **Finamp** (Jellyfin),
**Feishin** (OpenSubsonic, Jellyfin), **Amperfy** (OpenSubsonic), **Jellify** (Jellyfin).

This is the largest optional piece. Build it last (Phase 10).

## Decision: native vs. proxy

| Option | Pros | Cons |
|---|---|---|
| A. Native implementation over Shufflerr's own library index (Media/Track + file/stream sources) | One library across Plex/Jellyfin/Navidrome/local; app passwords; scrobbling built in | Large surface area; streaming/transcoding to implement |
| B. Proxy to an existing server (Navidrome for Subsonic, Jellyfin for Jellyfin API) | Small; mature | Only works when that server exists; users need accounts there; no unified library |

**Recommended:** A for OpenSubsonic (well-specified, smaller), backed by local files and
Navidrome/Plex/Jellyfin stream URLs; B (pass-through) as a stop-gap for the Jellyfin API until a
native subset is done. Record the choice in CHANGES.md.

## OpenSubsonic (mount at `/rest`)

- Spec: Subsonic API 1.16.1 + OpenSubsonic extensions (opensubsonic.netlify.app). Return
  `openSubsonic: true`, `type: "shufflerr"`, `serverVersion`.
- Auth: `u` + (`p` | `t`+`s`) using **app passwords**; support the `apiKey` extension for clients
  that send it. Token auth needs the plaintext secret → store app passwords twice: argon2 hash
  (for `p=`/apiKey) and AES-GCM encrypted copy (for `t=md5(secret+salt)`). Explain in
  CHANGES.md.
- Minimum endpoint set for the tested clients:
  `ping`, `getLicense`, `getOpenSubsonicExtensions`, `getMusicFolders`, `getIndexes`,
  `getArtists`, `getArtist`, `getAlbum`, `getSong`, `getAlbumList2`, `getRandomSongs`,
  `search3`, `getCoverArt` (via image proxy/cache), `stream` (range + optional transcode with
  `format`/`maxBitRate`), `download` (if `allowDownloads`), `scrobble`, `star`/`unstar`,
  `getStarred2`, `getPlaylists`/`getPlaylist`/`createPlaylist`/`updatePlaylist`/`deletePlaylist`,
  `getNowPlaying`, `getUser`, `getGenres`, `getLyricsBySongId` (extension, optional).
- IDs: stable opaque ids (`ar-<id>`, `al-<id>`, `tr-<id>`); include `musicBrainzId` fields.
- Errors: Subsonic error codes (10, 40, 50, 70) with JSON and XML response formats (`f=json`
  default xml).
- Playlists/stars need tables: `Playlist`, `PlaylistItem`, `Star` (add in Phase 10).
- `scrobble` → ScrobbleQueue (source `apps`).

## Jellyfin-compatible API (mount at `/jellyfin`)

- Clients expect `/System/Info/Public`, `/Users/AuthenticateByName`, `/Users/{id}/Views`,
  `/Items` (MusicAlbum, MusicArtist, Audio with filters/sorting/paging), `/Items/{id}`,
  `/Items/{id}/Images/Primary`, `/Audio/{id}/universal` and `/Audio/{id}/stream`,
  `/Sessions/Playing`, `/Sessions/Playing/Progress`, `/Sessions/Playing/Stopped` (→ scrobbles),
  `/Playlists`, `/UserFavoriteItems/{id}`, `/Artists`, `/MusicGenres`.
- Auth: `Authorization: MediaBrowser Client=…, Device=…, DeviceId=…, Version=…, Token=…`.
  `AuthenticateByName` accepts username + app password; returns an access token tied to the
  app password row.
- Implement only what Finamp and Jellify call (capture their requests against a real Jellyfin
  with a proxy first; write fixtures from that).

## Admin + user UI (already in mockup)

- Admin → Apps and devices: API switches, endpoints with Copy, transcode quality, tested apps,
  connected devices with Revoke.
- User → Settings → App passwords: server URL, username, create/revoke.

## Testing

- Contract tests per endpoint against recorded client requests.
- Manual matrix: Symfonium (both protocols), Feishin (both), Amperfy, Finamp, Jellify —
  sign in, browse, search, play, seek, scrobble, offline download.
