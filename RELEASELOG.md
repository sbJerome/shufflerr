# Release log

Plain-language notes per release, newest first. Technical detail is in
[CHANGELOG.md](CHANGELOG.md); build-phase notes are in [CHANGES.md](CHANGES.md).

## v0.1.0 — 2026-10-05 (in development)

Foundation release. Shufflerr starts life as a fork of Seerr with the movie and TV parts
removed and the music foundations in place:

- A database built around MusicBrainz artists, albums and tracks.
- Requests for missing tracks, whole albums or discographies, with album and track limits.
- Settings for Lidarr, Plex, Jellyfin, Navidrome, local folders and the optional services
  (Spotify, Deezer, iTunes, Ticketmaster, Skiddle, Last.fm, ListenBrainz, YouTube) — all off
  until you set them up.
- The complete API contract the rest of the app is being built against.

Nothing to upgrade from: this is the first version. Not yet usable end to end — searching,
requesting, scanning and the new interface arrive with the next build phases.
