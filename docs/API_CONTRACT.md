# API contract

The HTTP contract between the server streams and the front end. Server agents implement it;
front-end agents code against it. **Types are the source of truth** — every response/body name
below is a TypeScript type you can import:

| Types | File |
|---|---|
| `ArtistResult`, `AlbumResult`, `TrackResult`, `AlbumTrack`, `AlbumDetails`, `ArtistDetails`, `SearchResults`, `SourcedList<T>`, `ConcertResult`, `PlayResult`, `RequestSummary`, `MediaInfoSummary`, `ExternalLink` | `server/models/music.ts` |
| `MediaRequestBody`, `DryRunResult`, `RequestResult`, `RequestResultsResponse`, `RequestCountResponse`, `RequestFilter`, `MediaRequestUpdateBody`, `DeclineBody` | `server/interfaces/api/requestInterfaces.ts` |
| `Discover*Response`, `WatchlistResponse` | `server/interfaces/api/discoverInterfaces.ts` |
| `MediaResultsResponse`, `SlideshowResponse`, `LibraryArtistsResponse`, `LibraryAlbumsResponse`, `DownloadingItem` | `server/interfaces/api/mediaInterfaces.ts` |
| `ServiceCommonServer`, `ServiceCommonServerWithDetails`, `LidarrTestResponse`, `LidarrServerStatus`, `MetadataProfile` | `server/interfaces/api/serviceInterfaces.ts` |
| `QuotaResponse`, `UserResultsResponse`, `UserRequestsResponse`, `UserRecentlyPlayedResponse`, `CreateUserBody`, `BulkPermissionsBody`, `ImportableUser` | `server/interfaces/api/userInterfaces.ts` |
| `UserSettings*Response`, `LinkedAccountStatus`, `AppPasswordItem`, `AppPasswordCreatedResponse`, `UserNotificationChannel` | `server/interfaces/api/userSettingsInterfaces.ts` |
| `PublicSettingsResponse`, `*SettingsResponse`, `ScanStatus`, `ScanCommandBody`, `ConnectionTestResponse`, `PlexServerPreset`, `JobItem`, `CacheResponse`, `LogsResultsResponse`, `SettingsAboutResponse`, `ClientDevice`, `NotificationAgentResponse`, `StatusResponse` | `server/interfaces/api/settingsInterfaces.ts` |
| `ImportResolveResponse`, `ImportMatch`, `ImportRequestResponse`, `ImportSourcesResponse`, `ImportSpotifySavedResponse`, `ImportJobSummary` | `server/interfaces/api/importInterfaces.ts` |
| `TrackPlaybackInfo`, `TrackPeaksResponse`, `ScrobbleBody`, `ScrobbleResponse`, `ScrobbleStatusResponse`, `YoutubeTrackResponse` | `server/interfaces/api/playbackInterfaces.ts` |
| Settings section shapes (`MainSettings`, `PlexSettings`, `LidarrSettings`, `MetadataSettings`, `DiscoverSettings`, …), `FullPublicSettings`, `EnabledIntegrations`, `JobId` | `server/lib/settings/index.ts` |
| `Permission`, `hasPermission` | `server/lib/permissions.ts` |
| `MediaStatus`, `MediaRequestStatus`, `MediaType`, `RequestScope`, UI label maps | `server/constants/media.ts` |
| `NotificationTypeKey`, `MUSIC_NOTIFICATION_TYPES`, `MANAGER_NOTIFICATION_TYPES`, `typesToMask`, `maskToTypes` | `server/lib/notifications/types.ts` |
| Entities (`Media`, `Track`, `MediaRequest`, `TrackRequest`, `User`, …) | `server/entity/*` |

The client imports these with the `@server/...` alias exactly as Seerr's client does (types only).

## Conventions (apply to every route)

- **Base path** `/api/v1`. JSON in, JSON out. Dates are ISO strings.
- **Auth**: session cookie from `/auth/*`, or `X-Api-Key: <main.apiKey>` (acts as the owner; add
  `X-API-User: <id>` to act as someone else). "signed in" = any authenticated user.
- **Errors**: non-2xx responses are `{ "message": string, "errors"?: string[] }`. `message` is
  user-facing copy written per the copy rules (what happened + how to fix it) — the UI shows it
  as is. 403 from the auth middleware is `{ status: 403, error: string }` (Seerr).
- **No sample data, ever.** When a source is off or has nothing, lists are empty. Optional rows
  return `SourcedList<T>` = `{ enabled, reason?, results }`; the UI hides a row when
  `enabled` is false and shows the empty state when `results` is empty.
- **What is switched on** comes from `GET /settings/public` → `integrations`
  (`EnabledIntegrations`), `importEnabled`, `concertsEnabled`, `plexLoginEnabled`,
  `jellyfinLoginEnabled`, `localLogin`, `allowTrackRequests`, `initialized`. Use it for the rail
  (Import item), login buttons, YouTube fill, linked-account rows.
