# Spine — Phase 0 + Phase 1, API contract, wiring skeleton

## What exists now

- **Server typechecks** (`pnpm typecheck:server`), unit tests pass (`pnpm test`: 83 tests),
  and the API boots on an empty SQLite database (`/api/v1/status`, `/api/v1/settings/public`
  answer; schema with all 22 tables is created).
- **The client does not typecheck yet** — dropped movie/TV components were deleted and the
  remaining Seerr pages still reference them. The FE streams rebuild the pages.
- Config directory env var: **`CONFIG_DIRECTORY`** (settings.json, db/, logs/, cache/).
  Other env vars are unchanged from Seerr (`PORT`, `HOST`, `LOG_LEVEL`, `API_KEY`, `DB_*`).

## Contract and wiring

- `docs/API_CONTRACT.md` — every route, permission, input and response type, per stream.
- Types: `server/models/music.ts`, `server/interfaces/api/*.ts`.
- Every router is mounted in `server/routes/index.ts`; `/rest` and `/jellyfin` are mounted in
  `server/index.ts` before the session/OpenAPI middleware. Handlers not implemented yet answer
  `501 {message:"Not implemented", stream}` via `notImplemented()` (`server/routes/_stub.ts`).
- All 15 jobs are registered in `server/job/schedule.ts` and call the owning stream's module.
  Jobs are always registered; a tick is skipped while the integration behind it is off
  (`settings.integrations`), so enabling an integration needs no restart. "Run now" uses
  `runJobNow()` and ignores the enabled check.
- OpenAPI validator runs with `ignoreUndocumented: true` against a minimal
  `shufflerr-api.yml`; the full spec is a later pass.

## Stub modules per stream (replace the body, keep the exports)

| Stream | Module | Exports |
|---|---|---|
| SV1 | `server/lib/search.ts` | `searchMusic(options)`, types `SearchOptions`, `SearchType` |
| SV1 | `server/lib/metadata/index.ts` | `ensureMedia()`, `syncTracklist()`, `getDiscographyReleaseGroups()`, `coverUrlFor()` (implemented) |
| SV1 | `server/routes/{search,artist,release,recording,discover,library,media,public}.ts` | default router (501 handlers) |
| SV2 | `server/entity/MediaRequest.ts` | `MediaRequest.request()` (throws), error classes `RequestPermissionError`, `QuotaRestrictedError`, `DuplicateMediaRequestError`, `BlocklistedMediaError` |
| SV2 | `server/subscriber/MediaRequestSubscriber.ts` | `MediaRequestSubscriber` (empty) |
| SV2 | `server/lib/downloadtracker.ts` | default `{ getMusicProgress(), getDownloadingCount(), updateDownloads(), resetDownloadTracker() }` |
| SV2 | `server/lib/scanners/lidarr/index.ts` | `lidarrScanner` |
| SV2 | `server/routes/{request,service}.ts`, `server/routes/settings/lidarr.ts` | default router (501 handlers) |
| SV3 | `server/lib/scanners/plex/index.ts` | `plexFullScanner`, `plexRecentScanner` |
| SV3 | `server/lib/scanners/jellyfin/index.ts` | `jellyfinFullScanner`, `jellyfinRecentScanner` |
| SV3 | `server/lib/scanners/subsonic/index.ts` | `navidromeScanner` |
| SV3 | `server/lib/scanners/local/index.ts` | `localFilesScanner`, `syncLocalFilesWatcher()` (called at boot) |
| SV3 | `server/lib/availabilitySync.ts` | default `{ running, run(), cancel() }` |
| SV3 | `server/lib/library/stream.ts` | `streamTrack()`, `getTrackPeaks()`, `getTrackSource()` |
| SV3 | `server/subscriber/MediaSubscriber.ts` | `MediaSubscriber` (empty) |
| SV3 | `server/routes/stream.ts`, `server/routes/settings/{navidrome,local}.ts` | default router (501 handlers) |
| SV3 | `server/routes/settings/{plex,jellyfin}.ts` | Seerr's working routes split out of settings/index.ts; adapt to the contract paths |
| SV4 | `server/routes/callback.ts` | default router (501 handlers) |
| SV4 | `server/routes/user/index.ts` | `GET /:id/recently-played` is 501; the rest is Seerr's code compiling against the new entities |
| SV4 | `server/routes/user/usersettings.ts` | notifications GET/POST still return Seerr's flat shape (cast); app-passwords and linked-accounts for Last.fm / ListenBrainz / Spotify are not there yet |
| SV6 | `server/lib/scrobble/index.ts` | `nowPlaying()`, `recordPlay()`, `processScrobbleQueue()`, type `PlayEvent` |
| SV6 | `server/lib/concerts/index.ts` | `refreshConcerts()` |
| SV6 | `server/lib/import/index.ts` | `syncSpotifySavedAlbums()` |
| SV6 | `server/routes/{import,scrobble,webhooks,youtube}.ts` | default router (501 handlers) |
| SV7 | `server/clientapi/subsonic/index.ts`, `server/clientapi/jellyfin/index.ts` | default router (404 when the API is off, else 501) |

