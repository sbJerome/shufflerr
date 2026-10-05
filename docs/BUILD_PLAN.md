# Build plan

Each phase ends with: lint, typecheck, tests and build green; a commit `phase N: …`; an entry in
`CHANGES.md`. Don't start a phase until the previous one's acceptance criteria pass.

---

## Phase 0 — Fork, attribution, branding

**Do**
- Fork Seerr at `2cfbcf8940225f1597d44f507fd78040887c5597` (see `KICKOFF.md`). Keep history;
  add `upstream` remote.
- Copy this pack's `CLAUDE.md`, `HANDOFF.md`, `NOTICE.md`, `LICENSES/`, `docs/`, `design/`,
  `starter/` into the repo root.
- Root `LICENSE`: MIT with both copyright lines (see `CLAUDE.md` §Attribution).
- Rename: package name, Docker image name, app title default, config dir default,
  `seerr-api.yml` → `shufflerr-api.yml` (content updated in phase 7), helm chart name, CI names.
- Remove Seerr branding assets (`public/logo*`, `public/preview.jpg`, favicons, PWA icons).
  Add placeholder Shufflerr marks: `s/` red tile icon (SVG), wordmark text.
- README: short description + "Acknowledgements" crediting Seerr, Overseerr, Jellyseerr.
- Dockerfile copies `LICENSES/` and `NOTICE.md` into the image.

**Accept when**
- `pnpm build` passes; app boots and shows "Shufflerr" everywhere a title shows.
- `grep -ri "seerr" src/ server/ --include=*.ts* | grep -vi "adapted from"` only finds
  internal identifiers you've listed in `CHANGES.md` as "rename later".

---

## Phase 1 — Strip movie/TV, music domain model, migrations

**Do**
- Delete everything marked **Drop** in `docs/REUSE_MAP.md` (TMDB, TVDB, AniList, ratings,
  Radarr/Sonarr scanners & clients, movie/tv/person/collection routes & components, 4K paths).
- Replace `server/lib/permissions.ts` with `starter/server/lib/permissions.ts`; update every
  usage (search for removed bits).
- Replace `server/constants/media.ts` with `starter/server/constants/media.ts`.
- Implement entities per `docs/DATA_MODEL.md`: `Media`, `Track`, `MediaRequest`,
  `TrackRequest`, `User` (+ new fields), `UserSettings` (+ notification/linked/app-password
  fields), `AppPassword`, `LinkedAccount`, `ScrobbleQueue`, `ImportJob`, keep `Session`,
  `UserPushSubscription`, `Issue`/`IssueComment` (adapted types, UI later), `Blocklist`
  (adapted, UI later), `DiscoverSlider` (adapted, UI later), `OverrideRule` (adapted, UI later).
- Fresh **initial migrations** for SQLite and PostgreSQL (delete Seerr's migration history in
  this fork — Shufflerr is a new product, not an upgrade path).
- Settings defaults per `docs/settings.example.json` in `server/lib/settings/index.ts`;
  replace Seerr's settings migrations folder with an empty one plus a v1 marker.

