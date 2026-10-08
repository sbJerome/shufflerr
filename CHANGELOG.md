# Changelog

All notable changes to Shufflerr are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
`Major.Minor.SubMinor` versions.

## [Unreleased]

## [0.1.48] - 2026-10-08

### Fixed

- **A song in the library now shows available on every release it appears on.** Availability is
  matched by recording (MBID): if a recording is in the library on any release group, it is now
  marked available — and playable via that copy — on every album/EP/single/other that contains the
  same recording, not only the one the downloader happened to match it to. The album page reflects
  this immediately (track availability, play button, and the album's own available count/status),
  and the persisted release-group status catches up on the next library recompute.

## [0.1.47] - 2026-10-08

### Changed

- **Artist hero is now a full-bleed, Ken Burns photo.** The artist page header spans the full
  viewport width (like the Discover hero) with the photo centred and a slow Ken Burns zoom/pan. The
  sides are completely black and the veil is all black (black vignette + edges), fading into the
  page at the bottom. Respects `prefers-reduced-motion` (no animation).

## [0.1.46] - 2026-10-08

### Changed

- **Minimizing the YouTube player keeps it playing.** Minimize now shrinks it to a compact corner
  player (the video stays rendered, so audio keeps going) instead of pausing/hiding it.
- **Artist discography is now a tile grid.** On the artist page the discography shows album tiles
  like the Albums page (filter chips + paging kept) instead of a list. For any release not fully in
  the library, hovering (or focusing) a tile reveals a Request / Fill-gaps button over the cover.
- **Album page hero:** `.sh-ax-hero .veil` raised to `z-index: 1`, and the hero background art is
  now visible in light mode (shown with a normal blend instead of hidden).

## [0.1.45] - 2026-10-08

### Changed

- **Featured release now rotates.** The Discover "Featured release" picked the same album every
  time; it now chooses a random album from the recently-added pool, so it changes between visits.
- **Featured hero shows the cover art sharp.** The Discover hero art is now shown unblurred
  (`blur(0) saturate(1.3) contrast(1.1)`, no screen blend) as the featured cover, with the veil
  raised above it to fade only the bottom — and it's visible in light mode too.

## [0.1.44] - 2026-10-08

### Added

- **Dismiss / minimize the YouTube player.** The floating YouTube player now has a header bar with
  two controls: **close** (stops playback and removes the player) and **minimize** (collapses it to
  a small bar). Because YouTube's player must stay visible while it plays, minimizing pauses the
  video; expanding it resumes.

## [0.1.43] - 2026-10-07

### Changed

- **Playlists open as an overlay from the player.** The Playlists button in the player bar now
  opens a slide-over list of your playlists (fetched on open) instead of navigating to a new page;
  each entry opens that playlist, and a "Manage playlists" link goes to the full page.

### Fixed

- **Player Playlists button no longer wraps oddly on mobile.** The "now playing"/empty area now
  flexes to fill, so the button stays cleanly anchored to the right of the bar.
- **Tighter mobile Discover header spacing** (reduced the hero's top padding on phones). Note: the
  gap above the logo on an installed PWA is the device safe-area inset (Dynamic Island), which is
  expected.

## [0.1.42] - 2026-10-07

### Changed

- **Decluttered the header.** The admin icons that were crowding the search bar moved off the top
  nav: Issues and Blocklist now live in Settings (under a new "Management" group; Users was already
  there), and the Playlists shortcut moved to the right side of the player bar at the bottom.
- **Hero glow renders full-width again.** The heroes are now full-bleed to the viewport with the
  content in a centred column, so the cover-art glow spans edge to edge and fades in every
  direction (fixes the glow disappearing entirely, and the earlier right-side cutoff). The page
  content column is now centred.

### Fixed

- **Mobile album cover restored.** Centering the mobile album hero collapsed the cover's grid cell;
  it now has an explicit width and shows again.
- **Light-theme heroes no longer blow out to white.** The `screen`-blend glow is hidden in light
  mode (a dedicated light-theme treatment is still to come).

## [0.1.41] - 2026-10-07

### Fixed

- **Hero glow now spans the full viewport and fades in every direction.** On the Discover and
  album pages the glow was clipped to the (left-aligned, max-width) content box and cut off hard on
  the right. The glow is now a full-width backdrop: sized in viewport units and centred, sitting
  *behind* the content (`z-index: -1`, no `isolation`/opaque base) so it reaches edge to edge,
  fades out radially, and no longer washes over the tracklist.
- **Mobile album page is now centered.** On phones the album hero stacks and centers everything —
  breadcrumb, cover, title, artist, metadata, progress, action buttons and the tool icons.

## [0.1.40] - 2026-10-07

### Added

- **Search now puts your library first.** Search queries the local library before anything else
  and lists owned artists/albums/tracks ahead of all MusicBrainz results (e.g. searching an album
  you own shows your copy first). On page 1 the owned matches are prepended (deduped); later pages
  float any in-library items to the top. Non-library results keep MusicBrainz's relevance order so
  the list stays current. (New `searchLibrary` helper + library-first merge in `searchMusic`.)
- **Share button on album and artist pages.** A share control copies the direct link to the page
  (and uses the native share sheet where available), so album/artist pages can be shared. Includes
  a legacy clipboard fallback so it also works on insecure (http) origins.

## [0.1.39] - 2026-10-07

### Changed

- **Hero aura reworked into a wide, dimmer glow + text scrim.** The Discover and album-page
  hero artwork now renders as a soft, dimmed glow (lower opacity, heavier blur, `screen` blend)
  that spreads edge to edge and bleeds **past the viewport's horizontal limit** on both sides and
  down into the page, instead of the earlier bright, boxed panel. The horizontal clip moved to
  `html` so the glow can reach the true interface edge with no horizontal scrollbar. A scrim layer
  sits between the aura and the content so the text stays readable over the glow. (Fixes a hard
  vertical cut caused by sizing the art with four insets + `auto`.)

### Removed

- **Dropped the duplicate external-links section at the bottom of the album page.** The album
  already exposes its source link in the hero action row, so the redundant bottom links block was
  removed.

## [0.1.38] - 2026-10-07

### Changed

- **Hero backdrop is now a glowing aura, not a flat panel.** Reworked the Discover and album-page
  hero artwork so the blurred cover reads as a glow: it now sits *above* the hero's background
  layers (dark base + veil) with a `screen` blend so it radiates light, shaped by a radial mask
  into a soft aura, with only the text/content layered on top. The aura also expands well past the
  content column — the horizontal clip moved from `.sh-view` up to `.sh-main`, so the glow can fill
  the main column width (still no horizontal page scrollbar; vertical bleed preserved).

## [0.1.37] - 2026-10-07

### Changed

- **Blurred-art heroes now bleed past their edges.** The Discover and album-page heroes (a
  cover image under a tinted overlay) clipped the blurred artwork hard at the hero box. They now
  let the image and its blur overflow the container and fade out softly via a radial mask, so the
  backdrop melts into the surrounding page instead of ending at a sharp rectangle. Horizontal
  bleed is contained at the content column (`.sh-view { overflow-x: clip }`) so no horizontal
  page scrollbar appears.

## [0.1.36] - 2026-10-07

### Fixed

- **Verifier size guard no longer leaks unknown-size packs (sidecar 0.1.8).** The release-size
  budget kept any release the indexer reported with an unknown size (size 0), so an oversized
  discography pack with no reported size slipped straight past the cap even when a properly-sized
  album release was available — the leak behind the repeated oversized-pack grab→reject churn.
  The picker now prefers a release whose known size fits the budget and only falls back to an
  unknown-size release when no known-in-budget release exists (so indexers that never report size
  still work).
- **Verifier rejection log no longer prints a sentinel as an attempt count (sidecar 0.1.8).** A
  download that couldn't be mapped to an album logged `attempts=4294967295` (the internal
  "unmapped" sentinel). Unmapped downloads can't be re-searched by album anyway; the log now says
  so plainly and only prints a real attempt count for mapped albums.

## [0.1.35] - 2026-10-07

### Fixed

- **"New in your library" now shows freshly-available albums.** The row sorted by
  `mediaAddedAt`, which for a requested album often holds the album's original *release date*
  (e.g. 2016) rather than when it entered the library. A recently-downloaded old release was
  therefore sorted to the very bottom and never appeared. The row now orders by when the media
  row last changed (`updatedAt`), which is bumped exactly when availability flips, so newly
  imported albums surface at the top regardless of their release date.
- **Completed requests leave "Recent requests".** The recent-requests row had no status filter,
  so an album that finished downloading stayed listed. Completed requests are now excluded — once
  an album is in the library it belongs under "New in your library", not the active list.

## [0.1.34] - 2026-10-07

### Fixed

- **Lists now refresh on their own.** The Requests list and the Discover rows ("New in your
  library", recent requests, "For you") relied on live SSE events + window focus with no polling
  fallback, so they could show stale state — finished requests lingering, new library items not
  appearing. They now poll periodically (Requests every 20s while downloading / 60s otherwise;
  Discover rows every 60–120s) so they stay current even if a live event is missed.

### Changed

- **Discover header:** reduced the blur on the hero's background artwork (36px → 18px).

## [0.1.33] - 2026-10-07

### Fixed

- **Direct-grab no longer grabs oversized packs (sidecar 0.1.7).** The grab picker could choose a
  discography/compilation release containing hundreds of tracks for what should be a single
  album — downloading the wrong content, failing verification, and starving small imports behind
  it. It now rejects any release whose size is implausibly large for the album's track count
  (~200 MB/track budget; unknown sizes still allowed), so it grabs an album-sized release or
  skips. Single-song requests still download the album they're on (releases are whole-album), but
  never a giant pack.

## [0.1.32] - 2026-10-07

### Changed

- **Album page:** the cancel/remove-request button now sits in the action row next to
  "Add to playlist" instead of under the request-status banner.

## [0.1.31] - 2026-10-07

### Fixed

- **Request dialog lost your track selection.** In the track picker, selecting a track and then
  clicking elsewhere in the dialog could clear the selection — the modal's background data was
  revalidating (on window focus and on live-update events) and rebuilding the derived track list
  underneath the picker. The dialog now freezes its data while open and treats your picks as
  authoritative. Requesting a single track from its row now pre-selects exactly that track.

## [0.1.30] - 2026-10-07

### Added

- **Cancel a request from the UI.** A cancel/remove control now appears wherever a request's
  status is shown (request list, album & artist/discography pages, discography table, and the
  manage slide-over). The requester can cancel while a request is still pending; managers can
  remove at any status (so an auto-approved discography can be stopped). Cancelling now also
  **stops the download**: it unmonitors the affected album(s) in the downloader and removes their
  active queue items, scoped strictly to that request's own media (failures are non-fatal).

## [0.1.29] - 2026-10-07

### Added

- **Single-track requests import only the requested track(s).** A `tracks`-scope request already
  records the specific tracks; the verifier config endpoint now also exposes, per album wanted
  purely by track scope, those tracks' recording identifiers. When such a release is downloaded,
  the sidecar (0.1.6) files **only** the requested track file(s) via manual-import — not the whole
  album — matching them by recording id. Album and discography requests are unchanged (import in
  full). A downloaded release that contains none of the requested tracks is left unimported.

## [0.1.28] - 2026-10-06

### Changed

- **Direct-grab now targets only requested albums.** Previously the direct-submit bypass worked
  from the downloader's entire monitored-missing catalog (which can be the full discographies of
  every monitored artist). It is now scoped to the albums the user has an open request for: the
  server's verifier-config endpoint returns the requested album ids, and the sidecar only grabs
  those. An empty list means grab nothing. This keeps direct-grab to what was actually asked for
  instead of auto-filling the whole library.

### Fixed

- **Endless "a new version is available — reload" loop.** The web client bakes its build-time
  commit tag defaulting to `local`, but the server wrote its runtime `committag.json` with an
  empty string when no commit tag was supplied at build — so the two never matched and the
  reload prompt reappeared immediately after every reload. The server now defaults its commit
  tag to `local` as well, matching the client, and builds supply a real commit tag so the two
  always agree.
- **Direct-grab hardening (sidecar 0.1.4).** Three fixes to the direct-submit bypass surfaced by
  live testing: (1) submit failures now log the HTTP status only — never the request URL, which
  embedded the indexer API key and the release name; (2) the real download-client secret is read
  from the sidecar's own secret (the downloader API only exposes a masked key), so usenet submits
  authenticate correctly; (3) the grab cycle now caps *attempts* per cycle and cools down every
  attempted item, so a run of failures can no longer churn through every wanted item or flood the
  indexers and logs.

## [0.1.26] - 2026-10-06

### Added

- **Direct-grab bypass (sidecar 0.1.3), toggleable.** A new mode in which Shufflerr owns release
  selection and the downloader is used only to organize. When enabled, the verification sidecar
  reads the indexers and download clients configured in the downloader, interactive-searches for
  each monitored-missing album, picks the best release, and submits it **straight to the download
  client** — bypassing the downloader's release matcher (which otherwise refuses releases it
  can't map). It records the client's download id → album so the completed, otherwise-unmatchable
  download is verified against the right album and filed via a scoped manual-import (tag/rename
  only). Bounded by a per-cycle grab cap and a per-album cooldown. Controlled by a new
  **"Direct grab"** switch in Settings → General (`main.musicDirectGrab`, default **off**); the
  sidecar reads it from a new unauthenticated `GET /api/v1/verifier/config` endpoint that returns
  only `{ enabled }`.

## [0.1.25] - 2026-10-06

### Added

- **Playlists.** Create and manage playlists inside the app: a Playlists page (list + create),
  a playlist detail view (rename, reorder, remove items, delete), and an "add to playlist"
  action from album and track contexts. Playlists are owner-scoped and stored only in the app's
  own database (no sync to the media server). Backed by new `UserPlaylist` / `UserPlaylistItem`
  entities and an owner-scoped CRUD API, with migrations for SQLite and PostgreSQL. (Named
  `UserPlaylist` to avoid colliding with the existing client-API library playlists.)
- **"For you" discovery.** The Discover page now has a genre-based recommendation row built from
  the top MusicBrainz genres in your library, surfacing albums in those genres that you don't
  already have (via the existing metadata path — no new integration). Cached and built in the
  background; hidden when there's nothing to draw from.

### Fixed

- **"New in your library" dropped some newly-available albums.** The recently-added query
  ordered strictly by added-date, and rows that reached a library status without an explicit
  added-date (which happens for albums completing within a larger/discography request) sorted
  last under SQLite's NULL ordering and fell off the list. It now orders by the first available
  of added/updated/created date, so every newly-available album appears — including individual
  albums of a partly-filled discography request.

## [0.1.24] - 2026-10-06

### Fixed

- **Verifier re-search churn (sidecar 0.1.2).** When a rejected release was blocklisted, the
  sidecar always asked the downloader to search for a replacement. For an item whose every
  available release fails verification, that produced an endless blocklist → re-search →
  re-grab → reject loop (burning bandwidth and inflating the blocklist). The sidecar now caps
  re-search per album: after a small number of rejected releases for the same album, further
  rejects still blocklist the bad release but no longer trigger a re-grab, so the process
  converges. The per-album count is tracked in the sidecar's durable state.

## [0.1.23] - 2026-10-06

### Fixed

- **Verifier import path (sidecar 0.1.1).** When driving the downloader's manual import, the
  sidecar now ignores the downloader's *advisory* manual-import rejections (e.g. a partial-album
  "missing tracks" note) and imports a verified release as long as a valid artist/album/
  release/track mapping is present. Previously any advisory rejection caused the import to be
  skipped ("no importable files"), so verified downloads the downloader declined to auto-import
  were never filed — defeating the point of the sidecar. A download with no usable mapping is
  still skipped. Note: the sidecar depends on the downloader's queue to see completed downloads,
  so the downloader's Completed Download Handling must remain enabled; the sidecar rescues the
  items the downloader fails to import rather than replacing its handling.

