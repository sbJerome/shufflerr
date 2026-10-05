# Integrations

Every client extends Seerr's `server/api/externalapi.ts` (axios + node-cache, timeout from
`network.apiRequestTimeout`) and registers a cache id in `server/lib/cache.ts`. All tests use
recorded fixtures. **Verify each provider's current API docs and terms before implementing** —
endpoints below are the expected shapes as of the design phase; treat them as a starting point,
not gospel.

---

## Downloads

### Lidarr (required)
- API: `http(s)://host:port[/baseUrl]/api/v1/...`, header `X-Api-Key`.
- Endpoints used: `system/status`, `qualityprofile`, `metadataprofile`, `rootfolder`, `tag`,
  `artist`, `artist/lookup?term=lidarr:<artistMbid>` (MBID search prefix — confirm), `artist/{id}`
  (PUT for monitoring), `album?artistId=`, `album/lookup?term=lidarr:<releaseGroupMbid>`,
  `album/monitor` (PUT `{albumIds, monitored}`), `command` (POST `{name:'AlbumSearch',
  albumIds}`, `{name:'ArtistSearch', artistId}`, `{name:'RefreshArtist', artistId}`), `queue`,
  `history`, `trackfile?albumId=`.
- Implement as `class LidarrAPI extends ServarrBase` overriding the API version path. Reuse
  `ServarrBase.getProfiles/getRootFolders/getTags/getQueue` where shapes match.
- **Track-level requests:** Lidarr downloads releases, not single tracks. For `tracks` scope:
  monitor + search the album; Lidarr may grab a full release (upgrading/duplicating existing
  tracks per its profile). Completion = all requested recordings present in a library. Surface
  this in the request modal copy only if it confuses users (mockup doesn't mention it).
- Scanner (`lidarr-scan`): sync monitored artists/albums → `Media` rows + `lidarrAlbumId`.
- Download sync: queue → `downloadProgress` on APPROVED requests; failed imports → FAILED.

## Metadata

### MusicBrainz (required)
- `https://musicbrainz.org/ws/2/` (or mirror) with `fmt=json`.
- Search: `artist?query=`, `release-group?query=`, `recording?query=` (Lucene syntax; escape).
- Lookup: `release-group/{mbid}?inc=artist-credits+releases`, `release/{mbid}?inc=recordings+artist-credits+labels`,
  `artist/{mbid}?inc=url-rels+tags+genres`.
- Browse: `release-group?artist={mbid}&type=album|ep|single&limit=100`.
- **Rate limit:** 1 req/s average per IP on the public server; send
  `User-Agent: Shufflerr/<version> ( <contact> )`. Implement a token bucket in the client and
  queue requests; respect 503 with backoff. Cache lookups 24 h, searches 1 h.
- Pick a canonical release per release group for tracklists: prefer the release Lidarr has; else
  official, earliest, most common country (digital), most tracks.
- Data license: core data CC0; credit MusicBrainz on About.

### Cover Art Archive
- `https://coverartarchive.org/release-group/{mbid}/front-250|front-500|front-1200` (302 to
  archive.org). Through the image proxy only; cache per `cacheImages`.

### fanart.tv (artist photos)
- `https://webservice.fanart.tv/v3/music/{artistMbid}?api_key=…` → `artistthumb`,
  `artistbackground`, `hdmusiclogo`. Optional; fall back to initials.

### Last.fm
- `https://ws.audioscrobbler.com/2.0/?method=…&api_key=…&format=json`.
- Metadata: `artist.getInfo` (bio, tags; respect bio attribution/link), `artist.getSimilar`,
  `album.getInfo`, `tag.getTopAlbums`.
- Scrobbling (per user): web auth `https://www.last.fm/api/auth/?api_key=…&cb=<url>` →
  `auth.getSession` (signed) → session key stored encrypted in `LinkedAccount`;
  `track.updateNowPlaying` and `track.scrobble` (signed POST, batch ≤ 50).

## Stream from

### Plex
- Auth/owner token from sign-in (Seerr). Server via owner's resources list (Seerr's server
  preset loader).
- Music sections: `/library/sections` → type `artist`. Items: artists (type 8), albums (type 9),
  tracks (type 10) via `/library/sections/{id}/all?type=9` etc.; `includeGuids=1` to get
  `Guid` entries (MusicBrainz `mbid://` GUIDs when the Plex music agent has matched).
- Matching order: release-group/recording MBID GUIDs → normalized artist + album title + track
  title + duration (±3 s).
- Recently added: `/library/sections/{id}/recentlyAdded`.
- Plays (recently played / scrobble source): history endpoint for the user's account, or Plex
  webhooks (Plex Pass) → `/api/v1/webhooks/plex`. Confirm music history endpoint (HANDOFF §6).
- Streaming in the web player: the track's `Part` key with the user's Plex token (or the owner
  token for Shufflerr-initiated playback) — prefer transcode URL for browser-safe codecs.

### Jellyfin
- Auth per Seerr. Items: `/Items?IncludeItemTypes=MusicAlbum|Audio&Recursive=true&Fields=ProviderIds,MediaSources&ParentId=<library>`.
- MBIDs from `ProviderIds` (`MusicBrainzReleaseGroup`, `MusicBrainzAlbum`, `MusicBrainzTrack`,
  `MusicBrainzArtist`).
- Plays: Jellyfin Webhook plugin → `/api/v1/webhooks/jellyfin`, or poll `/Sessions`; history
  via the Playback Reporting plugin if installed (optional).
