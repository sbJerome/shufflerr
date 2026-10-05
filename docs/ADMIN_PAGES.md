# Admin area (Settings)

Adapted from Seerr's `src/components/Settings/*`, `src/pages/settings/*`,
`server/routes/settings/*`. Requires MANAGE_SETTINGS (Users page link also needs MANAGE_USERS).
Screens: `design/screens/20-*.png` … `37-*.png`.

## Layout

- Route per page: `/settings/<page>` (and `/settings/notifications/<agent>`). `/settings` →
  `/settings/general`.
- Desktop: two columns — left grouped sidebar (250px, sticky), right content. Active item has
  an accent inset bar. Integration items show a status dot (green = on, grey = off).
- Below 980px: sidebar hidden; a "Settings page" `<select>` with `<optgroup>`s navigates.
- Each page: H1 + one-line description, then stacked **panels** (rounded card, title, optional
  sub, fields, right-aligned buttons). Switch rows inside a bordered box. Save buttons say
  "Save changes"; toasts "Settings saved." (or specific).
- Each panel saves its own section via `POST /api/v1/settings/<section>`; GET returns masked
  secrets (`••••` + last 4) — only overwrite a secret if the field changed.

Sidebar groups (exact labels):

| Group | Items → route |
|---|---|
| General | General `/general` · Users `/users` · Network `/network` |
| Stream from | Plex `/plex` · Jellyfin `/jellyfin` · Navidrome `/navidrome` · Local files `/local` · YouTube `/youtube` |
| Connect your apps | Apps and devices `/clients` |
| Downloads | Lidarr `/lidarr` |
| Metadata | MusicBrainz and Last.fm `/metadata` |
| Discover and import | Spotify · Deezer · iTunes · Ticketmaster · Skiddle |
| Scrobble to | ListenBrainz and Last.fm `/scrobbling` |
| Notifications | Notification agents `/notifications/<agent>` |
| System | Logs `/logs` · Jobs and cache `/jobs` · About `/about` |

---

## General  → `main.*`

Panel **Server**:
- Application title (`applicationTitle`, required)
- Application URL (`applicationUrl`, valid URL, no trailing slash) — hint "The address people use
  to reach Shufflerr. Used in links and app setup."
