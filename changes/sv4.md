# SV4 — auth and user system (BUILD_PLAN Phase 5)

Scope: `server/routes/auth.ts`, `server/routes/user/**`, `server/routes/callback.ts`,
new `server/lib/auth/**`. Specs: `docs/AUTH.md`, `docs/USER_SYSTEM.md`, `docs/API_CONTRACT.md` §SV4.

## Kept (Seerr logic unchanged)

- Session handling, `checkUser` / `isAuthenticated`, `/auth/me`, logout, web-push subscription
  routes, Jellyfin Quick Connect (initiate / check / authenticate), avatar refresh at sign-in,
  password hashing (bcrypt) and the reset-password guid flow.
- `server/api/plextv.ts`, `server/lib/refreshToken.ts`, `server/middleware/auth.ts` — untouched.

## Adapted

- **Plex sign-in** — first user becomes owner; existing by `plexId`; link by email; unknown user
  needs server access (checked with the owner's Plex token) and `main.newPlexLogin`, else 403 with
  the AUTH.md copy. Gated by `main.mediaServerLogin && plex.loginEnabled` (not by
  `mediaServerType`, which is now only "what the owner signed in with"). If the owner never
  linked Plex there is no token to check access with, so only accounts that already exist
  (imported or linked) can sign in.
- **Jellyfin / Emby sign-in** — new rule `jellyfin.newLogin` (Seerr reused `newPlexLogin`);
  gated by `main.mediaServerLogin && jellyfin.loginEnabled`; exact copy for unknown account and
  bad credentials. The owner-setup branch now runs **only when no users exist**. Seerr also ran
  it whenever `mediaServerType` was unset — with a local owner that would have overwritten user
  1 with whoever signed in through Jellyfin. New Jellyfin users no longer get their Jellyfin
  password copied into a Shufflerr password.
- **Local sign-in** — AUTH.md copy for empty / unknown email / media-server account without a
  password; 400/403 instead of Seerr's 500s; errors are `{message}` through the error handler.
- **Reset password** — answers `ok` without sending anything while the email agent is off;
  400s with plain copy for a short password or dead link.
- **Users API** — list needs MANAGE_USERS or MANAGE_REQUESTS (Seerr: any signed-in user); `q`
  search; sorts `created` (newest first) / `displayname` / `requests` / `usertype` / `role`;
  create-local validation with the inline copy from USER_SYSTEM.md; bulk permission edit never
  touches the owner, the caller, or (unless the caller is the owner) another admin; delete
  refuses the owner and yourself; import-from-Plex/Jellyfin return the created users as an
  array (`ImportUsersResponse`); quota readable by the user, MANAGE_USERS or MANAGE_REQUESTS.
- **User settings** — main (quota overrides only by MANAGE_USERS, not for yourself, `null` =
  back to global; `autoRequestSpotifySaved` needs AUTO_REQUEST / AUTO_REQUEST_ALBUM; email
  validated and unique), password (current-password / 8 characters / confirmation copy),
  notifications in the contract's `channels` shape with string type keys, permissions (owner is
  never editable; nobody edits themselves; only the owner grants or changes an admin; ADMIN is
  stored alone).
- Plex / Jellyfin linking and unlinking moved behind the generic
  `…/linked-accounts/:provider` routes and return `LinkedAccountStatus` (Seerr: 204).

## New

- `server/lib/auth/rateLimit.ts` — 10 failed attempts per minute per IP on `/auth/plex`,
  `/auth/jellyfin`, `/auth/jellyfin/quickconnect/authenticate`, `/auth/local`, `/auth/setup`,
  `/auth/reset-password*` (429 "Too many sign-in attempts…"). Successful sign-ins don't count.
  Off under the test runner unless `AUTH_RATE_LIMIT_IN_TESTS=true`.
- `POST /api/v1/auth/setup` `{username?, email, password}` → 201 User. **First run only**:
  creates the owner as a Shufflerr (email + password) account so the app can be initialised
  without Plex or Jellyfin. 403 once any user exists. _(Not in API_CONTRACT.md — add it.)_
- `server/lib/auth/appPasswords.ts` — app passwords (`xxxxxx-xxxxxx-xxxxxx`).
- `server/lib/auth/linkedAccounts.ts` — Last.fm, ListenBrainz and Spotify links.
- `server/routes/callback.ts` — `/api/v1/callback/lastfm` and `/api/v1/callback/spotify`.
- `GET /user/:id/recently-played` — from `ScrobbleQueue` (real plays only; empty until the
  scrobble pipeline records some), consecutive repeats collapsed.
- Tests: `server/routes/user/rules.test.ts` (50 tests) + updated `auth.test.ts`,
  `usersettings.test.ts`.

## Decisions and trade-offs

- **App passwords are stored twice** (docs/AUTH.md): an argon2id hash for plain-password
  sign-ins, and an AES-256-GCM encrypted copy (key derived from `settings.serverSecret`) because
  Subsonic token auth (`t = md5(password + salt)`) needs the plaintext on the server. Someone
  holding both `settings.json` and the database can recover app passwords. They cannot recover
  account passwords, and an app password only opens the client APIs. Revoking deletes the row.
- **OAuth `state` is kept in memory** (10 minutes, single use) and carries the user id, so the
  provider's return completes even when the session cookie is withheld (SameSite=Strict when
  CSRF protection is on). Consequences: a link attempt does not survive a server restart, and
  `/api/v1/callback` is mounted without `isAuthenticated()` — one-line change in
  `server/routes/index.ts` (the only edit outside this stream's files).
- **Provider calls for linking live in `linkedAccounts.ts`** (`auth.getSession`,
  `validate-token`, Spotify token exchange + `/v1/me`), not in SV1's `lastfm.ts` /
  `listenbrainz.ts` or SV6's `spotify.ts`, which had no agreed signatures when this was
  written. They are three small calls on a class extending `ExternalAPI`; fold them into the
  shared clients later if wanted.
- **Unlinking Plex/Jellyfin** is allowed for anyone (owner included) as long as another way to
  sign in remains (a password with local sign-in on, or the other media-server link). Seerr
  blocked the owner outright; with a local owner that would make a Plex link permanent.
- **Linking Plex no longer requires matching emails** (Seerr did); the Plex id is what sign-in
  matches on. The owner may link Plex even while Plex sign-in is off.
- `GET /user/:id` stays open to any signed-in user with the filtered (no email/settings) shape,
  as in Seerr — request lists show other users' names and avatars. The contract says "own or
  MANAGE_USERS".
- `GET /user/:id/requests` still returns raw `MediaRequest` rows cast to `RequestResult[]`;
  switch to SV2's mapper once `routes/request.ts` exports one.

## Owner must configure

- Spotify app redirect URI: `<applicationUrl>/api/v1/callback/spotify`.
- Last.fm needs no registered callback (it is passed per request:
  `<applicationUrl>/api/v1/callback/lastfm`); the API key and shared secret must both be set.
- `main.applicationUrl` should be set; otherwise callback URLs are built from the request's
  host, which is wrong behind a proxy that rewrites it.

## Not verified live

- Real Plex PIN sign-in, Jellyfin sign-in, and the Last.fm / ListenBrainz / Spotify exchanges
  (no accounts or keys here): covered with mocked HTTP only.
