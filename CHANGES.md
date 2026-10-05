# CHANGES

Build notes per phase: what was kept / adapted / rewritten / dropped from Seerr, deviations
from the mockup, open decisions and what the owner must configure. The build ran as parallel
streams; each stream's notes (`changes/<stream>.md`) are merged below under the phase they
belong to. Start with the summary.

Seerr reference: `seerr-team/seerr@2cfbcf8940225f1597d44f507fd78040887c5597` (MIT).

---

## Summary

### State of the build

- Phases 0–10 are implemented, plus backlog items 1, 2 and 6 (issues, manage panel,
  blocklist). Phase 11: Dockerfile, compose files, Helm chart, database migrations and the
  OpenAPI document are done; the Cypress suite inherited from Seerr was not rewritten for the
  new flows.
- Server: `pnpm typecheck:server` and `eslint server` are clean; `pnpm test` runs 495 tests in
  about 75 seconds with no network access.
- Database: initial migrations for SQLite and PostgreSQL, proven on empty databases of both.
- `shufflerr-api.yml` is generated from the routes (157 paths, 201 operations).

### Verified against real services vs. fixtures only

| Area | Status |
|---|---|
| MusicBrainz, Cover Art Archive, ListenBrainz trending | Run against the real services |
| Local files scan, streaming, transcoding, waveform peaks | Run against the real music folder (1,116 files → 89 albums, 765 playable tracks) |
| Lidarr | Reads run against the real server (v3.1). **Writes (add artist/album, monitor, search, delete) are covered by a fake Lidarr in tests only** |
| Deezer and Apple Music import, iTunes chart | Run against the real services |
| OpenSubsonic and Jellyfin-compatible APIs | Driven with curl against a running server and real files. **No real app (Symfonium, Finamp, Feishin, Amperfy, Jellify) was run** |
| Local sign-in, users, app passwords, settings | Run through a booted server and route tests |
| Plex and Jellyfin/Emby sign-in, scanning and proxy streaming; Navidrome | **Fixtures / mocked HTTP only** (no credentials were available) |
| Spotify, Ticketmaster, Skiddle, YouTube, Last.fm, fanart.tv | **Fixtures only** (no API keys). Last.fm and fanart.tv fixtures are hand-written from the documented shapes |
| ListenBrainz and Last.fm scrobble submission | **Fixtures only**; no real scrobble was sent |
| Notification agents | Payloads and templates tested; **no real notification was sent** |
| PostgreSQL | Migrations and the list routes proven; the rest of the suite runs on SQLite |

### Open decisions (HANDOFF §6) and how each was handled

| # | Question | Taken |
|---|---|---|
| 1 | Spotify Developer Terms | Built, off by default. Per-user OAuth with PKCE; only the refresh token is stored (encrypted). Review the terms before turning it on |
| 2 | Ticketmaster / Skiddle terms | Built, off by default. Events keep provider and link for attribution and are purged on refresh. Ticketmaster's distance setting is not applied (Shufflerr knows a user's country, not a location) |
| 3 | Last.fm terms | Per-user session key (encrypted); bios carry the attribution link |
| 4 | Client API: native or proxy | Native for both OpenSubsonic and the Jellyfin-compatible API, over Shufflerr's own library index |
| 5 | Track-level requests in Lidarr | A tracks request monitors and searches the album; it completes when the requested tracks are in the library. Lidarr may fetch a full release |
| 6 | Plex music play history | Plays come from Plex webhooks (`/api/v1/webhooks/plex`), not a history endpoint |
| 7 | Emby | Kept (shares the Jellyfin code path) |
| — | Update check | `TODO(decision)` in code: off until there is a public release feed to compare against |
| — | App passwords stored twice | argon2id hash plus an AES-GCM encrypted copy, because Subsonic token auth needs the plaintext on the server (see Phase 10) |

### Deviations from the mockup (headlines; full lists under each front-end stream)

- No sample content anywhere: empty states until real data arrives. The player says "Nothing
  playing", the login slideshow shows real covers only, the pending pill hides at zero.
- The request dialog offers only the scopes the person may use, has a track picker and a
  "Watch for new releases" checkbox; declining asks for an optional note.
- Three Discover row captions were reworded where the mockup claimed a source the server
  cannot guarantee.
- Requests, users and library lists are paged and sortable.
- Jellyfin connection keeps Seerr's host / port / SSL fields rather than one URL; there is no
  Emby toggle (the page is titled Emby when the owner signed in with Emby).
- The job schedule editor is a cron field with a plain-words preview.
- About → Getting help links to the built-in API reference instead of a public repository
  that does not exist yet.
- Albums MusicBrainz cannot identify are not indexed (no invented IDs); they are listed by
  `GET /settings/local/unresolved` and retried weekly.

### Owner configuration

1. **Application URL** (Settings → General): used in notification links, app endpoints and
   OAuth callbacks.
2. **MusicBrainz contact** (Settings → MusicBrainz and Last.fm): an email or URL for the
   `User-Agent`; required by the public server.
3. **Lidarr** (Settings → Lidarr): host, port, API key, then Test and pick quality profile,
   metadata profile and root folder.
4. **A library source**: mount the music folder read-only (compose / Kubernetes: `/music`) and
   add it under Settings → Local files; and/or connect Plex, Jellyfin/Emby or Navidrome.
5. Optional keys, each on its own settings page: fanart.tv (artist photos), Last.fm key and
   shared secret (bios, similar artists, scrobbling), Spotify client ID and secret (redirect
   URI `<applicationUrl>/api/v1/callback/spotify`), Ticketmaster, Skiddle, YouTube Data API.
6. Optional play reporting from media servers:
   `<applicationUrl>/api/v1/webhooks/plex?apikey=<API key>` (Plex Pass → Webhooks) and
   `<applicationUrl>/api/v1/webhooks/jellyfin?apikey=<API key>` (Jellyfin Webhook plugin).
7. Notification agents: off until their pages are filled in.

---

## Phase 0 — Fork, attribution, branding

**Kept**
- Git history of Seerr with the `upstream` remote.
- Build tooling: pnpm, TypeScript, ESLint, Prettier, Tailwind, Next.js, the node:test runner.
- `Dockerfile` structure (multi-stage, alpine, `USER node`).

**Adapted**
- `package.json`: name `shufflerr`, version `0.1.0`, neutral repository field.
- `Dockerfile`: adds `ffmpeg` to the runtime image, a `HEALTHCHECK`, and a build-time check
  that `LICENSE`, `NOTICE.md` and `LICENSES/seerr-MIT.txt` are in the image. `.dockerignore`
  no longer excludes `LICENSE`/markdown files; it excludes `design/screens`,
  `design/legacy-canvas`, `starter/`, `cypress/`, `charts/`, `k8s/`.
- `compose.yaml` / `compose.postgres.yaml`: Shufflerr service, healthcheck, config volume and
  an optional read-only music volume.
- `charts/seerr-chart` → `charts/shufflerr-chart` (names, image repository, version 0.1.0).
- `.github/workflows/ci.yml`: one job — lint, typecheck, unit tests, build.
- Root `LICENSE`: MIT with `Copyright (c) 2020 sct` and `Copyright (c) 2026 Jerome S B`.
- `README.md` with Acknowledgements (Seerr, Overseerr, Jellyseerr); `CHANGELOG.md`,
  `RELEASELOG.md`.
- `seerr-api.yml` → `shufflerr-api.yml`. The document is now generated from the routes and
  their types (see Integration below).
- Server strings: log line, log file names (`shufflerr-*.log`), HTTP `User-Agent`
  (`Shufflerr/<version>`), Plex product/device headers, Jellyfin client/device names
  (`BOT_shufflerr…`), default application title and email sender name.
- `public/`: new `s/` tile marks (`logo.svg`, `favicon.svg`, `os_icon.svg`, `logo_full.svg`,
  `logo_stacked.svg`, `logo.png`), regenerated favicons, PWA icons, badge and splash screens,
  `site.webmanifest` and `offline.html`.

