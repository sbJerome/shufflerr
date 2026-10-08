# Release log

Plain-language notes per release, newest first. Technical detail is in
[CHANGELOG.md](CHANGELOG.md); build-phase notes are in [CHANGES.md](CHANGES.md).

## v0.1.46 — 2026-10-08

- **YouTube minimize keeps playing.** Shrinking the YouTube player no longer stops the music.
- **Discography as tiles.** The artist page shows the discography as album tiles like the Albums
  page; hovering a tile that isn't in your library reveals a request button.
- **Album page:** the background art now shows in light mode too.

## v0.1.45 — 2026-10-08

- **Featured release changes now.** The Discover featured album rotates instead of always showing
  the same one.
- **Sharp featured cover.** The featured hero shows the actual cover art (crisp, punchier) instead
  of a blur, fading into the page at the bottom — and it shows in light mode too.

## v0.1.44 — 2026-10-08

- **Close or minimize the YouTube player.** The pop-up YouTube player now has a close button (stops
  it) and a minimize button (tucks it into a small bar; it pauses while minimized, since YouTube
  requires its player to be visible to play).

## v0.1.43 — 2026-10-07

- **Playlists open in place.** The Playlists button on the player now slides open a list of your
  playlists instead of taking you to a separate page.
- **Player button tidy-up.** The Playlists button no longer floats oddly on mobile.
- Slightly tighter spacing at the top of the Discover page on phones.

## v0.1.42 — 2026-10-07

- **Tidier header.** Admin icons (Issues, Blocklist, Users) moved into Settings, and the Playlists
  button moved to the right of the bottom player — so the top bar no longer crowds the search box.
- **Hero glow, full width again.** The backdrop glow now spans the whole screen and the page content
  is centred (fixes the glow vanishing and the right-side cut-off).
- **Mobile album page:** the cover shows again and everything is centred.
- Light theme: the hero glow is hidden for now so it doesn't wash out white (a proper light-mode
  look is coming).

## v0.1.41 — 2026-10-07

- **Full-width hero glow.** The glow on the Discover and album pages now spreads all the way across
  the screen and fades out in every direction, sitting behind the content instead of being cut off
  at the edge of the column.
- **Centered mobile album page.** On phones, everything on an album page is now centered.

## v0.1.40 — 2026-10-07

- **Library-first search.** Search now shows the artists, albums and tracks you already own at the
  top, ahead of everything else; the rest stay ordered by relevance so results stay current.
- **Share links.** Album and artist pages have a share button that copies (or shares) a direct
  link to the page.

## v0.1.39 — 2026-10-07

- **Hero glow, refined.** The blurred cover now glows as a soft, dimmer aura that spreads all the
  way past the edges of the screen and fades into the page, with the text kept readable on top —
  instead of a bright boxed panel.
- **Less clutter on the album page.** Removed the duplicate links section at the bottom (the album
  already links out from the top).

## v0.1.38 — 2026-10-07

- **Glowing hero backdrop.** The blurred cover on the Discover and album pages now glows like an
  aura sitting above the background and spreads wide across the page, with the text on top — rather
  than a flat blurred panel behind everything.

## v0.1.37 — 2026-10-07

- **Softer hero backdrops.** On the Discover and album pages, the blurred cover art now spills
  past the header and fades out instead of stopping at a hard edge, for a smoother full-bleed look.

## v0.1.36 — 2026-10-07

- **Verifier stops churning on oversized packs.** When a download's size isn't reported, the
  verifier no longer treats it as a free pass — it prefers a correctly-sized release when one
  exists, so it stops repeatedly grabbing and rejecting giant packs.
- **Cleaner verifier logs.** Rejections of downloads it can't map to an album now say exactly that
  instead of printing a confusing giant number.

## v0.1.35 — 2026-10-07

- **"New in your library" actually updates now.** Albums that just finished downloading show up
  at the top, even older releases — previously they were sorted by release date and buried.
- **Recent requests clears finished items.** Once an album is in your library it drops off the
  "Recent requests" row instead of lingering there.

## v0.1.34 — 2026-10-07

- **Lists stay up to date.** The Requests list and Discover rows now refresh on their own, so
  finished requests drop to "available" and newly-added music shows up without a manual reload.
