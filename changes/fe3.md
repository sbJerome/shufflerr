# FE3 — users, profile, user settings

## Stable exports for other agents (read this first)

### `@app/components/PermissionEdit` (default export)
Props kept from Seerr:
- `currentPermission: number` — the bitmask being edited.
- `onUpdate: (newPermission: number) => void` — called with the new bitmask on every change.
  If ADMIN is set the value is just `Permission.ADMIN`.
- `actingUser?: User` — who is editing (defaults to the signed-in user). Non-owners can't
  grant ADMIN / MANAGE_SETTINGS they don't hold themselves (Seerr rule kept).
- `currentUser?: User` — whose permissions are edited (omit for bulk edit / default permissions).
Renders the music permission tree (`sh-perm`): Access, Management, Requests, Auto-approve.
A checked parent shows its children checked + disabled.

### `@app/components/NotificationTypeSelector` (default export)
Works on string keys (`NotificationTypeKey`: pending, autoApproved, approved, declined,
available, failed).
- `currentTypes: NotificationTypeKey[]`
- `onUpdate: (types: NotificationTypeKey[]) => void`
- `managerOnly?: boolean` — default `true` = manager-only types (pending, autoApproved) are
  offered; pass `false` to hide them (users without MANAGE_REQUESTS).
- `availableTypes?: NotificationTypeKey[]` — restrict to this list (server's `availableTypes`).
- `legend?: string` — fieldset legend, default "What to send".
- `error?: string`
Named export `notificationTypeLabel(intl, key)` returns the fixed label for a type.

## What was built

Routes (Next pages):
- `/users` → `UserList`
- `/users/[userId]`, `/profile` → profile Overview
- `/users/[userId]/requests`, `/profile/requests` → profile Requests
- `/users/[userId]/settings/[[...tab]]`, `/profile/settings/[[...tab]]` → user settings. Tab slugs:
  `general` (default; `main` accepted), `password`, `linked-accounts` (`linked` accepted),
  `app-passwords` (`apps` accepted), `notifications[/<channel>]`, `permissions`.

| Seerr path | Action | Now |
|---|---|---|
| `src/components/UserList/index.tsx` | Adapted (rewritten on the kit) | list, search, sort, selection, paging, delete confirm, credit line |
| `UserList/BulkEditModal.tsx` | Adapted | bitwise-AND prefill, never the owner |
| `UserList/PlexImportModal.tsx`, `JellyfinImportModal.tsx` | Adapted → one `ImportUsersModal.tsx` | driven by `GET /settings/{plex,jellyfin}/users` |
| (create-user modal inside UserList) | Adapted → `UserList/CreateUserModal.tsx` | generated-password rule tied to `emailEnabled` |
| `UserProfile/index.tsx`, `ProfileHeader` | Adapted | header card + Overview / Requests / Settings tabs |
| — | New | `UserProfile/Overview.tsx`, `Requests.tsx`, `RequestTitle.tsx`, `shared.tsx` |
| `UserSettings/index.tsx` | Adapted | pill sub-nav, Permissions visibility rule |
| `UserSettings/UserGeneralSettings` | Adapted → `General.tsx` | + Spotify auto-request switch, Request limits panel (album/track) |
| `UserSettings/UserPasswordChange` | Adapted → `Password.tsx` | three cases + exact copy |
| `UserSettings/UserLinkedAccountsSettings/index.tsx` | Adapted → `LinkedAccounts.tsx` | rows from the server's `accounts[]`; + Last.fm, ListenBrainz, Spotify |
| `UserLinkedAccountsSettings/LinkJellyfinModal.tsx`, `LinkJellyfinQuickConnectModal.tsx` | Kept | untouched |
| `UserSettings/UserNotificationSettings/*` (6 files + web push devices) | Adapted → one `Notifications.tsx` | per-channel form posting `{channels:{<agent>:…}}` |
| `UserSettings/UserPermissions` | Adapted → `Permissions.tsx` | owner note, tree editor |
| — | New | `UserSettings/AppPasswords.tsx` |
| `PermissionEdit/index.tsx` | Rewritten on the music tree | see top of this file |
| `PermissionOption/index.tsx` | Dropped | folded into `PermissionEdit` |
| `NotificationTypeSelector/*` | Rewritten on string keys | see top of this file |
| `QuotaSelector/index.tsx` | Kept untouched | not used by my pages (plain number + period selects per the mockup); left for the admin agent if wanted |
| `src/pages/{users,profile}/**/watchlist.tsx`, per-channel notification pages, `settings/main.tsx` etc. | Dropped | replaced by the catch-all settings route |

## Deviations from the mockup / spec
- Display language lists every locale the app ships (USER_SYSTEM.md: "use the app's i18n list"), plus a
  "Server default" entry; Discover region lists all countries with a "Server default" entry.
- Role on the General tab is shown as the role badge rather than a read-only text input.
- App passwords: Server and Username rows have Copy buttons (asked for in the brief; the mockup shows plain rows).
  When viewing someone else, creating is disabled with a note (the contract makes POST own-only); Revoke still works.
- Linked accounts: linking is own-only per the contract, so "Link …" is disabled when an admin views another
  user. Two-letter tiles, no third-party logos. Emby shows as "Emby" when that is the server type.
- Web push: Seerr's per-device list is gone. Saving the channel with the switch on registers this browser,
  off unregisters it (own account only).
- User notification extras kept from Seerr beyond the spec: PGP public key (email), "Send silently" (Telegram).
  Not surfaced: Telegram thread id / bot username, Pushover sound (the contract carries them; the spec doesn't list them).
- Profile "Recently played" hides entirely when the server reports `enabled:false`; cards get a Play button when the
  play is `playable`.
- Paging (Previous / Next) on the user list (25 per page) and the profile Requests tab (20 per page); the mockup
  has no paging because its data set is tiny.
- The profile header shows no "Edit user" for yourself (the Settings tab is right there), as in the mockup.

## For integration
- i18n: every file has one uniquely-namespaced `defineMessages`. `components.UserList`, `components.UserProfile`,
  `components.PermissionEdit`, `components.NotificationTypeSelector` reuse Seerr namespaces, so `en.json` holds stale
  Seerr copy for some ids until `pnpm i18n:extract` is run.
- Not run in a browser (no dev server allowed in the shared tree). Typecheck and eslint are clean for my files.