**Accept when**
- App boots on an empty SQLite and an empty Postgres; migrations run clean both ways.
- Unit tests: `hasPermission` (port Seerr's tests + new bits), entity constraints.

---

## Phase 2 — Metadata clients

**Do** (`docs/INTEGRATIONS.md` §Metadata)
- `server/api/musicbrainz/` — search (artist, release-group, recording), lookups with
  `inc=` params, browse release-groups by artist with type filters, rate limiter (token
  bucket, 1 rps default; configurable for mirrors), `User-Agent`, retries with backoff on 503.
- `server/api/coverartarchive.ts` — release-group front image, sizes 250/500/1200.
- `server/api/fanart.ts` — artist thumbs/backgrounds by MBID.
- `server/api/lastfm.ts` — `artist.getInfo`, `artist.getSimilar`, `album.getInfo`,
  `tag.getTopAlbums` (auth-less calls), plus scrobble/auth methods used in phase 9.
- Add hosts to the image proxy allow-list; cache images per `main.cacheImages`.
- `server/lib/search.ts` rewritten: unified search returning artists, release groups,
  recordings, with library status merged from `Media`.

**Accept when**
- Fixture-based tests for each client (no network).
- `GET /api/v1/search?query=john summit` returns typed results with statuses.

---

## Phase 3 — Lidarr + request engine

**Do** (`docs/PERMISSIONS_AND_APPROVALS.md`, `docs/INTEGRATIONS.md` §Lidarr)
- `server/api/servarr/lidarr.ts` extending `ServarrBase` with API v1 base path. Methods:
  system status, quality profiles, metadata profiles, root folders, tags, artist lookup/add/
  update (by MBID), album lookup/monitor, commands (`AlbumSearch`, `ArtistSearch`,
  `RefreshArtist`), queue, history.
- Settings: `lidarr[]` (name, host, port, ssl, baseUrl, apiKey, qualityProfileId,
  metadataProfileId, rootFolder, tags, isDefault, isHiRes, syncEnabled, preventSearch).
- `MediaRequest.request()` rewritten per the spec: scope handling, quota, duplicate,
  auto-approve, `discoReview` rule, `ignoreQuota` for managers.
- Request subscriber: on APPROVED → send to Lidarr (add artist if missing, monitor album(s),
  trigger search); on DECLINED → unmonitor if Shufflerr added it; on FAILED → notification.
- Routes: `POST /request`, `GET /request` (filters: status, type, requestedBy, sort),
  `GET /request/count`, `POST /request/:id/:status` (approve|decline), `POST /request/:id/retry`,
  `DELETE /request/:id` (owner of pending or manager), `PUT /request/:id` (managers; backlog UI).
- Download sync job (Lidarr queue → progress on requests) and Lidarr scan job.

**Accept when**
- Unit tests cover every branch in the engine table in `PERMISSIONS_AND_APPROVALS.md`.
- Integration test with a mocked Lidarr (nock) for approve → add/monitor/search.

---

## Phase 4 — Media servers + availability

**Do** (`docs/INTEGRATIONS.md` §Stream from)
- Plex scanner (music sections: artists → albums → tracks; match by MBID GUIDs when present,
  else normalized artist+album+track title+duration).
- Jellyfin scanner (MusicAlbum/Audio items, `ProviderIds.MusicBrainzReleaseGroup` /
  `MusicBrainzTrack` when present).
- Navidrome scanner via Subsonic API (`getArtists`, `getArtist`, `getAlbum`, `search3`);
  OpenSubsonic extensions for MBIDs when available.
- Local files scanner (walk folders, read tags with `music-metadata`, watch with chokidar when
  `watch` is on).
- Availability sync: per-track presence → `Media.status` (AVAILABLE / PARTIALLY_AVAILABLE),
  requests → COMPLETED when the requested scope is fully present.
- Jobs: recently-added scans (5 min), full scans (daily), Navidrome (15 min), local (on change
  + interval), availability sync (daily).

**Accept when**
- Fixture tests for each scanner's matching.
- CTRL ESCAPE fixture: 9/13 tracks present → PARTIALLY_AVAILABLE; after 13/13 → AVAILABLE and
  a `tracks` request flips to COMPLETED.

---

## Phase 5 — Auth + user system

**Do** (`docs/AUTH.md`, `docs/USER_SYSTEM.md`)
- Plex PIN sign-in (keep Seerr's `usePlexLogin` + `/auth/plex`), owner detection, server-access
  check, `newPlex` rule.
- Jellyfin sign-in (keep Seerr's `/auth/jellyfin`), `newJellyfin` rule (new setting).
- Local sign-in + password reset (keep Seerr's).
- Users API: list (search, sort, paginate), create local, import Plex, import Jellyfin, bulk
  permission edit, delete (rules: not owner, not self), get/update user, user settings
  (main, password, linked accounts, app passwords, notifications, permissions).
- App passwords (new): create (hash with bcrypt/argon2, show once), list, revoke, last-used.
- Linked accounts (new): Plex, Jellyfin, Last.fm (web auth → session key), ListenBrainz (user
  token, validated), Spotify (OAuth PKCE, refresh token).

**Accept when**
- Permission rules from `USER_SYSTEM.md` are covered by route tests (owner protection, can't
  edit own permissions unless owner, MANAGE_USERS bypasses quota).

---

## Phase 6 — Front end (MVP UI)

**Do** (`docs/FRONTEND.md`)
- Layout: icon rail, top bar (search, pending pill, theme toggle, account menu), docked player.
- Pages: Login, Logout, Discover, Search, Artist, Album (+ request modal), Requests, Import,
  Profile (overview/requests/settings tabs), Users, plus responsive phone layout.
- Request modal with live outcome preview (calls `POST /request?dryRun=1` — add this flag to
  the route; returns `{outcome: 'auto'|'pending'|'blocked', reason}`).
- Player: plays library tracks via the media server's stream URL (or local file stream),
  waveform from precomputed peaks (generate on scan; fall back to a flat bar).
- Login background slideshow: recently-added album art via image proxy, crossfade 6 s,
  static when reduced motion.

**Accept when**
- Screens visually match `design/screens/*` at 1440×900 and 390×844 (dark), and light theme
  works.
- Keyboard-only walkthrough of the MVP flow works; axe-core shows no serious violations.
- The Definition of Done in `CLAUDE.md` passes end-to-end.

---

## Phase 7 — Admin area

**Do** (`docs/ADMIN_PAGES.md`)
- Settings layout with grouped sidebar (desktop) / select (narrow), one route per page.
- Pages: General, Users, Network, Plex, Jellyfin, Navidrome, Local files, YouTube, Apps and
  devices, Lidarr (with add/edit modal adapted from Seerr's RadarrModal), MusicBrainz and
  Last.fm, Spotify, Deezer, iTunes, Ticketmaster, Skiddle, Scrobbling, Notifications (10
  agents), Logs, Jobs and cache, About.
- Update `shufflerr-api.yml` (OpenAPI) for every route.

**Accept when** every field in `ADMIN_PAGES.md` persists and round-trips through
`GET/POST /api/v1/settings/<section>`, with validation messages.

---

## Phase 8 — Notifications, jobs, logs

**Do**
- Adapt all agents; new notification types and payload variables (`docs/ADMIN_PAGES.md`
  §Notifications). Per-user channel prefs (`docs/USER_SYSTEM.md`).
- Jobs table from `docs/ADMIN_PAGES.md` §Jobs wired in `server/job/schedule.ts`; edit schedule,
  run now, cancel.
- Logs page reading Seerr's log file / stream with level filter, search, pause.

---

## Phase 9 — Discover & import, scrobbling, YouTube

**Do** (`docs/INTEGRATIONS.md`)
- Import page: parse Spotify / Deezer / Apple Music URLs → resolve albums → match to
  MusicBrainz (by UPC/ISRC first, then artist+title) → list with statuses → bulk request through
  the engine; result summary (auto/pending/blocked).
- Spotify saved-albums auto-request per user (`AUTO_REQUEST` permission + user toggle), daily job.
- iTunes charts row on Discover (optional), ListenBrainz trending row.
- Concerts: Ticketmaster Discovery + Skiddle for artists in library, by user region; Discover
  row; daily refresh job; respect attribution/caching rules.
- Scrobbler: ingest plays from Plex/Jellyfin/Navidrome (webhooks or polling), client APIs,
  and the web player → queue → ListenBrainz (`submit-listens`) and Last.fm (`track.scrobble`),
  with the configured rule; retries; per-user linked accounts.
- YouTube: search per missing track (Data API v3), play via IFrame Player API in the player
  bar when `fill` is on. No downloading.

---

## Phase 10 — Client APIs (OpenSubsonic, Jellyfin-compatible)

See `docs/CLIENT_API.md`. Start with OpenSubsonic (browse, search3, stream, getCoverArt,
scrobble, star/unstar, playlists), authenticate with username + app password, then the
Jellyfin-compatible subset for Finamp/Jellify. Test against Symfonium, Feishin, Amperfy,
Finamp, Jellify.

---

## Phase 11 — Docker, docs, smoke test

- `compose.yaml` (SQLite) and `compose.postgres.yaml`; healthcheck; volumes for config and
  (optional) local music folders.
- Helm chart renamed and values updated.
- Cypress: sign-in (local), request flow, approve flow, settings save.
- Final `CHANGES.md` and README.

---

## Backlog hooks to leave while building

- `MediaRequest` has room for `serverId`, `profileId`, `rootFolder`, `isHiRes` (request
  editing, hi-res requests).
- `OverrideRule` entity kept (override rules UI later).
- `Issue`, `Blocklist`, `Watchlist` entities kept and migrated (UI later).
- Keep Seerr's `ManageSlideOver` component around (adapted) for the album Manage panel.
