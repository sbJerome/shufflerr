# Backlog — Seerr features not yet in the mockup

Prioritized. P1 = do right after the MVP + admin (they're the biggest functional gaps).
Each item notes the Seerr source to adapt and the music translation.

## P1

1. **Issues** — users report problems with an album: types `wrong-release`, `bad-tags`,
   `missing-tracks`, `low-quality`, `other`; per-track selection for missing/bad tracks; comment
   thread; open/resolved; count badge in the rail; Issues page with filters; notifications
   (`issueCreated`, `issueComment`, `issueResolved`, `issueReopened`). Permissions
   MANAGE_ISSUES / VIEW_ISSUES / CREATE_ISSUES (bits already reserved).
   Seerr: `Issue`, `IssueComment`, `src/components/Issue*`, `server/routes/issue*.ts`.
   Hook the mockup's "Report a problem" button on the Album page.
2. **Manage panel** — admin slide-over on Album/Artist pages: requests for this item, mark
   available, clear data (reset Media row), remove from Lidarr (and optionally files), open in
   Lidarr / Plex / Jellyfin / MusicBrainz, Issues for this item.
   Seerr: `ManageSlideOver`.
3. **Edit requests** — managers change server, quality/metadata profile, folder, tracks, or the
   requester before approving; requesters edit their own pending track selection.
   Seerr: `RequestModal` edit mode + `PUT /request/:id`.
4. **Override rules** — auto-route requests to a Lidarr server/profile/folder by user, genre/tag,
   label, or release type (e.g. hi-res for listed users, live albums to an archive folder).
   Seerr: `OverrideRule` entity + Settings → Services → Override rules UI.
5. **Watchlist + auto-request** — per-user "want" list (manual, Spotify saved albums, Plex
   playlists, ListenBrainz recommendations); AUTO_REQUEST permissions request watchlist items
   automatically. Profile tab "Watchlist".
   Seerr: `Watchlist` entity, `watchlistsync.ts`, profile watchlist page.
6. **Blocklist** — block artists/release groups (and tags) from being requested or shown;
   Blocklist page; MANAGE_BLOCKLIST / VIEW_BLOCKLIST.
   Seerr: `Blocklist` entity, `src/components/Blocklist*`, blocklisted tags processor.

## P2 — browsing

7. **Label pages** (Seerr studios/companies → record labels; MusicBrainz `label` + browse
   release groups by label).
8. **Genre / tag pages** (MusicBrainz genres + Last.fm tags).
9. **Credit pages** for producers, remixers and featured artists (Seerr person pages → MB
   artist relationships).
10. **Box sets & compilations** with "request all" (Seerr collections → MB series / release
    groups with secondary type Compilation).
11. **Discover/Search filters** — genre, year range, release type, label, language.
12. **Customizable Discover rows** — admins add/remove/reorder rows (Seerr `DiscoverSlider`
    admin UI).
13. **Upcoming releases calendar** — announced release groups for followed/library artists,
    "Request when released" (creates a pending/approved request with `monitorFuture`).
14. **External links block** — MusicBrainz, Discogs, Spotify, Bandcamp, Apple Music.
15. **Popularity** — ListenBrainz / Last.fm listener counts in place of Seerr's ratings.
16. **Play stats** — per-album play counts from the media servers (Seerr's Tautulli block).

## P2 — account & system

17. **Setup wizard** polish (Seerr's `/setup`: sign in with Plex/Jellyfin → libraries → Lidarr).
18. **Request on behalf of** another user (managers) — route support exists in the engine.
19. **Request votes** (VOTE bit reserved).
20. **Emby** support (shares Jellyfin code in Seerr).
21. **Translations** — Seerr's i18n pipeline (Weblate) with new music strings.
22. **PWA install + real web push** (Seerr's service worker setup).
23. **Update available banner** (Seerr's StatusChecker).
24. **API docs page** (`/api-docs` from `shufflerr-api.yml`).

## P3 — partly done in the mockup

25. **Hi-res as a request option** — REQUEST_HIRES / AUTO_APPROVE_HIRES bits reserved; request
    modal toggle "Hi-res" routes to the hi-res Lidarr server (Seerr's 4K pattern).
26. **Download detail** — per-track ETA, queue position, indexer/client info (Seerr's
    `DownloadBlock`).
