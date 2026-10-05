# Changelog

All notable changes to Shufflerr are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
`Major.Minor.SubMinor` versions.

## [Unreleased]

### Changed

- **License:** Shufflerr is now licensed under AGPL-3.0 (was MIT). Seerr-derived code keeps its
  MIT notice in `NOTICE.md` and `LICENSES/seerr-MIT.txt`.
- `k8s/shufflerr.yaml` is now a generic example manifest.
- README header uses the app favicon as the project logo; added `public/social-preview.png`
  (1280×640) for the repository's social preview.

## [0.1.1] - 2026-10-05

### Fixed

- Artist photos were blank unless a fanart.tv API key was set. They now fall back to the
  default Lidarr server's metadata lookup (`server/api/lidarrImages.ts`, new `lidarr` image
  proxy source), which needs no key; fanart.tv is still used first when it is switched on.

## [0.1.0] - 2026-10-05

First version. Shufflerr is a fork of Seerr
(`seerr-team/seerr@2cfbcf8940225f1597d44f507fd78040887c5597`, MIT) with the movie/TV domain
replaced by music.

### Added

- **Foundation:** rebrand (package, Docker image with ffmpeg, compose files, Helm chart, CI,
  `s/` logos and PWA icons); music data model keyed by MusicBrainz IDs (`Media`, `Track`,
  `MediaRequest` with scopes `tracks` / `album` / `discography`, `TrackRequest`,
  `LinkedAccount`, `AppPassword`, `ScrobbleQueue`, `ImportJob`, `Event`, `Playlist`,
  `PlaylistItem`, `Star`); music permission bits; album and track quotas; settings for every
  integration, all off until configured, with secrets masked in responses and encrypted at
  rest where they belong to a user.
- **Metadata and browse:** MusicBrainz client (rate-limited, cached, mirror support), Cover
  Art Archive, fanart.tv, Last.fm and ListenBrainz clients; unified search; artist, album and
  track pages; Discover rows (recently added, trending, popular artists, concerts, recent
  requests); library lists; login slideshow of real covers.
- **Requests:** Lidarr client (API v1) and multi-server settings; the request engine with
  permission, quota, blocklist, duplicate and auto-approve rules and a dry run for the request
  dialog; approve, decline, retry, edit, cancel; hand-off to Lidarr; download progress sync;
  Lidarr library scan.
- **Library:** scanners for Plex, Jellyfin/Emby, Navidrome and local folders (with a folder
  watcher); per-track availability; requests complete when what they asked for is in the
  library; audio streaming with range requests and optional transcoding; waveform peaks.
- **Accounts:** Plex PIN, Jellyfin/Emby and local sign-in; first-run local owner; user list,
  profiles, quotas, bulk permission edits, Plex and Jellyfin imports; app passwords; linked
  Last.fm, ListenBrainz and Spotify accounts; sign-in rate limit.
- **Admin:** settings API and pages for general, users, network, Plex, Jellyfin, Navidrome,
  local files, YouTube, apps and devices, Lidarr, metadata, Spotify, Deezer, iTunes,
  Ticketmaster, Skiddle, scrobbling, ten notification agents, logs, jobs, cache and about;
  setup wizard.
- **Notifications:** email, web push, Discord, Slack, Telegram, Pushbullet, Pushover, webhook,
  Gotify and ntfy with music payloads and six notification types.
- **Import and extras:** import from Spotify, Deezer and Apple Music links matched to
  MusicBrainz by UPC, ISRC or name; Spotify saved-albums sync; iTunes chart; concerts from
  Ticketmaster and Skiddle; scrobbling to ListenBrainz and Last.fm from the web player, client
  apps and Plex/Jellyfin webhooks; YouTube playback of missing tracks through the official
  player only.
- **Client APIs:** OpenSubsonic at `/rest` and a Jellyfin-compatible API at `/jellyfin`, native
  over Shufflerr's library, signed in with app passwords.
- **Issues, manage panel and blocklist** adapted from Seerr for albums and artists.
- **Web app:** new design system (dark and light), icon rail, top bar, docked player with
  waveform, and every page above.
- **Database migrations** for SQLite and PostgreSQL; production runs migrations only.
- **OpenAPI document** generated from the routes and their types
  (`server/scripts/generateApiSpec.ts`), served at `/api-docs`.
- Routes added at integration: `POST /artist/:mbid/watch`, `DELETE /media/:id/lidarr`,
  `GET /settings/local/unresolved`, `GET /issue?mediaId=`.

### Changed

- `settings.json` is written with mode `0600`.
- Settings pages require `MANAGE_SETTINGS` (Seerr required `ADMIN`).
- The update check is off: there is no public Shufflerr release feed yet.
- Requests are validated by their handlers (with the UI's own error copy) rather than by the
  OpenAPI validator.
- CSRF protection does not apply to the client APIs and webhooks, which do not use browser
  sessions.
- The unit test runner runs files side by side and skips the per-file type check; the suite
  takes about 75 seconds instead of six and a half minutes.
- `GET /issue/count` is scoped to what the caller may see.

### Fixed

- Artist names taken from an album's credit phrase while MusicBrainz was unreachable are
  corrected on the next scan.

### Removed

- Everything movie/TV: TMDB, TVDB, AniList, ratings, Tautulli, Radarr, Sonarr, 4K paths, movie /
  TV / person / collection routes and pages, Seerr's database and settings migrations, the
  Overseerr merge, Plex watchlist sync.
- Seerr branding assets, documentation site and release/publish workflows.
