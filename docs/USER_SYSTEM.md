# User system

Adapted from Seerr: `src/components/UserList/*`, `src/components/UserProfile/*`,
`src/components/UserProfile/UserSettings/*`, `server/routes/user/*`, `server/entity/User.ts`.
Screens: `design/screens/11-users.png` … `17-user-permissions.png`.

## Roles (display only — permissions decide access)

- **Owner** — user id 1. Badge in amber. Can't be deleted; only the owner can edit the owner.
- **Admin** — has ADMIN bit. Badge in accent.
- **User** — everyone else.
- Account type labels: "Plex user", "Jellyfin user", "Local user".

## Users page — `/users` (requires MANAGE_USERS)

Header: title "Users", description "Everyone who can sign in to Shufflerr. Permissions decide who
can request what and whose requests skip the queue."

Header actions (only when the method is enabled):
- **Create local user** → modal (from Seerr's create modal):
  - Username (required), Email address (required, valid, unique), "Email them a generated
    password" checkbox (default on; requires email agent — if email is off, disable and default
    off), Password (shown when unchecked; ≥ 8 chars).
  - Note: "New users get the default permissions from Settings → Users."
  - Errors inline: "Enter a username." / "Enter a valid email address." / "That email address is
    already used." / "The password needs at least 8 characters."
  - Toast: "Created <name>." or "Created <name>. A password was emailed to them."
- **Import Plex users** → modal listing Plex users with access to the owner's server who aren't
  in Shufflerr (checkboxes, default checked). Empty state: "There are no Plex users to import.
  Everyone with access already has an account." Toast: "Imported N Plex users with the default
  permissions."
- **Import Jellyfin users** → same for Jellyfin users.

