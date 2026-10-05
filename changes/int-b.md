# INT-B — UI integration and browser verification

Verified with Python Playwright (Chromium) against the dev preview on port 5080, set up with the
real music folder (`/srv/music`, 89 albums / 765 tracks after the scan) and the real
Lidarr (read-only: nothing was approved, retried, watched or removed).

## Fixed

| Area | Problem | Fix |
|---|---|---|
| All tables (tracklist, requests, users, jobs, logs, issues, blocklist, search tracks) | Action buttons sat low under a stray divider | Removed Seerr's legacy form rule `.actions` from `globals.css`; it collided with the table cell class |
| Phone layout (search, artist, album, requests) | Page scrolled sideways (up to 969px wide at 390px) | `.sh-scroll-x` is now the containing block for `.sr-only` header cells |
| Profile → Settings → General | Page crashed on the server render (`RangeError: invalid_argument`) | New `src/utils/regions.ts` guards `Intl.DisplayNames`; used by the profile tab and `RegionSelector` (which logged the same error on four settings pages) |
| Manage panel → Block | Confirm dialog opened underneath the slide-over and could not be clicked | Dialog overlay raised above slide-overs (`z-index` 55) |
| Status check | `GET /status?checkUpdateAvailable=false` answered 400 on every page | Query parameter dropped |
| Webhook notification page | JSON editor tried to load a worker script that is not bundled | Worker switched off by default in `JSONEditor` |
| Albums / Artists / Users / Logs / Blocklist filters | `type="search"` inputs were unstyled (white box) | Added to the global input rule |
| Requests, Albums, Artists, Logs | Sort select stretched across the row | `!flex-none` next to `!w-auto` |
| Settings → General | Application title field stretched to the hint's height | `.sh-fields { align-items: start }` |
| Checkboxes and radios | Unchecked boxes were nearly invisible on the dark surface | Border uses the `faint` token |
| Request modal, Requests, Manage panel, Blocklist block | React "unique key" warnings from rich-text message values | Keys added |
| Settings → Lidarr | Banner said "no default" next to a server tagged "Default" (it was the hi-res default) | Tag reads "Default for hi-res"; banner explains a standard default is needed |
| Sign-out page | Told local users they were "still signed in to Plex" | Line shown only when the person signed in with Plex/Jellyfin/Emby (`/logout?via=`) |
| Discover → Popular artists | Wrapping grid (20 artists = 10 rows on a phone); caption claimed "on this server" for ListenBrainz data | Scrolling row; caption names ListenBrainz when the artists are not from the library |

## Added (known items)

- Rail: **Issues** (open-count badge for managers/viewers) and **Blocklist** entries.
- Import: polls `GET /import/jobs/:id` while `status: 'resolving'`, shows "Finding it on MusicBrainz…"
  per pending album, checks newly matched albums by default, and reports failed/truncated jobs.
- Settings → Scrobbling: Plex and Jellyfin webhook addresses with Copy.
- Manage panel: "Remove from Lidarr" and "Remove from Lidarr and delete files"
  (`DELETE /media/:id/lidarr`), shown only when `lidarr.canRemove`; issues use the `mediaId` filter.
- Settings → Local files: list of albums MusicBrainz could not identify (`/settings/local/unresolved`).
- Profile → Notifications: Telegram topic ID and Pushover sound fields.
- "Adapted from Seerr" header added to the 18 Seerr-derived files that lacked it.

The artist "Watch for new releases" toggle already called the route INT-A added; nothing to change.

## Verified working (no change needed)

Login (real-cover slideshow), sign-out, reset password, Discover, Search, Artist, Album (playback of
real files, waveform from real peaks, seek, next), request modal (scopes, track picker, live outcome,
Lidarr profiles, limit meter, Esc and focus trap), Requests (pending → cancel, pending → decline with
note), library pages, Import (real Deezer album, Deezer playlist, Apple Music album, bad link),
Users (create with inline errors, bulk edit, delete), Profile and every settings tab (app password
create/revoke), every Settings page (round-trips, job run-now, schedule editor, log filter and detail,
Lidarr test and edit modal), Issues (report, comment, resolve), Blocklist (block, unblock), 404,
light theme, 390px layout, keyboard walk.

## Not verified

- The setup wizard in a browser: the preview is already initialised and a second `next dev` cannot
  run in this checkout. The page compiles and redirects correctly once initialised.
- Plex PIN popup, Jellyfin/Emby sign-in, Plex/Jellyfin/Navidrome settings beyond loading the pages.
- Anything that writes to Lidarr (approve, retry, watch, remove) and real notification delivery.
- YouTube playback, Spotify, Last.fm, ListenBrainz linking (no keys).
- Phone and light theme were checked on the main pages, not on every settings page.

## Left as is

- Phone tracklists scroll sideways to reach Play (same as the mockup's table behaviour).
- One inherited lint warning (`any` in `Common/Tooltip`).
