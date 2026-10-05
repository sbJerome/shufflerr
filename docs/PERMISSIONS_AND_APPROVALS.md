# Permissions and approvals

Adapted from Seerr: `server/lib/permissions.ts`, `server/entity/MediaRequest.ts`
(`MediaRequest.request()`), `server/entity/User.ts` (`getQuota()`), `server/routes/request.ts`.
The mockup implements the same logic client-side (`evaluateRequest`, `createRequest`,
`updateStatus`, `cancelRequest`, `quotaFor`) — use it to check behavior.

## Permission bits

Source of truth: `starter/server/lib/permissions.ts`.

| Bit | Name | Meaning in Shufflerr |
|---:|---|---|
| 2 | ADMIN | Everything. Overrides all other bits. |
| 4 | MANAGE_SETTINGS | Admin settings pages |
| 8 | MANAGE_USERS | User list, edit users, import, delete; **bypasses quotas** |
| 16 | MANAGE_REQUESTS | Approve / decline / retry / edit any request; may ignore own quota |
| 32 | REQUEST | Request anything (album, tracks, discography) |
| 64 | VOTE | (backlog) |
| 128 | AUTO_APPROVE | All own requests auto-approved |
| 256 | AUTO_APPROVE_ALBUM | |
| 512 | AUTO_APPROVE_TRACK | |
| 1024 | REQUEST_DISCOGRAPHY | |
| 2048 | REQUEST_HIRES | (backlog) |
| 8192 | REQUEST_ADVANCED | Choose server, quality, metadata profile, folder in the request modal |
| 16384 | REQUEST_VIEW | See everyone's requests |
| 32768 | AUTO_APPROVE_DISCOGRAPHY | |
| 65536 | AUTO_APPROVE_HIRES | (backlog) |
| 262144 | REQUEST_ALBUM | |
| 524288 | REQUEST_TRACK | |
| 1048576 / 2097152 / 4194304 | MANAGE_ISSUES / VIEW_ISSUES / CREATE_ISSUES | (backlog UI) |
| 8388608 / 16777216 / 33554432 | AUTO_REQUEST / _ALBUM / _TRACK | Spotify saved albums, watchlist |
| 67108864 | RECENT_VIEW | See "Recently added" |
| 134217728 | WATCHLIST_VIEW | (backlog) |
| 268435456 / 1073741824 | MANAGE_BLOCKLIST / VIEW_BLOCKLIST | (backlog UI) |

`hasPermission(perms, value, {type})` — unchanged from Seerr: ADMIN always true; arrays use
`and`/`or`; `0` always true.

### Permission editor UI (from Seerr's PermissionEdit, see mockup `PERM_TREE`)

Groups and parent/child behavior:
- **Access:** Admin. When checked, every other box shows checked and disabled.
- **Management:** Manage settings; Manage users; Manage requests → child "See all requests".
- **Requests:** Request anything → children Request albums / tracks / discographies.
- **Auto-approve:** Approve everything automatically → children albums / tracks /
  discographies ("Unless discographies always need review").
- When a parent is checked, its children show checked + disabled (the parent covers them).
- Saving reads only enabled checked boxes; if ADMIN is set, store just ADMIN.
- A user can't edit their own permissions unless they're the owner (id 1). Nobody but the owner
  can edit the owner.

## Quotas (`User.getQuota()`)

```
canBypass = hasPermission([MANAGE_USERS], user.permissions, {type:'or'})   // ADMIN passes too
albumLimit = canBypass ? 0 : (user.albumQuotaLimit ?? settings.main.defaultQuotas.album.quotaLimit)
albumDays  = user.albumQuotaDays ?? settings.main.defaultQuotas.album.quotaDays
trackLimit / trackDays likewise
```
`0` limit = unlimited. Usage counts requests by this user created within `days`, excluding
DECLINED and excluding `ignoreQuota = true`:
- album usage = count(scope=album) + sum(releaseCount for scope=discography)
- track usage = sum(trackCount for scope=tracks)

