# SV3 — library: scanners, availability, streaming

## What exists

**Library core — `server/lib/library/`** (new)
- `types.ts` — `ScannedAlbum` / `ScannedTrack`: what every scanner hands over.
- `resolver.ts` — scanned album → MusicBrainz release group. Order: release-group id from the
  source → release id → ambiguous id (Plex / OpenSubsonic: tried as release, then release group)
  → artist + title search. A search hit is accepted only when artist **and** title agree after
  normalisation and the score is ≥ 85. Up to five real spellings are searched (tags, folder
  names, first credited artist, title without packaging words such as "(Maxi CD)" / "WEB").
  All lookups go through SV1's `getMusicBrainz()` (shared 1 req/s limiter and cache).
- `matching.ts` — scanned tracks → canonical tracklist: recording MBID → normalised title +
  duration ±3 s → looser title (bracketed qualifiers dropped) → title without an unbracketed
  guest credit (both durations required). ±10 s when title *and* disc/track number agree.
  Tracks that match nothing are left out, never forced onto a row.
- `ingest.ts` — `ingestAlbum()`: resolve → `ensureMedia(withTracks)` → attach tracks → recompute.
  When files are a different edition than the canonical one and the source did not name its
  release, up to two editions whose size fits the files are tried; one is kept only if it puts
  more of the library on the tracklist.
- `availability.ts` — `recomputeReleaseGroup`, `recomputeArtist`, `detachSource`, `countSource`,
  `recomputeAll`. Status rule: all tracks present → AVAILABLE; else an approved request →
  PROCESSING; a pending one → PENDING; else PARTIALLY_AVAILABLE / UNKNOWN. BLOCKLISTED is kept.
  APPROVED requests flip to COMPLETED when their scope is present (`album`: every track;
  `tracks`: the requested TrackRequests; `discography`: every release group from
  `getDiscographyReleaseGroups()` is AVAILABLE) — saved through the repository so the request
  subscriber notifies.
- `sourceScanner.ts` — run loop shared by all four scanners: list albums → skip unchanged ones
  (signature) → ingest → on a full run detach whatever the source no longer lists.
- `state.ts` — `<config>/db/library-state.json`: per source album its signature, release group
  and attached track ids; per local file its mtime/size/tags. Safe to delete (next scan
  re-ingests).
- `peaks.ts` — 96 peaks (0–255) per track via ffmpeg (4 kHz mono decode, one max per 50 ms),
  stored base64 in `Track.peaks`; background queue (2 at a time) after a local scan, and lazily
  on the first `/peaks` request.
- `stream.ts` — `streamTrack(req, res, trackId, {format, maxBitRate, download})`,
  `getTrackPeaks`, `getTrackSource`. Local files with Range (206/416), HEAD, download
  disposition; ffmpeg transcode for `opus-160`, `mp3-320`, `mp3-128`, `opus`, `mp3`
  (+`maxBitRate`); proxy with Range passthrough from Plex (Part key + owner token), Jellyfin
  (`/Audio/{id}/stream?static=true`) and Navidrome (`stream?format=raw`). Auth-agnostic.
  Only files under a configured music folder are served.

**Scanners**
- `scanners/local` — walk folders, tags with `music-metadata` (MBIDs included), grouping by
  folder + album tag, disc subfolders folded in, path fallback for untagged files, incremental
  by mtime/size, chokidar watcher (5 s debounce, waits for copies to finish).
- `scanners/plex` — music sections, albums (`type=9`, `includeGuids=1`) → tracks; full and
  recently added (last 24 h).
- `scanners/jellyfin` — Jellyfin/Emby `MusicAlbum` → `Audio` with `ProviderIds`; full and
  recently added (latest 50).
- `scanners/subsonic` — Navidrome through the new `server/api/subsonic.ts` (token auth,
  `getAlbumList2`, `getAlbum`, `getArtists`, `getArtist`, `search3`, OpenSubsonic MBIDs).

**Other**
- `lib/availabilitySync.ts` — sources that were switched off are detached; local files that no
  longer exist are detached; everything is recomputed.
- `subscriber/MediaSubscriber.ts` — a release group saved as AVAILABLE from outside the
  scanners completes the approved requests it satisfies.
- `routes/stream.ts` — `/track/:id`, `/track/:id/peaks`, `/track/:id/info`.
- `routes/settings/{plex,jellyfin,navidrome,local}.ts` + `scanPanel.ts` — per the contract.
  Secrets masked on GET and only overwritten when changed; connections are validated before a
  source can be switched on; every error says what to fix.

## Seerr code
- Adapted (header present): `server/api/plexapi.ts`, `server/api/jellyfin.ts`,
  `server/lib/scanners/plex/index.ts`, `server/lib/scanners/jellyfin/index.ts`,
  `server/lib/availabilitySync.ts`, `server/subscriber/MediaSubscriber.ts`,
  `server/routes/settings/plex.ts`, `server/routes/settings/jellyfin.ts`.