- **Images** are always same-origin image-proxy paths or `null`:
  `/imageproxy/<type>/<path>` with `<type>` ∈ `caa` (coverartarchive.org, e.g.
  `/imageproxy/caa/release-group/<mbid>/front-250|front-500|front-1200`), `fanart`, `lastfm`,
  `spotify`, `deezer`, `itunes`, `ticketmaster`, `skiddle`, `youtube`, plus `plex`, `jellyfin`,
  `navidrome` registered by SV3 (`registerImageSource()` in `server/lib/imageSources.ts`).
  A proxy URL may 404 (no art exists) → show the tinted placeholder slot. User avatars:
  `/avatarproxy/<id>` (Seerr).
- **Paging**: Seerr's `take`/`skip` → `{ pageInfo: { pages, page, results, pageSize }, results }`.
- **Secrets** in settings GETs are masked as `••••` + last 4. POST the masked value back
  unchanged to keep the stored secret; a new value replaces it; `''` clears it
  (`maskSecrets` / `mergeWithSecrets` / `resolveSecret` in `server/lib/settings`).
- **Notification types** travel as string keys (`pending`, `autoApproved`, `approved`,
  `declined`, `available`, `failed`); they are stored as Seerr's bitmask — convert with
  `typesToMask` / `maskToTypes`.
- **Statuses**: `MediaStatus` 1 UNKNOWN "Not in library", 2 PENDING, 3 PROCESSING, 4
  PARTIALLY_AVAILABLE, 5 AVAILABLE, 6 BLOCKLISTED, 7 DELETED. `MediaRequestStatus` 1 PENDING,
  2 APPROVED, 3 DECLINED, 4 FAILED, 5 COMPLETED. Labels: `MEDIA_STATUS_LABEL`,
  `REQUEST_STATUS_LABEL`.
- **Playback**: a track is playable when it has a Track row `id` and `playable: true`; the audio
  URL is `/api/v1/stream/track/<id>`, waveform at `…/peaks`.
- **Unimplemented routes** answer `501 { message: "Not implemented", stream }` until the owning
  stream lands (`notImplemented()` in `server/routes/_stub.ts`).
- Client APIs for music apps live outside `/api/v1`: `/rest/*` (OpenSubsonic) and `/jellyfin/*`
  (Jellyfin-compatible) — stream SV7, see `docs/CLIENT_API.md`.

## Request engine outcome → UI copy

`POST /request?dryRun=1` → `DryRunResult`:
`auto` → "This will be approved automatically and sent to Lidarr right away." ·
`pending` → "An admin will need to approve this before it downloads." ·
`blocked` → show `reason`.

## SV1 — metadata and browse

| Method | Path | Permission | Query / body | Response | Notes |
|---|---|---|---|---|---|
| GET | `/api/v1/search` | signed in | query `query` (required), `type`=all|artist|album|track (default all), `page` (1), `pageSize` (20) | SearchResults | Library status merged in; MusicBrainz ≤1 rps so results are cached 1 h |
| GET | `/api/v1/artist/:mbid` | signed in | — | ArtistDetails | Discography carries status + active request per release group; `similar` empty unless Last.fm is on |
| POST | `/api/v1/artist/:mbid/watch` | MANAGE_REQUESTS | body `{enabled}` | `{enabled}` | Lidarr "monitor new items" for the artist; state is `ArtistDetails.lidarr.monitorNewItems`. 409 when the artist is not in Lidarr yet; 502 when Lidarr refuses |
| GET | `/api/v1/album/:mbid` | signed in | — | AlbumDetails | Release-group MBID. Syncs the canonical tracklist into Track rows so every track has an `id` |
| GET | `/api/v1/recording/:mbid` | signed in | — | TrackResult |  |
| GET | `/api/v1/discover/stats` | signed in | — | DiscoverStatsResponse | Real counts from the library index |
| GET | `/api/v1/discover/featured` | signed in | — | DiscoverFeaturedResponse | `album: null` when there is nothing real to feature |
| GET | `/api/v1/discover/recently-added` | signed in (RECENT_VIEW; otherwise `enabled:false`) | query `take` (20) | DiscoverAlbumsResponse | From Media.mediaAddedAt |
| GET | `/api/v1/discover/trending` | signed in | query `take` (20) | DiscoverAlbumsResponse | ListenBrainz most-played new releases; when that is off and iTunes is on, the iTunes chart matched to MusicBrainz (cached 6 h; a `reason` line while matching is still running). `enabled:false` when both are off |
| GET | `/api/v1/discover/popular-artists` | signed in | query `take` (20) | DiscoverArtistsResponse | Library artists ranked by plays/requests; ListenBrainz sitewide when on |
| GET | `/api/v1/discover/recent-requests` | signed in | query `take` (10) | DiscoverRecentRequestsResponse | Own requests unless REQUEST_VIEW / MANAGE_REQUESTS |
| GET | `/api/v1/discover/concerts` | signed in | query `take` (20) | DiscoverConcertsResponse | Reads the Event cache (filled by SV6 `concerts-refresh`), filtered by the viewer's region |
| GET | `/api/v1/library/artists` | signed in | query `page`, `pageSize` (48), `sort`=name|added|albums, `q` | LibraryArtistsResponse | Rail → Artists |
| GET | `/api/v1/library/albums` | signed in | query `page`, `pageSize` (48), `sort`=added|title|artist|year, `filter`=all|available|partial|processing, `q`, `artistMbid` | LibraryAlbumsResponse | Rail → Albums |
| GET | `/api/v1/media` | signed in | query `take`, `skip`, `filter`=all|available|partial|allavailable|processing|pending, `sort`=added|modified|mediaAdded, `mediaType` | MediaResultsResponse | Seerr-style list |
| GET | `/api/v1/media/:id` | signed in | — | Media (with requests, tracks) |  |
| POST | `/api/v1/media/:id/:status` | MANAGE_REQUESTS | `status`=available|partial|processing|pending|unknown | Media | Backlog Manage panel: mark available / clear |
| DELETE | `/api/v1/media/:id` | MANAGE_REQUESTS | — | 204 | Clear data (reset the Media row) |
| DELETE | `/api/v1/media/:id/lidarr` | MANAGE_REQUESTS | query `deleteFiles`=0|1 | 204 | Remove the album/artist from Lidarr (optionally with its files). Offer it when `details.lidarr.canRemove`. 409 when not in Lidarr |
| GET | `/api/v1/public/slideshow` | public | query `take` (70) | SlideshowResponse | Login background: recently added cover URLs only. Empty array on an empty library |

