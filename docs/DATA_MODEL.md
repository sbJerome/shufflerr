# Data model

TypeORM entities. Types are indicative; follow Seerr's column conventions (snake_case in DB via
the naming strategy Seerr uses, `@CreateDateColumn`/`@UpdateDateColumn`, `@DbAwareColumn` where
Seerr uses it for SQLite/Postgres differences). Fresh initial migrations for both databases.

## Media  (adapts Seerr `Media`)

One row per MusicBrainz entity Shufflerr tracks (artist or release group; recordings live in
`Track`).

| Field | Type | Notes |
|---|---|---|
| id | int PK | |
| mediaType | enum `artist` \| `release-group` | `MediaType` |
| mbid | uuid, indexed | MusicBrainz ID. Unique per mediaType. |
| artistMbid | uuid, nullable, indexed | For release groups. |
| title | string | Cached for lists/notifications. |
| artistName | string, nullable | |
| primaryType | string, nullable | Album / Single / EP / Broadcast / Other |
| secondaryTypes | simple-array | Compilation, Live, Remix, Soundtrack, … |
| firstReleaseDate | string, nullable | YYYY or YYYY-MM-DD |
| status | `MediaStatus` | Library status (see constants). |
| trackCount | int, nullable | From the release Lidarr / media server has, else MB. |
| tracksAvailable | int, default 0 | Denormalized for lists. |
| lidarrServerId | int, nullable | Which Lidarr instance owns it. |
| lidarrArtistId / lidarrAlbumId | int, nullable | External IDs in Lidarr. |
| plexRatingKey / jellyfinItemId / navidromeId / localPath | string, nullable | Where it lives. |
| lastSeasonChange equivalent → `lastScanAt` | datetime | |
| mediaAddedAt | datetime, nullable | First time it became (partly) available. |
| createdAt / updatedAt | datetime | |
| requests | OneToMany MediaRequest | |
| tracks | OneToMany Track | |
| issues | OneToMany Issue | (backlog UI) |

## Track  (new; replaces Seerr `Season`)

| Field | Type | Notes |
|---|---|---|
| id | int PK | |
| media | ManyToOne Media (release group) | |
| recordingMbid | uuid, nullable | |
| position | string | "01", "1-07" for multi-disc |
| title | string | |
| artistCredit | string | e.g. "John Summit, Devault, Julia Church" |
| lengthMs | int, nullable | |
| status | `MediaStatus` | AVAILABLE when found in a library |
| fileFormat | string, nullable | "FLAC 16/44.1" |
| sourceIds | simple-json | `{plex, jellyfin, navidrome, localPath}` |
| peaks | text, nullable | Precomputed waveform peaks (base64 Uint8 array), generated on scan |

## MediaRequest  (adapts Seerr `MediaRequest`)

| Field | Type | Notes |
|---|---|---|
| id | int PK | |
| status | `MediaRequestStatus` | PENDING 1, APPROVED 2, DECLINED 3, FAILED 4, COMPLETED 5 |
| scope | enum `tracks` \| `album` \| `discography` | `RequestScope` |
| media | ManyToOne Media | release group for tracks/album; artist for discography |
| requestedBy | ManyToOne User | |
| modifiedBy | ManyToOne User, nullable | Who approved/declined; requester when auto-approved |
| isAutoApproved | boolean | Drives "Approved automatically" in the UI |
| isAutoRequest | boolean | Created by watchlist/Spotify sync |
| ignoreQuota | boolean | Manager chose to bypass their limit |
| releaseCount | int | For discography: number of release groups included (quota) |
| trackCount | int | For tracks: number of tracks (quota) |
| tracks | OneToMany TrackRequest | For `tracks` scope |
| serverId | int, nullable | Lidarr instance (default if null) |
| qualityProfileId / metadataProfileId | int, nullable | REQUEST_ADVANCED only |
| rootFolder | string, nullable | |
| isHiRes | boolean, default false | Backlog: hi-res requests |
| monitorFuture | boolean | "Watch for new releases from <artist>" checkbox |
| downloadProgress | int, nullable | 0–100 from download sync |
| failureReason | string, nullable | e.g. no release matched the quality profile |
| declineReason | string, nullable | Optional admin note |
| createdAt / updatedAt | datetime | |

## TrackRequest  (new; replaces Seerr `SeasonRequest`)

`id`, `request` (ManyToOne), `track` (ManyToOne Track), `status` (MediaRequestStatus).

