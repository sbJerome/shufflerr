# Shufflerr — Handoff

Shufflerr is a self-hosted request and discovery manager for music. It does for albums, tracks
and discographies what Seerr does for movies and TV. People search, request what's missing,
admins approve (or permissions auto-approve), Lidarr downloads it, and the media server
(Plex, Jellyfin, Navidrome, or local folders) marks it available.

This pack is everything produced during the design phase. It is meant to be dropped into a
fork of Seerr and built out in Claude Code.

> **Read order for Claude Code:** `HANDOFF.md` (this file) → `CLAUDE.md` → `docs/BUILD_PLAN.md`
> → the doc for the phase you're on → open `design/shufflerr-mockup.html` in a browser.

---

## 1. What's in this pack

| Path | What it is |
|---|---|
| `HANDOFF.md` | This file. Context, decisions, architecture summary, index of everything else. |
| `CLAUDE.md` | Standing instructions for Claude Code: rules, stack, conventions, attribution. Put at repo root. |
| `KICKOFF.md` | Exact setup commands and the prompt to start the build with `claude --effort ultracode`. |
| `NOTICE.md` | Third-party attribution (Seerr). Must ship with the product. |
| `LICENSES/seerr-MIT.txt` | Verbatim copy of Seerr's MIT license. Must ship with the product. |
| `docs/BUILD_PLAN.md` | Phased plan, ordered, with acceptance criteria per phase. |
| `docs/DATA_MODEL.md` | Entities, fields, relations, migrations. |
| `docs/PERMISSIONS_AND_APPROVALS.md` | Permission bits, `hasPermission`, the request engine step by step, quotas, edge cases. |
| `docs/AUTH.md` | Plex PIN sign-in, Jellyfin sign-in, local accounts, sessions, new-user rules, app passwords. |
| `docs/USER_SYSTEM.md` | User list, profile, user settings tabs — every field and rule. |
| `docs/ADMIN_PAGES.md` | Every admin page, every field, the settings key it writes, and its behavior. |
| `docs/INTEGRATIONS.md` | Each external service: purpose, API, auth, rate limits, jobs, gotchas, terms to check. |
| `docs/CLIENT_API.md` | OpenSubsonic + Jellyfin-compatible server APIs for third-party apps. Scope and phasing. |
| `docs/FRONTEND.md` | Routes, layout, components, design tokens, behaviors, accessibility, copy rules. |
| `docs/REUSE_MAP.md` | Seerr path → Keep / Adapt / Rewrite / Drop, with notes. |
| `docs/BACKLOG.md` | Seerr features not yet in the mockup, translated to music, prioritized. |
| `docs/settings.example.json` | Full settings document shape, filled with the mockup's values. |
| `starter/server/lib/permissions.ts` | Music permission bits, drop-in replacement for Seerr's file. |
| `starter/server/constants/media.ts` | Request/media status enums, scopes, UI labels. |
| `design/shufflerr-mockup.html` | **The approved, clickable mockup.** Single file, no build. Open in a browser. Source of truth for UI. |
| `design/screens/*.png` | 38 screenshots of every page (dark, plus one light and one phone). |
| `design/legacy-canvas/*.dc.html` | Earlier canvas-format mockup. Superseded by the HTML mockup; kept only for history. |

The live mockup is also published at: https://claude.ai/artifact/EfjfLGhHRV3C8xm5fh3ucj

---

## 2. Decisions already made (do not re-litigate without asking)

1. **Name:** Shufflerr (working name). Wordmark `s/` in a red tile; text logo `SHUFFLERR`.
2. **Base:** a **fork of Seerr** (`seerr-team/seerr`, branch `develop`, commit
   `2cfbcf8940225f1597d44f507fd78040887c5597`, 2026-10-03). Seerr is MIT. Keep git history.
   Reuse the platform (auth, users, permissions, quotas, settings, notifications, jobs, request
   lifecycle, scanners, image proxy, UI primitives); rewrite the media domain for music.
