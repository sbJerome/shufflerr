# SV6 — import, concerts, scrobbling, YouTube (BUILD_PLAN phase 9, server side)

All new code; nothing here is adapted from Seerr except that the API clients extend Seerr's
`ExternalAPI` and use the cache manager.

## Added

| File | What |
|---|---|
| `server/api/spotify.ts` | Web API client. PKCE helpers `buildAuthorizeUrl`, `exchangeCode`, `refreshAccessToken`, `getProfile`; app token (`getAppToken`, `getPublicSpotify`); albums, playlists, saved albums |
| `server/api/deezer.ts` | Public API client (albums, tracks, playlists, share-link resolution). Deezer's 200-with-`error` bodies become `DeezerApiError` |
| `server/api/itunes.ts` | Lookup API + Apple marketing RSS chart. `getItunesChart(limit?, country?)` for the Discover page |
| `server/api/ticketmaster.ts`, `server/api/skiddle.ts` | Event lookups |
| `server/api/youtube.ts` | Data API v3 `search.list` only |
| `server/lib/import/*` | Link parser, MusicBrainz matcher (UPC → ISRC → artist + title), source fetchers, jobs, request hand-off, Spotify saved-albums sync, a small JSON-file cache |
| `server/lib/scrobble/*` | Rule, ListenBrainz and Last.fm submitters, queue with retry/backoff, linked-account access, Plex/Jellyfin webhook mapping |
| `server/lib/concerts/index.ts` | `refreshConcerts` |
| `server/routes/{import,scrobble,webhooks,youtube}.ts` | Routes per docs/API_CONTRACT.md §SV6 |
| `server/test/mockAxios.ts` | Canned HTTP for API-client tests (see "Tests") |
| `server/test/fixtures/{import,concerts}/*` | Fixtures |

## Contract changes (all additive, in `server/interfaces/api/importInterfaces.ts`)

- `ImportResolveResponse` gained `status`, `error`, `truncated`. MusicBrainz allows about one
  lookup a second, so `POST /import/resolve` waits up to 8 s and then answers
  `status: 'resolving'` with `pending: true` entries. Poll `GET /import/jobs/:id` until
  `ready` (or `failed`, with `error`).
- `ImportMatch` gained `pending`.
- `ImportSpotifySavedResponse` gained `pending` (saved albums still being matched; ask again).
- `POST /import/resolve` also accepts track links (the track's album is imported) and
  `spotify.link` / `link.deezer.com` share links.

## Behaviour worth knowing

- **Import cap:** 200 albums per link; the rest is counted in `truncated`.
- **Matches are cached on disk** (`<config>/cache/import-matches.json`, 30 days; misses 1 day)
  so the daily Spotify sync does not ask MusicBrainz twice.
- **Spotify saved-albums sync** only requests albums saved *after* the account was linked,
  and considers each saved album once (`<config>/cache/spotify-saved-sync.json`).
- **Scrobble history:** a play that meets the rule is always written to `ScrobbleQueue`, even
  when the user has no scrobble target, because that table is the "Recently played" history.
- **De-duplication:** a second report of the same track by the same user within the track's
  length is dropped, whatever the source. This is what stops the web player and a Plex webhook
  (or a Navidrome that scrobbles by itself) from double-counting.
- **Retry:** 8 attempts, 1 min doubling to 6 h. Retry timers are in memory, so a restart
  retries immediately. A rejected token/session key fails at once with "link it again".
- **YouTube:** hits cached 30 days on disk, misses 1 day; a quota error pauses searching for
  an hour. Search only — nothing is downloaded.
- **Concerts:** up to 100 library artists per run (recently played or requested first), up to
  4 countries (Ticketmaster setting, server region, users' regions). Skiddle is only asked when
  one of those countries is GB or IE. Past events, events not refreshed for 7 days and events
  of a switched-off provider are deleted.

## Decisions (conservative option taken)

- `// TODO(decision)`-level, not marked in code: Ticketmaster's **Distance** setting
  (`radiusMiles`) is not applied. A radius needs a point, and Shufflerr knows a user's country
  but not their location. Events are filtered by country only.
- The scrobble submitters (ListenBrainz `submit-listens`, Last.fm `track.scrobble` /
  `track.updateNowPlaying`) live in `server/lib/scrobble/targets.ts` rather than in SV1's
  `lastfm.ts` / `listenbrainz.ts`, which did not exist yet. They can be merged later.
- Linked-account secrets are read directly (`server/lib/scrobble/linked.ts`) instead of through
  SV4's `getLinkedSecret`, for the same reason.

## Owner configuration

- Spotify: client ID + secret (Settings → Spotify), redirect URI
  `<applicationUrl>/api/v1/callback/spotify`. Review the Spotify Developer Terms (HANDOFF §6).
- Ticketmaster / Skiddle / YouTube: API keys in their settings pages.
- Scrobbling from media servers:
  - Plex (Plex Pass → Webhooks): `<applicationUrl>/api/v1/webhooks/plex?apikey=<API key>`
  - Jellyfin (Webhook plugin, Generic destination, Playback Start + Playback Stop, Songs, send
    all properties): `<applicationUrl>/api/v1/webhooks/jellyfin?apikey=<API key>`

## Tests

81 tests in `server/lib/import/{import,spotify}.test.ts`, `server/lib/scrobble/scrobble.test.ts`,
`server/lib/concerts/concerts.test.ts`. MusicBrainz, Deezer and iTunes fixtures are recorded
from the live services; Spotify, Ticketmaster, Skiddle, YouTube, ListenBrainz and Last.fm
bodies follow the documented formats (no keys were available).

`nock` cannot be used with `server/test/setup.ts`: nock 14 still calls `http.request` before
answering and the outbound-request guard throws. `server/test/mockAxios.ts` swaps the axios
adapter instead.

## Open

- With **CSRF protection** switched on, csurf in `server/index.ts` also guards
  `POST /api/v1/webhooks/*`, so Plex and Jellyfin webhooks are rejected. The webhook path needs
  an exemption there (shared file, not changed by this stream).