`restricted = limit > 0 && remaining <= 0`.

## The request engine — `MediaRequest.request(body, user)`

Body: `{ mbid, mediaType, scope, trackMbids?, releaseCount?, serverId?, qualityProfileId?,
metadataProfileId?, rootFolder?, monitorFuture?, ignoreQuota?, userId?, isAutoRequest?, dryRun? }`

Order of checks — **keep this order**, it determines which error the user sees:

1. **Acting user.** If `userId` is set and `user` lacks `MANAGE_USERS | MANAGE_REQUESTS` (or)
   → `RequestPermissionError("You don't have permission to request for someone else.")`.
   Else `requestUser = userId ? load(userId) : user`.
2. **Permission.** `hasPermission([REQUEST, REQUEST_<SCOPE>], requestUser.permissions, 'or')`
   else `RequestPermissionError("You don't have permission to request <albums|tracks|discographies>.")`.
   - If `serverId/qualityProfileId/metadataProfileId/rootFolder` provided and user lacks
     `REQUEST_ADVANCED` → ignore those fields (Seerr behavior: silently use defaults).
3. **Quota** (skip if `ignoreQuota && hasPermission(MANAGE_REQUESTS, user)` — note: the *acting*
   user's permission, like Seerr; if `ignoreQuota` and not allowed →
   `RequestPermissionError("You don't have permission to go over request limits.")`):
   - `album`: if `album.restricted` → `QuotaRestrictedError("You've used your weekly limit of N albums.")`
   - `discography`: if `album.limit && releaseCount > album.remaining` →
     `QuotaRestrictedError("A discography counts each release against your album limit. You have N left.")`
   - `tracks`: if `track.limit && trackCount > track.remaining` →
     `QuotaRestrictedError("That's more tracks than your limit allows (N left).")`
4. **Blocklist** (backlog): if media is blocklisted → `BlocklistedMediaError`.
5. **Duplicate.** An existing request for the same media + scope whose status is not
   DECLINED/COMPLETED/FAILED → `DuplicateMediaRequestError("This has already been requested.")`.
   For `tracks`: duplicates are per track — drop tracks already in an active request; if none
   left → duplicate error.
   For `album` when an active `discography` request covers the artist → duplicate.
6. **Already available.** `album`/`tracks` where every requested track is AVAILABLE →
   `DuplicateMediaRequestError("This is already in the library.")`.
7. **Auto-approve.**
   `auto = hasPermission([AUTO_APPROVE, AUTO_APPROVE_<SCOPE>], requestUser.permissions, 'or')`
   - If `scope === 'discography' && settings.main.discographyAlwaysReview && !(requestUser.permissions & ADMIN)` → `auto = false`.
   - (backlog) hi-res: `AUTO_APPROVE_HIRES` for `isHiRes` requests.
8. **Dry run.** If `dryRun` → return `{ outcome: auto ? 'auto' : 'pending' }` (errors above map
   to `{ outcome: 'blocked', reason }`). Nothing is written. Used by the request modal.
9. **Create.** `status = auto ? APPROVED : PENDING`, `modifiedBy = auto ? requestUser : null`,
   `isAutoApproved = auto`. Media row: create/update with `status = PENDING` (or PROCESSING if
   approved). Save. Subscriber handles side effects (below).

### Status changes — `POST /api/v1/request/:id/:status`

- Requires `MANAGE_REQUESTS` → else 403 "You don't have permission to manage requests."
- Only from PENDING → APPROVED or DECLINED; else 400 "Only pending requests can be approved or declined."
- Sets `modifiedBy = user`, `isAutoApproved = false`, optional `declineReason`.

### Retry — `POST /api/v1/request/:id/retry`

- `MANAGE_REQUESTS`; only FAILED → APPROVED; clears `failureReason`; re-sends to Lidarr.