## [0.1.22] - 2026-10-06

### Added

- **Audio-verification sidecar.** A separate companion service that verifies each completed
  download before it enters the library. For every audio file it checks the technical specs,
  confirms the recording's acoustic fingerprint matches the expected release, and detects
  transcoded / fake-lossless files; any failed check hard-rejects the release. On a pass it
  drives the downloader's manual-import (so the downloader still handles tagging, renaming and
  artwork); on a fail it removes and blocklists the release so a better copy is sought. This
  bypasses the downloader's unreliable automatic-import threshold. The downloader's existing
  quality-upgrade behaviour is preserved — tier selection stays with the downloader; the sidecar
  only authenticates and files what was grabbed. It runs in observe-only mode by default and
  mounts the completed-downloads folder read-only. Built and tested as its own container image;
  excluded from the main app image.

## [0.1.21] - 2026-10-06

### Security

- **SSE connection cap (low).** The real-time stream (`/api/v1/realtime`) accepted unbounded
  connections per account, a potential resource-exhaustion vector. It now caps concurrent
  streams at 8 per user and 500 total (503 beyond), with the count freed when a connection
  closes.

## [0.1.20] - 2026-10-06

### Added

- **Real-time updates (Server-Sent Events).** The browser opens one authenticated SSE stream
  (`GET /api/v1/realtime`) and request status, download progress and availability now update
  live instead of on a poll. Events are scoped per viewer — a request event reaches only the
  requester or someone who can already see all requests (MANAGE_REQUESTS / REQUEST_VIEW);
  media/availability events are shared. Emitted from the request subscriber, the download sync
  and the availability recompute; the client revalidates the affected SWR caches on each event.
  Polling is kept as a 60s fallback.