- Removed from the Jellyfin client: movie/TV methods (`getLibraryContents`, `getRecentlyAdded`,
  `getItemData`, `getSeasons`, `getEpisodes`) and their types. `getLibraries()` now returns
  music libraries only. Added `getMusicAlbums`, `getAlbumTracks`, `authHeaders`.
- Removed from the Plex client: movie/TV item types and `getLibraryContents`, `getMetadata`,
  `getChildrenMetadata`, `getRecentlyAdded`. Added `getAlbums`, `getAlbumTracks`, `getTrack`,
  `getTrackPartKey`.

## Decisions
- **Albums MusicBrainz cannot identify are not indexed and not lost**: they are recorded as
  unresolved in the scan state and looked up again after 7 days or when their files change.
  No MBID is ever invented. `libraryState.unresolved(source)` lists them (no UI yet).
- **MusicBrainz or metadata unreachable** → the album is postponed and tried on the next run.
- **An empty listing never wipes the library**: a full scan that finds no albums removes
  nothing (unmounted folder / unreachable server). The availability sync likewise leaves a
  folder alone when the folder itself cannot be read or is empty.
- **Artist status** is AVAILABLE as soon as the library holds anything by the artist; an open
  discography request is reported separately (as `models/music.ts` documents).
- **`Full rescan` (local)**: the job ticks every 15 minutes; with a longer interval the scanner
  skips scheduled ticks that come too soon. Scans from the settings page or the watcher always
  run. TODO(decision): "Run now" on the Jobs page goes through the same scheduled entry point,
  so with an hourly/daily interval it is skipped when a scan ran recently — `schedule.ts`
  (SV5) should call `localFilesScanner.run({ force: true })` for manual runs.
- **Completed requests are not reopened** when files disappear later; the album's status steps
  back (Seerr behaviour).

## Deviations
- No `plex` / `jellyfin` / `navidrome` image-proxy sources are registered: covers come from the
  Cover Art Archive URL SV1 builds. The schema has no column for a media-server thumb path.
- `PUT /settings/{plex,jellyfin}/library/:id` returns the whole `Library[]` (contract), not the
  single library Seerr returned.
- `DELETE /settings/local/folders` also accepts `?path=` (some proxies drop DELETE bodies).
- `POST /settings/jellyfin` accepts either Seerr's `ip/port/useSsl/urlBase` or a single `url`.
- Plex needs the owner's Plex token (owner signed in with Plex or linked it); without it the
  Plex settings routes answer 400 with that explanation.
- One additive edit outside the stream: `server/routes/auth.ts` — `POST /auth/setup-local` added
  as the primary path of SV4's existing first-run owner route (`/setup` kept as alias), as the
  coordinator asked.

## Tests (`pnpm test server/lib/library/*.test.ts`) — 39, no network
- `library.test.ts`: normalisation, matching, resolver (fake gateway), search spellings, edition
  choice, local grouping on the real CTRL ESCAPE tags, Plex / Jellyfin / Subsonic mapping,
  Range parsing, peak reduction.
- `availability.test.ts` (SQLite): 9/13 → PARTIALLY_AVAILABLE; 13/13 → AVAILABLE and the
  `tracks` request COMPLETED; album and discography completion; two sources on one track;
  unresolved/deferred change nothing; streaming a file with 200 / 206 / 416 / 404, folder
  allow-list, download disposition, stored peaks.
- Fixtures: `server/test/fixtures/local/ctrl-escape-files.json` is recorded from the real
  files. `fixtures/{plex,jellyfin,subsonic}/*` are **hand-built in the documented response
  shapes** from the recorded MusicBrainz release — no Plex, Jellyfin or Navidrome server was
  available to record from.

## Live check (real library, read-only, 2026-10-05)
`/srv/music`: 1,116 audio files → 113 album groups.
- 97 groups ingested into 89 release groups / 9 artists; 765 tracks playable; 71 albums fully
  available, 18 partly. 16 groups unresolved (scene-named folders, "VA" compilations, promo
  singles MusicBrainz does not list under those names). 52 files in ingested albums matched no
  canonical track (other mixes, bonus tracks of other editions) and were left out.
- First scan 253 s (MusicBrainz at 1 req/s); a rescan of the unchanged library 1 s (113 skipped).
- CTRL ESCAPE: 13/13, AVAILABLE. Range request `bytes=1000-65999` → 206, bytes identical to the
  file; HEAD; 416 past the end; FLAC full download; `format=opus-160` → Ogg Opus; peaks: 96
  values in 1.7 s on first request, then stored.
- Not verified live: Plex, Jellyfin/Emby and Navidrome scanning and proxy streaming (no server
  credentials); the folder watcher was started but no file was changed.

## Owner configuration
- Mount the music folder read-only (compose / k8s: `/music`), then Settings → Local files →
  add `/music`.
- ffmpeg must be in the image (it is, per the Dockerfile) for peaks and transcoding.