**Dropped**
- Seerr branding (`preview.jpg`, `os_logo_filled.png`, `logo_full.png`, old icons).
- Seerr's docs site sources (`docs/` now holds the handoff docs; `gen-docs/` removed),
  `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue/PR templates, funding,
  renovate config, nix dev env, and all release / publish / docs / labeller / scan workflows.
- GitHub release check against Seerr's repository.

**Rename later** (internal identifiers that still say "seerr"; harmless)
- npm dependency `@seerr-team/react-tailwindcss-datepicker` (a published Seerr package).
- Attribution comments and `docs/REUSE_MAP.md` references.

---

## Phase 1 — Strip movie/TV, music domain model

**Kept (unchanged or renamed only)**
- `server/logger.ts`, `server/middleware/*`, `server/api/externalapi.ts`,
  `server/lib/imageproxy.ts`, `server/routes/avatarproxy.ts`, `server/lib/refreshToken.ts`,
  `server/lib/email/*`, `server/templates/*`, `server/utils/*`, `server/i18n/*`,
  entities `Session`, `UserPushSubscription`, `IssueComment`.

**Adapted**
- `server/lib/permissions.ts`, `server/constants/media.ts` — from `starter/`.
- Entities: `Media` (MBID keys, artist / release group, track counts, Lidarr and media-server
  ids), `MediaRequest` (scope, release/track counts, Lidarr options, progress, reasons),
  `User` (album/track quotas, linked accounts, app passwords, `getQuota()`), `UserSettings`
  (drops streaming/language/watchlist-sync; adds `autoRequestSpotifySaved`,
  `scrobbleEnabled`), `Issue` (music issue types, `problemTracks`), `Blocklist` and
  `Watchlist` (MBID-based), `DiscoverSlider` (music slider types), `OverrideRule`
  (Lidarr server, label, primary type, metadata profile).
- `server/lib/settings/index.ts` — full Shufflerr settings shape (`docs/settings.example.json`),
  server secret, `integrations`, public settings, secret-masking helpers, `0600` file mode.
- `server/lib/cache.ts` (music cache ids), `server/routes/imageproxy.ts` +
  `server/lib/imageSources.ts` (allow-listed sources), `server/job/schedule.ts` (15 jobs),
  `server/routes/index.ts`, `server/index.ts`, `server/datasource.ts`.
- `server/routes/settings/index.ts` (music sections; Plex/Jellyfin routes split into
  `settings/plex.ts`, `settings/jellyfin.ts`), `server/routes/{auth,issue,blocklist,watchlist,overrideRule}.ts`,
  `server/routes/user/*`, notification agents (compile against music entities; wording is
  reworked in phase 8), `server/lib/overrideRules.ts`, `server/lib/scanners/baseScanner.ts`
  (run loop only), `server/api/{plexapi,servarr/base}.ts`.

**Rewritten / new**
- Entities `Track`, `TrackRequest`, `LinkedAccount`, `AppPassword`, `ScrobbleQueue`,
  `ImportJob`, `Event`, `Playlist`, `PlaylistItem`, `Star`.
- `server/lib/secrets.ts`, `server/lib/notifications/types.ts`.
- API contract: `docs/API_CONTRACT.md`, `server/models/music.ts`, `server/interfaces/api/*`.
- Route and module skeletons for every stream (see `changes/spine.md`).

**Dropped**
- `server/api/{themoviedb,tvdb,rating}/`, `animelist.ts`, `ratings.ts`, `tautulli.ts`,
  `metadata.ts`, `provider.ts`, `github.ts`, `servarr/{radarr,sonarr}.ts`.
- `server/lib/scanners/{radarr,sonarr}`, `overseerrMerge.ts`, `watchlistsync.ts`,
  `server/job/blocklistedTagsProcessor.ts`, `server/utils/{demoMode,typeHelpers}.ts`.
- Routes `movie`, `tv`, `person`, `collection`, `settings/{radarr,sonarr,metadata}`, the
  TMDB helper routes in `routes/index.ts` (regions, languages, genres, studios, networks,
  backdrops, keywords, watch providers, certifications).
- Entities `Season`, `SeasonRequest`; models `Movie`, `Tv`, `Person`, `Collection`, `Search`.
- All Seerr database migrations and settings migrations (Shufflerr is a new product; a v1
  settings-migration marker is in place).
- Client: movie/TV/person/collection components and pages (list in `changes/spine.md`).

**Decisions taken**
- Emby stays (it shares the Jellyfin code path; `UserType.EMBY`, `MediaServerType.EMBY`).
- Notification types stay a bitmask in storage; the API uses string keys.
- Initial database migrations were generated once at the end of the build (see Integration
  below); production runs migrations only.
- `TODO(decision)`: update check — needs a public release feed to compare against.

**Owner configuration**
- Nothing yet. From phase 3 on: a Lidarr server (Settings → Lidarr), at least one library
  source, and a MusicBrainz contact (Settings → MusicBrainz and Last.fm) for the `User-Agent`.

---

## Phase 2 — Metadata clients and browse

### Stream SV1 — metadata and browse

#### Rewritten (new code, no Seerr source)

- `server/api/musicbrainz/` — client on `ExternalAPI`: search (artist / release group /
  recording, Lucene-escaped), lookups with `inc`, browse release groups by artist with type
  filter and paging, release lookup for tracklists, raw Lucene searches for the import matcher
  (`searchReleaseGroupsRaw`, `searchReleasesRaw`, `searchRecordingsRaw`).
  One process-wide token bucket (`rateLimiter.ts`) fed by
  `metadata.musicbrainz.requestsPerSecond`; `User-Agent: Shufflerr/<version> ( <contact> )`;
  503/429 → back off and retry up to 3 times; mirror URL from settings; lookups cached 24 h,
  searches 1 h; identical simultaneous requests share one call.
- `server/api/coverartarchive.ts` — image-proxy path builders only (the browser never gets a
  CAA URL); returns null when Cover Art Archive is off.
- `server/api/fanart.ts` — artist thumb / background / logo by MBID as image-proxy paths.
- `server/api/lastfm.ts` — `artist.getInfo`, `artist.getSimilar`, `album.getInfo`,
  `tag.getTopAlbums`, plus the signed side for SV4/SV6: `getAuthUrl`, `sign`, `signedCall`,
  `getSession`, `updateNowPlaying`, `scrobble` (≤ 50 per call).
- `server/api/listenbrainz.ts` — sitewide artists / release groups, fresh releases (cached as a
  compact index), `validateToken`, `submitListens` / `submitPlayingNow` / `submitPlays`.
- `server/lib/metadata/` — `ensureMedia`, `syncTracklist`, `getDiscographyReleaseGroups`,
  `coverUrlFor`, `pickCanonicalRelease`, `flattenRelease`, `isMbid`; `details.ts` (album,
  artist, recording pages); `library.ts` (merging library status / requests into results);
  `mappers.ts`; `errors.ts`.
- `server/lib/search.ts` — unified search with library status merged in.
- Routes: `search`, `artist`, `release` (`/album`), `recording`, `discover`, `library`,
  `public` (slideshow).

#### Adapted from Seerr

- `server/routes/media.ts` (list / get / set status / clear).

#### Decisions

- **Canonical release:** preferred release (when it belongs to the group) → official only →
  earliest → digital → worldwide / home country / most common country → most tracks → MBID.
  Once picked, a release group keeps its release so Track ids stay stable; pass
  `preferReleaseMbid` (e.g. the release Lidarr has) to switch.
- **Re-syncing a tracklist never loses library data.** Existing rows are matched by recording
  MBID, then position + title, then title + length (±3 s). Unmatched rows that hold a library
  file or belong to a request are kept as extras (`discNumber 0`, position `x-NN`) and do not
  count towards `trackCount`; other unmatched rows are removed.
- **Search:** albums and tracks match every word across title and artist (MusicBrainz searches
  one field by default). When the words are exactly an artist's name, the album bucket lists
  that artist's own releases, studio albums first.
- **Artist library status** is derived from release groups in the library (`artistMbid`), so it
  does not depend on a scanner writing artist rows.
- **Discography filter** (`getDiscographyReleaseGroups`): primary type Album with no secondary
  types — Lidarr's "Standard" metadata profile. TODO(decision): read the real metadata profile
  of the target Lidarr server instead.
- **Trending** = release groups ListenBrainz users played most this week, those released in the
  last 60 days first. ListenBrainz's fresh-releases endpoint cannot sort by listens and its
  listen counts are zero, so on its own it is not a trending list.
- **Popular artists** = ListenBrainz sitewide artists when ListenBrainz trending is on,
  otherwise library artists ranked by plays (90 days), requests and albums held.
- **Slideshow** returns cover URLs only (no titles) — the privacy-friendly option in AUTH.md.
- **Request visibility:** viewers without REQUEST_VIEW / MANAGE_REQUESTS see that an album is
  requested but not by whom.

#### Owner configuration

- Settings → MusicBrainz and Last.fm → **Contact**: set an email or URL; MusicBrainz asks for
  one in the User-Agent (falls back to the application URL).
- fanart.tv API key for artist photos; without it artists show initials.
- Last.fm API key (+ shared secret for scrobbling) for bios, tags and similar artists.
- ListenBrainz trending switch for the Trending and Popular rows (no key needed).

#### Tests

63 tests in `server/api/musicbrainz/musicbrainz.test.ts`, `server/api/metadataClients.test.ts`,
`server/lib/metadata/metadata.test.ts`, `server/lib/metadata/library.test.ts`. Fixtures under
`server/test/fixtures/{musicbrainz,listenbrainz,coverartarchive}` are recorded responses;
`lastfm/` and `fanart/` are hand-written from the documented shapes (no keys were available).
`server/test/fixtureAdapter.ts` is a small shared helper for serving fixtures to any client.


---

## Phase 3 — Lidarr and the request engine

### Stream SV2 — Lidarr and requests

#### Adapted from Seerr (header added)

| File | From | Notes |
|---|---|---|
| `server/api/servarr/lidarr.ts` | `server/api/servarr/radarr.ts` | `LidarrAPI extends ServarrBase` on `/api/v1`. System status, quality/metadata profiles, root folders, tags, artist list / by MBID / lookup (`lidarr:<mbid>`) / add / update, albums by artist / by release-group MBID / lookup / add, album monitor, `AlbumSearch` / `ArtistSearch` / `RefreshArtist`, paged queue, history, tracks, track files. `LidarrAPI.fromSettings(server)` builds a client. |
| `server/entity/MediaRequest.ts` | same path | `MediaRequest.request()` rewritten per `docs/PERMISSIONS_AND_APPROVALS.md`; adds `refreshMediaStatus()`, `completeSatisfied()`, `RequestValidationError`, `ACTIVE_STATUSES`. No column changes. |
| `server/subscriber/MediaRequestSubscriber.ts` | same path | Transition side effects, the Lidarr hand-off, unmonitor on decline/cancel. |
| `server/lib/downloadtracker.ts` | same path | Lidarr queue → `downloadProgress`; failed imports → FAILED. |
| `server/lib/scanners/lidarr/index.ts` | `server/lib/scanners/radarr/index.ts` | Artists/albums → Media rows with Lidarr ids. |
| `server/routes/request.ts`, `server/routes/service.ts` | same paths | Contract routes. |
| `server/routes/settings/lidarr.ts` | `server/routes/settings/radarr.ts` | CRUD, test, profiles. |

#### New (no Seerr source)

- `server/lib/requestResults.ts` — `toRequestResults()` / `toRequestResult()` / `lastChangeLabel()`:
  entity → `RequestResult` (cover, profile name, canRemove/canManage, last change, playable).
  SV4 can use it for `GET /user/:id/requests`.
- `server/test/fakeLidarr.ts` — in-process Lidarr v1 on loopback for tests.
- `server/test/requestFixtures.ts` — test hooks: fake Lidarr, mocked `lib/metadata`, captured notifications.
- `server/test/fixtures/lidarr/*.json` — trimmed responses recorded from Lidarr 3.1.0.4875 (GET only, no key, release titles neutralised).
- Tests: `server/entity/MediaRequest.test.ts` (28), `server/routes/request.test.ts` (21), `server/routes/settings/lidarr.test.ts` (9).

#### How it behaves

- **Engine order**: acting user → permission → quota → blocklist → duplicate → already available →
  auto-approve → dry run → create. Everything needed to count the request is resolved first, then
  errors are raised in that order, so the user always sees the documented one.
- **Tracks scope**: omitted `trackMbids` = every track missing from the library. Tracks already
  available or covered by another active request are dropped; `trackCount` is what is left.
- **Discography `releaseCount`** is computed on the server (MusicBrainz discography minus release
  groups already fully in the library, minimum 1); the body's number is only a fallback when
  MusicBrainz can't be reached.
- **Media status** is derived, never hand-set: fully available → AVAILABLE; else any APPROVED
  request → PROCESSING; else any PENDING → PENDING; else the library status. Recomputed on create,
  approve, decline, fail, complete and delete (`MediaRequest.refreshMediaStatus(mediaId)`).
- **Side effects run after the saving transaction commits** (queued on the query runner), so they
  work on Postgres pools too. Tests await them with `flushRequestSideEffects()`.
- **Transitions are detected from `save()`** (saved entity vs. database row). `repository.update()`
  on a request does not fire them — the download tracker relies on that for progress ticks.
- **Hand-off**: server = request `serverId` → override rule → default (hi-res default for hi-res
  requests). Existing artist: make sure it is monitored (and `monitorNewItems: all` when "Watch for
  new releases" is on). Missing artist: lookup by MBID and add with `addOptions.monitor: none`,
  then wait for Lidarr to load its albums (10 × 3 s), falling back to adding the album from a
  lookup. Then monitor the album and run `AlbumSearch` unless "Enable automatic search" is off.
  Discography: new artist is added with `monitor: all` + search; existing artist gets every album
  monitored + `ArtistSearch`.
- **Failure** → request FAILED with a readable `failureReason` (no server set up, key rejected,
  unreachable, HTTP status + Lidarr's validation message, not found in metadata).
- **Unmonitor** only what Shufflerr itself switched on (`Media.lidarrAddedByShufflerr`) and only
  when no other active request wants it: on decline, and when an approved request is deleted.
- **Completion**: `MediaRequest.completeSatisfied(mediaId)` marks approved album/tracks requests
  COMPLETED once the library has them; the download sync calls it every minute, and scanners may
  call it right after updating Track/Media. Discography requests complete in the Lidarr scan when
  every monitored album of the artist has all its files.
- **Lidarr scan** creates a Media row per Lidarr artist and per album that is monitored or has
  files. It uses Lidarr's file counts for availability only when no library source (Plex, Jellyfin,
  Navidrome, local files) is switched on and no scanner has touched the row.
- **Default servers**: saving a default clears the flag on the other servers of the same class
  (standard / hi-res). A standard server is always default while one exists; hi-res may have none.

#### Deviations from the contract / spec

- `filter=approved` and `filter=processing` return the same set (status APPROVED), and
  `RequestCountResponse.processing === approved`.
- `POST /request` with a malformed body (unknown scope, wrong `mediaType`, track MBIDs not on the
  album) answers 400 via the new `RequestValidationError`; a dry run reports it as
  `{outcome:'blocked', code:'error'}`.
- New permission-class error: tracks scope while `main.allowTrackRequests` is off →
  "Track requests are turned off. Request the whole album instead."
- `userId` equal to the caller's own id is not treated as "someone else".
- Advanced fields are kept when the acting user has REQUEST_ADVANCED **or** MANAGE_REQUESTS.
- Quota copy says "weekly" for 7-day windows and "N-day" otherwise.
- `PUT /request/:id` works on PENDING and FAILED requests; discography ↔ album/tracks is refused
  (different Media row) with a message to cancel and request again.
- `GET /service/lidarr/:id` answers 502 with user copy when Lidarr is unreachable.
- Blocklist copy: "This has been blocked, so it can't be requested."

#### TODO(decision) / open

- Track-exact downloads (HANDOFF §6.5): Lidarr fetches a release. A tracks request monitors and
  searches the album; it completes when the requested tracks are present.
- Download sync fails an album/tracks request when its only queue item is `importFailed` /
  `failed`. On the owner's Lidarr the whole current queue (50 items) is in `importFailed`
  (manual-import warnings), so requests that land there will show Failed with Lidarr's reason until
  an admin resolves the import and retries.
- Not verified against the live server: every write (artist add, album add, monitor, commands).
  Only GETs were issued; the write paths are covered by the fake-Lidarr tests.

#### Owner configuration

Settings → Lidarr: hostname `lidarr.example.lan`, port `80`, API key from Lidarr → Settings → General,
then Test and pick quality profile, metadata profile and root folder (`/mediacatalog/music`).


---

## Phase 4 — Media servers, availability and streaming

### Stream SV3 — library

#### What exists

**Library core — `server/lib/library/`** (new)
- `types.ts` — `ScannedAlbum` / `ScannedTrack`: what every scanner hands over.
- `resolver.ts` — scanned album → MusicBrainz release group. Order: release-group id from the
  source → release id → ambiguous id (Plex / OpenSubsonic: tried as release, then release group)
  → artist + title search. A search hit is accepted only when artist **and** title agree after
  normalisation and the score is ≥ 85. Up to five real spellings are searched (tags, folder
  names, first credited artist, title without packaging words such as "(Maxi CD)" / "WEB").
  All lookups go through SV1's `getMusicBrainz()` (shared 1 req/s limiter and cache).
- `matching.ts` — scanned tracks → canonical tracklist: recording MBID → normalised title +
  duration ±3 s → looser title (bracketed qualifiers dropped) → title without an unbracketed
  guest credit (both durations required). ±10 s when title *and* disc/track number agree.
  Tracks that match nothing are left out, never forced onto a row.
- `ingest.ts` — `ingestAlbum()`: resolve → `ensureMedia(withTracks)` → attach tracks → recompute.
  When files are a different edition than the canonical one and the source did not name its
  release, up to two editions whose size fits the files are tried; one is kept only if it puts
  more of the library on the tracklist.
- `availability.ts` — `recomputeReleaseGroup`, `recomputeArtist`, `detachSource`, `countSource`,
  `recomputeAll`. Status rule: all tracks present → AVAILABLE; else an approved request →
  PROCESSING; a pending one → PENDING; else PARTIALLY_AVAILABLE / UNKNOWN. BLOCKLISTED is kept.
  APPROVED requests flip to COMPLETED when their scope is present (`album`: every track;
  `tracks`: the requested TrackRequests; `discography`: every release group from
  `getDiscographyReleaseGroups()` is AVAILABLE) — saved through the repository so the request
  subscriber notifies.
- `sourceScanner.ts` — run loop shared by all four scanners: list albums → skip unchanged ones
  (signature) → ingest → on a full run detach whatever the source no longer lists.
- `state.ts` — `<config>/db/library-state.json`: per source album its signature, release group
  and attached track ids; per local file its mtime/size/tags. Safe to delete (next scan
  re-ingests).
- `peaks.ts` — 96 peaks (0–255) per track via ffmpeg (4 kHz mono decode, one max per 50 ms),
  stored base64 in `Track.peaks`; background queue (2 at a time) after a local scan, and lazily
  on the first `/peaks` request.
- `stream.ts` — `streamTrack(req, res, trackId, {format, maxBitRate, download})`,
  `getTrackPeaks`, `getTrackSource`. Local files with Range (206/416), HEAD, download
  disposition; ffmpeg transcode for `opus-160`, `mp3-320`, `mp3-128`, `opus`, `mp3`
  (+`maxBitRate`); proxy with Range passthrough from Plex (Part key + owner token), Jellyfin
  (`/Audio/{id}/stream?static=true`) and Navidrome (`stream?format=raw`). Auth-agnostic.
  Only files under a configured music folder are served.

**Scanners**
- `scanners/local` — walk folders, tags with `music-metadata` (MBIDs included), grouping by
  folder + album tag, disc subfolders folded in, path fallback for untagged files, incremental
  by mtime/size, chokidar watcher (5 s debounce, waits for copies to finish).
- `scanners/plex` — music sections, albums (`type=9`, `includeGuids=1`) → tracks; full and
  recently added (last 24 h).
- `scanners/jellyfin` — Jellyfin/Emby `MusicAlbum` → `Audio` with `ProviderIds`; full and
  recently added (latest 50).
- `scanners/subsonic` — Navidrome through the new `server/api/subsonic.ts` (token auth,
  `getAlbumList2`, `getAlbum`, `getArtists`, `getArtist`, `search3`, OpenSubsonic MBIDs).

**Other**
- `lib/availabilitySync.ts` — sources that were switched off are detached; local files that no
  longer exist are detached; everything is recomputed.
- `subscriber/MediaSubscriber.ts` — a release group saved as AVAILABLE from outside the
  scanners completes the approved requests it satisfies.
- `routes/stream.ts` — `/track/:id`, `/track/:id/peaks`, `/track/:id/info`.
- `routes/settings/{plex,jellyfin,navidrome,local}.ts` + `scanPanel.ts` — per the contract.
  Secrets masked on GET and only overwritten when changed; connections are validated before a
  source can be switched on; every error says what to fix.

#### Seerr code
- Adapted (header present): `server/api/plexapi.ts`, `server/api/jellyfin.ts`,
  `server/lib/scanners/plex/index.ts`, `server/lib/scanners/jellyfin/index.ts`,
  `server/lib/availabilitySync.ts`, `server/subscriber/MediaSubscriber.ts`,
  `server/routes/settings/plex.ts`, `server/routes/settings/jellyfin.ts`.
- Removed from the Jellyfin client: movie/TV methods (`getLibraryContents`, `getRecentlyAdded`,
  `getItemData`, `getSeasons`, `getEpisodes`) and their types. `getLibraries()` now returns
  music libraries only. Added `getMusicAlbums`, `getAlbumTracks`, `authHeaders`.
- Removed from the Plex client: movie/TV item types and `getLibraryContents`, `getMetadata`,
  `getChildrenMetadata`, `getRecentlyAdded`. Added `getAlbums`, `getAlbumTracks`, `getTrack`,
  `getTrackPartKey`.

#### Decisions
- **Albums MusicBrainz cannot identify are not indexed and not lost**: they are recorded as
  unresolved in the scan state and looked up again after 7 days or when their files change.
  No MBID is ever invented. `libraryState.unresolved(source)` lists them (no UI yet).
- **MusicBrainz or metadata unreachable** → the album is postponed and tried on the next run.
- **An empty listing never wipes the library**: a full scan that finds no albums removes
  nothing (unmounted folder / unreachable server). The availability sync likewise leaves a
  folder alone when the folder itself cannot be read or is empty.
- **Artist status** is AVAILABLE as soon as the library holds anything by the artist; an open
  discography request is reported separately (as `models/music.ts` documents).
- **`Full rescan` (local)**: the job ticks every 15 minutes; with a longer interval the scanner
  skips scheduled ticks that come too soon. Scans from the settings page or the watcher always
  run. TODO(decision): "Run now" on the Jobs page goes through the same scheduled entry point,
  so with an hourly/daily interval it is skipped when a scan ran recently — `schedule.ts`
  (SV5) should call `localFilesScanner.run({ force: true })` for manual runs.
- **Completed requests are not reopened** when files disappear later; the album's status steps
  back (Seerr behaviour).

#### Deviations
- No `plex` / `jellyfin` / `navidrome` image-proxy sources are registered: covers come from the
  Cover Art Archive URL SV1 builds. The schema has no column for a media-server thumb path.
- `PUT /settings/{plex,jellyfin}/library/:id` returns the whole `Library[]` (contract), not the
  single library Seerr returned.
- `DELETE /settings/local/folders` also accepts `?path=` (some proxies drop DELETE bodies).
- `POST /settings/jellyfin` accepts either Seerr's `ip/port/useSsl/urlBase` or a single `url`.
- Plex needs the owner's Plex token (owner signed in with Plex or linked it); without it the
  Plex settings routes answer 400 with that explanation.
- One additive edit outside the stream: `server/routes/auth.ts` — `POST /auth/setup-local` added
  as the primary path of SV4's existing first-run owner route (`/setup` kept as alias), as the
  coordinator asked.

#### Tests (`pnpm test server/lib/library/*.test.ts`) — 39, no network
- `library.test.ts`: normalisation, matching, resolver (fake gateway), search spellings, edition
  choice, local grouping on the real CTRL ESCAPE tags, Plex / Jellyfin / Subsonic mapping,
  Range parsing, peak reduction.
- `availability.test.ts` (SQLite): 9/13 → PARTIALLY_AVAILABLE; 13/13 → AVAILABLE and the
  `tracks` request COMPLETED; album and discography completion; two sources on one track;
  unresolved/deferred change nothing; streaming a file with 200 / 206 / 416 / 404, folder
  allow-list, download disposition, stored peaks.
- Fixtures: `server/test/fixtures/local/ctrl-escape-files.json` is recorded from the real
  files. `fixtures/{plex,jellyfin,subsonic}/*` are **hand-built in the documented response
  shapes** from the recorded MusicBrainz release — no Plex, Jellyfin or Navidrome server was
  available to record from.

#### Live check (real library, read-only, 2026-10-05)
`/srv/music`: 1,116 audio files → 113 album groups.
- 97 groups ingested into 89 release groups / 9 artists; 765 tracks playable; 71 albums fully
  available, 18 partly. 16 groups unresolved (scene-named folders, "VA" compilations, promo
  singles MusicBrainz does not list under those names). 52 files in ingested albums matched no
  canonical track (other mixes, bonus tracks of other editions) and were left out.
- First scan 253 s (MusicBrainz at 1 req/s); a rescan of the unchanged library 1 s (113 skipped).
- CTRL ESCAPE: 13/13, AVAILABLE. Range request `bytes=1000-65999` → 206, bytes identical to the
  file; HEAD; 416 past the end; FLAC full download; `format=opus-160` → Ogg Opus; peaks: 96
  values in 1.7 s on first request, then stored.
- Not verified live: Plex, Jellyfin/Emby and Navidrome scanning and proxy streaming (no server
  credentials); the folder watcher was started but no file was changed.

#### Owner configuration
- Mount the music folder read-only (compose / k8s: `/music`), then Settings → Local files →
  add `/music`.
- ffmpeg must be in the image (it is, per the Dockerfile) for peaks and transcoding.


---

## Phase 5 — Auth and the user system

### Stream SV4 — auth and users

Scope: `server/routes/auth.ts`, `server/routes/user/**`, `server/routes/callback.ts`,
new `server/lib/auth/**`. Specs: `docs/AUTH.md`, `docs/USER_SYSTEM.md`, `docs/API_CONTRACT.md` §SV4.

#### Kept (Seerr logic unchanged)

- Session handling, `checkUser` / `isAuthenticated`, `/auth/me`, logout, web-push subscription
  routes, Jellyfin Quick Connect (initiate / check / authenticate), avatar refresh at sign-in,
  password hashing (bcrypt) and the reset-password guid flow.
- `server/api/plextv.ts`, `server/lib/refreshToken.ts`, `server/middleware/auth.ts` — untouched.

#### Adapted

- **Plex sign-in** — first user becomes owner; existing by `plexId`; link by email; unknown user
  needs server access (checked with the owner's Plex token) and `main.newPlexLogin`, else 403 with
  the AUTH.md copy. Gated by `main.mediaServerLogin && plex.loginEnabled` (not by
  `mediaServerType`, which is now only "what the owner signed in with"). If the owner never
  linked Plex there is no token to check access with, so only accounts that already exist
  (imported or linked) can sign in.
- **Jellyfin / Emby sign-in** — new rule `jellyfin.newLogin` (Seerr reused `newPlexLogin`);
  gated by `main.mediaServerLogin && jellyfin.loginEnabled`; exact copy for unknown account and
  bad credentials. The owner-setup branch now runs **only when no users exist**. Seerr also ran
  it whenever `mediaServerType` was unset — with a local owner that would have overwritten user
  1 with whoever signed in through Jellyfin. New Jellyfin users no longer get their Jellyfin
  password copied into a Shufflerr password.
- **Local sign-in** — AUTH.md copy for empty / unknown email / media-server account without a
  password; 400/403 instead of Seerr's 500s; errors are `{message}` through the error handler.
- **Reset password** — answers `ok` without sending anything while the email agent is off;
  400s with plain copy for a short password or dead link.
- **Users API** — list needs MANAGE_USERS or MANAGE_REQUESTS (Seerr: any signed-in user); `q`
  search; sorts `created` (newest first) / `displayname` / `requests` / `usertype` / `role`;
  create-local validation with the inline copy from USER_SYSTEM.md; bulk permission edit never
  touches the owner, the caller, or (unless the caller is the owner) another admin; delete
  refuses the owner and yourself; import-from-Plex/Jellyfin return the created users as an
  array (`ImportUsersResponse`); quota readable by the user, MANAGE_USERS or MANAGE_REQUESTS.
- **User settings** — main (quota overrides only by MANAGE_USERS, not for yourself, `null` =
  back to global; `autoRequestSpotifySaved` needs AUTO_REQUEST / AUTO_REQUEST_ALBUM; email
  validated and unique), password (current-password / 8 characters / confirmation copy),
  notifications in the contract's `channels` shape with string type keys, permissions (owner is
  never editable; nobody edits themselves; only the owner grants or changes an admin; ADMIN is
  stored alone).
- Plex / Jellyfin linking and unlinking moved behind the generic
  `…/linked-accounts/:provider` routes and return `LinkedAccountStatus` (Seerr: 204).

#### New

- `server/lib/auth/rateLimit.ts` — 10 failed attempts per minute per IP on `/auth/plex`,
  `/auth/jellyfin`, `/auth/jellyfin/quickconnect/authenticate`, `/auth/local`, `/auth/setup`,
  `/auth/reset-password*` (429 "Too many sign-in attempts…"). Successful sign-ins don't count.
  Off under the test runner unless `AUTH_RATE_LIMIT_IN_TESTS=true`.
- `POST /api/v1/auth/setup` `{username?, email, password}` → 201 User. **First run only**:
  creates the owner as a Shufflerr (email + password) account so the app can be initialised
  without Plex or Jellyfin. 403 once any user exists. _(Not in API_CONTRACT.md — add it.)_
- `server/lib/auth/appPasswords.ts` — app passwords (`xxxxxx-xxxxxx-xxxxxx`).
- `server/lib/auth/linkedAccounts.ts` — Last.fm, ListenBrainz and Spotify links.
- `server/routes/callback.ts` — `/api/v1/callback/lastfm` and `/api/v1/callback/spotify`.
- `GET /user/:id/recently-played` — from `ScrobbleQueue` (real plays only; empty until the
  scrobble pipeline records some), consecutive repeats collapsed.
- Tests: `server/routes/user/rules.test.ts` (50 tests) + updated `auth.test.ts`,
  `usersettings.test.ts`.

#### Decisions and trade-offs

- **App passwords are stored twice** (docs/AUTH.md): an argon2id hash for plain-password
  sign-ins, and an AES-256-GCM encrypted copy (key derived from `settings.serverSecret`) because
  Subsonic token auth (`t = md5(password + salt)`) needs the plaintext on the server. Someone
  holding both `settings.json` and the database can recover app passwords. They cannot recover
  account passwords, and an app password only opens the client APIs. Revoking deletes the row.
- **OAuth `state` is kept in memory** (10 minutes, single use) and carries the user id, so the
  provider's return completes even when the session cookie is withheld (SameSite=Strict when
  CSRF protection is on). Consequences: a link attempt does not survive a server restart, and
  `/api/v1/callback` is mounted without `isAuthenticated()` — one-line change in
  `server/routes/index.ts` (the only edit outside this stream's files).
- **Provider calls for linking live in `linkedAccounts.ts`** (`auth.getSession`,
  `validate-token`, Spotify token exchange + `/v1/me`), not in SV1's `lastfm.ts` /
  `listenbrainz.ts` or SV6's `spotify.ts`, which had no agreed signatures when this was
  written. They are three small calls on a class extending `ExternalAPI`; fold them into the
  shared clients later if wanted.
- **Unlinking Plex/Jellyfin** is allowed for anyone (owner included) as long as another way to
  sign in remains (a password with local sign-in on, or the other media-server link). Seerr
  blocked the owner outright; with a local owner that would make a Plex link permanent.
- **Linking Plex no longer requires matching emails** (Seerr did); the Plex id is what sign-in
  matches on. The owner may link Plex even while Plex sign-in is off.
- `GET /user/:id` stays open to any signed-in user with the filtered (no email/settings) shape,
  as in Seerr — request lists show other users' names and avatars. The contract says "own or
  MANAGE_USERS".
- `GET /user/:id/requests` still returns raw `MediaRequest` rows cast to `RequestResult[]`;
  switch to SV2's mapper once `routes/request.ts` exports one.

#### Owner must configure

- Spotify app redirect URI: `<applicationUrl>/api/v1/callback/spotify`.
- Last.fm needs no registered callback (it is passed per request:
  `<applicationUrl>/api/v1/callback/lastfm`); the API key and shared secret must both be set.
- `main.applicationUrl` should be set; otherwise callback URLs are built from the request's
  host, which is wrong behind a proxy that rewrites it.

#### Not verified live

- Real Plex PIN sign-in, Jellyfin sign-in, and the Last.fm / ListenBrainz / Spotify exchanges
  (no accounts or keys here): covered with mocked HTTP only.


---

## Phase 6 — Front end

### Stream FE1 — UI foundation, shell, player, auth pages

Guide for page agents: `docs/UI_KIT.md`.

#### Kept (Seerr, restyled through tokens only)

`Common/{Accordion, ButtonWithDropdown, ConfirmButton, LabeledCheckbox, LoadingSpinner,
MultiRangeSlider, PageTitle, PlayButton, ProgressCircle, QuickConnectModal, SensitiveInput,
StatusBadgeMini, Tag, Tooltip}`, `LoadingBar`, `Layout/UserWarnings`, `Login/AddEmailModal`,
`Login/JellyfinQuickConnectModal`, `Setup/JellyfinSetup`, hooks (`useUser`, `useSettings`,
`usePlexLogin`, `useQuickConnect`, `useRouteGuard`, `useToasts`, …), `utils/plex.ts`.
They pick up the Shufflerr look because Tailwind's `gray`/`indigo` scales are remapped to the
design tokens in `tailwind.config.js`.

#### Adapted (attribution header added)

- `tailwind.config.js`, `src/styles/globals.css` — tokens (dark default, light via
  `data-theme`), fonts, scrollbars, focus ring, reduced motion; mockup component CSS ported 1:1
  with an `sh-` prefix; legacy Seerr form classes kept and re-tokenised.
- `Common/{Button, Modal, SlideOver, Table, Badge, Alert, Dropdown, Header, List, SettingsTabs,
  CachedImage, SlideCheckbox}` — same props, new look. Modal gained focus trap, Esc, close button.
  Button gained `buttonType="accent"`. CachedImage `type` is now `cover | artist | avatar`.
- `Layout/index.tsx` — replaced sidebar/mobile menu with the icon rail + top bar + player.
- `Toast`, `StatusBadge` (now music labels: `status` / `requestStatus`), `PWAHeader`.
- `Login/*` (two-panel card, Plex PIN button, Jellyfin/Emby dialog with Quick Connect, local
  form), `ResetPassword/*`, `Setup/*` (same 4 steps on the auth shell), `_app.tsx`,
  `_document.tsx`, `SettingsContext`, `UserContext`, `useUser` (`/logout` is a public route).

#### New (no Seerr source)

`Layout/{Rail, TopBar, AccountMenu}`, `Player/{index, Waveform}`, `context/PlayerContext`,
`hooks/{usePlayer, useTheme, useScrobbleTargets}`, `CoverArt`, `AlbumCard`, `ArtistCard`,
`HorizontalRow`, `Common/{Panel, SwitchRow, Field, FilterChips, EmptyState, ProgressBar,
QuotaRing, PageHeader, Avatar, StatusDot, RoleBadge}`, `Login/AuthShell` (slideshow),
`pages/logout.tsx`, `utils/{images, format, status, publicSettings}`.

#### Dropped

`Layout/{Sidebar, MobileMenu, SearchInput, UserDropdown, PullToRefresh, Notifications,
VersionStatus, LanguagePicker}`, `Common/{ImageFader, ListView}`, `hooks/{useDiscover,
useRequestOverride, useSearchInput}`, `utils/creditHelpers`, `utils/refreshIntervalHelper.test`
(movie/TV only). `@fontsource-variable/inter` is no longer imported (dependency can be removed).

#### Deviations from the mockup

- Plex button text is dark (`#1B1405`) as docs/FRONTEND.md specifies; the mockup's cascade
  rendered it white on orange (2.2:1 contrast).
- Login slideshow tiles are real covers only — no titles, no placeholder tiles. With an empty
  library the background is plain dark and the footer drops the "Background shows album art"
  clause.
- "Demo:" hint under the local form is not built (mockup-only).
- Auth screens stay dark under the light theme (the mockup hardcodes dark there too).
- The pending pill is hidden at 0 instead of showing "0 waiting for approval".
- Player with nothing queued shows "Nothing playing. Pick a track from your library to start."
  (the mockup always had a sample track). Prev/next/play are disabled then.
- Waveform is a `role="slider"` (arrow keys seek) rather than a plain button.
- Language picker removed from the auth screens (mockup has none); language is set in user
  settings.
- Toasts keep a dismiss button (Seerr behavior) in addition to auto-dismiss.
- Phone top bar: search, theme and account stay on one row (the `/` hint is hidden).
- Setup has no "create local admin" path: the API contract has no endpoint for it; the first
  Plex/Jellyfin/Emby sign-in becomes the owner (Seerr behavior).

#### TODO / for other streams

- Run `pnpm i18n:extract` after adding messages; other locale files still carry Seerr strings
  for reused ids.
- `src/pages/404.tsx` and `_error.tsx` still have Seerr copy ("Page Not Found", "Return Home").
- `/setup` could not be rendered yet: it imports the old Seerr `Settings/SettingsPlex`,
  `SettingsJellyfin` and `SettingsServices`, which don't compile until the admin stream adapts
  them.

### Stream FE2 — browse and request pages

Phase 6 pages built on FE1's kit (`docs/UI_KIT.md`) against `docs/API_CONTRACT.md`.
Nothing here holds sample data: every list, count and image comes from the API, and each
screen has loading, empty and error states.

#### Screens

| Route | Component | Notes |
|---|---|---|
| `/`, `/discover` | `Discover`, `Discover/FeaturedRelease` | Hero with live stats; featured band hidden when `/discover/featured` returns `album: null`; rows hide when `enabled` is false or empty |
| `/search?query=&type=` | `Search`, `Search/TrackResults` | Chips with counts from the `type=all` query; per-type tabs page with "Show more" |
| `/artist/[mbid]` | `ArtistDetails`, `ArtistDetails/Discography` | Facts, about, details, discography with type chips, similar, links, Manage |
| `/album/[mbid]` | `AlbumDetails`, `AlbumDetails/Tracklist` | Status banner, progress, tracklist (multi-disc headers), Report a problem, Manage |
| `/artists`, `/albums` | `Library/Artists`, `Library/Albums` | Paged grids; sort, filter and text filter kept in the URL |
| `/requests?filter=&sort=&page=` | `RequestList`, `RequestList/RequestItem` | Chips with counts, approve / decline (optional note) / cancel / retry / play, progress, 10 s refresh while anything downloads |
| `/import?job=` | `Import`, `Import/MatchList` | Link → albums → request checked; Spotify saved albums; recent links |
| 404, error | `pages/404.tsx`, `pages/_error.tsx` | Shufflerr copy |

Shared pieces: `RequestModal` (the release request dialog with live dry-run outcome, track
picker and advanced selects), `RequestButton` (opens it; hides without any request permission),
`RequestModal/subject.ts`, `Playback` (`usePlayback`: play album, play track, YouTube fallback),
`RequestList/requestText.ts` (titles, type labels, relative time), `RequestCard`,
`RequestBlock`, `DownloadBlock`.

#### Kept / adapted / rewritten / dropped

- **Adapted (Seerr header added):** `RequestModal/index.tsx` (from `TvRequestModal`: season
  picker → scope radio cards + track picker), `RequestButton`, `RequestList`,
  `RequestList/RequestItem`, `RequestCard`, `RequestBlock`, `DownloadBlock`, `Search`,
  `Discover`, `pages/404.tsx`, `pages/_error.tsx`.
- **Rewritten (no Seerr source):** `ArtistDetails`, `AlbumDetails`, `Library/*`, `Import/*`,
  `Playback`, `Discover/FeaturedRelease`, `Search/TrackResults`.
- **Dropped:** `Slider`, `MediaSlider`, `TitleCard` (+ `TmdbTitleCard`, `ErrorCard`,
  `Placeholder`), `Discover/{CreateSlider,DiscoverSliderEdit,FilterSlideover,
  RecentlyAddedSlider,RecentRequestsSlider,Trending,constants}`,
  `RequestModal/{MovieRequestModal,TvRequestModal,CollectionRequestModal,AdvancedRequester,
  QuotaDisplay,SearchByNameModal}`, `pages/discover/trending.tsx`. `HorizontalRow`,
  `AlbumCard` and `ArtistCard` replace the sliders and title cards. The Discover row editor
  (`DiscoverSlider` admin UI) is a backlog item and has no UI.

#### Deviations from the mockup

- Row captions that stated something the server can't guarantee were reworded:
  "Imported from Lidarr this week" → "The newest albums in your library"; "Popular on
  ListenBrainz in the last 7 days" → "New releases people are listening to this week" (the row
  may come from ListenBrainz or the iTunes chart); "Most requested on this server" → "Most
  played and requested on this server".
- The request dialog only offers "Everything by <artist>" to people who may request
  discographies, and "Only the missing tracks" only when track requests are on and tracks are
  missing. The mockup always shows all three.
- The request dialog has a track picker under "Only the missing tracks" (all missing tracks
  checked by default) and a "Watch for new releases from <artist>" checkbox on the discography
  scope (`monitorFuture` in DATA_MODEL). Neither is in the mockup.
- Declining a request opens a small dialog with an optional note (`declineReason`); the mockup
  declines in one click.
- The Requests page has a sort select and paging, and the Downloading chip filters on
  `approved`. The mockup shows one unpaged list.
- Tracks without a file get a "YouTube" button only while the YouTube integration is on; it
  plays in YouTube's own player. The mockup has no control on missing tracks.
- Artist and Album pages have a "Manage" button for request managers and a Links row built
  from `links`. The mockup has "Open in Plex" only.
- The search top-result card and artist rows show MusicBrainz's disambiguation, type and
  area — the mockup's "Featured on …" lines were invented sample copy.
- Album cards in rows have no "Cover art" caption (real art, or the tinted slot).

#### Contract gaps

- **Watch for new releases (artist page).** `ArtistDetails.lidarr.monitorNewItems` is
  read-only in the contract and no route changes it. The button calls
  `POST /api/v1/artist/:mbid/watch { enabled: boolean }` (managers only, shown when the artist
  is in Lidarr). That route does not exist yet — it needs adding (SV1 route, SV2 Lidarr call),
  or the button removed.
- `RequestCountResponse` has both `approved` and `processing`; the Downloading chip uses
  `approved` to match the list filter it applies.
- The discography option's "N releases" line needs a count before a request exists; it comes
  from the dry run's `releaseCount` and falls back to a line without a number.

#### Owner configuration

None. Import shows whichever of Spotify, Deezer and iTunes are turned on in Settings.

### Stream FE3 — users, profile, user settings

#### Stable exports for other agents (read this first)

##### `@app/components/PermissionEdit` (default export)
Props kept from Seerr:
- `currentPermission: number` — the bitmask being edited.
- `onUpdate: (newPermission: number) => void` — called with the new bitmask on every change.
  If ADMIN is set the value is just `Permission.ADMIN`.
- `actingUser?: User` — who is editing (defaults to the signed-in user). Non-owners can't
  grant ADMIN / MANAGE_SETTINGS they don't hold themselves (Seerr rule kept).
- `currentUser?: User` — whose permissions are edited (omit for bulk edit / default permissions).
Renders the music permission tree (`sh-perm`): Access, Management, Requests, Auto-approve.
A checked parent shows its children checked + disabled.

##### `@app/components/NotificationTypeSelector` (default export)
Works on string keys (`NotificationTypeKey`: pending, autoApproved, approved, declined,
available, failed).
- `currentTypes: NotificationTypeKey[]`
- `onUpdate: (types: NotificationTypeKey[]) => void`
- `managerOnly?: boolean` — default `true` = manager-only types (pending, autoApproved) are
  offered; pass `false` to hide them (users without MANAGE_REQUESTS).
- `availableTypes?: NotificationTypeKey[]` — restrict to this list (server's `availableTypes`).
- `legend?: string` — fieldset legend, default "What to send".
- `error?: string`
Named export `notificationTypeLabel(intl, key)` returns the fixed label for a type.

#### What was built

Routes (Next pages):
- `/users` → `UserList`
- `/users/[userId]`, `/profile` → profile Overview
- `/users/[userId]/requests`, `/profile/requests` → profile Requests
- `/users/[userId]/settings/[[...tab]]`, `/profile/settings/[[...tab]]` → user settings. Tab slugs:
  `general` (default; `main` accepted), `password`, `linked-accounts` (`linked` accepted),
  `app-passwords` (`apps` accepted), `notifications[/<channel>]`, `permissions`.

| Seerr path | Action | Now |
|---|---|---|
| `src/components/UserList/index.tsx` | Adapted (rewritten on the kit) | list, search, sort, selection, paging, delete confirm, credit line |
| `UserList/BulkEditModal.tsx` | Adapted | bitwise-AND prefill, never the owner |
| `UserList/PlexImportModal.tsx`, `JellyfinImportModal.tsx` | Adapted → one `ImportUsersModal.tsx` | driven by `GET /settings/{plex,jellyfin}/users` |
| (create-user modal inside UserList) | Adapted → `UserList/CreateUserModal.tsx` | generated-password rule tied to `emailEnabled` |
| `UserProfile/index.tsx`, `ProfileHeader` | Adapted | header card + Overview / Requests / Settings tabs |
| — | New | `UserProfile/Overview.tsx`, `Requests.tsx`, `RequestTitle.tsx`, `shared.tsx` |
| `UserSettings/index.tsx` | Adapted | pill sub-nav, Permissions visibility rule |
| `UserSettings/UserGeneralSettings` | Adapted → `General.tsx` | + Spotify auto-request switch, Request limits panel (album/track) |
| `UserSettings/UserPasswordChange` | Adapted → `Password.tsx` | three cases + exact copy |
| `UserSettings/UserLinkedAccountsSettings/index.tsx` | Adapted → `LinkedAccounts.tsx` | rows from the server's `accounts[]`; + Last.fm, ListenBrainz, Spotify |
| `UserLinkedAccountsSettings/LinkJellyfinModal.tsx`, `LinkJellyfinQuickConnectModal.tsx` | Kept | untouched |
| `UserSettings/UserNotificationSettings/*` (6 files + web push devices) | Adapted → one `Notifications.tsx` | per-channel form posting `{channels:{<agent>:…}}` |
| `UserSettings/UserPermissions` | Adapted → `Permissions.tsx` | owner note, tree editor |
| — | New | `UserSettings/AppPasswords.tsx` |
| `PermissionEdit/index.tsx` | Rewritten on the music tree | see top of this file |
| `PermissionOption/index.tsx` | Dropped | folded into `PermissionEdit` |
| `NotificationTypeSelector/*` | Rewritten on string keys | see top of this file |
| `QuotaSelector/index.tsx` | Kept untouched | not used by my pages (plain number + period selects per the mockup); left for the admin agent if wanted |
| `src/pages/{users,profile}/**/watchlist.tsx`, per-channel notification pages, `settings/main.tsx` etc. | Dropped | replaced by the catch-all settings route |

#### Deviations from the mockup / spec
- Display language lists every locale the app ships (USER_SYSTEM.md: "use the app's i18n list"), plus a
  "Server default" entry; Discover region lists all countries with a "Server default" entry.
- Role on the General tab is shown as the role badge rather than a read-only text input.
- App passwords: Server and Username rows have Copy buttons (asked for in the brief; the mockup shows plain rows).
  When viewing someone else, creating is disabled with a note (the contract makes POST own-only); Revoke still works.
- Linked accounts: linking is own-only per the contract, so "Link …" is disabled when an admin views another
  user. Two-letter tiles, no third-party logos. Emby shows as "Emby" when that is the server type.
- Web push: Seerr's per-device list is gone. Saving the channel with the switch on registers this browser,
  off unregisters it (own account only).
- User notification extras kept from Seerr beyond the spec: PGP public key (email), "Send silently" (Telegram).
  Not surfaced: Telegram thread id / bot username, Pushover sound (the contract carries them; the spec doesn't list them).
- Profile "Recently played" hides entirely when the server reports `enabled:false`; cards get a Play button when the
  play is `playable`.
- Paging (Previous / Next) on the user list (25 per page) and the profile Requests tab (20 per page); the mockup
  has no paging because its data set is tiny.
- The profile header shows no "Edit user" for yourself (the Settings tab is right there), as in the mockup.

#### For integration
- i18n: every file has one uniquely-namespaced `defineMessages`. `components.UserList`, `components.UserProfile`,
  `components.PermissionEdit`, `components.NotificationTypeSelector` reuse Seerr namespaces, so `en.json` holds stale
  Seerr copy for some ids until `pnpm i18n:extract` is run.
- Not run in a browser (no dev server allowed in the shared tree). Typecheck and eslint are clean for my files.


---

## Phases 7 and 8 — Admin area, notifications, jobs, logs

### Stream SV5 — settings API, notifications, jobs

#### What works (and how it was checked)

All of it is covered by `server/routes/settings/settings.test.ts` (37 tests, real router +
SQLite through supertest, HTTP stubbed) and `server/lib/notifications/music.test.ts`
(18 tests). `pnpm typecheck:server` and eslint are clean for the files below. The API was not
booted as a whole process for this stream, and no notification was sent to a real service.

##### Settings routes (`server/routes/settings/index.ts`) — adapted from Seerr
- Every section validates before saving and answers `400 {message}` with copy that says what
  to fix; unknown keys in a body are dropped (`pickKnown`) so a request can't add keys to
  `settings.json`.
- **General** `/main`: title required, URL must be http(s) without trailing slash, locale from
  the app's list, region two letters; the API key only changes through `/main/regenerate`.
- **Users** `/users`: "At least one sign-in method has to stay on.", limits 0–100000, periods
  1–365 days, default permissions.
- **Network** `/network`: Seerr semantics; proxy password masked; proxy needs a hostname when
  on; min TTL ≤ max TTL (−1 = no maximum).
- **Metadata** `/metadata`: MusicBrainz URL + requests/second (the public server is held to
  1 rps), contact (email or URL), fanart.tv / Last.fm need their key before they turn on.
  Changing the MusicBrainz URL flushes its cache.
- **YouTube**, **Discover** (`spotify`, `deezer`, `itunes`, `ticketmaster`, `skiddle`,
  `listenbrainzTrending`), **Scrobble**, **Clients** (+ devices list / revoke).
  Changing Spotify's saved-albums check to hourly/daily reschedules the job.
- **Test buttons**: `POST /metadata/test/:service`, `/youtube/test`,
  `/discover/test/:service`, `/scrobble/test/:service` → `ConnectionTestResponse`. One real
  call each (`server/routes/settings/connectionTests.ts`), with unsaved form values; a masked
  or missing secret means "use the stored one".
- **Jobs**: list (with `scheduleText`, `enabled`, `cancellable`), run now, cancel, edit schedule
  (validated 6-field cron, persisted, applied live). **Cache**: display names per
  ADMIN_PAGES, flush, DNS flush, `POST /cache/images/cleanup`. **About**: real counts.
- Logs route is Seerr's reader, unchanged.

##### Notifications
- `server/lib/notifications/music.ts` (new): `MusicNotificationPayload`,
  `buildRequestNotification(type, request)`, `notifyRequest(type, request, options?)` — the one
  call SV2's subscriber needs. Routing: pending/autoApproved → managers; approved/declined/
  available → requester; failed → both. Subject "<Album> — <Artist>" or
  "<Artist> — discography"; `extra` carries Scope, Reason, Approved/Declined by; cover image is
  `<applicationUrl>/imageproxy/caa/release-group/<mbid>/front-500` (only with an application
  URL, never for artists).
- All 10 agents kept. Status labels are the fixed UI labels; email and web push bodies
  reworded (no movie/series/4K); webhook variables are the ADMIN_PAGES list plus
  `{{notification_key}}`; a variable used twice in one string is replaced twice.
- `server/routes/settings/notifications.ts` rewritten as one generic per-agent handler:
  `GET /` overview, `GET|POST /:agent`, `POST /:agent/test`. String type keys, masked secrets,
  per-agent validation when enabled, email `encryption` choice, webhook template as text.
- Email templates restyled to the Shufflerr palette and sentence case.
- `server/i18n/globalMessages.ts` + regenerated `server/i18n/locale/en.json`.

##### Jobs (`server/job/schedule.ts`)
- Generic running state for every job, a job never overlaps itself, `runJobNow`, `cancelJob`,
  `setJobSchedule`, `isValidSchedule`, `describeSchedule`, `jobItem`, `stopJobs`,
  `cleanImageCache`. Download sync is labelled per-minute.

#### Deviations from the contract (all additive)
- New routes: the four `…/test…` endpoints above.
- `JobItem` gained optional `scheduleText`, `enabled`, `cancellable`; `POST /jobs/:id/run`
  answers `running: true` plus `alreadyRunning`.
- `POST /jobs/:id/cancel` answers 400 for a running job that has no cancel hook.
- `POST /settings/notifications/:agent/test` answers 400 (not 500) when the service refuses.
- Discord/Slack webhook URLs are masked like other secrets.
- `docs/API_CONTRACT.md` updated for these.

#### Decisions / notes for the owner
- The connection tests call the services directly with axios rather than through the other
  streams' clients, so the Test buttons don't depend on them.
- `GET /settings/notifications/pushover/sounds` lives in `server/routes/index.ts` (not this
  stream's file) and needs the plaintext token in the query; with a masked stored token the
  sound list only loads after the token is typed again.
- Non-English server locales keep Seerr's translations for the unchanged labels and fall back
  to English for the reworded messages.
- nock does not work under `server/test/setup.ts` (its outbound-request blocker fires first
  and the process then hangs); these tests stub `axios.get/post` with `node:test` mocks.
- Nothing to configure: every agent and integration stays off until its page is filled in.

### Stream FE4 — admin pages and setup wizard

Scope: `src/pages/settings/**`, `src/components/{Settings,Setup,JSONEditor,LanguageSelector,RegionSelector}`.
Verified with `tsc --noEmit` (0 errors in the whole client), eslint and prettier on these
files. Not run in a browser by this stream (one shared checkout; the integrated app is run
afterwards).

#### Rewritten (Seerr used as reference, attribution header kept)

| File | From Seerr | Notes |
|---|---|---|
| `Settings/SettingsLayout.tsx` | `SettingsLayout.tsx` | Grouped sidebar (`sh-admin`/`sh-snav`), `<select>` with optgroups below 980px, status dots from `settings/public.integrations`, MANAGE_SETTINGS guard |
| `Settings/SettingsMain.tsx` | `SettingsMain/index.tsx` | General page |
| `Settings/SettingsUsers.tsx` | `SettingsUsers/index.tsx` | Sign-in methods (≥ 1 rule), global limits, default permissions |
| `Settings/SettingsNetwork.tsx` | `SettingsNetwork/index.tsx` | Same semantics |
| `Settings/SettingsPlex.tsx`, `SettingsJellyfin.tsx` | same names | Connection, plex.tv presets, music libraries, scan panel, sign-in note; `isSetupSettings` |
| `Settings/SettingsLidarr.tsx`, `LidarrModal.tsx` | `SettingsServices.tsx`, `RadarrModal` | Server cards with live status; modal with Test-loads-profiles, metadata profile, hi-res |
| `Settings/SettingsNotifications.tsx` | `SettingsNotifications.tsx` + `Notifications/*` | One generic agent form driven by a field table instead of ten files |
| `Settings/SettingsLogs.tsx`, `SettingsJobsCache.tsx`, `SettingsAbout.tsx` | same names | |
| `Setup/index.tsx` | `Setup/index.tsx` | Three steps: create the owner → add your music → connect Lidarr |
| `RegionSelector`, `LanguageSelector` | same names | Static selects (the TMDB-backed `/regions` and `/languages` routes are gone) |

#### New (no Seerr source)

`Settings/shared.tsx` (`useSection`, `SettingsPage`, `SecretInput`, `CopyRow`, `NumberInput`,
`ScanPanel`, `useConnectionTest`/`TestButton`/`ConnectionStatus`, `useRelativeTime`),
`Settings/MusicLibraries.tsx`, `SettingsNavidrome.tsx`, `SettingsLocal.tsx`,
`SettingsYoutube.tsx`, `SettingsClients.tsx`, `SettingsMetadata.tsx`, `SettingsDiscover.tsx`
(Spotify, Deezer, iTunes, Ticketmaster, Skiddle), `SettingsScrobbling.tsx`,
`Setup/LocalAdminSetup.tsx`.

#### Dropped

`Settings/SonarrModal`, `Settings/OverrideRule/*` (backlog item 4), `SettingsBadge`,
`CopyButton`, `LibraryItem`, `SettingsAbout/Releases`, the ten `Notifications/*` files, and
`src/components/Selector` (TMDB company/genre/keyword selectors). Pages `settings/main` and
`settings/services` are replaced by `settings/general` and `settings/lidarr`.

#### Routes

`/settings` → `/settings/general`; `general users network plex jellyfin navidrome local youtube
clients lidarr metadata spotify deezer itunes ticketmaster skiddle scrobbling logs jobs about`;
`/settings/notifications` → `/settings/notifications/email`; `/settings/notifications/[agent]`.

#### Deviations from the mockup / spec

- **Secrets** use a local `SecretInput` (input + Show/Hide) instead of Seerr's
  `SensitiveInput`, whose two-element fragment doesn't fit the kit's `Field`. The masked value
  from GET is posted back unchanged, which the server reads as "keep the stored secret".
- **Emby** has no toggle: the Jellyfin page is titled "Emby" when the owner signed in with
  Emby (`mediaServerType`), as Seerr does.
- **Jellyfin connection** is hostname / port / SSL / URL base / API key (the server keeps
  Seerr's shape) rather than the mockup's single "Server URL"; external URL and forgot-password
  URL are kept from Seerr.
- **About → Getting help**: the mockup's "Documentation / GitHub discussions / Report a problem"
  links need a public repository, and none exists yet. The panel links to the built-in API
  reference and to the Lidarr and MusicBrainz docs instead. Swap in the repo links once it is
  public.
- **Job schedule editor** is a 6-field cron input with a live plain-words preview, not Seerr's
  interval pickers (the job list now has second-level and fixed schedules).
- **Pushover sound** is a text field; Seerr's sound list needs the unmasked token.
- **Lidarr** cards add a Remove button with a confirm dialog (the mockup only shows Test / Edit).
- **Test buttons** were added on YouTube, MusicBrainz, fanart.tv, Last.fm, Spotify, Deezer,
  iTunes, Ticketmaster, Skiddle and ListenBrainz, using the server's real test endpoints.
- **ListenBrainz trending** switch lives on the Scrobbling page and saves immediately
  (it belongs to the `discover` section).
- **Setup** steps are owner → music → Lidarr, with a local-admin path; steps 2 and 3 can be
  skipped.
- **Tested apps** (Symfonium, Finamp, Feishin, Amperfy, Jellify) are product documentation,
  listed in the page source; their "Ready" state follows the real API switches.

#### Owner configuration surfaced by these pages

Application URL (General) drives the app endpoints and the Spotify redirect URL; MusicBrainz
contact (Metadata) is required for the public server.


---

## Phase 9 — Discover and import, scrobbling, concerts, YouTube

### Stream SV6

All new code; nothing here is adapted from Seerr except that the API clients extend Seerr's
`ExternalAPI` and use the cache manager.

#### Added

| File | What |
|---|---|
| `server/api/spotify.ts` | Web API client. PKCE helpers `buildAuthorizeUrl`, `exchangeCode`, `refreshAccessToken`, `getProfile`; app token (`getAppToken`, `getPublicSpotify`); albums, playlists, saved albums |
| `server/api/deezer.ts` | Public API client (albums, tracks, playlists, share-link resolution). Deezer's 200-with-`error` bodies become `DeezerApiError` |
| `server/api/itunes.ts` | Lookup API + Apple marketing RSS chart. `getItunesChart(limit?, country?)` for the Discover page |
| `server/api/ticketmaster.ts`, `server/api/skiddle.ts` | Event lookups |
| `server/api/youtube.ts` | Data API v3 `search.list` only |
| `server/lib/import/*` | Link parser, MusicBrainz matcher (UPC → ISRC → artist + title), source fetchers, jobs, request hand-off, Spotify saved-albums sync, a small JSON-file cache |
| `server/lib/scrobble/*` | Rule, ListenBrainz and Last.fm submitters, queue with retry/backoff, linked-account access, Plex/Jellyfin webhook mapping |
| `server/lib/concerts/index.ts` | `refreshConcerts` |
| `server/routes/{import,scrobble,webhooks,youtube}.ts` | Routes per docs/API_CONTRACT.md §SV6 |
| `server/test/mockAxios.ts` | Canned HTTP for API-client tests (see "Tests") |
| `server/test/fixtures/{import,concerts}/*` | Fixtures |

#### Contract changes (all additive, in `server/interfaces/api/importInterfaces.ts`)

- `ImportResolveResponse` gained `status`, `error`, `truncated`. MusicBrainz allows about one
  lookup a second, so `POST /import/resolve` waits up to 8 s and then answers
  `status: 'resolving'` with `pending: true` entries. Poll `GET /import/jobs/:id` until
  `ready` (or `failed`, with `error`).
- `ImportMatch` gained `pending`.
- `ImportSpotifySavedResponse` gained `pending` (saved albums still being matched; ask again).
- `POST /import/resolve` also accepts track links (the track's album is imported) and
  `spotify.link` / `link.deezer.com` share links.

#### Behaviour worth knowing

- **Import cap:** 200 albums per link; the rest is counted in `truncated`.
- **Matches are cached on disk** (`<config>/cache/import-matches.json`, 30 days; misses 1 day)
  so the daily Spotify sync does not ask MusicBrainz twice.
- **Spotify saved-albums sync** only requests albums saved *after* the account was linked,
  and considers each saved album once (`<config>/cache/spotify-saved-sync.json`).
- **Scrobble history:** a play that meets the rule is always written to `ScrobbleQueue`, even
  when the user has no scrobble target, because that table is the "Recently played" history.
- **De-duplication:** a second report of the same track by the same user within the track's
  length is dropped, whatever the source. This is what stops the web player and a Plex webhook
  (or a Navidrome that scrobbles by itself) from double-counting.
- **Retry:** 8 attempts, 1 min doubling to 6 h. Retry timers are in memory, so a restart
  retries immediately. A rejected token/session key fails at once with "link it again".
- **YouTube:** hits cached 30 days on disk, misses 1 day; a quota error pauses searching for
  an hour. Search only — nothing is downloaded.
- **Concerts:** up to 100 library artists per run (recently played or requested first), up to
  4 countries (Ticketmaster setting, server region, users' regions). Skiddle is only asked when
  one of those countries is GB or IE. Past events, events not refreshed for 7 days and events
  of a switched-off provider are deleted.

#### Decisions (conservative option taken)

- `// TODO(decision)`-level, not marked in code: Ticketmaster's **Distance** setting
  (`radiusMiles`) is not applied. A radius needs a point, and Shufflerr knows a user's country
  but not their location. Events are filtered by country only.
- The scrobble submitters (ListenBrainz `submit-listens`, Last.fm `track.scrobble` /
  `track.updateNowPlaying`) live in `server/lib/scrobble/targets.ts` rather than in SV1's
  `lastfm.ts` / `listenbrainz.ts`, which did not exist yet. They can be merged later.
- Linked-account secrets are read directly (`server/lib/scrobble/linked.ts`) instead of through
  SV4's `getLinkedSecret`, for the same reason.

#### Owner configuration

- Spotify: client ID + secret (Settings → Spotify), redirect URI
  `<applicationUrl>/api/v1/callback/spotify`. Review the Spotify Developer Terms (HANDOFF §6).
- Ticketmaster / Skiddle / YouTube: API keys in their settings pages.
- Scrobbling from media servers:
  - Plex (Plex Pass → Webhooks): `<applicationUrl>/api/v1/webhooks/plex?apikey=<API key>`
  - Jellyfin (Webhook plugin, Generic destination, Playback Start + Playback Stop, Songs, send
    all properties): `<applicationUrl>/api/v1/webhooks/jellyfin?apikey=<API key>`

#### Tests

81 tests in `server/lib/import/{import,spotify}.test.ts`, `server/lib/scrobble/scrobble.test.ts`,
`server/lib/concerts/concerts.test.ts`. MusicBrainz, Deezer and iTunes fixtures are recorded
from the live services; Spotify, Ticketmaster, Skiddle, YouTube, ListenBrainz and Last.fm
bodies follow the documented formats (no keys were available).

`nock` cannot be used with `server/test/setup.ts`: nock 14 still calls `http.request` before
answering and the outbound-request guard throws. `server/test/mockAxios.ts` swaps the axios
adapter instead.

#### Open

- With **CSRF protection** switched on, csurf in `server/index.ts` also guards
  `POST /api/v1/webhooks/*`, so Plex and Jellyfin webhooks are rejected. The webhook path needs
  an exemption there (shared file, not changed by this stream).


---

## Phase 10 — Client APIs (OpenSubsonic, Jellyfin-compatible)

### Stream SV7

Everything lives in `server/clientapi/**`; no shared file was edited.

#### Decision recorded

**Native implementation of both protocols** over Shufflerr's own library index (HANDOFF §6.4,
CLIENT_API "Option A" for OpenSubsonic *and* for the Jellyfin API — no pass-through proxy).
The library an app sees is every `Track` that is `AVAILABLE` and that the shared streamer
(`server/lib/library/stream.ts`) would serve: a local file under a configured music folder, or
a copy on a media server that is switched on. Nothing is seeded or invented; an empty library
is an empty list.

#### New (no Seerr source)

| Path | What |
|---|---|
| `common/library.ts` | 20-second in-memory snapshot of the playable library (artists → albums → tracks), search, format parsing (`Track.fileFormat` → suffix / bit rate / bit depth / sample rate) |
| `common/credentials.ts` | App-password sign-in on top of `server/lib/auth/appPasswords.ts`: verification cache, API-key lookup, signed Jellyfin access token, "last used" |
| `common/userData.ts` | Stars, playlists, play counts (from `ScrobbleQueue`), now-playing, hand-off to `server/lib/scrobble` (source `apps`) |
| `common/media.ts` | Cover bytes through the image proxy/cache (`coverUrlFor` → `getImageSource`), stream option mapping |
| `subsonic/*` | OpenSubsonic at `/rest` |
| `jellyfin/*` | Jellyfin-compatible API at `/jellyfin` |
| `testSupport.ts`, `subsonic/subsonic.test.ts`, `jellyfin/jellyfin.test.ts` | 65 contract tests (supertest, test SQLite, no network) |

#### OpenSubsonic (`/rest`)

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

#### Jellyfin-compatible API (`/jellyfin`)

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

#### App passwords: stored twice (tradeoff from AUTH.md)

Each app password is kept as an **argon2id hash** and as an **AES-256-GCM encrypted copy**
(key derived from `settings.serverSecret`). The encrypted copy exists only because Subsonic
token auth (`t = md5(password + salt)`) cannot be checked against a hash; the API-key lookup
uses it too, because an API key arrives without a username. Consequence: someone holding
both `settings.json` and the database can recover app passwords. They cannot recover account
passwords, an app password only opens `/rest` and `/jellyfin`, and revoking it (deleting the
row) cuts off every client and every Jellyfin token issued for it at the next request.

The Jellyfin access token is `hex(appPasswordId)` + HMAC-SHA256 over the row, keyed with the
server secret. Nothing is stored (the `AppPassword.accessToken` column is unused).

#### Deviations / limits

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

#### Not verified

- No real phone or desktop app was run (Symfonium, Finamp, Feishin, Amperfy, Jellify). The
  APIs were exercised with curl against the running server and by the contract tests. The
  Jellyfin subset was written from the published API, not from captured client traffic.
- Proxying from Plex / Jellyfin / Navidrome sources was not exercised here (stream SV3 owns
  it); only local files were streamed.


---

## Backlog P1 built early — issues, manage panel, blocklist

### Stream FE5

#### Adapted from Seerr (rewritten on the UI kit, attribution header added)
- `IssueModal` (+ `CreateIssueModal`, `constants`): "Report a problem" dialog. Props
  `{ mediaType, mbid, show, onClose }`. Music issue types; per-track checklist for bad tags /
  missing tracks / low quality (missing tracks pre-checks tracks not in the library).
- `IssueList` + `IssueItem` (`/issues`): open / resolved / all chips with counts, sort, paging.
- `IssueDetails` + `IssueComment` + `IssueDescription` (`/issues/[issueId]`): comment thread,
  edit/delete own comments, resolve / reopen (optionally with a comment), delete.
- `IssueBlock`: compact `<li>` row used in the manage panel.
- `ManageSlideOver`: props `{ mediaType, mbid, show, onClose }`. Requests with approve/decline,
  open issues, library data (mark available, clear data), blocklist, "Open in" links.
- `Blocklist` (`/blocklist`), `BlocklistModal`, `BlocklistBlock`: MBID-based.
- `ExternalLinkBlock`: now takes the API's `ExternalLink[]` (`only` filters/orders types).
- `StatusChecker`, `AppDataWarning`: reworded. `ServiceWorkerSetup`: guards browsers without
  the Notification API.
- `public/sw.js`: absolute icon paths, default notification title "Shufflerr".
  `public/offline.html`: rewritten in Shufflerr's look.

#### Dropped
- Seerr's blocklisted-tags filter on the blocklist page and the Tautulli/watch-data,
  4K and "remove from Radarr/Sonarr" parts of the manage panel (no music equivalent in the API).

#### Decisions
- Per-item issues in the manage panel are filtered client-side from the first 100 open issues,
  because `GET /issue` has no media filter.
- Issue counts on `/issues` are only shown to people with MANAGE_ISSUES / VIEW_ISSUES: the count
  route is server-wide.
- No "Remove from Lidarr" button: the contract has no route for it.

#### Not verified
- Nothing was run in a browser (dev servers are off-limits while streams share the tree).
  Typecheck, eslint and prettier are clean for these files.


---

## Phase 11 and integration — migrations, OpenAPI, tests

### INT-A — server integration

Closes the seams between the server streams, makes the test suite finish, adds the database
migrations and the OpenAPI document. Server only; the UI wiring for the new routes is INT-B's.

#### New and changed routes (for the UI)

| Route | Who | Notes |
|---|---|---|
| `POST /api/v1/artist/:mbid/watch` `{enabled}` | MANAGE_REQUESTS | Sets Lidarr "monitor new items" (`all` / `none`) for the artist. `200 {enabled}`. `409` "This artist is not in Lidarr yet. Request an album or the discography first, then turn this on." `502` when Lidarr refuses. The current state is `ArtistDetails.lidarr.monitorNewItems` (re-read after a change; the 60 s cache is cleared). |
| `DELETE /api/v1/media/:id/lidarr?deleteFiles=0\|1` | MANAGE_REQUESTS | Removes the album or artist from Lidarr; with `deleteFiles=1` Lidarr also deletes the files. `204`; `409` when the item is not in Lidarr; `502` when Lidarr refuses. Show the button when `details.lidarr?.canRemove` is true (new optional field on `AlbumDetails.lidarr` and `ArtistDetails.lidarr`). |
| `GET /api/v1/issue?mediaId=<Media id>` | as before | New filter: only issues for one album/artist (replaces the manage panel's "fetch 100 and filter"). |
| `GET /api/v1/issue/count` | signed in | Now scoped: MANAGE_ISSUES / VIEW_ISSUES see server-wide counts, everyone else the counts of their own issues. Same response shape. |
| `GET /api/v1/settings/local/unresolved` | MANAGE_SETTINGS | `LocalUnresolvedResponse`: albums in the local folders MusicBrainz could not identify (`folder`, `label`, `artist`, `album`, `attempts`, `lastTried`, `nextTry`, `reason`). For a list on the Local files page. |
| `GET /api/v1/settings/notifications/pushover/sounds?token=` | signed in | A masked or empty `token` now falls back to the stored application token, so the sound list loads without retyping it. |
| `GET /api/v1/discover/trending` | signed in | When ListenBrainz trending is off and iTunes is on, the row is the iTunes most-played chart matched to MusicBrainz (cached 6 h). The first call answers within 8 s; if matching is still running it returns what is ready plus a `reason` line, and fills in on the next load. |
| `POST /api/v1/auth/setup` and `/auth/setup-local` | public, only while no users exist | Same handler; both documented in the contract. |

`AlbumDetails.lidarr.monitored` is now read from Lidarr (cached 60 s) instead of always `true`.

#### Seams closed

- **Lidarr reads go through one client.** `getLidarrArtistState` uses SV2's
  `LidarrAPI.fromSettings` (no private axios client). `LidarrAPI` gained `deleteArtist` and
  `deleteAlbum`.
- **One request mapper.** `GET /discover/recent-requests` and `GET /user/:id/requests` use
  `toRequestResults` (`server/lib/requestResults.ts`); it now returns the artist photo as the
  cover of a discography request. The duplicate mapper in `routes/discover.ts` is gone.
- **One completion path.** Album/tracks requests become COMPLETED only in
  `MediaRequest.completeSatisfied()`; discography requests only in
  `MediaRequest.completeDiscography()`. The library layer
  (`completeReleaseGroupRequests`, `recomputeArtist`), the Lidarr scan and the download sync
  all call those. Each acts only on APPROVED requests and saves through the repository, so the
  request subscriber sends `available` exactly once.
- **"Run now" for the local files scan** forces a scan (`run({ force: true })`) instead of
  honouring the rescan interval.
- **CSRF** no longer applies to `/rest`, `/jellyfin` and `/api/v1/webhooks/*` (app-password /
  API-key traffic, not browser sessions).
- **`DELETE /issue/:id`** loads comments explicitly instead of relying on eager loading.
- Dead stubs removed: `server/routes/_stub.ts`, `server/lib/scanners/stub.ts`. No handler
  answers 501 any more.

#### Looked at, left as is

- **`MEDIA_FAILED` logged when a test saves an approved request** — not a bug. Saving an
  APPROVED request with no Lidarr server configured fails it with "No Lidarr server is set up.
  Add one in Settings → Lidarr, then retry." and notifies; that is the intended behaviour.
- **Scrobble submitters.** SV6's `server/lib/scrobble/targets.ts` and `linked.ts` duplicate
  small parts of `server/api/{lastfm,listenbrainz}.ts` and `server/lib/auth/linkedAccounts.ts`.
  They are covered by 36 tests and never ran against the real services (no keys), so merging
  them now would trade tested code for untested code. Left for when real keys are available.

#### Tests

- `pnpm test`: **495 tests, 0 failures, ~77 s** (was ~6.5 min and looked hung).
- Cause of the "stall": nothing was hanging. The runner executed the 28 files one after another
  and every file type-checked the whole project through ts-node before starting.
  `server/test/index.mts` now runs files side by side (`TEST_CONCURRENCY`, default 6; each file
  has its own process and in-memory database) and transpiles without the per-file type check
  (`pnpm typecheck` covers types).
- `nock` does not work with `server/test/setup.ts` (its outbound blocker fires first). Use
  `server/test/mockAxios.ts`, `server/test/fixtureAdapter.ts` or `server/test/fakeLidarr.ts`.

#### Database migrations

- `server/migration/sqlite/1791192875557-InitialMigration.ts` and
  `server/migration/postgres/1791192885204-InitialMigration.ts`, generated from the entities.
- Production now runs migrations only (`synchronize: false`); the "synchronise when there are
  no migrations" fallback is removed. Development on SQLite still synchronises, as in Seerr.
- Proven on an empty SQLite file and an empty PostgreSQL 17 database in production mode:
  23 tables, no pending migrations, zero schema drift between entities and the migrated
  schema, and 21 list/detail routes (library search with `LIKE … ESCAPE`, grouped counts,
  requests, users sorted by requests, discover rows, issues, blocklist) answered 200 on both.

#### OpenAPI

- `shufflerr-api.yml` is generated by `server/scripts/generateApiSpec.ts`: 157 paths,
  201 operations, 118 schemas; 170 operations carry typed request/response bodies taken from
  the route's type arguments or, failing that, from what the handler sends.
  Regenerate with
  `pnpm exec ts-node -r tsconfig-paths/register --files --project server/tsconfig.json server/scripts/generateApiSpec.ts && pnpm exec prettier --write shufflerr-api.yml`.
- The validator middleware stays mounted with `ignoreUndocumented`, but no longer validates
  request bodies against the schema: handlers validate their own input and answer with the
  exact "what to fix" copy the UI shows, which generic schema errors would pre-empt.
- `/api-docs` renders the document.

#### Sweep

- "Seerr" in `server/`: only attribution headers and code comments explaining inherited
  behaviour. Nothing user-visible or log-visible.
- Attribution headers added to adapted files that lacked one (`datasource.ts`, kept test
  files, `utils/seedTestDb.ts`, `test/index.mts`). Files that share a path with Seerr but were
  rewritten without Seerr code (`lib/search.ts`, `routes/search.ts`, `routes/discover.ts`,
  `entity/MediaRequest.test.ts`, `routes/request.test.ts`) carry no header on purpose.

#### Bug fixed during integration

- **Artist names from album credits.** When MusicBrainz did not answer during a scan, the
  artist row was created from the album's credit phrase ("Martin Garrix, DubVision & Shaun
  Farrugia", "Dr. Dre introducing Snoop Doggy Dogg") and never corrected. `recomputeArtist`
  now replaces a provisional name (a row without `artistMbid`) with the artist's own
  MusicBrainz name as soon as MusicBrainz answers — on any later scan or availability sync —
  and the Lidarr scan sets `artistMbid` on the rows it writes. Covered by a test.
- **Library artist names.** `GET /library/artists` and the popular-artists row took the name
  from an album's credit phrase; they now use the artist row's own name and fall back to the
  credit only when no artist row exists. Search matches either. Checked on SQLite and
  PostgreSQL.
- **Scan panel after a restart.** `GET /settings/<source>/sync` reads the album and track
  counts from the database before answering, so it no longer reports "0 albums, 0 tracks"
  until the next scan.

---

## Foundation detail

The spine stream's full notes (the stub list it handed to the other streams, deleted client
components, test changes) are in `changes/spine.md`; Phases 0 and 1 above are its summary.
Notes written after this merge (for example the UI integration pass) are in `changes/`.

## After v0.1.0 (owner-directed changes)

- **v0.1.3, Discover:** rebuilt to follow the layout of the Rekord home page (hero, carousels,
  popular list beside dated cards). This is a deliberate deviation from `design/shufflerr-mockup.html`;
  the mockup's version of the page remains at `/discover/classic`. No Rekord code, CSS, fonts,
  icons or images are used.
- **v0.1.3, album placeholder:** original SVG drawing instead of an empty tinted slot.
- **v0.1.4, Album and Artist pages:** rebuilt to follow the Rekord album and artist pages
  (deviation from the mockup; classic versions kept at `/album/<mbid>/classic` and
  `/artist/<mbid>/classic`). No Rekord code or assets are used.
- **v0.1.4, genre pages:** backlog item 8, built on MusicBrainz tags. Results come back in
  MusicBrainz's relevance order, not by popularity; a Last.fm key would allow a popularity order.
- **v0.1.4, artist photos:** order is fanart.tv, then Lidarr, then Deezer (exact-name match,
  because Deezer has no MusicBrainz ids).
- **v0.1.5, top navigation:** the mockup's left icon rail is replaced by a top bar (owner
  request). Deviation from the mockup; the classic pages are unaffected.