## [0.1.19] - 2026-10-06

### Changed

- Removed the "open in Lidarr" link from the album, artist and manage views. Lidarr runs on an
  internal address that does not resolve from outside the network, so the link was dead for
  anyone reaching the site over the public hostname. The "Remove from Lidarr" actions and the
  Lidarr details (quality, metadata profile, folder) are unchanged.

## [0.1.18] - 2026-10-06

### Fixed

- Test suite: updated two tests to match the 0.1.17 security behaviour — the sign-in test now
  expects the generic credential message, and the request-route tests set a real API key (an
  empty key no longer authenticates). No runtime change.

## [0.1.17] - 2026-10-06

### Security

- **Hardening (low).** A batch of low-severity items from the security review:
  - the `X-API-Key` header is compared in constant time (`safeEqual`), matching the webhook path;
  - local sign-in returns the same message for an unknown email and a wrong password, so valid
    accounts cannot be enumerated by password guessing;
  - `GET /status/appdata` (config path and permissions) now requires a signed-in session;
  - the Pushover sounds lookup requires MANAGE_SETTINGS (it uses the stored admin token);
  - `GET /issue` clamps `take`/`skip`;
  - the media and blocklist routes no longer return raw exception text to the client (the detail
    is logged server-side).

## [0.1.16] - 2026-10-06