## SV2 — Lidarr and requests

| Method | Path | Permission | Query / body | Response | Notes |
|---|---|---|---|---|---|
| POST | `/api/v1/request` | signed in | body MediaRequestBody; `?dryRun=1` (or body `dryRun:true`) | 201 RequestResult · dry run: 200 DryRunResult | Errors: 403 RequestPermissionError / QuotaRestrictedError, 409 DuplicateMediaRequestError, 403 BlocklistedMediaError — body `{message}` is the user-facing copy. A dry run never errors for engine outcomes: it returns `{outcome:"blocked",reason,code}` |
| GET | `/api/v1/request` | signed in | query `take` (20), `skip`, `filter` RequestFilter, `sort`=added|modified, `sortDirection`=asc|desc, `requestedBy` (user id), `scope` | RequestResultsResponse | Only own requests without MANAGE_REQUESTS / REQUEST_VIEW |
| GET | `/api/v1/request/count` | signed in | — | RequestCountResponse | Scoped the same way as the list |
| GET | `/api/v1/request/:id` | signed in | — | RequestResult | 403 when not yours and no view permission |
| PUT | `/api/v1/request/:id` | MANAGE_REQUESTS, or requester while pending | body MediaRequestUpdateBody | RequestResult |  |
| DELETE | `/api/v1/request/:id` | requester (pending only) or MANAGE_REQUESTS | — | 204 | Media status is recalculated |
| POST | `/api/v1/request/:id/retry` | MANAGE_REQUESTS | — | RequestResult | Only FAILED → APPROVED; re-sends to Lidarr |
| POST | `/api/v1/request/:id/:status` | MANAGE_REQUESTS | `status`=approve|decline; body DeclineBody (optional) | RequestResult | 400 "Only pending requests can be approved or declined." |
| GET | `/api/v1/service/lidarr` | signed in | — | ServiceCommonServer[] | No secrets |
| GET | `/api/v1/service/lidarr/:id` | signed in | — | ServiceCommonServerWithDetails | Profiles, metadata profiles, root folders, tags for the request modal |
| GET | `/api/v1/settings/lidarr` | MANAGE_SETTINGS | — | LidarrSettingsResponse | apiKey masked; `status` = live connection check |
| POST | `/api/v1/settings/lidarr` | MANAGE_SETTINGS | body LidarrSettings (no id) | LidarrSettings | Exactly one default; at most one default hi-res |
| POST | `/api/v1/settings/lidarr/test` | MANAGE_SETTINGS | body `{hostname, port, apiKey, useSsl, baseUrl, id?}` (masked apiKey + id = use stored key) | LidarrTestResponse |  |
| PUT | `/api/v1/settings/lidarr/:id` | MANAGE_SETTINGS | body LidarrSettings | LidarrSettings |  |
| GET | `/api/v1/settings/lidarr/:id/profiles` | MANAGE_SETTINGS | — | QualityProfile[] |  |
| DELETE | `/api/v1/settings/lidarr/:id` | MANAGE_SETTINGS | — | LidarrSettings (removed) |  |

## SV3 — library, scanners, streaming