- **Discover header:** lighter blur on the backdrop.

## v0.1.33 — 2026-10-07

- **Smarter grabbing.** The verifier no longer accidentally grabs a giant discography pack when
  you request one album — it picks an album-sized release (or skips), which also stops those
  bad grabs from blocking your other downloads.

## v0.1.32 — 2026-10-07

- **Tidied the album page:** the cancel-request button now sits next to "Add to playlist".

## v0.1.31 — 2026-10-07

- **Fixed losing your track pick.** Choosing a single track and then clicking elsewhere in the
  request dialog no longer clears it, and requesting a track from its row now selects just that
  track.

## v0.1.30 — 2026-10-07

- **Cancel requests.** You can now cancel or remove a request from within the app — from the
  request list, an album or artist page, or the manage panel — and cancelling actually stops the
  download (including a whole discography), not just hides the request.

## v0.1.29 — 2026-10-07

- **Grab a single track, not the whole album.** When you request individual tracks, Shufflerr now
  keeps just those tracks from whatever release it fetches, instead of requiring/importing the
  full album. Album and discography requests work as before.

## v0.1.28 — 2026-10-06

- **Direct-grab only fetches what you requested.** The direct-download bypass now grabs just the
  albums you have an open request for, instead of trying to fill your entire monitored library.

## v0.1.27 — 2026-10-06

- **Fixed the reload loop.** The "a new version is available, reload" prompt no longer keeps
  reappearing after you reload — the client and server now agree on the running version.

## v0.1.26 — 2026-10-06

- **Direct grab (optional).** A new switch in Settings lets Shufflerr pick releases and hand them
  straight to your downloader, using the downloader only to tag and organize — so albums the
  downloader otherwise refuses to match can still be fetched and filed correctly. Off by default;
  needs your indexers and download clients set up in the downloader.

## v0.1.25 — 2026-10-06

- **Playlists.** Make your own playlists in the app — create them, add albums or tracks from
  their pages, rename, reorder and remove. They live in Shufflerr only.
- **"For you" on Discover.** A new row recommends music in the genres you already collect, so
  you can find more of what you like.
- **"New in your library" fix.** Albums that become available as part of a bigger (e.g. full
  discography) request now show up in "new in your library" as each one lands, instead of
  sometimes being missed.

## v0.1.24 — 2026-10-06

- **Audio verification: stop the retry storm.** When an item's every available copy fails
  verification, the verifier no longer keeps asking the downloader to fetch yet another copy —
  it tries a few, then gives up gracefully instead of looping forever. Good copies are still
  sought as before.

## v0.1.23 — 2026-10-06

- **Audio verification fix.** The verifier now actually files the downloads it approves instead
  of skipping them when the downloader attaches a cautionary note (like a partial-album
  warning). Bad downloads are still rejected; genuine ones are imported with full tagging and
  artwork.

## v0.1.22 — 2026-10-06

- **Audio verification.** A new companion service double-checks every finished download — right
  track, genuine quality, no fake "lossless" — and only then files it into the library,
  stepping in for the downloader's flaky import. Bad grabs are rejected and re-sought; good ones
  are imported with full tagging and artwork. Quality upgrades (e.g. replacing an MP3 with FLAC)
  keep working as before. Starts in a safe watch-only mode.

## v0.1.21 — 2026-10-06

- **Security hardening:** capped how many live-update connections one account can open.

## v0.1.20 — 2026-10-06

- **Live updates.** Requests, download progress and "now available" update instantly in the
  browser instead of waiting for a refresh.

## v0.1.19 — 2026-10-06

- Dropped the "open in Lidarr" link from album and artist pages — it pointed at an internal
  address that does not work from outside the network.

## v0.1.18 — 2026-10-06

- Internal: test fixes following the security hardening. No change to the app itself.

## v0.1.17 — 2026-10-06

- **Security hardening:** several small fixes — constant-time API-key check, no account
  enumeration on the sign-in form, a couple of internal endpoints gated behind sign-in/admin,
  and tidier error messages.

## v0.1.16 — 2026-10-06

- **Security fix (medium):** server paths, disk space and other infrastructure detail are no
  longer readable by ordinary accounts — only by people who manage requests or settings.

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