### Security

- **Infrastructure detail exposed to any signed-in user (medium).** `GET /service/lidarr[/:id]`
  returned a Lidarr server's root-folder filesystem paths, free/total disk space, server names
  and profiles to any authenticated account. It now requires the permission its only callers
  already have — REQUEST_ADVANCED (advanced request modal), MANAGE_REQUESTS, or MANAGE_SETTINGS
  (admins pass).
- **`GET /media/:id`** returned the raw library row (local file path, media-server item ids) to
  any authenticated user; it is used only by the manage tools and now requires MANAGE_REQUESTS,
  matching the other media routes.

## [0.1.15] - 2026-10-06

### Security

- **Session fixation (medium).** The session id was not regenerated on sign-in, so an id fixed
  before authentication (feasible over plain HTTP on a shared network) could be reused to ride
  the victim's session afterwards. All sign-in paths (Plex, Jellyfin/Emby incl. Quick Connect,
  local, first-run setup) now regenerate the session id before establishing the authenticated
  session.

## [0.1.14] - 2026-10-06

### Fixed

- Follow-up to 0.1.13: the session is now read on the image-proxy mount, so the internal-source
  access check can tell a signed-in viewer from an anonymous one. Without this, artist photos
  served from an internal source returned 401 for everyone. Signed-in viewers get those images
  again; anonymous requests and path traversal stay blocked.

