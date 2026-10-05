# CHANGES

Build notes per phase: what was kept / adapted / rewritten / dropped from Seerr, deviations
from the mockup, open decisions and what the owner must configure. Per-stream detail lives in
`changes/<stream>.md` and is merged here at the end of each phase.

Seerr reference: `seerr-team/seerr@2cfbcf8940225f1597d44f507fd78040887c5597` (MIT).

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
- `seerr-api.yml` → `shufflerr-api.yml` (minimal for now; validator ignores undocumented
  routes until the full spec is written in the admin phase).
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
- Initial database migrations are generated once at the end of the build; until then an empty
  migrations folder means the schema is synchronised at boot.
- `TODO(decision)`: update check — needs a public release feed to compare against.

**Owner configuration**
- Nothing yet. From phase 3 on: a Lidarr server (Settings → Lidarr), at least one library
  source, and a MusicBrainz contact (Settings → MusicBrainz and Last.fm) for the `User-Agent`.