3. **Stack:** keep Seerr's — Next.js + React front end, Express API, TypeORM (SQLite default,
   PostgreSQL supported), Tailwind, SWR, pnpm, Docker. Check `package.json` in the fork for
   exact versions (at the pinned commit: Next 16.2.6, React 19.2.6, Express 5.2.1,
   TypeORM 0.3.31, Tailwind 3.4.19, SWR 2.4.1).
4. **Downloader:** Lidarr (API v1) is the only download manager. Multiple Lidarr instances
   allowed (e.g. lossless and hi-res); one is default.
5. **Metadata:** MusicBrainz is the source of truth (MBIDs are the primary external keys).
   Cover Art Archive for album art, fanart.tv for artist photos, Last.fm for bios/tags/similar.
6. **Request scopes:** `tracks` (missing tracks of one album), `album`, `discography`.
7. **Approval engine:** identical rules to Seerr's `MediaRequest.request()` (permission check →
   quota check → duplicate check → auto-approve or pending). Approve/decline only by
   `MANAGE_REQUESTS`, only while pending. See `docs/PERMISSIONS_AND_APPROVALS.md`.
8. **Sign-in:** Plex (PIN flow, like Seerr), Jellyfin (username/password, like Seerr), local
   email/password. Owner = user id 1. New Plex/Jellyfin users can be auto-created with default
   permissions when the admin allows it.
9. **User system and admin area:** copied from Seerr's structure (user list, profile, user
   settings tabs, admin settings as separate pages), extended for music.
10. **Integrations in scope** (all have admin pages in the mockup):
    - Stream from: Plex, Jellyfin, Navidrome, Local files, YouTube (official player only).
    - Connect your apps: any OpenSubsonic or Jellyfin client — tested list: Symfonium, Finamp,
      Feishin, Amperfy, Jellify.
    - Discover & import: Spotify, Deezer, iTunes, Ticketmaster, Skiddle.
    - Scrobble to: ListenBrainz, Last.fm.
    - Metadata: MusicBrainz, Cover Art Archive, fanart.tv, Last.fm.
    - Notifications: Email, Web push, Discord, Slack, Telegram, Pushbullet, Pushover, Webhook,
      Gotify, ntfy.
