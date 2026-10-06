# Release log

Plain-language notes per release, newest first. Technical detail is in
[CHANGELOG.md](CHANGELOG.md); build-phase notes are in [CHANGES.md](CHANGES.md).

## v0.1.15 — 2026-10-06

- **Security fix (medium):** the session is now reissued each time you sign in, closing a
  session-fixation weakness.

## v0.1.14 — 2026-10-06

- **Fix:** artist photos that come from an internal source display again for signed-in users
  (a regression from the 0.1.13 security fix). The security protections from 0.1.13 are unchanged.

## v0.1.13 — 2026-10-06

- **Security fix (high):** closed a hole in the image proxy that could be used to reach internal
  services. Cover art and artist photos are unaffected.

## v0.1.12 — 2026-10-06

- **Plex avatars show up.** People who sign in with Plex now see their Plex profile picture
  in the account menu, user list and profile, as in Seerr.

## v0.1.11 — 2026-10-06

- **"Downloading" means downloading.** An approved request now shows as "Requested" until
  Lidarr is actually pulling it, everywhere in the app.

## v0.1.10 — 2026-10-06

- **Albums placed straight in an artist folder** are now matched through Lidarr too, instead
  of being guessed by name.

## v0.1.9 — 2026-10-06

- **Bonus video discs no longer count as missing tracks.** An album that ships with a DVD or
  Blu-ray is complete once its audio tracks are in the library.

## v0.1.8 — 2026-10-06

- **Finished downloads now show as available.** When Lidarr finishes an album whose files have
  no MusicBrainz tags, Shufflerr asks Lidarr which album it is instead of guessing from the
  title, so the album and its request update as soon as the files are scanned.
- **"Run now" on the local-files scan** retries folders that could not be identified before.

## v0.1.7 — 2026-10-06

- **Requests for new artists now actually search.** When you requested an album by an artist
  Shufflerr had to add to Lidarr first, the search ran before Lidarr had finished loading the
  artist and found nothing. Shufflerr now waits for Lidarr to finish before searching.

## v0.1.6 — 2026-10-05

- **Centred pages.** On wide screens every page now sits in the middle of the window instead of
  hugging the left edge.

## v0.1.5 — 2026-10-05

- **Navigation moved to the top.** One bar holds the links, search and your account; on
  smaller screens the links fold into a menu.
- **Bigger artist photos.** The artist page photo now fills most of the screen, with the name
  and top albums over it.
- **Discography in pages of 10,** with Previous and Next.
- **Works at every size.** Checked on desktop, laptop, tablet and phone widths.

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