| Method | Path | Permission | Query / body | Response | Notes |
|---|---|---|---|---|---|
| GET | `/api/v1/stream/track/:trackId` | signed in | Range header; query `format`=original|opus-160|mp3-320|mp3-128 | audio bytes (206/200) | Local file first, else proxied from Plex / Jellyfin / Navidrome. 404 when not playable |
| GET | `/api/v1/stream/track/:trackId/peaks` | signed in | — | TrackPeaksResponse | `peaks: []` when none (UI draws a flat bar) |
| GET | `/api/v1/stream/track/:trackId/info` | signed in | — | TrackPlaybackInfo | Everything the player bar shows for a track |
| GET | `/api/v1/settings/plex` | MANAGE_SETTINGS | — | PlexSettingsResponse | Secrets masked |
| POST | `/api/v1/settings/plex` | MANAGE_SETTINGS | body partial section (connection fields, `enabled`) | PlexSettingsResponse | Validates the connection before saving |
| POST | `/api/v1/settings/plex/test` | MANAGE_SETTINGS | body connection fields (optional; default = stored) | ConnectionTestResponse |  |
| GET | `/api/v1/settings/plex/library` | MANAGE_SETTINGS | query `sync`=1 to re-fetch from the server | Library[] | Music libraries only |
| PUT | `/api/v1/settings/plex/library/:libraryId` | MANAGE_SETTINGS | body `{enabled}` | Library[] |  |
| POST | `/api/v1/settings/plex/library/sync` | MANAGE_SETTINGS | — | Library[] | "Sync libraries" |
| GET | `/api/v1/settings/plex/sync` | MANAGE_SETTINGS | — | ScanStatus | Library scan panel |
| POST | `/api/v1/settings/plex/sync` | MANAGE_SETTINGS | body ScanCommandBody | ScanStatus |  |
| GET | `/api/v1/settings/plex/users` | MANAGE_USERS | — | ImportableUser[] | Users with access who have no Shufflerr account yet |
| GET | `/api/v1/settings/jellyfin` | MANAGE_SETTINGS | — | JellyfinSettingsResponse | Secrets masked |
| POST | `/api/v1/settings/jellyfin` | MANAGE_SETTINGS | body partial section (connection fields, `enabled`) | JellyfinSettingsResponse | Validates the connection before saving |
| POST | `/api/v1/settings/jellyfin/test` | MANAGE_SETTINGS | body connection fields (optional; default = stored) | ConnectionTestResponse |  |
| GET | `/api/v1/settings/jellyfin/library` | MANAGE_SETTINGS | query `sync`=1 to re-fetch from the server | Library[] | Music libraries only |
| PUT | `/api/v1/settings/jellyfin/library/:libraryId` | MANAGE_SETTINGS | body `{enabled}` | Library[] |  |
| POST | `/api/v1/settings/jellyfin/library/sync` | MANAGE_SETTINGS | — | Library[] | "Sync libraries" |
| GET | `/api/v1/settings/jellyfin/sync` | MANAGE_SETTINGS | — | ScanStatus | Library scan panel |
| POST | `/api/v1/settings/jellyfin/sync` | MANAGE_SETTINGS | body ScanCommandBody | ScanStatus |  |
| GET | `/api/v1/settings/jellyfin/users` | MANAGE_USERS | — | ImportableUser[] | Users with access who have no Shufflerr account yet |
| GET | `/api/v1/settings/plex/devices/servers` | MANAGE_SETTINGS | — | PlexServerPreset[] | "Load servers from plex.tv" (owner token) |
| GET | `/api/v1/settings/navidrome` | MANAGE_SETTINGS | — | NavidromeSettingsResponse | password masked |
| POST | `/api/v1/settings/navidrome` | MANAGE_SETTINGS | body partial NavidromeSettings | NavidromeSettingsResponse |  |
| POST | `/api/v1/settings/navidrome/test` | MANAGE_SETTINGS | body `{url, username, password}` (optional) | ConnectionTestResponse |  |
| GET | `/api/v1/settings/navidrome/sync` | MANAGE_SETTINGS | — | ScanStatus |  |
| POST | `/api/v1/settings/navidrome/sync` | MANAGE_SETTINGS | body ScanCommandBody | ScanStatus |  |
| GET | `/api/v1/settings/local` | MANAGE_SETTINGS | — | LocalFilesSettingsResponse |  |
| POST | `/api/v1/settings/local` | MANAGE_SETTINGS | body `{enabled, watch, rescanMinutes}` | LocalFilesSettingsResponse |  |
| POST | `/api/v1/settings/local/folders` | MANAGE_SETTINGS | body `{path}` | LocalFolderCheckResponse | 400 with `message` when the path does not start with /, does not exist or is not readable |
| DELETE | `/api/v1/settings/local/folders` | MANAGE_SETTINGS | body `{path}` | LocalFilesSettingsResponse |  |
| GET | `/api/v1/settings/local/sync` | MANAGE_SETTINGS | — | ScanStatus |  |
| POST | `/api/v1/settings/local/sync` | MANAGE_SETTINGS | body ScanCommandBody | ScanStatus |  |
| GET | `/api/v1/settings/local/unresolved` | MANAGE_SETTINGS | — | LocalUnresolvedResponse | Albums in the folders MusicBrainz could not identify (not indexed; retried weekly or when files change) |

## SV4 — auth and users

