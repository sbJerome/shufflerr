# Changelog

All notable changes to Shufflerr are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
`Major.Minor.SubMinor` versions.

## [Unreleased]

## [0.1.0] - 2026-10-05

### Added

- Forked from Seerr (`seerr-team/seerr@2cfbcf8940225f1597d44f507fd78040887c5597`, MIT) and
  rebranded as Shufflerr: package, Docker image, compose files, Helm chart, CI, logos and PWA
  icons (`s/` tile).
- Music data model: `Media` (artist / release group, keyed by MusicBrainz ID), `Track`,
  `MediaRequest` with scopes `tracks` / `album` / `discography`, `TrackRequest`,
  `LinkedAccount`, `AppPassword`, `ScrobbleQueue`, `ImportJob`, `Event`, `Playlist`,
  `PlaylistItem`, `Star`.
- Music permission bits and album/track request quotas (`User.getQuota()`).
- Settings for Lidarr servers, Plex, Jellyfin, Navidrome, local files, YouTube, client apps,
  metadata sources, discover/import sources, scrobbling and the 15 scheduled jobs. Every
  integration is off until configured. Secrets are masked in settings responses.
- Server secret + AES-256-GCM encryption for linked-account secrets and app passwords.
- Image proxy sources for the Cover Art Archive, fanart.tv, Last.fm, Spotify, Deezer, iTunes,
  Ticketmaster, Skiddle and YouTube thumbnails.
- API contract (`docs/API_CONTRACT.md`) with typed request/response shapes and mounted route
  skeletons for every stream.

### Changed

- `settings.json` is written with mode `0600`.
- Settings pages require `MANAGE_SETTINGS` (Seerr required `ADMIN`).
- The update check is off: there is no public Shufflerr release feed yet.

### Removed

- Everything movie/TV: TMDB, TVDB, AniList, ratings, Tautulli, Radarr, Sonarr, 4K paths, movie /
  TV / person / collection routes and pages, Seerr's database and settings migrations, the
  Overseerr merge, Plex watchlist sync.
- Seerr branding assets, documentation site and release/publish workflows.