Scanner contract: `LibraryScanner = { run(): Promise<void>; status(): StatusBase & Partial<ScanStatus>; cancel(): void }`
(`server/lib/scanners/stub.ts`; delete `stub.ts` and `routes/_stub.ts` when nothing uses them).
`BaseScanner` keeps Seerr's run loop only (`startRun`, `endRun`, `loop`, `log`).

## Already implemented (not stubs)

- Entities and constants (see CHANGES.md), `User.getQuota()`, `Media.getMedia/getRelatedMedia/libraryStatus`.
- Settings: full shape, defaults, `integrations`, `fullPublicSettings`, secret masking helpers.
- `server/lib/secrets.ts`, `server/lib/notifications/types.ts`, `server/lib/imageSources.ts`,
  `server/lib/overrideRules.ts`, image proxy route (404 for missing art).
- Settings routes (SV5 file): `/main`, `/main/regenerate`, `/network`, `/users`, `/youtube`,
  `/metadata`, `/discover`, `/scrobble`, `/clients`, `/clients/devices` (+ DELETE), `/logs`,
  `/jobs…`, `/cache…`, `/about`, `/initialize`, `/sliders`. The generic section routes merge
  partial bodies and mask secrets but do **no field validation** — SV5 adds it.
- Backlog routes compile and work against MBIDs: `/issue`, `/issueComment`, `/blocklist`,
  `/watchlist`, `/overrideRule`.

## Notification types

Stored as Seerr's bitmask (`Notification` enum, unchanged values) in settings
(`notifications.agents.<agent>.types: number`) and in `UserSettings.notificationTypes`
(`Record<agent, number>`). The HTTP API speaks string keys
(`pending | autoApproved | approved | declined | available | failed`, plus reserved
`autoRequested`, `issueCreated`, `issueComment`, `issueResolved`, `issueReopened`).
Convert with `typesToMask()` / `maskToTypes()` in `server/lib/notifications/types.ts`.
The notification agents themselves still carry Seerr's movie/TV wording (they compile; links
now point to `/album/<mbid>` / `/artist/<mbid>` through `mediaPath()`); SV5 rewords them.

## Deviations from the brief

- **Public slideshow route** is `GET /api/v1/public/slideshow` (own router `routes/public.ts`,
  SV1) rather than under `/auth`, so SV1 does not touch SV4's file.
- **Discover slider settings** moved from `/settings/discover` to `/settings/sliders`, because
  `/settings/discover` is now the Spotify/Deezer/iTunes/Ticketmaster/Skiddle section.
- **Media-server model**: Seerr has one `main.mediaServerType`. It is kept only as "what the
  owner signed in with" (auth code relies on it). Library sources are independent switches
  (`plex.enabled`, `jellyfin.enabled`, `navidrome.enabled`, `localFiles.enabled`).
- **Jellyfin settings** keep Seerr's `ip/port/useSsl/urlBase` fields (the Jellyfin client and
  `getHostname()` depend on them) instead of the single `url` in `settings.example.json`.
  The settings route can accept a URL and split it.
