# Front end

Source of truth: `design/shufflerr-mockup.html` (open it; sign in as `admin@shufflerr.local`)
and `design/screens/`. This doc lists what to build and the rules behind the visuals.

## Routes

| Route | Screen | Access |
|---|---|---|
| `/login` | Sign in (Plex / Jellyfin / local) | public |
| `/logout` | Signed-out page | public |
| `/resetpassword/[guid]` | Seerr's reset flow, restyled | public |
| `/setup` | Seerr's setup wizard, adapted (backlog polish) | first run |
| `/` → `/discover` | Discover | signed in |
| `/search?query=` | Search results (tabs: All, Artists, Albums and singles, Tracks) | signed in |
| `/artist/[mbid]` | Artist page | signed in |
| `/album/[mbid]` | Album (release group) page + request modal | signed in |
| `/requests` | Requests list (own or all by permission) | signed in |
| `/import` | Import from Spotify / Deezer / Apple Music | any import source enabled |
| `/profile`, `/profile/requests`, `/profile/settings/[tab]` | Own profile | signed in |
| `/users` | User list | MANAGE_USERS |
| `/users/[id]`, `/users/[id]/requests`, `/users/[id]/settings/[tab]` | Profiles | own or MANAGE_USERS |
| `/settings/[page]`, `/settings/notifications/[agent]` | Admin area | MANAGE_SETTINGS |
| `/mobile` | Mockup-only phone preview — **do not build**; the real app is responsive | — |

Mockup uses hash routes (`#/users/2/settings/apps`); build them as real Next.js routes.

## App shell

- **Icon rail** (76px, left, sticky): brand tile `s/` (accent bg) → Discover, Search, Artists,
  Albums, Requests (badge = pending count: all pending for managers, own pending for others),
  Import (hidden when no import source), Users (MANAGE_USERS), spacer, Settings
  (MANAGE_SETTINGS). Icons are 22px stroke icons (Heroicons/Lucide are fine — Seerr uses
  Heroicons). `aria-label` + `title` on each; `aria-current="page"` on the active one.
  Below 760px the rail becomes a sticky top bar (horizontal).