## User  (adapts Seerr `User`)

Keep Seerr's fields: `id`, `email`, `plexUsername`, `jellyfinUsername`, `username`,
`password` (hash), `resetPasswordGuid`, `recoveryLinkExpirationDate`, `userType`
(`PLEX` | `JELLYFIN` | `LOCAL` — drop `EMBY` unless kept, see HANDOFF §6), `plexId`,
`jellyfinUserId`, `jellyfinDeviceId`, `jellyfinAuthToken`, `plexToken`, `permissions` (int),
`avatar`, `createdAt`, `updatedAt`, `requests`, `settings`, `pushSubscriptions`.

Change:
- Replace `movieQuotaLimit/Days`, `tvQuotaLimit/Days` with
  `albumQuotaLimit`, `albumQuotaDays`, `trackQuotaLimit`, `trackQuotaDays` (nullable = use
  global).
- `displayName` getter unchanged (username || plexUsername || jellyfinUsername || email).

## UserSettings  (adapts Seerr `UserSettings`)

Keep: `locale`, `discoverRegion`, notification types per agent (Seerr's
`notificationTypes` JSON), `discordId`, `telegramChatId`, `telegramSendSilently`,
`pushbulletAccessToken`, `pushoverApplicationToken`, `pushoverUserKey`, `pushoverSound`,
`pgpKey`.
Drop: `originalLanguage`, `streamingRegion`, `watchlistSyncMovies/Tv`.
Add: `autoRequestSpotifySaved` (bool), `scrobbleEnabled` (bool, default true).

## LinkedAccount  (new)

| Field | Notes |
|---|---|
| id, user (ManyToOne) | |
| provider | `lastfm` \| `listenbrainz` \| `spotify` (Plex/Jellyfin stay on User like Seerr) |
| externalUsername | shown in UI ("Linked as …") |
| secret | encrypted: Last.fm session key / ListenBrainz user token / Spotify refresh token |
| scopes, expiresAt | Spotify |
| createdAt, lastUsedAt | |

Encrypt secrets at rest with a key derived from a server secret in settings (generate on first
boot, store in `settings.json` with 0600 perms).

## AppPassword  (new)

`id`, `user`, `name`, `hash` (argon2id), `lastUsedAt`, `lastUsedClient` (UA/app name),
`createdAt`. Plaintext shown once on creation. Used by OpenSubsonic (`u` + `p`/token auth) and
the Jellyfin-compatible API.

## ScrobbleQueue  (new)

`id`, `user`, `recordingMbid` (nullable), `artist`, `track`, `album`, `durationMs`,
`playedAt`, `source` (`plex`|`jellyfin`|`navidrome`|`apps`|`web`), `targets` (json:
`{listenbrainz: 'pending'|'sent'|'failed', lastfm: …}`), `attempts`, `lastError`.

## ImportJob  (new, optional persistence)

`id`, `user`, `source` (`spotify`|`deezer`|`itunes`), `url`, `status`, `matched` (json array of
`{mbid, title, artist, status}`), `createdAt`. Lets the Import page survive reloads.

## Event  (new, cache only)

Concert listings: `id`, `provider`, `externalId`, `artistMbid`, `artistName`, `venue`, `city`,
`country`, `startsAt`, `url`, `fetchedAt`. Purge by provider terms.

## Kept from Seerr (adapt types/labels, UI may come later)

- `Session` — unchanged.
- `UserPushSubscription` — unchanged.
- `Issue`, `IssueComment` — issue types become: `wrong-release`, `bad-tags`, `missing-tracks`,
  `low-quality`, `other`. (Backlog UI.)
- `Blocklist` — block an artist or release group by MBID; optional tag blocklist. (Backlog UI.)
- `Watchlist` — per-user wanted list; source `manual` | `spotify` | `plex-playlist`. (Backlog UI.)
- `DiscoverSlider` — slider types for music: recently-added, trending-listenbrainz,
  itunes-chart, new-from-followed, genre, label, concerts. (Backlog UI for editing.)
- `OverrideRule` — conditions: user, genre/tag, label, primary type; actions: server, quality
  profile, metadata profile, root folder. (Backlog UI.)

## Indexes / constraints

- `Media(mediaType, mbid)` unique.
- `Track(media, position)` unique.
- `MediaRequest(media, scope, status)` index for duplicate checks.
- `AppPassword(user)`; `LinkedAccount(user, provider)` unique.
