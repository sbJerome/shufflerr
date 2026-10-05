# INT-A — server integration

Closes the seams between the server streams, makes the test suite finish, adds the database
migrations and the OpenAPI document. Server only; the UI wiring for the new routes is INT-B's.

## New and changed routes (for the UI)

| Route | Who | Notes |
|---|---|---|
| `POST /api/v1/artist/:mbid/watch` `{enabled}` | MANAGE_REQUESTS | Sets Lidarr "monitor new items" (`all` / `none`) for the artist. `200 {enabled}`. `409` "This artist is not in Lidarr yet. Request an album or the discography first, then turn this on." `502` when Lidarr refuses. The current state is `ArtistDetails.lidarr.monitorNewItems` (re-read after a change; the 60 s cache is cleared). |
| `DELETE /api/v1/media/:id/lidarr?deleteFiles=0\|1` | MANAGE_REQUESTS | Removes the album or artist from Lidarr; with `deleteFiles=1` Lidarr also deletes the files. `204`; `409` when the item is not in Lidarr; `502` when Lidarr refuses. Show the button when `details.lidarr?.canRemove` is true (new optional field on `AlbumDetails.lidarr` and `ArtistDetails.lidarr`). |
| `GET /api/v1/issue?mediaId=<Media id>` | as before | New filter: only issues for one album/artist (replaces the manage panel's "fetch 100 and filter"). |
| `GET /api/v1/issue/count` | signed in | Now scoped: MANAGE_ISSUES / VIEW_ISSUES see server-wide counts, everyone else the counts of their own issues. Same response shape. |
| `GET /api/v1/settings/local/unresolved` | MANAGE_SETTINGS | `LocalUnresolvedResponse`: albums in the local folders MusicBrainz could not identify (`folder`, `label`, `artist`, `album`, `attempts`, `lastTried`, `nextTry`, `reason`). For a list on the Local files page. |
| `GET /api/v1/settings/notifications/pushover/sounds?token=` | signed in | A masked or empty `token` now falls back to the stored application token, so the sound list loads without retyping it. |
| `GET /api/v1/discover/trending` | signed in | When ListenBrainz trending is off and iTunes is on, the row is the iTunes most-played chart matched to MusicBrainz (cached 6 h). The first call answers within 8 s; if matching is still running it returns what is ready plus a `reason` line, and fills in on the next load. |
| `POST /api/v1/auth/setup` and `/auth/setup-local` | public, only while no users exist | Same handler; both documented in the contract. |

`AlbumDetails.lidarr.monitored` is now read from Lidarr (cached 60 s) instead of always `true`.

## Seams closed

- **Lidarr reads go through one client.** `getLidarrArtistState` uses SV2's
  `LidarrAPI.fromSettings` (no private axios client). `LidarrAPI` gained `deleteArtist` and
  `deleteAlbum`.
- **One request mapper.** `GET /discover/recent-requests` and `GET /user/:id/requests` use
  `toRequestResults` (`server/lib/requestResults.ts`); it now returns the artist photo as the
  cover of a discography request. The duplicate mapper in `routes/discover.ts` is gone.
- **One completion path.** Album/tracks requests become COMPLETED only in
  `MediaRequest.completeSatisfied()`; discography requests only in
  `MediaRequest.completeDiscography()`. The library layer
  (`completeReleaseGroupRequests`, `recomputeArtist`), the Lidarr scan and the download sync
  all call those. Each acts only on APPROVED requests and saves through the repository, so the
  request subscriber sends `available` exactly once.
- **"Run now" for the local files scan** forces a scan (`run({ force: true })`) instead of
  honouring the rescan interval.
- **CSRF** no longer applies to `/rest`, `/jellyfin` and `/api/v1/webhooks/*` (app-password /
  API-key traffic, not browser sessions).
- **`DELETE /issue/:id`** loads comments explicitly instead of relying on eager loading.
- Dead stubs removed: `server/routes/_stub.ts`, `server/lib/scanners/stub.ts`. No handler
  answers 501 any more.

## Looked at, left as is

- **`MEDIA_FAILED` logged when a test saves an approved request** — not a bug. Saving an
  APPROVED request with no Lidarr server configured fails it with "No Lidarr server is set up.
  Add one in Settings → Lidarr, then retry." and notifies; that is the intended behaviour.
- **Scrobble submitters.** SV6's `server/lib/scrobble/targets.ts` and `linked.ts` duplicate
  small parts of `server/api/{lastfm,listenbrainz}.ts` and `server/lib/auth/linkedAccounts.ts`.
  They are covered by 36 tests and never ran against the real services (no keys), so merging
  them now would trade tested code for untested code. Left for when real keys are available.

## Tests

- `pnpm test`: **495 tests, 0 failures, ~77 s** (was ~6.5 min and looked hung).
- Cause of the "stall": nothing was hanging. The runner executed the 28 files one after another
  and every file type-checked the whole project through ts-node before starting.
  `server/test/index.mts` now runs files side by side (`TEST_CONCURRENCY`, default 6; each file
  has its own process and in-memory database) and transpiles without the per-file type check
  (`pnpm typecheck` covers types).
- `nock` does not work with `server/test/setup.ts` (its outbound blocker fires first). Use
  `server/test/mockAxios.ts`, `server/test/fixtureAdapter.ts` or `server/test/fakeLidarr.ts`.

## Database migrations

- `server/migration/sqlite/1791192875557-InitialMigration.ts` and
  `server/migration/postgres/1791192885204-InitialMigration.ts`, generated from the entities.
- Production now runs migrations only (`synchronize: false`); the "synchronise when there are
  no migrations" fallback is removed. Development on SQLite still synchronises, as in Seerr.
- Proven on an empty SQLite file and an empty PostgreSQL 17 database in production mode:
  23 tables, no pending migrations, zero schema drift between entities and the migrated
  schema, and 21 list/detail routes (library search with `LIKE … ESCAPE`, grouped counts,
  requests, users sorted by requests, discover rows, issues, blocklist) answered 200 on both.

## OpenAPI

- `shufflerr-api.yml` is generated by `server/scripts/generateApiSpec.ts`: 157 paths,
  201 operations, 118 schemas; 170 operations carry typed request/response bodies taken from
  the route's type arguments or, failing that, from what the handler sends.
  Regenerate with
  `pnpm exec ts-node -r tsconfig-paths/register --files --project server/tsconfig.json server/scripts/generateApiSpec.ts && pnpm exec prettier --write shufflerr-api.yml`.
- The validator middleware stays mounted with `ignoreUndocumented`, but no longer validates
  request bodies against the schema: handlers validate their own input and answer with the
  exact "what to fix" copy the UI shows, which generic schema errors would pre-empt.
- `/api-docs` renders the document.

## Sweep

- "Seerr" in `server/`: only attribution headers and code comments explaining inherited
  behaviour. Nothing user-visible or log-visible.
- Attribution headers added to adapted files that lacked one (`datasource.ts`, kept test
  files, `utils/seedTestDb.ts`, `test/index.mts`). Files that share a path with Seerr but were
  rewritten without Seerr code (`lib/search.ts`, `routes/search.ts`, `routes/discover.ts`,
  `entity/MediaRequest.test.ts`, `routes/request.test.ts`) carry no header on purpose.

## Bug fixed during integration

- **Artist names from album credits.** When MusicBrainz did not answer during a scan, the
  artist row was created from the album's credit phrase ("Martin Garrix, DubVision & Shaun
  Farrugia", "Dr. Dre introducing Snoop Doggy Dogg") and never corrected. `recomputeArtist`
  now replaces a provisional name (a row without `artistMbid`) with the artist's own
  MusicBrainz name as soon as MusicBrainz answers — on any later scan or availability sync —
  and the Lidarr scan sets `artistMbid` on the rows it writes. Covered by a test.
- **Library artist names.** `GET /library/artists` and the popular-artists row took the name
  from an album's credit phrase; they now use the artist row's own name and fall back to the
  credit only when no artist row exists. Search matches either. Checked on SQLite and
  PostgreSQL.
- **Scan panel after a restart.** `GET /settings/<source>/sync` reads the album and track
  counts from the database before answering, so it no longer reports "0 albums, 0 tracks"
  until the next scan.