11. **Design direction:** dark navy UI, red-pink accent `#FF1744`, slim icon rail, docked player
    bar with waveform, full-bleed hero. Layout and color inspired by the Rekord HTML template the
    owner licensed — **inspiration only; no Rekord code, CSS, fonts, icons or images are used or
    to be copied.** Login/logout layout follows Rekord's login page structure (two-panel card,
    underline inputs). Login background is an album-art slideshow (like Seerr's ImageFader).
12. **Type:** IBM Plex Sans (UI/body) + JetBrains Mono (data, timestamps, wordmark, command
    line). Not Roboto.
13. **Sample content:** John Summit's *CTRL ESCAPE* (2026) is the featured release and
    tracklist in the mockup (real metadata, verified from public listings). Other catalog items
    are fictional. **No real album art or artist photos** are in the mockup — every image is a
    labelled slot that the real app fills from Cover Art Archive / fanart.tv at runtime.
14. **Light theme** exists and must keep working (tokens in `docs/FRONTEND.md`).

---

## 3. Architecture at a glance

```
                 ┌──────────────────────────── Shufflerr (Seerr fork) ────────────────────────────┐
 Browser ──HTTP──▶ Next.js UI ──▶ Express API ──▶ Request engine ──▶ Lidarr client ──▶ Lidarr (v1)
 Music apps ─────▶ /rest (OpenSubsonic) & /jellyfin (Jellyfin API)  [Phase 7]                 │
                 │      │                │                                                     ▼
                 │   Sessions        TypeORM (SQLite|Postgres)                          downloads → library
                 │      │                │                                                     │
                 │   Auth: Plex PIN / Jellyfin / local          Scanners ◀── Plex / Jellyfin / Navidrome / local folders
                 │                                                │
                 │   Metadata: MusicBrainz, CAA, fanart.tv, Last.fm   Availability sync → Media.status
                 │   Discover/import: Spotify, Deezer, iTunes; Concerts: Ticketmaster, Skiddle
                 │   Scrobbler: ListenBrainz, Last.fm      Notifications: 10 agents      Jobs scheduler
                 └──────────────────────────────────────────────────────────────────────────────────┘
```

Key flows:
- **Request:** UI → `POST /api/v1/request` → engine (perm, quota, duplicate, auto-approve) →
  if approved: Lidarr add/monitor + search command → `Media.status = PROCESSING`.
- **Availability:** scanners and Lidarr sync update `Media.status` and per-track presence →
  request `COMPLETED` when everything requested is present → notification.
- **Sign-in:** Plex PIN (popup to app.plex.tv, poll PIN) or Jellyfin auth → find/create user →
  session cookie.

Details per area live in the `docs/` files listed above.

---

## 4. Phases (summary — full detail in `docs/BUILD_PLAN.md`)

| # | Phase | Outcome |
|---|---|---|
| 0 | Fork, attribution, branding | Repo builds as "Shufflerr", Seerr credited, Seerr assets removed |
| 1 | Strip movie/TV, music domain model, migrations | Clean schema with MBID keys, new permission bits |
| 2 | Metadata clients | MusicBrainz, CAA, fanart.tv, Last.fm clients with fixtures + caching |
| 3 | Lidarr + request engine | Requests for tracks/album/discography, approvals, quotas, Lidarr hand-off |
| 4 | Media servers + availability | Plex, Jellyfin, Navidrome, local scanners; availability sync |
| 5 | Auth + user system | Plex/Jellyfin/local sign-in, user list, profile, user settings |
| 6 | Front end | All mockup screens rebuilt as React components |
| 7 | Admin area | Every settings page from the mockup, wired to real settings |
| 8 | Notifications, jobs, logs | Agents with music payloads, job schedule, logs page |
| 9 | Discover & import, scrobbling, YouTube | Spotify/Deezer/iTunes import, concerts, scrobbling, YouTube player |
| 10 | Client APIs | OpenSubsonic and Jellyfin-compatible endpoints, app passwords |
| 11 | Docker, docs, smoke test | `docker compose up` → end-to-end flow works |

Phases 0–6 are the MVP. 7–8 complete parity with Seerr's admin. 9–10 are the music-specific
extras. Backlog items (Issues, Manage panel, request editing, override rules, watchlist,
blocklist, …) are in `docs/BACKLOG.md`; several map to code you'll already be touching, so
the plan notes where to leave hooks.

---

## 5. Non-negotiables

- **Attribution:** every file copied or adapted from Seerr keeps/gets the header in `CLAUDE.md`
  §Attribution. Root `LICENSE` lists Seerr's copyright line alongside Shufflerr's. `NOTICE.md`
  and `LICENSES/seerr-MIT.txt` ship in the Docker image and release tarballs. No Seerr logo or
  name in Shufflerr branding.
- **No live third-party calls in tests.** Record fixtures.
- **MusicBrainz etiquette:** ≤1 request/second to the public server, meaningful `User-Agent`
  (`Shufflerr/<version> ( <contact URL or email> )`), support a mirror URL.
- **YouTube:** official IFrame player only. Never download or extract audio from YouTube.
- **Images:** all third-party images go through the image proxy; the browser never hits CAA,
  fanart.tv or Spotify CDNs directly.
- **Accessibility floor:** real buttons/links/labels, 44px targets, visible focus, 4.5:1
  contrast, status never shown by color alone, reduced-motion respected.
- **Copy:** sentence case, plain verbs, same action name through a flow ("Request" → toast
  "Requested …"). See `docs/FRONTEND.md` §Copy.

---

## 6. Things to verify early (open questions / risks)

1. **Spotify Developer Terms** — confirm that importing a user's playlists/saved albums to drive
   requests in a self-hosted tool is allowed, and what attribution/display rules apply. If not,
   restrict to user-initiated, per-user OAuth with no server-side storage of Spotify content.
2. **Ticketmaster / Skiddle API terms** — attribution and caching limits for event data.
3. **Last.fm API terms** — scrobbling requires per-user auth (session key); bios have
   attribution requirements.
4. **Client API scope** — implementing OpenSubsonic and a Jellyfin-compatible API is large.
   Decision needed: implement natively vs. proxy to Navidrome/Jellyfin when present. The plan
   assumes native OpenSubsonic first (smaller), Jellyfin API second. See `docs/CLIENT_API.md`.
5. **Track-level requests in Lidarr** — Lidarr works at album/release level. "Missing tracks
   only" maps to re-searching the album with the existing files kept, or picking a release that
   contains the missing tracks. Confirm behavior against a real Lidarr before promising
   track-exact downloads. See `docs/INTEGRATIONS.md` §Lidarr.
6. **Plex music watch history** — confirm the endpoint for per-user play history on music
   libraries (used for "Recently played" and scrobbling from Plex).
7. **Emby** — Seerr supports it; Shufflerr doesn't yet. Decide whether to keep Seerr's Emby
   path alive (cheap, since it shares the Jellyfin code) or drop it.

---

## 7. How the mockup maps to code

`design/shufflerr-mockup.html` is one file with all CSS and JS inline. It is a **behavioral
spec**, not production code. Useful anchors inside its `<script>`:

| Mockup symbol | Becomes |
|---|---|
| `P`, `hasPermission`, `TYPE` | `server/lib/permissions.ts` (see `starter/`) |
| `evaluateRequest`, `createRequest`, `updateStatus`, `cancelRequest`, `quotaFor` | `server/entity/MediaRequest.ts` (`request()`), `server/routes/request.ts`, `User.getQuota()` |
| `RS`, `RS_UI`, `ST` | `server/constants/media.ts` (see `starter/`) |
| `USERS`, `mkUser` fields | `User`, `UserSettings` entities |
| `settings` object | `server/lib/settings/index.ts` defaults — shape in `docs/settings.example.json` |
| `JOBS` | `server/job/schedule.ts` |
| `vLogin`, `vLogout`, `openPlexWindow`, `openJellyfinLogin`, `mosaicHtml/startFader` | `src/components/Login/*`, `ImageFader` |
| `vDiscover`, `vSearch`, `vArtist`, `vAlbum`, `vRequests`, `vImport`, `vMobile` | page components under `src/components/*` |
| `vUserList`, `openCreateUser`, `openImportUsers`, `openBulkEdit`, `openDeleteUser` | `src/components/UserList/*` |
| `vUser`, `userOverview`, `userRequests`, `userSettings` | `src/components/UserProfile/*` and `UserSettings/*` |
| `ADMIN_NAV`, `ADMIN_PAGES.*` | `src/components/Settings/*`, `src/pages/settings/*` |
| `permEditor`, `PERM_TREE` | `src/components/PermissionEdit` (adapted) |
| `openRequest`, `outcomeHtml`, `SCOPES` | `src/components/RequestModal/*` (new `ReleaseRequestModal`) |
| player (`setPlaying`, waveform) | new `src/components/Player/*` |

Sign in to the mockup as `admin@shufflerr.local` (any password) to see admin pages. Other
accounts: `guest@shufflerr.local` (local); `maya`, `sam` via the Plex button; `dre` via the
Jellyfin button; `lena` (new Plex user) and `kai` (new Jellyfin user) to test first-sign-in.

---

## 8. Glossary

- **Release group** — MusicBrainz's "album" concept (all editions of one album). UI says "album".
- **Release** — a specific edition (CD, vinyl, deluxe). Lidarr picks one per its profiles.
- **Recording** — a track.
- **Scope** — what a request covers: tracks / album / discography.
- **Owner** — user id 1; cannot be edited by others or deleted.
- **Global limit / override** — request quotas; per-user override replaces the global one.