Toolbar: search ("Search users", matches username/display name/email), sort select
(date joined [default] / name / requests / account type / role), **Edit permissions (N)** —
enabled when rows are selected (bulk edit, Seerr's BulkEditModal).

Table columns: checkbox (owner row disabled), avatar (links to profile), User (display name +
email), Requests (count, links to user's requests), Type, Role, Joined (long date), actions
(Edit → `/users/:id/settings`, disabled-looking for owner unless you are the owner; Delete →
confirm modal; disabled for owner and yourself).

Bulk edit modal: "Edit permissions for N users", lists names, permission editor pre-filled with
the bitwise AND of selected users' permissions, "Save permissions". Never applies to owner.

Delete confirm: "Delete <name>?" — "This removes <name>'s account and all N of their requests.
Music already in the library stays." Buttons: Cancel / Delete user (danger). Toast
"Deleted <name>."

Footer credit line: "The user system, permissions and approval rules are adapted from Seerr
(github.com/seerr-team/seerr), MIT License."

## Profile — `/users/:id` and `/profile` (own)

Access: own profile always; others need MANAGE_USERS.

Header card: large avatar (initials fallback; Plex/Jellyfin avatar via image proxy when
present), display name, email, account type, "Joined <date>", role badge; "Edit user" button
(when viewing someone else and allowed).

Tabs: **Overview** · **Requests** · **Settings** (Settings hidden if you can't edit the user).

Overview:
- Three stat cards: Total requests; Albums left (ring = used/limit, "N of M" or "Unlimited",
  "(past D days)"); Tracks left (same).
- "Recent requests" row (cards with art + status) with "All requests" link.
- "Recently played" row (from Plex/Jellyfin history / scrobble log), sub-line:
  "From Plex and connected apps. Scrobbling to ListenBrainz and Last.fm" (only names that are
  linked and enabled).

Requests: the user's requests list (art, title, artist + scope, time, status).

## User settings — `/users/:id/settings/<tab>`

Pill sub-nav: General · Password · Linked accounts · App passwords · Notifications ·
Permissions.

Rules:
- You can always edit yourself.
- Editing others requires MANAGE_USERS and the target isn't the owner (unless you're the owner).
- **Permissions** tab: visible when you have MANAGE_USERS, except on your own account unless
  you're the owner (Seerr: `hidden: currentUser.id !== 1 && currentUser.id === user.id`).

### General
Fields: Display name, Email, Account type (read-only), Role (read-only), Display language
(en, nl, de, fr, es — use the app's i18n list), Discover region (country; drives trending,
charts and concerts). If Spotify is linked and enabled: switch "Request albums I save on
Spotify" ("Checks your Spotify saved albums every day and requests new ones.") — requires
AUTO_REQUEST(_ALBUM).
**Request limits** panel (only when the viewer has MANAGE_USERS): "Override the global limits"
checkbox → Albums (number), Album period (7/14/30 days), Tracks, Track period. Copy: "Without an
override, this user follows the global limits in Settings → Users. People who can manage users
have no limit." Save → "Saved request limits."

### Password
- Own account with a password: Current password, New password (≥ 8), Confirm.
- Admin editing someone else: New + Confirm only.
- Media-server user without password: copy "This account doesn't have a password yet. Set one so
  <you|name> can also sign in with an email address."
- Errors: "Enter your current password." / "The new password needs at least 8 characters." /
  "The passwords don't match." Toast "Password saved."

### Linked accounts
Rows (shown only if the integration is enabled):
| Provider | Purpose copy | Link flow |
|---|---|---|
| Plex | Sign in and see what you've played on Plex | Plex PIN flow; unlink disabled if it's the sign-in method |
| Jellyfin | Sign in and see what you've played on Jellyfin | Seerr's LinkJellyfinModal / Quick Connect |
| Last.fm | Scrobble everything you play in Shufflerr and connected apps | Last.fm web auth → `auth.getSession` → session key |
| ListenBrainz | Scrobble to ListenBrainz with your user token | Paste user token → validate via `validate-token` |
| Spotify | Import your playlists and saved albums as requests | OAuth (Authorization Code + PKCE), scopes `playlist-read-private user-library-read` |
Linked state: "Linked as <username>" + Unlink.

### App passwords
Copy: "Use these to sign in from music apps like Symfonium, Finamp, Feishin, Amperfy and Jellify.
Each app gets its own password so you can revoke one without changing the others."
Shows Server URL and Username. List: name, "Created <date>, last used <relative>", Revoke.
Create: name input (placeholder "For example: Finamp on my phone") → "Create password" → green
box "Password for <name>: <pw>. Copy it now, it won't be shown again."

### Notifications
Pills per channel that is enabled server-side: Email, Web push, Discord, Telegram, Pushbullet,
Pushover. Each: switch "Send me <channel> notifications", channel fields (Discord user ID —
"So Shufflerr can mention you"; Telegram chat ID; Pushbullet access token; Pushover application
token + user key), checklist of types. Manager-only types (pending, autoApproved) appear only
for users with MANAGE_REQUESTS.

Types (keys used everywhere):
| key | Label |
|---|---|
| pending | A request is waiting for approval |
| autoApproved | A request was approved automatically |
| approved | Your request was approved |
| declined | Your request was declined |
| available | Your music is available |
| failed | A request failed to download |
| (backlog) issueCreated / issueComment / issueResolved | Issues |

### Permissions
Permission editor (see PERMISSIONS_AND_APPROVALS.md). Owner: "The owner always has full
access." and no editor. Save → "Saved <name>'s permissions."

## API routes (adapt Seerr's `server/routes/user/*`)

- `GET /user` (take, skip, sort, q) · `POST /user` (create local) · `PUT /user` (bulk perms)
- `POST /user/import-from-plex` · `POST /user/import-from-jellyfin`
- `GET /user/:id` · `DELETE /user/:id`
- `GET /user/:id/requests` · `GET /user/:id/quota` · `GET /user/:id/recently-played`
- `GET|POST /user/:id/settings/main`
- `GET|POST /user/:id/settings/password`
- `GET|POST|DELETE /user/:id/settings/linked-accounts/:provider` (+ OAuth callback routes)
- `GET|POST|DELETE /user/:id/settings/app-passwords`
- `GET|POST /user/:id/settings/notifications`
- `GET|POST /user/:id/settings/permissions`