| Method | Path | Permission | Query / body | Response | Notes |
|---|---|---|---|---|---|
| GET | `/api/v1/auth/me` | signed in | — | User (+ `warnings`, `settings`) |  |
| POST | `/api/v1/auth/plex` | public (rate-limited) | body `{authToken}` | User | First user becomes owner. 403 "Your Plex account doesn't have a Shufflerr account yet. Ask the server owner to import you." |
| POST | `/api/v1/auth/jellyfin` | public (rate-limited) | body `{username, password, hostname?, port?, useSsl?, urlBase?, email?, serverType?}` | User | 401 "Jellyfin didn't accept that username and password." · 403 "Your Jellyfin account doesn't have a Shufflerr account yet. Ask an admin to import you." |
| POST | `/api/v1/auth/local` | public (rate-limited) | body `{email, password}` | User | Error copy per docs/AUTH.md §Local accounts |
| POST | `/api/v1/auth/setup` · `/api/v1/auth/setup-local` | public, only while no users exist | body `{username?, email, password}` | 201 User | First-run local owner (id 1, ADMIN), signed in. 403 once any user exists. Same handler under both paths |
| POST | `/api/v1/auth/logout` | — | — | `{status:"ok"}` | Client then routes to /logout |
| POST | `/api/v1/auth/reset-password` | public | body `{email}` | `{status:"ok"}` | Always ok (no account enumeration) |
| POST | `/api/v1/auth/reset-password/:guid` | public | body `{password}` | `{status:"ok"}` |  |
| GET | `/api/v1/user` | MANAGE_USERS | query `take`, `skip`, `sort`=created|displayname|requests|usertype|role, `q` | UserResultsResponse |  |
| POST | `/api/v1/user` | MANAGE_USERS | body CreateUserBody | 201 User | Inline errors: "Enter a username." / "Enter a valid email address." / "That email address is already used." / "The password needs at least 8 characters." |
| PUT | `/api/v1/user` | MANAGE_USERS | body BulkPermissionsBody | User[] | Never applies to the owner |
| POST | `/api/v1/user/import-from-plex` | MANAGE_USERS | body `{plexIds?: string[]}` | ImportUsersResponse |  |
| POST | `/api/v1/user/import-from-jellyfin` | MANAGE_USERS | body `{jellyfinUserIds: string[]}` | ImportUsersResponse |  |
| GET | `/api/v1/user/:id` | own or MANAGE_USERS | — | User |  |
| DELETE | `/api/v1/user/:id` | MANAGE_USERS | — | User | Not the owner, not yourself |
| GET | `/api/v1/user/:id/requests` | own or MANAGE_REQUESTS / REQUEST_VIEW | query `take`, `skip` | UserRequestsResponse |  |
| GET | `/api/v1/user/:id/quota` | own or MANAGE_USERS | — | QuotaResponse |  |
| GET | `/api/v1/user/:id/recently-played` | own or MANAGE_USERS | query `take` (12) | UserRecentlyPlayedResponse | From ScrobbleQueue (+ media-server history when available) |
| GET | `/api/v1/user/:id/settings/main` | own or MANAGE_USERS | — | UserSettingsGeneralResponse |  |
| POST | `/api/v1/user/:id/settings/main` | own or MANAGE_USERS | body UserSettingsGeneralResponse | UserSettingsGeneralResponse | Quota fields only honoured for MANAGE_USERS |
| GET | `/api/v1/user/:id/settings/password` | own or MANAGE_USERS | — | UserSettingsPasswordResponse |  |
| POST | `/api/v1/user/:id/settings/password` | own or MANAGE_USERS | body UserSettingsPasswordBody | 204 | "Enter your current password." / "The new password needs at least 8 characters." / "The passwords don't match." |
| GET | `/api/v1/user/:id/settings/linked-accounts` | own or MANAGE_USERS | — | UserSettingsLinkedAccountsResponse |  |
| POST | `/api/v1/user/:id/settings/linked-accounts/:provider` | own | plex `{authToken}` · jellyfin `{username,password}` · listenbrainz `{token}` | LinkedAccountStatus |  |
| GET | `/api/v1/user/:id/settings/linked-accounts/:provider/authorize` | own | lastfm | spotify | LinkAuthorizeResponse | Open `url`; provider returns to /api/v1/callback/<provider> |
| DELETE | `/api/v1/user/:id/settings/linked-accounts/:provider` | own or MANAGE_USERS | — | 204 |  |
| GET | `/api/v1/user/:id/settings/app-passwords` | own or MANAGE_USERS | — | UserSettingsAppPasswordsResponse |  |
| POST | `/api/v1/user/:id/settings/app-passwords` | own | body `{name}` | 201 AppPasswordCreatedResponse | Plaintext shown once |
| DELETE | `/api/v1/user/:id/settings/app-passwords/:passwordId` | own or MANAGE_USERS | — | 204 |  |
| GET | `/api/v1/user/:id/settings/notifications` | own or MANAGE_USERS | — | UserSettingsNotificationsResponse |  |
| POST | `/api/v1/user/:id/settings/notifications` | own or MANAGE_USERS | body `{channels: {<agent>: {enabled, types, …fields}}}` | UserSettingsNotificationsResponse |  |
| GET | `/api/v1/user/:id/settings/permissions` | MANAGE_USERS (not self unless owner) | — | UserSettingsPermissionsResponse |  |
| POST | `/api/v1/user/:id/settings/permissions` | MANAGE_USERS (not self unless owner; nobody edits the owner) | body `{permissions}` | UserSettingsPermissionsResponse |  |
| POST | `/api/v1/user/registerPushSubscription` | signed in | body PushSubscription | 204 | Seerr web push (kept) + GET/DELETE `/:id/pushSubscription(s)` |
| GET | `/api/v1/callback/lastfm` | signed in (session cookie) | query `token`, `state` | 302 → /profile/settings/linked-accounts?linked=lastfm (or `?error=`) | Exchanges the token with `auth.getSession` |
| GET | `/api/v1/callback/spotify` | signed in (session cookie) | query `code`, `state` | 302 → /profile/settings/linked-accounts?linked=spotify (or `?error=`) | Authorization Code + PKCE; stores the refresh token encrypted |