- Stream: `/Audio/{id}/universal?...` with api key / user token.

### Navidrome (Subsonic / OpenSubsonic)
- Auth: `u`, `t = md5(password + s)`, `s` (salt), `v=1.16.1`, `c=Shufflerr`, `f=json`.
- Scan: `getArtists`, `getArtist`, `getAlbum`, `getAlbumList2?type=newest`, `search3`.
  OpenSubsonic responses may include `musicBrainzId` fields — use them when present.
- Stream: `stream?id=`.
- Scrobbling: Navidrome can scrobble to Last.fm/ListenBrainz itself. If a user has Navidrome
  scrobbling on, **don't double-scrobble** — add a per-source dedupe (same user + track within
  play duration) and a note on the Scrobbling page.

### Local files
- Walk folders (`fs.promises.opendir`, concurrency-limited), read tags with `music-metadata`
  (MBIDs from `MUSICBRAINZ_RELEASEGROUPID`, `MUSICBRAINZ_TRACKID` etc.), watch with `chokidar`
  when `watch` is on (debounce 5 s).
- Generate waveform peaks on scan (ffmpeg `astats`/`audiowaveform` or decode with
  `music-metadata` + downsample) — store in `Track.peaks`.
- Serve audio for the web player and the client APIs with range requests; transcode with ffmpeg
  per `clients.mobileTranscode` when asked.
- Docker: document mounting music folders read-only.

### YouTube (optional, never download)
- Data API v3 `search.list` (`type=video`, `videoCategoryId=10`, query `artist - title`) — costs
  quota (100 units per search; default 10,000/day) → cache results per recording for 30 days.
- Playback via the **IFrame Player API** in the player bar. No audio extraction, no
  downloading, no background-only playback tricks — follow YouTube API Services Terms.

## Connect your apps
See `CLIENT_API.md`.

## Discover & import

Import pipeline (all sources): parse URL → fetch album list (playlist → unique albums of its
tracks) → match to MusicBrainz by **UPC** (release barcode) → **ISRC** (recording) →
artist + title fuzzy → show results with library status → user picks → each goes through the
request engine (scope `album`) → summary toast "N approved automatically, M waiting for
approval, K not requested: <first reason>".

### Spotify
- Web API. Client credentials for public albums/playlists; per-user Authorization Code with PKCE
  for `user-library-read` (saved albums) and `playlist-read-private`.
- Album UPC: `external_ids.upc`; track ISRC: `external_ids.isrc`.
- **Check current restrictions:** Spotify limited several Web API endpoints for new apps in late
  2024 (e.g. recommendations, related artists, audio features, and some Spotify-owned editorial
  / algorithmic playlists). Design around user-owned and public user playlists + saved albums.
- Review the Spotify Developer Terms for this use (HANDOFF §6).
- Job `spotify-saved-albums-sync`: for users with linked Spotify + toggle + AUTO_REQUEST perms,
  request newly saved albums (`isAutoRequest = true`).

### Deezer
- Public API, no auth: `https://api.deezer.com/playlist/{id}`, `/album/{id}` (has `upc`),
  `/track/{id}` (has `isrc`). Handle `deezer.page.link` short links by following redirects.

### iTunes / Apple Music
- iTunes Search/Lookup API: `https://itunes.apple.com/lookup?id=<albumId>&entity=song&country=…`
  (album via `collectionId` from `music.apple.com/<cc>/album/<slug>/<id>`). UPC not exposed —
  match by artist + title (+ track count).
- Apple Music **playlists** need the Apple Music API with a MusicKit developer token (paid
  developer account) — out of scope unless the owner provides one; show a clear error for
  playlist links.
- Charts row (optional): Apple's marketing RSS feeds (most played albums by country).

### Ticketmaster
- Discovery API v2: `/discovery/v2/attractions.json?keyword=<artist>&classificationName=music`
  to resolve the artist, then `/discovery/v2/events.json?attractionId=…&countryCode=…`.
- Default quota is limited (e.g. 5,000 calls/day, a few per second) — batch per day in
  `concerts-refresh`, only for artists in the library with recent plays/requests.
- Show attribution and link to Ticketmaster event URLs; don't cache longer than allowed.

### Skiddle
- UK events API (`/api/v1/events/search/` with `api_key`, `keyword`/artist filters). Same job,
  same caching rules. Region filter: only when the user's region is GB or IE.

### ListenBrainz (trending, optional)
- Sitewide stats / "fresh releases" endpoints for the Discover trending row. Cache 6 h.

## Scrobble to

### ListenBrainz
- Per-user token (Linked accounts). Validate: `GET /1/validate-token` (Authorization:
  `Token <token>`). Submit: `POST /1/submit-listens` with `listen_type` `single` / `playing_now`
  / `import`, payload `track_metadata` (+ `additional_info.recording_mbid`,
  `release_group_mbid`, `submission_client: "Shufflerr"`).
- Server URL configurable (self-hosted ListenBrainz).

### Last.fm
- Per-user session key (Linked accounts). `track.updateNowPlaying` on start;
  `track.scrobble` when the rule passes.

### Pipeline
- Sources: web player events, client APIs (`scrobble` calls), Plex/Jellyfin webhooks or polling,
  Navidrome `getNowPlaying` polling (or skip when Navidrome scrobbles itself).
- Rule (`scrobble.rule`): `half-or-4min` (Last.fm standard), `end`, `30s`. Tracks < 30 s never
  scrobble.
- Queue table `ScrobbleQueue`; job every 30 s; retries with backoff; per-target status.