## [0.1.13] - 2026-10-06

### Security

- **Image proxy path traversal / SSRF (high).** The `/imageproxy/<source>/<path>` endpoint did
  not reject `..` path components, so a request could escape a source's base path and reach the
  rest of an internal, credentialed host's API (the Lidarr image source attaches that server's
  API key). The route now rejects any `..` component; credentialed/internal sources require a
  signed-in session (public cover-art CDNs stay open for the pre-sign-in login slideshow); and
  the HTTP client refuses any resolved URL that falls outside the source's base origin and path
  prefix. Regression tests added.

## [0.1.12] - 2026-10-06

### Fixed

- Plex (and Gravatar) avatars showed as initials: the client only allowed proxied image hosts,
  so the stored plex.tv avatar URL was dropped. `avatarUrl` now loads plex.tv and gravatar.com
  avatars directly, the way Seerr does; Jellyfin avatars still go through `/avatarproxy`.

## [0.1.11] - 2026-10-06

### Changed

- Approved requests and the albums they cover read **"Requested"** until Lidarr's queue actually
  holds the download; only then do they read **"Downloading"**. Status badges take a
  `downloading` flag derived from the request's download progress (`isDownloading` in
  `src/utils/status.ts`); the album banner, track rows, request lists, Discover, the manage
  panel and profile pages all follow it.
