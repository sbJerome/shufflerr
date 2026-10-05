# Seerr → Shufflerr reuse map

Seerr reference: `seerr-team/seerr@2cfbcf8940225f1597d44f507fd78040887c5597` (develop, 2026-10-03), MIT.
Shufflerr-only additions (no Seerr source): Player, Waveform, Import page, LinkedAccount, AppPassword, ScrobbleQueue, client APIs (`/rest`, `/jellyfin`), Navidrome/local/YouTube/Spotify/Deezer/iTunes/Ticketmaster/Skiddle/ListenBrainz/Last.fm clients.
Legend: **Keep** = reuse as-is (rename only) · **Adapt** = reuse structure, change domain
logic · **Rewrite** = new code, Seerr used only as reference · **Drop** = remove.
Every Keep/Adapt row must be listed in `NOTICE.md` and carry the attribution header.

## Server

| Seerr path | Action | Shufflerr notes |
|---|---|---|
| `server/index.ts`, `server/datasource.ts`, `server/logger.ts`, `server/middleware/*` | Keep | Bootstrap, DB, logging, auth middleware |
| `server/lib/settings/*` | Adapt | Replace radarr/sonarr/tmdb blocks with lidarr[], musicbrainz, coverart, listenbrainz, lastfm, mediaServer |
| `server/lib/permissions.ts` | Adapt | New music bits (CLAUDE.md §4) |
| `server/lib/cache.ts`, `server/lib/imageproxy.ts`, `server/routes/imageproxy.ts`, `server/routes/avatarproxy.ts` | Keep | Add CAA/fanart hosts to image proxy |
| `server/lib/notifications/**` (agents: discord, email, gotify, ntfy, pushbullet, pushover, slack, telegram, webhook, webpush) | Adapt | Keep all 10 agents; new types (pending, autoApproved, approved, declined, available, failed) and music payload vars (ADMIN_PAGES.md) |
| `server/lib/email/*`, `server/templates/*` | Adapt | Music wording |
| `server/lib/refreshToken.ts`, `server/routes/auth.ts` | Keep | Plex PIN + Jellyfin + local login (AUTH.md); add `jellyfin.newLogin` rule; logout page |
| `server/lib/scanners/baseScanner.ts` | Keep | |
| `server/lib/scanners/plex`, `server/lib/scanners/jellyfin` | Adapt | Music libraries only |
| `server/lib/scanners/radarr` | Adapt → `lidarr` | |
| `server/lib/scanners/sonarr` | Drop | |
| — | Rewrite | `server/lib/scanners/subsonic` (Navidrome) |
| `server/lib/availabilitySync.ts`, `server/lib/downloadtracker.ts` | Adapt | Track-level availability |
| `server/lib/search.ts` | Rewrite | MusicBrainz search |
| `server/lib/overrideRules.ts`, `server/entity/OverrideRule.ts` | Adapt | Route by genre/user to a Lidarr instance |
| `server/lib/watchlistsync.ts`, `server/entity/Watchlist.ts` | Adapt (later) | "Follow artist" — v0.2 |
| `server/lib/overseerrMerge.ts` | Drop | |
| `server/api/externalapi.ts` | Keep | Base HTTP client |
| `server/api/servarr/base.ts` | Keep | Lidarr extends it; override API version |
| `server/api/servarr/radarr.ts` | Reference | Pattern for `lidarr.ts` |
| `server/api/servarr/sonarr.ts` | Drop | |
| `server/api/plexapi.ts`, `plextv.ts`, `jellyfin.ts` | Adapt | Music endpoints |
| `server/api/themoviedb/*`, `tvdb/*`, `animelist.ts`, `rating/*`, `ratings.ts`, `tautulli.ts`, `metadata.ts`, `provider.ts` | Drop | |
| — | Rewrite | `server/api/musicbrainz/*`, `server/api/coverartarchive.ts`, `server/api/listenbrainz.ts`, `server/api/lastfm.ts`, `server/api/fanart.ts`, `server/api/subsonic.ts`, `server/api/servarr/lidarr.ts` |
| `server/entity/User.ts`, `UserSettings.ts`, `Session.ts`, `UserPushSubscription.ts` | Keep | Quota fields → album/track |
| `server/entity/Media.ts`, `MediaRequest.ts` | Adapt | MBID keys, scopes |
| `server/entity/Season.ts`, `SeasonRequest.ts` | Drop → `TrackRequest.ts` | |
| `server/entity/Issue.ts`, `IssueComment.ts` | Adapt | Issue types: wrong release, bad tags, low quality, missing tracks |
| `server/entity/Blocklist.ts` | Adapt | Block artists/releases |
| `server/entity/DiscoverSlider.ts` | Adapt | Music slider types |
| `server/migration/*` | Drop | New initial migration for SQLite + Postgres |
| `server/routes/request.ts`, `media.ts`, `issue.ts`, `issueComment.ts`, `blocklist.ts`, `service.ts`, `settings/*`, `user/*` | Adapt | |
| `server/routes/movie.ts`, `tv.ts`, `person.ts`, `collection.ts` | Drop → `artist.ts`, `release.ts`, `recording.ts` | |
| `server/routes/discover.ts`, `search.ts` | Rewrite | |
| `server/job/schedule.ts` | Adapt | Jobs: media-server scan, Lidarr sync, availability sync, image cache cleanup |
| `server/test/*`, `*.test.ts` | Keep for kept modules | |