- **Defaults** follow `settings.example.json` for behaviour (default permissions 544 =
  REQUEST + AUTO_APPROVE_TRACK, 10 albums / 50 tracks per 7 days, discography always reviewed)
  but every host, key and integration switch is empty/off. `cacheImages` defaults on.
  `network.trustProxy` keeps Seerr's default (off).
- **GitHub update check removed** (`server/api/github.ts` deleted): it compared against Seerr's
  releases. `/status` reports `updateAvailable: false`. `TODO(decision)`.
- **`/regions`, `/languages`** (TMDB-backed) are gone; the UI should use a static country list.
- **Production schema**: no hand-written migrations yet. With no migration files present the
  data source uses `synchronize` (SQLite and Postgres), so production boots on an empty DB.
  The final pass generates the initial migrations; once files exist they take over.
- `settings/index.ts` requires `MANAGE_SETTINGS` (Seerr: `ADMIN`); `/settings/plex/users` and
  `/settings/jellyfin/users` are also reachable with `MANAGE_USERS` for the import modals.
- Unblocking an item keeps its Media row (resets status from library data) instead of deleting
  it as Seerr does.
- `getAppVersion()` returns the real package version (Seerr mapped `0.1.0` to `develop-<tag>`).

## Tests

- Deleted with their modules: TMDB/TVDB/Radarr/Sonarr tests, `availabilitySync.test.ts`,
  `routes/request.test.ts`, `routes/mediaInfo.test.ts`, `entity/MediaRequest.test.ts`,
  `scanners/jellyfin/jellyfin.test.ts`, `watchlistsync.test.ts` — the owning streams write new
  ones (SV2: engine matrix + Lidarr; SV3: scanners + availability).
- Kept and adapted: auth, user, user settings, blocklist, issue, plextv, proxy agent, user
  agent, seed tests. Test accounts are `admin@shufflerr.test` / `demo@shufflerr.test`.
- Added: `server/lib/permissions.test.ts`.

## For the front-end streams

- Read `docs/API_CONTRACT.md` first; import types from `@server/models/music` and
  `@server/interfaces/api/*`.
- Feature flags: `GET /api/v1/settings/public` (`integrations`, `importEnabled`,
  `concertsEnabled`, login switches). `currentSettings` in `SettingsContext` should be typed as
  `PublicSettingsResponse` (= `FullPublicSettings`); removed fields: `movie4kEnabled`,
  `series4kEnabled`, `streamingRegion`, `originalLanguage`, `partialRequestsEnabled`,
  `enableSpecialEpisodes`, `hideBlocklisted`, `hideRequested`, `youtubeUrl`.
- Quota shape is `{ album, track }` (was `{ movie, tv }`).
- Public assets: `/logo.svg`, `/favicon.svg`, `/logo_full.svg`, `/logo_stacked.svg`,
  `/os_icon.svg`, `/logo.png`, PWA icons and splash screens are regenerated Shufflerr marks.
  `/preview.jpg`, `/os_logo_filled.png`, `/logo_full.png` no longer exist.
- Deleted client code: `src/components/{MovieDetails,TvDetails,PersonDetails,PersonCard,CollectionDetails,CompanyCard,CompanyTag,GenreCard,GenreTag,KeywordTag,AirDateBadge,MetadataSelector,BlocklistedTagsBadge,BlocklistedTagsSelector}`,
  the movie/TV Discover sub-components, `src/pages/{movie,tv,person,collection}`,
  `src/pages/discover/{movies,tv,watchlist.tsx}`, `src/pages/settings/metadata.tsx`.
  Still present but movie/TV-bound (rewrite or delete): `RequestModal/*`, `Settings/{RadarrModal,SonarrModal,SettingsServices,SettingsMetadata,OverrideRule}`,
  `Discover/*`, `TitleCard`, `MediaSlider`, `ManageSlideOver`, `RequestCard`, `RequestList`,
  `RequestBlock`, `RequestButton`, `IssueModal`, `Blocklist*`, `RegionSelector`, `Selector`,
  `LanguageSelector`, `ExternalLinkBlock`, `DownloadBlock`.