- **Top bar:** search field (label "Search music", placeholder "Search artists, albums and
  tracks", `/` focuses it), pending pill ("N waiting for approval" / "N of yours waiting"),
  theme toggle, account button (avatar + display name) → menu: name, email, role badge, account
  type; Profile, My requests, Account settings, Server settings (if allowed), Sign out.
- **Player bar** (fixed bottom, 76px, safe-area aware): prev / play-pause (48px ring button,
  accent) / next; now playing (art slot + title + artists); waveform (96 bars, played part in
  accent, click to seek); time `1:12 / 3:23`; source line "Streaming from Plex, scrobbling to
  ListenBrainz". On phones: prev/next/time/source hidden, waveform wraps to its own row.
- Main content max-width 1400px, padding 32px (16px on phones), vertical gap 48px between
  sections.

## Pages (what each must contain)

- **Discover:** base hero (command-line line `$ shufflerr discover --since 7d`, H1
  "Find it. Request it. / Hear it tonight." second line in accent, blurb, "Search music" +
  "See requests" buttons, 2×2 stats panel: Albums in library, Artists, Tracks, Downloading now);
  Featured release band (artist photo slot right with scrim, "Featured release", big title,
  artist line, availability blurb, Request missing tracks / View album / Play from library);
  rows: Recently added, Trending new releases (with Request buttons), Popular artists (round),
  Concerts for artists you have (when Ticketmaster/Skiddle on), Recent requests (or "Your recent
  requests").
- **Search:** title "Results for “q”", filter chips with counts, Artists (top result card +
  list), Albums and singles grid, Tracks table (Play / Request per row), empty state.
- **Artist:** crumb, round photo slot, one-line bio meta, name, tags, Request discography (or
  disabled state "Discography waiting for approval"), Watch for new releases toggle, Open in
  Plex/Jellyfin, facts grid (Releases / In library / Downloading / Albums), About + details
  (MBID, Lidarr monitored, quality, folder), Discography table with type chips and per-row
  action (Request / Fill gaps / Play / none), Similar artists chips.
- **Album:** crumb, status banner when a tracks request is pending/approved, cover slot (280px),
  meta line, title, artist link, counts + status + "N of M in library" + progress bar, buttons
  (Request missing tracks, Play album, Report a problem), Tracklist table (#, title + credits,
  length, file format, status, Play).
- **Request modal:** title "Request <album>", summary row, radio cards for scope
  (Only the missing tracks / The whole album / Everything by <artist>) with sub-lines, **live
  outcome box** (auto / waiting / blocked — calls the dry-run endpoint), advanced selects (Lidarr
  server, Quality, Metadata profile, Folder — only with REQUEST_ADVANCED or manager), "Ignore my
  weekly limit" (managers with a limit), limit meter, Cancel / Send request.
- **Requests:** title ("Requests" or "Your requests"), sub-line, your-limit box, status chips with
  counts (All, Waiting, Downloading, Available, Declined, Failed), table (art, request + artist
  + note, type, requested by + time, last change, status, actions: Approve/Decline, Cancel
  request, progress bar, Retry, Play), empty state.
- **Import:** sources row, link input + Find albums, results list with checkboxes (in-library
  disabled), Request checked albums, Spotify saved-albums panel.
- **Users / Profile / User settings / Admin:** see `USER_SYSTEM.md` and `ADMIN_PAGES.md`.

## Design tokens

Dark is the default; light must work. Put these in CSS variables (and Tailwind theme).

| Token | Dark | Light | Use |
|---|---|---|---|
| bg | `#0C101B` | `#F4F6FA` | page |
| surface | `#10151F` | `#FFFFFF` | cards, panels |
| raised | `#141A26` | `#FFFFFF` | inputs, dialogs |
| hover | `#1A2131` | `#EBEFF5` | hover/active fills |
| line | `#1E2636` | `#DDE3EC` | borders |
| line-2 | `#283143` | `#C9D2DE` | stronger borders, scrollbar thumb |
| text | `#E9EEF4` | `#121826` | |
| muted | `#9CA8B0` | `#4A5566` | secondary text |
| faint | `#7F8A9A` | `#5C6878` | captions (still ≥ 4.5:1) |
| accent | `#FF1744` | `#D6002A` | primary buttons, active states |
| on-accent | `#0C101B` | `#FFFFFF` | text on accent |
| link | `#FF5C7A` | `#C4002A` | links |
| rail | `#090C14` | `#FFFFFF` | rail, player, auth side |
| slot / slot-ink | `#1A2131` / `#3A4458` | `#E3E8F0` / `#8A96A8` | image placeholders |
| st-available | `#5FD3C6` | `#0B7F74` | Available, In library, Connected |
| st-partial | `#7FD08A` | `#2E7D32` | Partly available |
| st-processing | `#9DB4FF` | `#3557C4` | Downloading |
| st-pending | `#F5B83D` | `#9A6400` | Waiting for approval, Owner badge |
| st-declined | `#F08C7A` | `#C0392B` | Declined, Failed, Missing, danger |
| st-none | `#7F8A9A` | `#5C6878` | Not in library |

Brand colors used only on integration tiles/buttons: Plex `#E5A00D` (button text `#1B1405`),
Jellyfin `#7B5CD6`, Spotify `#1DB954`, Deezer `#A238FF`, iTunes `#FB5BC5`, Ticketmaster
`#026CDF`, YouTube `#E62117`, Last.fm `#D51007`, ListenBrainz `#EB743B`, MusicBrainz `#BA478F`,
Navidrome `#2F6FDE`. **Don't ship third-party logos** unless their brand guidelines allow it;
the mockup uses two-letter tiles.

Album-art placeholder tints (used until art loads, and for missing art) — pairs
`[bg, ink]`: `#2B3A35/#7FE0D2`, `#3A2E22/#F5B83D`, `#232A3A/#9DB4FF`, `#382328/#F08C7A`,
`#2E3322/#C8E07A`, `#30263A/#D2A6F5`, `#1F2E2E/#E6E8E3`, `#3A3520/#F2E3A0` (pick by hash of MBID).

**Type:** IBM Plex Sans 300/400/500/600/700 (UI), JetBrains Mono 400/500/700 (numbers, times,
IDs, wordmark, `$` command line, endpoint URLs, log lines). Base 15px/1.5. Page H1 30–32px/700,
section H2 22px/600, hero 34–84px clamp/700 tight tracking (−0.03 to −0.04em).

**Shape:** radius 8px (buttons/inputs/covers), 10–12px (pills, lists), 14–16px (panels, hero,
dialogs), 50% (artist photos). Buttons min-height 46px (small 40px); touch targets ≥ 44px.

**Status display:** dot + label (`.status`), never color alone. Covers carry a status badge
top-left.

**Scrollbars:** thin, rounded, `line-2` thumb on transparent track, `faint` on hover, accent
while dragging; `scrollbar-gutter: stable`; Firefox `scrollbar-width: thin` +
`scrollbar-color`.

**Motion:** one deliberate motion moment each — login slideshow crossfade (2 s, every 6 s),
toast slide-up (0.2 s), switch knob (0.15 s). No entrance animations on sections. Everything
off under `prefers-reduced-motion`.

## Components to build (map to Seerr where possible)

| Component | From Seerr | Notes |
|---|---|---|
| AppShell (Rail, TopBar, AccountMenu) | `Layout` | new layout, reuse Layout's user/permission plumbing |
| Player, Waveform | — | new |
| AlbumCard, ArtistCard, CoverArt (slot + tint + badge) | `TitleCard`, `CachedImage` | |
| HorizontalRow | `Slider`, `MediaSlider` | CSS grid row with scroll-snap, `minmax(176px,212px)` columns |
| StatusBadge / StatusDot | `StatusBadge` | music labels |
| RequestModal (ReleaseRequestModal) | `RequestModal/*`, `TvRequestModal` (season picker → scope) | + dry-run outcome |
| RequestList / RequestItem | `RequestList`, `RequestCard` | |
| PermissionEditor | `PermissionEdit`, `PermissionOption` | tree from mockup |
| SettingsLayout (grouped sidebar + select) | `SettingsLayout` | replace tab bar |
| Panel, SwitchRow, Field, SensitiveInput | `Common/*` | |
| Toast | `Toast` (react-toast-notifications in Seerr) | bottom-center, above player |
| Login (PlexLoginButton, JellyfinLogin, LocalLogin, LoginSlideshow) | `Login/*`, `ImageFader` | |
| UserList, BulkEditModal, PlexImportModal, JellyfinImportModal | same names | |
| UserProfile + UserSettings tabs | same names | + LinkedAccounts, AppPasswords |

## Copy rules

Sentence case everywhere. Plain verbs. One name per action through the flow
("Request" → "Requested …", "Approve" → "Approved …"). Errors say what happened and how to fix
it, no apologies. Empty states give the next step ("You haven't requested anything yet. Search
for an album to start."). No "Submit", no "Oops". Keep the exact strings from the mockup unless
they're wrong.

## Accessibility checklist

Landmarks (`nav` rail with `aria-label="Primary"`, `main`, player `role="region"`), skip to
content, visible focus ring (accent, 2px), dialogs trap focus and close on Esc, toasts in
`aria-live="polite"`, tables have header rows, icons-only buttons have `aria-label`, switches are
buttons with `aria-pressed`, radio cards are real radios, contrast ≥ 4.5:1 for text in both
themes, reduced motion respected, keyboard `/` focuses search (skip when typing).
