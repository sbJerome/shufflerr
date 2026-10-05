# SV5 — admin settings API, notifications, jobs, logs

## What works (and how it was checked)

All of it is covered by `server/routes/settings/settings.test.ts` (37 tests, real router +
SQLite through supertest, HTTP stubbed) and `server/lib/notifications/music.test.ts`
(18 tests). `pnpm typecheck:server` and eslint are clean for the files below. The API was not
booted as a whole process for this stream, and no notification was sent to a real service.

### Settings routes (`server/routes/settings/index.ts`) — adapted from Seerr
- Every section validates before saving and answers `400 {message}` with copy that says what
  to fix; unknown keys in a body are dropped (`pickKnown`) so a request can't add keys to
  `settings.json`.
- **General** `/main`: title required, URL must be http(s) without trailing slash, locale from
  the app's list, region two letters; the API key only changes through `/main/regenerate`.
- **Users** `/users`: "At least one sign-in method has to stay on.", limits 0–100000, periods
  1–365 days, default permissions.
- **Network** `/network`: Seerr semantics; proxy password masked; proxy needs a hostname when
  on; min TTL ≤ max TTL (−1 = no maximum).
- **Metadata** `/metadata`: MusicBrainz URL + requests/second (the public server is held to
  1 rps), contact (email or URL), fanart.tv / Last.fm need their key before they turn on.
  Changing the MusicBrainz URL flushes its cache.
- **YouTube**, **Discover** (`spotify`, `deezer`, `itunes`, `ticketmaster`, `skiddle`,
  `listenbrainzTrending`), **Scrobble**, **Clients** (+ devices list / revoke).
  Changing Spotify's saved-albums check to hourly/daily reschedules the job.
- **Test buttons**: `POST /metadata/test/:service`, `/youtube/test`,
  `/discover/test/:service`, `/scrobble/test/:service` → `ConnectionTestResponse`. One real
  call each (`server/routes/settings/connectionTests.ts`), with unsaved form values; a masked
  or missing secret means "use the stored one".
- **Jobs**: list (with `scheduleText`, `enabled`, `cancellable`), run now, cancel, edit schedule
  (validated 6-field cron, persisted, applied live). **Cache**: display names per
  ADMIN_PAGES, flush, DNS flush, `POST /cache/images/cleanup`. **About**: real counts.
- Logs route is Seerr's reader, unchanged.

### Notifications
- `server/lib/notifications/music.ts` (new): `MusicNotificationPayload`,
  `buildRequestNotification(type, request)`, `notifyRequest(type, request, options?)` — the one
  call SV2's subscriber needs. Routing: pending/autoApproved → managers; approved/declined/
  available → requester; failed → both. Subject "<Album> — <Artist>" or
  "<Artist> — discography"; `extra` carries Scope, Reason, Approved/Declined by; cover image is
  `<applicationUrl>/imageproxy/caa/release-group/<mbid>/front-500` (only with an application
  URL, never for artists).
- All 10 agents kept. Status labels are the fixed UI labels; email and web push bodies
  reworded (no movie/series/4K); webhook variables are the ADMIN_PAGES list plus
  `{{notification_key}}`; a variable used twice in one string is replaced twice.
- `server/routes/settings/notifications.ts` rewritten as one generic per-agent handler:
  `GET /` overview, `GET|POST /:agent`, `POST /:agent/test`. String type keys, masked secrets,
  per-agent validation when enabled, email `encryption` choice, webhook template as text.
- Email templates restyled to the Shufflerr palette and sentence case.
- `server/i18n/globalMessages.ts` + regenerated `server/i18n/locale/en.json`.

### Jobs (`server/job/schedule.ts`)
- Generic running state for every job, a job never overlaps itself, `runJobNow`, `cancelJob`,
  `setJobSchedule`, `isValidSchedule`, `describeSchedule`, `jobItem`, `stopJobs`,
  `cleanImageCache`. Download sync is labelled per-minute.

## Deviations from the contract (all additive)
- New routes: the four `…/test…` endpoints above.
- `JobItem` gained optional `scheduleText`, `enabled`, `cancellable`; `POST /jobs/:id/run`
  answers `running: true` plus `alreadyRunning`.
- `POST /jobs/:id/cancel` answers 400 for a running job that has no cancel hook.
- `POST /settings/notifications/:agent/test` answers 400 (not 500) when the service refuses.
- Discord/Slack webhook URLs are masked like other secrets.
- `docs/API_CONTRACT.md` updated for these.

## Decisions / notes for the owner
- The connection tests call the services directly with axios rather than through the other
  streams' clients, so the Test buttons don't depend on them.
- `GET /settings/notifications/pushover/sounds` lives in `server/routes/index.ts` (not this
  stream's file) and needs the plaintext token in the query; with a masked stored token the
  sound list only loads after the token is typed again.
- Non-English server locales keep Seerr's translations for the unchanged labels and fall back
  to English for the reworded messages.
- nock does not work under `server/test/setup.ts` (its outbound-request blocker fires first
  and the process then hangs); these tests stub `axios.get/post` with `node:test` mocks.
- Nothing to configure: every agent and integration stays off until its page is filled in.
