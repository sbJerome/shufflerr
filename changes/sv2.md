# SV2 — Lidarr and the request engine (BUILD_PLAN phase 3)

## Adapted from Seerr (header added)

| File | From | Notes |
|---|---|---|
| `server/api/servarr/lidarr.ts` | `server/api/servarr/radarr.ts` | `LidarrAPI extends ServarrBase` on `/api/v1`. System status, quality/metadata profiles, root folders, tags, artist list / by MBID / lookup (`lidarr:<mbid>`) / add / update, albums by artist / by release-group MBID / lookup / add, album monitor, `AlbumSearch` / `ArtistSearch` / `RefreshArtist`, paged queue, history, tracks, track files. `LidarrAPI.fromSettings(server)` builds a client. |
| `server/entity/MediaRequest.ts` | same path | `MediaRequest.request()` rewritten per `docs/PERMISSIONS_AND_APPROVALS.md`; adds `refreshMediaStatus()`, `completeSatisfied()`, `RequestValidationError`, `ACTIVE_STATUSES`. No column changes. |
| `server/subscriber/MediaRequestSubscriber.ts` | same path | Transition side effects, the Lidarr hand-off, unmonitor on decline/cancel. |
| `server/lib/downloadtracker.ts` | same path | Lidarr queue → `downloadProgress`; failed imports → FAILED. |
| `server/lib/scanners/lidarr/index.ts` | `server/lib/scanners/radarr/index.ts` | Artists/albums → Media rows with Lidarr ids. |
| `server/routes/request.ts`, `server/routes/service.ts` | same paths | Contract routes. |
| `server/routes/settings/lidarr.ts` | `server/routes/settings/radarr.ts` | CRUD, test, profiles. |

## New (no Seerr source)

- `server/lib/requestResults.ts` — `toRequestResults()` / `toRequestResult()` / `lastChangeLabel()`:
  entity → `RequestResult` (cover, profile name, canRemove/canManage, last change, playable).
  SV4 can use it for `GET /user/:id/requests`.
- `server/test/fakeLidarr.ts` — in-process Lidarr v1 on loopback for tests.
- `server/test/requestFixtures.ts` — test hooks: fake Lidarr, mocked `lib/metadata`, captured notifications.
- `server/test/fixtures/lidarr/*.json` — trimmed responses recorded from Lidarr 3.1.0.4875 (GET only, no key, release titles neutralised).
- Tests: `server/entity/MediaRequest.test.ts` (28), `server/routes/request.test.ts` (21), `server/routes/settings/lidarr.test.ts` (9).

## How it behaves

- **Engine order**: acting user → permission → quota → blocklist → duplicate → already available →
  auto-approve → dry run → create. Everything needed to count the request is resolved first, then
  errors are raised in that order, so the user always sees the documented one.
- **Tracks scope**: omitted `trackMbids` = every track missing from the library. Tracks already
  available or covered by another active request are dropped; `trackCount` is what is left.
- **Discography `releaseCount`** is computed on the server (MusicBrainz discography minus release
  groups already fully in the library, minimum 1); the body's number is only a fallback when
  MusicBrainz can't be reached.
- **Media status** is derived, never hand-set: fully available → AVAILABLE; else any APPROVED
  request → PROCESSING; else any PENDING → PENDING; else the library status. Recomputed on create,
  approve, decline, fail, complete and delete (`MediaRequest.refreshMediaStatus(mediaId)`).
- **Side effects run after the saving transaction commits** (queued on the query runner), so they
  work on Postgres pools too. Tests await them with `flushRequestSideEffects()`.
- **Transitions are detected from `save()`** (saved entity vs. database row). `repository.update()`
  on a request does not fire them — the download tracker relies on that for progress ticks.
- **Hand-off**: server = request `serverId` → override rule → default (hi-res default for hi-res
  requests). Existing artist: make sure it is monitored (and `monitorNewItems: all` when "Watch for
  new releases" is on). Missing artist: lookup by MBID and add with `addOptions.monitor: none`,
  then wait for Lidarr to load its albums (10 × 3 s), falling back to adding the album from a
  lookup. Then monitor the album and run `AlbumSearch` unless "Enable automatic search" is off.
  Discography: new artist is added with `monitor: all` + search; existing artist gets every album
  monitored + `ArtistSearch`.
- **Failure** → request FAILED with a readable `failureReason` (no server set up, key rejected,
  unreachable, HTTP status + Lidarr's validation message, not found in metadata).
- **Unmonitor** only what Shufflerr itself switched on (`Media.lidarrAddedByShufflerr`) and only
  when no other active request wants it: on decline, and when an approved request is deleted.
- **Completion**: `MediaRequest.completeSatisfied(mediaId)` marks approved album/tracks requests
  COMPLETED once the library has them; the download sync calls it every minute, and scanners may
  call it right after updating Track/Media. Discography requests complete in the Lidarr scan when
  every monitored album of the artist has all its files.
- **Lidarr scan** creates a Media row per Lidarr artist and per album that is monitored or has
  files. It uses Lidarr's file counts for availability only when no library source (Plex, Jellyfin,
  Navidrome, local files) is switched on and no scanner has touched the row.
- **Default servers**: saving a default clears the flag on the other servers of the same class
  (standard / hi-res). A standard server is always default while one exists; hi-res may have none.

## Deviations from the contract / spec

- `filter=approved` and `filter=processing` return the same set (status APPROVED), and
  `RequestCountResponse.processing === approved`.
- `POST /request` with a malformed body (unknown scope, wrong `mediaType`, track MBIDs not on the
  album) answers 400 via the new `RequestValidationError`; a dry run reports it as
  `{outcome:'blocked', code:'error'}`.
- New permission-class error: tracks scope while `main.allowTrackRequests` is off →
  "Track requests are turned off. Request the whole album instead."
- `userId` equal to the caller's own id is not treated as "someone else".
- Advanced fields are kept when the acting user has REQUEST_ADVANCED **or** MANAGE_REQUESTS.
- Quota copy says "weekly" for 7-day windows and "N-day" otherwise.
- `PUT /request/:id` works on PENDING and FAILED requests; discography ↔ album/tracks is refused
  (different Media row) with a message to cancel and request again.
- `GET /service/lidarr/:id` answers 502 with user copy when Lidarr is unreachable.
- Blocklist copy: "This has been blocked, so it can't be requested."

## TODO(decision) / open

- Track-exact downloads (HANDOFF §6.5): Lidarr fetches a release. A tracks request monitors and
  searches the album; it completes when the requested tracks are present.
- Download sync fails an album/tracks request when its only queue item is `importFailed` /
  `failed`. On the owner's Lidarr the whole current queue (50 items) is in `importFailed`
  (manual-import warnings), so requests that land there will show Failed with Lidarr's reason until
  an admin resolves the import and retries.
- Not verified against the live server: every write (artist add, album add, monitor, commands).
  Only GETs were issued; the write paths are covered by the fake-Lidarr tests.

## Owner configuration

Settings → Lidarr: hostname `lidarr.example.lan`, port `80`, API key from Lidarr → Settings → General,
then Test and pick quality profile, metadata profile and root folder (`/mediacatalog/music`).