## SV5 — settings, notifications, jobs

| Method | Path | Permission | Query / body | Response | Notes |
|---|---|---|---|---|---|
| GET | `/api/v1/settings/public` | public | — | PublicSettingsResponse | Drives login buttons, rail items, feature flags (`integrations`) |
| GET | `/api/v1/settings/main` | MANAGE_SETTINGS | — | MainSettingsResponse |  |
| POST | `/api/v1/settings/main` | MANAGE_SETTINGS | body partial MainSettings | MainSettingsResponse | applicationTitle required; applicationUrl valid URL without trailing slash |
| POST | `/api/v1/settings/main/regenerate` | MANAGE_SETTINGS | — | MainSettingsResponse | New API key |
| GET | `/api/v1/settings/users` | MANAGE_SETTINGS | — | UsersSettingsResponse |  |
| POST | `/api/v1/settings/users` | MANAGE_SETTINGS | body partial UsersSettingsResponse | UsersSettingsResponse | 400 "At least one sign-in method has to stay on." |
| GET | `/api/v1/settings/network` | MANAGE_SETTINGS | — | NetworkSettingsResponse | proxy password masked |
| POST | `/api/v1/settings/network` | MANAGE_SETTINGS | body partial NetworkSettings | NetworkSettingsResponse | Some changes need a restart (`/status.restartRequired`) |
| GET | `/api/v1/settings/youtube` | MANAGE_SETTINGS | — | YoutubeSettingsResponse | Secrets masked |
| POST | `/api/v1/settings/youtube` | MANAGE_SETTINGS | body partial section (deep-merged; e.g. `{spotify:{enabled:true}}`) | YoutubeSettingsResponse |  |
| GET | `/api/v1/settings/metadata` | MANAGE_SETTINGS | — | MetadataSettingsResponse | Secrets masked |
| POST | `/api/v1/settings/metadata` | MANAGE_SETTINGS | body partial section (deep-merged; e.g. `{spotify:{enabled:true}}`) | MetadataSettingsResponse |  |
| GET | `/api/v1/settings/discover` | MANAGE_SETTINGS | — | DiscoverSettingsResponse | Secrets masked |
| POST | `/api/v1/settings/discover` | MANAGE_SETTINGS | body partial section (deep-merged; e.g. `{spotify:{enabled:true}}`) | DiscoverSettingsResponse |  |
| GET | `/api/v1/settings/scrobble` | MANAGE_SETTINGS | — | ScrobbleSettingsResponse | Secrets masked |
| POST | `/api/v1/settings/scrobble` | MANAGE_SETTINGS | body partial section (deep-merged; e.g. `{spotify:{enabled:true}}`) | ScrobbleSettingsResponse |  |
| POST | `/api/v1/settings/metadata/test/:service` | MANAGE_SETTINGS | service = musicbrainz `{url?, contact?}` · fanart `{apiKey?}` · lastfm `{apiKey?}` (unsaved form values; masked or missing secret = stored one) | ConnectionTestResponse | Always 200; `ok:false` + `message` says what to fix |
| POST | `/api/v1/settings/youtube/test` | MANAGE_SETTINGS | body `{apiKey?}` | ConnectionTestResponse |  |
| POST | `/api/v1/settings/discover/test/:service` | MANAGE_SETTINGS | service = spotify `{clientId?, clientSecret?}` · deezer · itunes `{country?}` · ticketmaster `{apiKey?, country?}` · skiddle `{apiKey?}` | ConnectionTestResponse |  |
| POST | `/api/v1/settings/scrobble/test/:service` | MANAGE_SETTINGS | service = listenbrainz `{url?}` · lastfm (uses the Metadata key) | ConnectionTestResponse |  |
| GET | `/api/v1/settings/clients` | MANAGE_SETTINGS | — | ClientsSettingsResponse |  |
| POST | `/api/v1/settings/clients` | MANAGE_SETTINGS | body partial ClientsSettings | ClientsSettingsResponse |  |
| GET | `/api/v1/settings/clients/devices` | MANAGE_SETTINGS | — | ClientDevice[] | Every app password across users |
| DELETE | `/api/v1/settings/clients/devices/:id` | MANAGE_SETTINGS | — | 204 | Revoke |
| GET | `/api/v1/settings/notifications` | MANAGE_SETTINGS | — | NotificationAgentsOverview |  |
| GET | `/api/v1/settings/notifications/:agent` | MANAGE_SETTINGS | agent = email|webpush|discord|slack|telegram|pushbullet|pushover|webhook|gotify|ntfy | NotificationAgentResponse | `types` as string keys; secrets masked |
| POST | `/api/v1/settings/notifications/:agent` | MANAGE_SETTINGS | body NotificationAgentResponse | NotificationAgentResponse | 400 `{message}` names the missing/invalid field when `enabled`. Email `options.encryption` = none\|starttls\|tls (maps to Seerr's secure/requireTls/ignoreTls). Webhook `options.jsonPayload` is the template as text |
| POST | `/api/v1/settings/notifications/:agent/test` | MANAGE_SETTINGS | body NotificationAgentResponse (unsaved values are tested) | 204 | "Send test"; 400 `{message}` when the service refuses it |
| GET | `/api/v1/settings/notifications/pushover/sounds` | signed in | query `token` | PushoverSound[] | Seerr (kept). A masked or empty `token` uses the stored application token |
| GET | `/api/v1/settings/logs` | MANAGE_SETTINGS | query `take` (25), `skip`, `filter`=debug|info|warn|error, `search` | LogsResultsResponse | Newest first; the page polls for live append |
| GET | `/api/v1/settings/jobs` | MANAGE_SETTINGS | — | JobItem[] | 15 jobs (docs/ADMIN_PAGES.md §Jobs) |
| POST | `/api/v1/settings/jobs/:jobId/run` | MANAGE_SETTINGS | — | JobItem |  |
| POST | `/api/v1/settings/jobs/:jobId/cancel` | MANAGE_SETTINGS | — | JobItem |  |
| POST | `/api/v1/settings/jobs/:jobId/schedule` | MANAGE_SETTINGS | body `{schedule}` (6-field cron) | JobItem | 400 with a message when the expression is invalid. JobItem also carries `scheduleText` (cron in words), `enabled` (integration on) and `cancellable` |
| GET | `/api/v1/settings/cache` | MANAGE_SETTINGS | — | CacheResponse |  |
| POST | `/api/v1/settings/cache/:cacheId/flush` | MANAGE_SETTINGS | — | 204 |  |
| POST | `/api/v1/settings/cache/dns/:dnsEntry/flush` | MANAGE_SETTINGS | — | 204 |  |
| POST | `/api/v1/settings/cache/images/cleanup` | MANAGE_SETTINGS | — | 204 | "Clean up now" |
| GET | `/api/v1/settings/about` | MANAGE_SETTINGS | — | SettingsAboutResponse |  |
| POST | `/api/v1/settings/initialize` | ADMIN | — | PublicSettings | Marks setup finished (Seerr) |
| GET | `/api/v1/settings/sliders` | signed in | — | DiscoverSlider[] | Discover row order (backlog editor: POST /settings/sliders, /sliders/add, /sliders/reset) |
| GET | `/api/v1/status` | public | — | StatusResponse |  |
| GET | `/api/v1/status/appdata` | public | — | `{appData, appDataPath, appDataPermissions}` |  |

## SV6 — import, scrobbling, concerts, YouTube

| Method | Path | Permission | Query / body | Response | Notes |
|---|---|---|---|---|---|
| GET | `/api/v1/import/sources` | signed in | — | ImportSourcesResponse |  |
| POST | `/api/v1/import/resolve` | signed in (REQUEST / REQUEST_ALBUM) | body `{url}` | ImportResolveResponse | 400 with fix-it copy for unsupported links (e.g. Apple Music playlists) |
| POST | `/api/v1/import/request` | signed in | body `{jobId?, mbids: string[]}` | ImportRequestResponse | Each MBID goes through the request engine with scope `album` |
| GET | `/api/v1/import/spotify/saved` | signed in | — | ImportSpotifySavedResponse | `linked:false` when the viewer has not linked Spotify |
| GET | `/api/v1/import/jobs` | signed in | — | ImportJobSummary[] | The viewer's recent import links |
| GET | `/api/v1/import/jobs/:id` | signed in | — | ImportResolveResponse |  |
| GET | `/api/v1/scrobble/status` | signed in | — | ScrobbleStatusResponse | Player bar "scrobbling to …" |
| POST | `/api/v1/scrobble/now-playing` | signed in | body ScrobbleBody | ScrobbleResponse |  |
| POST | `/api/v1/scrobble` | signed in | body ScrobbleBody (with `playedSeconds`) | ScrobbleResponse | Server applies settings.scrobble.rule |
| POST | `/api/v1/webhooks/plex` | query `apikey` = main.apiKey | Plex webhook multipart payload | 204 | media.scrobble / media.play for music → scrobble pipeline |
| POST | `/api/v1/webhooks/jellyfin` | query `apikey` = main.apiKey | Jellyfin Webhook plugin JSON | 204 | PlaybackStart / PlaybackStop → scrobble pipeline |
| GET | `/api/v1/youtube/track/:recordingMbid` | signed in | query `artist`, `title` (used when the recording is not cached) | YoutubeTrackResponse | `enabled:false, videoId:null` when YouTube is off. Cached 30 days per recording. IFrame player only |

## The OpenAPI document

`shufflerr-api.yml` (served at `/api-docs`) is generated from the mounted routes and their
TypeScript types by `server/scripts/generateApiSpec.ts`. This file stays the human-readable
contract; regenerate the spec after changing a route.

## Backlog routes (kept from Seerr)

| Method | Path | Permission | Query / body | Response | Notes |
|---|---|---|---|---|---|
| * | `/api/v1/issue…` | per Seerr | — | — | Issues (Seerr routes, music issue types). `GET /issue` accepts `mediaId` to list one item's issues; `GET /issue/count` is scoped (MANAGE_ISSUES / VIEW_ISSUES: whole server, others: own issues) |
| * | `/api/v1/issueComment…` | per Seerr | — | — | Issue comments — kept compiling for the backlog UI |
| * | `/api/v1/blocklist…` | per Seerr | — | — | Blocklist by MBID — kept compiling for the backlog UI |
| * | `/api/v1/watchlist…` | per Seerr | — | — | Watchlist by MBID — kept compiling for the backlog UI |
| * | `/api/v1/overrideRule…` | per Seerr | — | — | Override rules — kept compiling for the backlog UI |
## Stream ownership (files)

| Stream | Owns |
|---|---|
| SV1 metadata + browse | `server/api/musicbrainz/*`, `server/api/{coverartarchive,fanart,lastfm,listenbrainz}.ts`, `server/lib/search.ts`, `server/lib/metadata/*`, `server/routes/{search,artist,release,recording,discover,library,media,public}.ts` |
| SV2 Lidarr + requests | `server/api/servarr/lidarr.ts`, `MediaRequest.request()` in `server/entity/MediaRequest.ts`, `server/subscriber/MediaRequestSubscriber.ts`, `server/routes/{request,service}.ts`, `server/routes/settings/lidarr.ts`, `server/lib/downloadtracker.ts`, `server/lib/scanners/lidarr/*` |
| SV3 library | `server/lib/scanners/{plex,jellyfin,subsonic,local}/*`, `server/api/{plexapi,jellyfin,subsonic}.ts`, `server/lib/availabilitySync.ts`, `server/lib/library/*`, `server/subscriber/MediaSubscriber.ts`, `server/routes/stream.ts`, `server/routes/settings/{plex,jellyfin,navidrome,local}.ts` |
| SV4 auth + users | `server/routes/auth.ts`, `server/routes/user/**`, `server/routes/callback.ts`, `server/api/plextv.ts`, `server/middleware/auth.ts` |
| SV5 settings + notifications + jobs | `server/routes/settings/{index,notifications,sliders}.ts`, `server/lib/notifications/**`, `server/lib/email/**`, `server/templates/**`, `server/job/schedule.ts` |
| SV6 extras | `server/api/{spotify,deezer,itunes,ticketmaster,skiddle,youtube}.ts`, `server/lib/{import,scrobble,concerts}/*`, `server/routes/{import,scrobble,webhooks,youtube}.ts` |
| SV7 client APIs | `server/clientapi/{subsonic,jellyfin}/**` |

Shared files nobody should need to edit (already wired): `server/routes/index.ts`,
`server/index.ts`, `server/datasource.ts`, `server/lib/cache.ts`, `server/lib/imageSources.ts`,
`server/lib/settings/index.ts`, `server/entity/*` (schema is frozen for one final migration
generation), `server/interfaces/api/*`, `server/models/music.ts`. If a contract type is wrong
or missing, change it in the interface file, keep it backwards compatible where possible, and
note it in `changes/<stream>.md`.

## Shared helpers other streams call

| Helper | File | Owner |
|---|---|---|
| `ensureMedia(mbid, mediaType, {withTracks, preferReleaseMbid})`, `syncTracklist(media)`, `getDiscographyReleaseGroups(artistMbid)`, `coverUrlFor(mbid, size)` | `server/lib/metadata/index.ts` | SV1 |
| `searchMusic({query, type, page, pageSize, user})` | `server/lib/search.ts` | SV1 |
| `MediaRequest.request(body, user, options)` + error classes | `server/entity/MediaRequest.ts` | SV2 |
| `downloadTracker.getMusicProgress(serverId, albumId)`, `.getDownloadingCount()` | `server/lib/downloadtracker.ts` | SV2 |
| `streamTrack(req, res, trackId, options)`, `getTrackPeaks(trackId)`, `getTrackSource(trackId)` | `server/lib/library/stream.ts` | SV3 |
| `nowPlaying(event)`, `recordPlay(event)`, `processScrobbleQueue()` | `server/lib/scrobble/index.ts` | SV6 |
| `encryptSecret`, `decryptSecret`, `safeEqual`, `generateAppPassword` | `server/lib/secrets.ts` | spine (done) |
| `User.getQuota()` | `server/entity/User.ts` | spine (done) |
| `overrideRules(input)` | `server/lib/overrideRules.ts` | spine (done) |
| `registerImageSource(type, factory)` | `server/lib/imageSources.ts` | spine (done) |
| `maskSecrets`, `mergeWithSecrets`, `resolveSecret`, `settings.integrations` | `server/lib/settings/index.ts` | spine (done) |
| `runJobNow(jobId)`, `scheduledJobs` | `server/job/schedule.ts` | spine (done), SV5 owns |
