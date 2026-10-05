# Release log

Plain-language notes per release, newest first. Technical detail is in
[CHANGELOG.md](CHANGELOG.md); build-phase notes are in [CHANGES.md](CHANGES.md).

## v0.1.4 — 2026-10-05

- **New album page.** The cover sits over a blurred version of itself, and the tracklist is a
  stack of bars you can play or request from. The old page is at `/album/<id>/classic`.
- **New artist page.** A full-width artist photo with the name across it and their top albums
  right underneath. The old page is at `/artist/<id>/classic`.
- **Genres are clickable.** Click a genre on an album or artist to browse other artists and
  albums in that genre.
- **More artist photos.** Artists that fanart.tv and Lidarr have no photo for now get one from
  Deezer.

## v0.1.3 — 2026-10-05

- **New Discover page.** A big featured-release hero, album carousels you can page through, and
  a "Most popular this week" list next to your recent requests. The old page is still at
  `/discover/classic`.
- **New album placeholder.** Albums without cover art show Shufflerr's own record drawing.

## v0.1.2 — 2026-10-05

- Albums without cover art now show a vinyl record instead of a blank tile.
- The project now lives on GitHub, with the app icon as its logo.
- Shufflerr is now open source under the AGPL-3.0 license.
- A ready-made image is available: `docker pull ghcr.io/sbjerome/shufflerr:latest`.

## v0.1.1 — 2026-10-05

- **Artist photos show up without a fanart.tv key.** Shufflerr now gets them through your
  Lidarr server when fanart.tv isn't set up.

## v0.1.0 — 2026-10-05

First version. Shufflerr starts life as a fork of Seerr with the movie and TV parts replaced by
music.

- **Find and request music.** Search artists, albums and tracks from MusicBrainz, see what is
  already in your library, and request the missing tracks of an album, a whole album or an
  artist's discography. Limits and automatic approval follow each person's permissions.
- **Lidarr does the downloading.** Approved requests are handed to Lidarr; progress shows on
  the Requests page, and people are notified when their music is available.
- **Your library, from wherever it lives.** Plex, Jellyfin or Emby, Navidrome and plain
  folders are scanned track by track. A built-in player streams what you have.
- **Sign in** with Plex, Jellyfin or Emby, or a local account. The first account becomes the
  owner.
- **Admin area** for every integration, ten notification channels, scheduled jobs and logs.
- **Extras:** import albums from Spotify, Deezer and Apple Music links; scrobble to
  ListenBrainz and Last.fm; concerts for artists you have; play missing tracks from YouTube's
  own player; report problems with an album; block artists or albums.
- **Use your own music app.** Symfonium, Finamp, Feishin, Amperfy, Jellify and other
  OpenSubsonic or Jellyfin apps can connect with an app password from your profile.

Good to know:

- Nothing to upgrade from: this is the first version.
- Every integration is off until you set it up. Start with Settings → General (application
  URL), MusicBrainz and Last.fm (contact), Lidarr, and one library source.
- Plex, Jellyfin, Navidrome, Spotify, Ticketmaster, Skiddle, YouTube and scrobbling were built
  and tested against recorded responses, not live accounts. Expect rough edges the first time
  each is connected, and see [CHANGES.md](CHANGES.md) for the full list.
- Albums MusicBrainz cannot identify from their tags are not shown in the library.