- API key — read-only input + **Copy** + **Make a new key** (toast "Made a new API key. Update
  any scripts that used the old one.") — Seerr's regenerate route.
- Display language (`locale`), Discover region (`discoverRegion`).

Panel **Requests and browsing** (switches):
- Allow track requests (`allowTrackRequests`) — "People can request just the missing tracks from an album."
- Hide music that's already available (`hideAvailable`)
- Cache album art (`cacheImages`)
- Check for updates (`versionCheck`)

## Users  → `main.*`, `plex.loginEnabled`, `jellyfin.loginEnabled|newLogin`

Header button "Manage users" → `/users`.
Panel **Sign-in methods** — switches: Shufflerr accounts, Plex sign-in, Let new Plex users sign
in, Jellyfin sign-in, Let new Jellyfin users sign in. Rule: ≥ 1 of local/Plex/Jellyfin.
Panel **Global request limits** — Albums (0 = no limit), Album period (7/14/30), Tracks, Track
period; switch "Always review discography requests" (`discographyAlwaysReview`). Copy:
"Applies to everyone without their own limits. People who can manage users have no limit."
Panel **Default permissions** — permission editor bound to `defaultPermissions`.

## Network  → `network.*` (Seerr's SettingsNetwork, unchanged semantics)

- Security: CSRF protection ("Makes the external API read-only from other sites. Needs HTTPS."),
  Behind a reverse proxy (trust proxy).
- Outgoing proxy: switch; when on: hostname, port, username, password, bypass list
  (comma-separated), "Use SSL for the proxy", "Skip the proxy for local addresses".
- DNS and timeouts: Prefer IPv4, Cache DNS lookups, min/max TTL seconds, request timeout ms.

## Plex  → `plex.*`

- Connection: switch "Use Plex"; Server preset select ("Manual setup" + servers loaded from
  plex.tv using the owner token — Seerr's "Retrieve servers"); Hostname/IP; Port; Use SSL.
  Buttons: "Load servers from plex.tv" (toast "Found N servers on plex.tv."), "Test", Save.
- Music libraries: checkbox per Plex library of type `artist` (music). Button "Sync libraries"
  (re-fetch sections). Only enabled libraries are scanned.
- Library scan panel: progress bar while running ("Scanning… 48%"), "Scan recently added",
  "Start full scan", "Cancel scan"; idle text "Last full scan finished <time>. N albums, M tracks."
- Sign-in note linking to Users page.

## Jellyfin  → `jellyfin.*`

Connection (Use Jellyfin, Server URL, API key — hint "Dashboard → API keys in Jellyfin"), Test,
Music libraries (CollectionType `music`), Library scan panel. Keep Seerr's Emby toggle only if
Emby support is kept (HANDOFF §6).

## Navidrome  → `navidrome.*`

Use Navidrome, Server URL, Username, Password (Subsonic token auth: `t=md5(password+salt)`, `s`),
Test, Library scan panel.

## Local files  → `localFiles.*`

- Folders list with Remove; "Add a folder" input (must start with `/`, must exist and be
  readable inside the container — validate server-side) + "Add folder".
- Switch "Watch folders for changes" ("New files show up as soon as they're copied in.").
- Full rescan select: every 15 min / hourly / daily.
- Library scan panel.

## YouTube  → `youtube.*`

Copy: "Play tracks you don't have yet with YouTube's own player. Nothing is downloaded."
Use YouTube; YouTube Data API key (hint "From Google Cloud Console"); Region; switch "Fill gaps
while requests download" ("Missing tracks play from YouTube until the real files arrive.").

## Apps and devices  → `clients.*`

Copy: "Any OpenSubsonic or Jellyfin music app can connect to Shufflerr. People sign in with their
username and an app password from their profile."
- Server APIs: switches OpenSubsonic API, Jellyfin API, Allow downloads for offline listening.
  When on, show endpoint rows with Copy: `<applicationUrl>/rest`, `<applicationUrl>/jellyfin`.
  Select "Streaming quality on mobile data": Original / Opus 160 / MP3 320 / MP3 128.
- Tested apps grid (card per app: logo tile, name, platforms, protocol tags, collapsible "How
  to connect" steps, status "Ready" / "Turn on its API above"):

| App | Platforms | Protocols |
|---|---|---|
| Symfonium | Android | OpenSubsonic, Jellyfin |
| Finamp | iOS, Android | Jellyfin |
| Feishin | Windows, macOS, Linux, web | OpenSubsonic, Jellyfin |
| Amperfy | iOS, macOS | OpenSubsonic |
| Jellify | iOS, Android | Jellyfin |

- Connected devices: all app passwords across users (avatar, name, user, last used) + Revoke.

## Lidarr  → `lidarr[]`

Server cards: name (+ "Default" tag), URL, Quality, Folder, Connection status; Test, Edit.
"Add Lidarr server" → modal adapted from Seerr's RadarrModal: Default server, Hi-res server,
Server name, Hostname/IP, Port, Use SSL, API key, URL base, **Test** (loads profiles), Quality
profile, Metadata profile (Lidarr-specific), Root folder, Tags, Enable scan, Enable automatic
search (inverse of preventSearch). Exactly one default (and at most one default hi-res).

## MusicBrainz and Last.fm  → `metadata.*`

- MusicBrainz: Server URL (hint "Use your own mirror to skip the public rate limit"), Requests per
  second (1 public / 10 / 50), Contact (email or URL for User-Agent — **add this field**; the
  mockup lacks it).
- Album art and photos: Cover Art Archive switch; fanart.tv switch + API key.
- Last.fm: Use Last.fm, API key, Shared secret ("The same key is used for scrobbling.").
- Priority: "MusicBrainz first, Last.fm for bios and tags" / "Last.fm first".

## Spotify / Deezer / iTunes / Ticketmaster / Skiddle  → `discover.*`

- **Spotify:** Use Spotify; Client ID; Client secret; "Check linked accounts for new saved
  albums" (daily/hourly/never). Copy explains creating an app at developer.spotify.com with
  redirect `<applicationUrl>/callback/spotify`. Panel "What people can do".
- **Deezer:** Use Deezer (public API, nothing to set up).
- **iTunes:** Use iTunes; Store country.
- **Ticketmaster:** Use Ticketmaster; Discovery API key; Country; Distance (25/50/100 miles).
- **Skiddle:** Use Skiddle; API key.
- (Add) **ListenBrainz trending** switch for the Discover trending row (mockup has it under the
  old metadata toggles; put it on the Scrobbling or Spotify-adjacent page as you see fit).

## Scrobbling  → `scrobble.*`

ListenBrainz (switch, Server URL), Last.fm (switch; uses Metadata API key), "Scrobble a track
after" (half the track or 4 min / track finishes / 30 seconds), "Where plays come from"
checkboxes (Plex, Jellyfin, Navidrome, Connected apps, Shufflerr's own player).

## Notifications  → `notifications.agents.<agent>`

Pills for 10 agents (● marks enabled). Each page: "Send <Agent> notifications" switch, agent
fields, "What to send" checklist (types in USER_SYSTEM.md), **Send test**, Save.

| Agent | Fields |
|---|---|
| Email | Sender name, Sender address, SMTP host, SMTP port, Encryption (none/STARTTLS/always TLS), SMTP username, SMTP password, Allow self-signed certificates (+ Seerr's PGP fields) |
| Web push | none (users opt in from the browser) |
| Discord | Webhook URL, Bot name, Bot avatar URL, Mention users |
| Slack | Webhook URL |
| Telegram | Bot token, Chat ID, Send silently |
| Pushbullet | Access token, Channel tag |
| Pushover | Application token, User or group key, Sound |
| Webhook | Webhook URL, Authorization header, JSON payload (template) |
| Gotify | Server URL, Application token, Priority |
| ntfy | Server URL, Topic, Username, Password |

Webhook template variables (rename Seerr's media vars for music):
`{{event}} {{subject}} {{message}} {{image}} {{notification_type}}`
`{{requestedBy_username}} {{requestedBy_email}} {{requestedBy_avatar}}`
`{{media_type}} {{media_mbid}} {{media_title}} {{media_artist}} {{media_status}}`
`{{request_id}} {{request_scope}} {{request_track_count}} {{request_release_count}}`
`{{extra}}` (array of `{name, value}`).

## Logs

Toolbar: filter text, level select (all/debug/info/warn/error), Pause/Resume. Table: Time,
Level (pill), Label, Message; newest first; live append. Keep Seerr's log detail modal and
copy-to-clipboard.

## Jobs and cache

Jobs table: Job, Type (Process/Command), Runs (human schedule), Next run, **Run now** / **Cancel**
(when running, show "Running…"). Edit schedule modal from Seerr.

| Job id | Name | Default schedule |
|---|---|---|
| plex-recently-added-scan | Plex recently added scan | every 5 min |
| plex-full-scan | Plex full library scan | daily 03:00 |
| plex-refresh-token | Plex refresh token | daily 05:00 |
| jellyfin-recently-added-scan | Jellyfin recently added scan | every 5 min |
| jellyfin-full-scan | Jellyfin full library scan | daily 03:30 |
| navidrome-scan | Navidrome library scan | every 15 min |
| local-files-scan | Local files scan | on change + every 15 min |
| lidarr-scan | Lidarr scan | daily 04:00 |
| download-sync | Download sync | every minute |
| download-sync-reset | Download sync reset | daily 01:00 |
| availability-sync | Music availability sync | daily 00:00 |
| spotify-saved-albums-sync | Spotify playlist sync | daily 06:00 |
| scrobble-queue | Scrobble queue | every 30 s |
| concerts-refresh | Concert listings refresh | daily 07:00 |
| image-cache-cleanup | Image cache cleanup | daily 02:00 |

Cache table: MusicBrainz, Cover Art Archive, Last.fm, Spotify, Ticketmaster, Lidarr — hits,
misses, keys, **Clear**. Image cache panel: images cached, size on disk, "Clean up now". Keep
Seerr's DNS cache table.

## About

Version, Albums, Requests, Users, Data folder, Time zone; Getting help links (Documentation,
GitHub discussions, Report a problem); **Credits** paragraph (Seerr attribution, MIT, Copyright
(c) 2020 sct; MusicBrainz/CAA/Last.fm/ListenBrainz data credits). Keep Seerr's version check.