## Front end

| Seerr path | Action | Notes |
|---|---|---|
| `src/components/Common/*` | Keep, restyle | Primitives |
| `src/components/Layout`, `Login`, `Setup`, `PermissionEdit`, `PermissionOption`, `QuotaSelector`, `NotificationTypeSelector`, `Toast`, `LoadingBar`, `StatusChecker`, `ServiceWorkerSetup`, `PWAHeader`, `ResetPassword`, `LanguageSelector` | Adapt | Restyle to design tokens; music wording |
| `src/components/UserList/*` (index, BulkEditModal, PlexImportModal, JellyfinImportModal) | Adapt | Exactly as USER_SYSTEM.md |
| `src/components/UserProfile/*`, `UserSettings/*` (General, Password, LinkedAccounts, Notifications, Permissions) | Adapt | + new App passwords tab; linked accounts gain Last.fm, ListenBrainz, Spotify |
| `src/components/Settings/*` (SettingsLayout, Main, Users, Plex, Jellyfin, Services, Network, Notifications/*, Logs, JobsCache, About, Metadata) | Adapt | Grouped-sidebar layout; Services → Lidarr; add Navidrome, Local files, YouTube, Apps and devices, Spotify, Deezer, iTunes, Ticketmaster, Skiddle, Scrobbling (ADMIN_PAGES.md) |
| `src/components/Settings/RadarrModal` | Adapt → LidarrModal | + metadata profile, hi-res flag |
| `src/components/Settings/SonarrModal`, `OverrideRule` UI | Drop / backlog | OverrideRule UI comes back with the backlog item |
| `src/components/RequestList`, `RequestCard`, `RequestBlock`, `RequestButton`, `ManageSlideOver`, `StatusBadge`, `IssueList`, `IssueDetails`, `IssueModal`, `IssueBlock`, `Blocklist*`, `DownloadBlock` | Adapt | |
| `src/components/RequestModal/index.tsx`, `QuotaDisplay`, `AdvancedRequester` | Adapt → `ReleaseRequestModal` | Scope radio, server/quality/metadata profile/root folder |
| `RequestModal/MovieRequestModal.tsx`, `TvRequestModal.tsx`, `CollectionRequestModal.tsx` | Reference/Drop | TvRequestModal's season picker → track picker |
| `src/components/Discover`, `MediaSlider`, `Slider`, `TitleCard`, `Search` | Adapt | Album cards, artist cards |
| `MovieDetails`, `TvDetails` | Rewrite → `ArtistDetails`, `ReleaseDetails` | Use `design/Artist.dc.html`, `design/Album.dc.html` |
| `PersonDetails`, `PersonCard`, `CollectionDetails`, `CompanyCard`, `GenreCard`, `KeywordTag`, `AirDateBadge`, `RegionSelector` | Drop | |
| `src/hooks/*`, `src/context/*`, `src/utils/*`, `src/i18n/*` | Keep/Adapt | |
| `tailwind.config.js` | Adapt | Tokens from CLAUDE.md §6 |
| `public/*` logos, `preview.jpg` | Drop | Seerr branding must not ship |

## Infra

| Seerr path | Action |
|---|---|
| `Dockerfile`, `compose.yaml`, `compose.postgres.yaml`, `charts/seerr-chart` | Adapt (rename to shufflerr) |
| `.github/workflows/*` | Adapt (CI only; drop Seerr release/publish targets) |
| `seerr-api.yml` | Rewrite as `shufflerr-api.yml` |
| `docs/`, `gen-docs/` | Drop; new docs later |
| `cypress/*` | Adapt for new flows |

## Status after Phase 0 + 1 (spine)

What was actually done to each row above is recorded in `CHANGES.md` (Phase 0, Phase 1) and
`changes/spine.md`. Differences from the table:

- `server/lib/scanners/baseScanner.ts` — **Adapt** (run loop kept; movie/TV processing removed).
- `server/lib/watchlistsync.ts` — **Dropped** for now (Plex movie/TV watchlist); `Watchlist`
  entity and routes are kept, MBID-based, for the "follow artist" backlog item.
- `server/api/github.ts` — **Dropped** (update check against Seerr's releases).
- `server/routes/settings/index.ts` — Plex and Jellyfin routes split into
  `server/routes/settings/plex.ts` and `server/routes/settings/jellyfin.ts`.
- `server/routes/settings/discover.ts` → `server/routes/settings/sliders.ts`.
- `charts/seerr-chart` → `charts/shufflerr-chart`; `.github/workflows` reduced to `ci.yml`.

## As built (v0.1.0) — where the build differs from the plan above

Checked against the tree at the end of the build. `CHANGES.md` has the per-file lists.

### Server

| Planned | What happened |
|---|---|
| `server/lib/scanners/radarr` → Adapt → `lidarr` | Rewritten as `server/lib/scanners/lidarr` (Seerr's scanner used as reference only) |
| `server/lib/scanners/plex`, `jellyfin` → Adapt | Rewritten on a shared library core (`server/lib/library/*`: ingest, matching, availability, state, streaming, peaks). `baseScanner.ts` keeps Seerr's run loop only |
| `server/lib/availabilitySync.ts` → Adapt | Adapted shell; the per-track logic lives in `server/lib/library/availability.ts` (new) |
| `server/lib/watchlistsync.ts` → Adapt (later) | Dropped; the `Watchlist` entity and routes are kept (MBID-based) |
| `server/api/github.ts` (not listed) | Dropped with the update check |
| `server/api/plexapi.ts`, `jellyfin.ts` → Adapt | Adapted: music endpoints only, movie/TV methods removed |
| `server/routes/settings/*` → Adapt | Split per section: `index.ts` (adapted), `plex.ts`, `jellyfin.ts`, `notifications.ts`, `sliders.ts` (adapted), `lidarr.ts` (adapted from `radarr.ts`), `navidrome.ts`, `local.ts`, `scanPanel.ts` (new) |
| `server/migration/*` → Drop | Dropped; new initial migrations in `server/migration/{sqlite,postgres}` |
| `seerr-api.yml` → Rewrite | `shufflerr-api.yml`, generated by `server/scripts/generateApiSpec.ts` (new) |
| `server/test/*` → Keep | Kept; `index.mts` adapted (concurrency, transpile-only). New helpers: `fakeLidarr.ts`, `fixtureAdapter.ts`, `mockAxios.ts`, `requestFixtures.ts` |
| — | New, no Seerr source: `server/clientapi/{subsonic,jellyfin}`, `server/lib/{metadata,library,import,scrobble,concerts,auth}`, `server/lib/requestResults.ts`, `server/lib/secrets.ts`, `server/api/{spotify,deezer,itunes,ticketmaster,skiddle,youtube,subsonic}.ts` |

### Front end

| Planned | What happened |
|---|---|
| `Slider`, `MediaSlider`, `TitleCard` → Adapt | Dropped; replaced by `HorizontalRow`, `AlbumCard`, `ArtistCard`, `CoverArt` (new) |
| `Common/ImageFader`, `Common/ListView` | Dropped; the login slideshow and library grids are new |
| `Settings/RadarrModal` → Adapt → LidarrModal | Rewritten (Seerr's modal used as reference; header kept) |
| `Settings/*` → Adapt | Rewritten page by page on the new primitives (`Settings/shared.tsx`); `SettingsLayout` rewritten as a grouped sidebar |
| `Selector`, `RegionSelector`, `LanguageSelector` | `Selector` dropped; the other two are static selects (the TMDB-backed routes are gone) |
| `UserProfile/UserSettings/*` → Adapt | Adapted into one settings area with tabs; per-channel notification pages and the watchlist page dropped; Linked accounts and App passwords tabs added |
| `PermissionOption` | Folded into the rebuilt `PermissionEdit` |
| `RequestModal/*` → Adapt | Rewritten as the release request dialog (scope cards, track picker, dry-run outcome) |
| `IssueList`, `IssueDetails`, `IssueModal`, `IssueBlock`, `Blocklist*`, `ManageSlideOver`, `ExternalLinkBlock` → Adapt | Adapted and built (backlog items 1, 2 and 6) rather than left for later |
| `OverrideRule` UI | Dropped (backlog item 4); the entity and routes are kept |
| `src/hooks/useDiscover`, `useRequestOverride`, `useSearchInput` | Dropped with the components that used them |
| `cypress/*` → Adapt | Not adapted yet; the suite still describes Seerr's flows |