- The download sync clears a request's progress figure when Lidarr's queue no longer holds it,
  so "Downloading" cannot linger after a grab is gone.
- Discover's "Downloading now" counts only what Lidarr's queue holds; the Requests filter chip
  for approved requests reads "Approved"; the artist facts and album filters read "Requested".

## [0.1.10] - 2026-10-06

### Fixed

- Albums whose files sit directly in the artist folder (no album subfolder) were not identified
  through Lidarr, so the scan fell back to a name search and could attach them to the wrong
  MusicBrainz release. The Lidarr lookup now accepts both folder shapes.

## [0.1.9] - 2026-10-06

### Fixed

- Editions with a bonus video disc (DVD, Blu-ray) counted the video items as tracks, so an
  album whose audio was complete showed "Partly available" and its request never completed.
  Video mediums are now left out of the canonical tracklist, as Lidarr does
  (`isVideoMedium` in `server/lib/metadata/index.ts`). DVD-Audio and DualDisc still count.

## [0.1.8] - 2026-10-06

### Fixed

- Albums downloaded by Lidarr could stay "Downloading" after the files arrived. Files Lidarr
  imports often carry no MusicBrainz ids in their tags, and when the tagged title also differs
  from the MusicBrainz title the local scan could not identify the folder and left it unresolved.
  The scanner now asks Lidarr which album a folder belongs to (matching the artist and album
  folder names against Lidarr's track files) and uses its release-group, edition and per-file
  recording ids before falling back to a name search (`server/lib/library/lidarrHints.ts`).
- "Run now" on the local-files scan retries folders that were left unresolved instead of
  waiting for the weekly retry.

## [0.1.7] - 2026-10-06

### Fixed

- Album requests for a newly added artist no longer fire the Lidarr search before Lidarr has
  loaded the album's tracks. Lidarr creates the album rows first and pulls tracks afterwards;
  a search in that window had every result rejected with "Album duration is 0" and was never
  retried, so the request sat at "Approved, downloading" forever. `waitForAlbum` now waits for
  the album's track count (up to 60s) before searching
  (`server/subscriber/MediaRequestSubscriber.ts`).

## [0.1.6] - 2026-10-05

### Changed

- Pages are centred on wide screens: the content column (max 1400px) now sits in the middle
  of the window, in line with the top navigation, and the player bar's contents line up with it.

## [0.1.5] - 2026-10-05

### Changed

- **Top navigation** replaces the left icon rail (`src/components/Layout/TopNav.tsx`): brand,
  primary links with labels, search, pending pill, theme toggle and account in one sticky bar.
  Labels drop below 1300px, the links fold into a menu below 1000px, and the search box takes
  its own row on phones. Users, Issues, Blocklist and Settings are icon-only in the bar.
- **Artist page:** the photo now fills most of the viewport (up to 88vh) with the name and
  top albums over its lower part, closer to the Rekord artist page.
- **Discography** on the artist page is paged, 10 releases at a time, with Previous / Next and
  a page counter; changing the type filter returns to page 1.
- Responsive pass across Discover, Artist, Album, Requests, Search, Settings and Users at
  1440 / 1100 / 820 / 390px: no horizontal page scroll at any width.

### Removed

- `src/components/Layout/Rail.tsx` (replaced by `TopNav.tsx`).

## [0.1.4] - 2026-10-05

### Added

- **Genre pages** at `/genre/<name>`: artists and albums/EPs MusicBrainz tags with that genre,
  library status merged in, with paging (`GET /api/v1/genre/:name`). Genre chips on album and
  artist pages now link to them.
- **Deezer artist photos** as a third fallback (`server/api/deezerImages.ts`) after fanart.tv and
  Lidarr, for artists neither has a photo of. Exact-name match only; off when Deezer is off.

### Changed

- **Album page redesigned** (owner request): blurred-artwork hero over a centred column, icon
  actions for Report a problem / Manage / MusicBrainz, and the tracklist as a stack of bars with
  a play button, file format, length, status and a per-track Request button for missing tracks.
  The previous page is kept at `/album/<mbid>/classic`.
- **Artist page redesigned** (owner request): sharp full-bleed artist photo, centred spaced-out
  name, and a "Top albums" row directly under it (library albums first, then studio albums);
  the facts, About, discography and links follow. The previous page is kept at
  `/artist/<mbid>/classic`.

## [0.1.3] - 2026-10-05

### Changed

- **Discover page redesigned** (owner request, deviates from the handoff mockup): full-bleed hero
  with the featured release over its own blurred artwork and the library numbers along its lower
  edge; paged carousels with arrow buttons and dark-footer cards; a "Most popular this week" list
  with All / Not in library / In library tabs beside dated cards for recent requests and
  concerts; lighter headings. Written with Shufflerr's own markup and CSS (`sh-dx-*`).
- The previous Discover page is kept as a backup at `/discover/classic`
  (`src/components/DiscoverClassic`).
- The album placeholder is now an original drawing (`public/no-cover.svg`: star-trail sleeve and
  record in Shufflerr's colours). The third-party `no-cover.webp` is removed.
- README states the current version and uses it in the image tag example.

## [0.1.2] - 2026-10-05

### Added

- Container image published at `ghcr.io/sbjerome/shufflerr` (`latest`, `0.1.1`); README has the
  `docker run` command.

### Changed

- Albums with no cover art show a vinyl placeholder (`public/no-cover.webp`) instead of an empty
  tinted slot. Artist and user slots keep their initials.
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

[Unreleased]: https://github.com/sbJerome/shufflerr/compare/v0.1.21...HEAD
[0.1.21]: https://github.com/sbJerome/shufflerr/compare/v0.1.20...v0.1.21
[0.1.20]: https://github.com/sbJerome/shufflerr/compare/v0.1.19...v0.1.20
[0.1.19]: https://github.com/sbJerome/shufflerr/compare/v0.1.18...v0.1.19
[0.1.18]: https://github.com/sbJerome/shufflerr/compare/v0.1.17...v0.1.18
[0.1.17]: https://github.com/sbJerome/shufflerr/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/sbJerome/shufflerr/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/sbJerome/shufflerr/compare/v0.1.14...v0.1.15
[0.1.14]: https://github.com/sbJerome/shufflerr/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/sbJerome/shufflerr/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/sbJerome/shufflerr/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/sbJerome/shufflerr/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/sbJerome/shufflerr/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/sbJerome/shufflerr/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/sbJerome/shufflerr/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/sbJerome/shufflerr/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/sbJerome/shufflerr/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/sbJerome/shufflerr/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/sbJerome/shufflerr/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/sbJerome/shufflerr/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/sbJerome/shufflerr/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/sbJerome/shufflerr/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/sbJerome/shufflerr/releases/tag/v0.1.0