### Delete / cancel — `DELETE /api/v1/request/:id`

- Requester may delete their own PENDING request. `MANAGE_REQUESTS` may delete any.
- Media status recalculated (back to UNKNOWN or PARTIALLY_AVAILABLE).

### Edit — `PUT /api/v1/request/:id` (backlog UI, implement route in phase 3)

- `MANAGE_REQUESTS`, or requester while PENDING (scope/tracks only). Managers can change
  server/profile/folder/tracks/user.

### Visibility — `GET /api/v1/request`

- Users without `MANAGE_REQUESTS | REQUEST_VIEW` (or) only get their own requests (Seerr rule).
- Filters: `all | pending | approved | processing | available | declined | failed`, `requestedBy`,
  `scope`; sort: `added | modified`.

## Subscriber side effects (`MediaRequestSubscriber`)

| Transition | Effect |
|---|---|
| → PENDING (created) | Notify `pending` to managers (agents + per-user prefs); media PENDING |
| → APPROVED (auto) | Notify `autoApproved` to managers; send to Lidarr |
| PENDING → APPROVED | Notify `approved` to requester; send to Lidarr |
| PENDING → DECLINED | Notify `declined` to requester; media back to previous status |
| any → FAILED | Notify `failed` to requester + managers; `failureReason` set |
| → COMPLETED | Notify `available` to requester; media AVAILABLE/PARTIALLY_AVAILABLE |

**Send to Lidarr:**
1. Pick server: `serverId` → override rule (backlog) → default (`isHiRes` → hi-res default).
2. Artist: lookup by MBID (`/api/v1/artist/lookup?term=lidarr:<mbid>`); add if missing with
   `monitored: true`, `monitorNewItems: monitorFuture ? 'all' : 'none'`, quality/metadata
   profile, root folder, `addOptions: { monitor: 'none', searchForMissingAlbums: false }`.
3. `album`/`tracks`: find album by release-group MBID, set `monitored: true`, command
   `AlbumSearch` with the album id. For `tracks`, keep existing files; mark the request
   COMPLETED when the requested tracks become available (Lidarr may fetch a full release —
   that's expected; see INTEGRATIONS §Lidarr).
4. `discography`: set artist `monitor: 'all'` per metadata profile, command `ArtistSearch`.
5. On Lidarr error: request → FAILED with `failureReason` (human readable).

## UI copy (from the mockup — keep)

- Modal outcome: "This will be approved automatically and sent to Lidarr right away." /
  "An admin will need to approve this before it downloads." / blocked → the error message.
- Toasts: "Requested X. Approved automatically and sent to Lidarr." / "Requested X. It's waiting
  for an admin to approve it." / "Approved X. Sent to Lidarr." / "Declined X." / "Retrying X.
  Sent to Lidarr." / "Cancelled your request for X." / "X is now in your library."
- Requests list "Last change": "Approved automatically" / "Approved by <name>" /
  "Declined by <name>" / "Failed after approval" / "No changes yet".

## Test matrix (minimum)

| User | Perms | Scope | Expected |
|---|---|---|---|
| owner | ADMIN | any | auto (discography too, even with review on) |
| maya | REQUEST + AUTO_APPROVE_TRACK, limit 10 albums/50 tracks | tracks (4) | auto |
| maya | same | album | pending |
| maya | same | discography (8) with 7 left | blocked (quota) |
| sam | REQUEST, limit 3 albums, already 3+ used | album | blocked (quota) |
| dre | REQUEST + AUTO_APPROVE + REQUEST_VIEW | discography, review on | pending |
| dre | same | discography, review off | auto |
| guest | REQUEST_ALBUM only | tracks | blocked (permission) |
| any | — | duplicate active request | blocked (duplicate) |
| manager w/ limit | MANAGE_REQUESTS | album, ignoreQuota | allowed past limit |
| user | REQUEST | album, ignoreQuota | RequestPermissionError |
