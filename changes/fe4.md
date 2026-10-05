# FE4 — admin area (Settings pages) and setup wizard

Scope: `src/pages/settings/**`, `src/components/{Settings,Setup,JSONEditor,LanguageSelector,RegionSelector}`.
Verified with `tsc --noEmit` (0 errors in the whole client), eslint and prettier on these
files. Not run in a browser by this stream (one shared checkout; the integrated app is run
afterwards).

## Rewritten (Seerr used as reference, attribution header kept)

| File | From Seerr | Notes |
|---|---|---|
| `Settings/SettingsLayout.tsx` | `SettingsLayout.tsx` | Grouped sidebar (`sh-admin`/`sh-snav`), `<select>` with optgroups below 980px, status dots from `settings/public.integrations`, MANAGE_SETTINGS guard |
| `Settings/SettingsMain.tsx` | `SettingsMain/index.tsx` | General page |
| `Settings/SettingsUsers.tsx` | `SettingsUsers/index.tsx` | Sign-in methods (≥ 1 rule), global limits, default permissions |
| `Settings/SettingsNetwork.tsx` | `SettingsNetwork/index.tsx` | Same semantics |
| `Settings/SettingsPlex.tsx`, `SettingsJellyfin.tsx` | same names | Connection, plex.tv presets, music libraries, scan panel, sign-in note; `isSetupSettings` |
| `Settings/SettingsLidarr.tsx`, `LidarrModal.tsx` | `SettingsServices.tsx`, `RadarrModal` | Server cards with live status; modal with Test-loads-profiles, metadata profile, hi-res |
| `Settings/SettingsNotifications.tsx` | `SettingsNotifications.tsx` + `Notifications/*` | One generic agent form driven by a field table instead of ten files |
| `Settings/SettingsLogs.tsx`, `SettingsJobsCache.tsx`, `SettingsAbout.tsx` | same names | |
| `Setup/index.tsx` | `Setup/index.tsx` | Three steps: create the owner → add your music → connect Lidarr |
| `RegionSelector`, `LanguageSelector` | same names | Static selects (the TMDB-backed `/regions` and `/languages` routes are gone) |

## New (no Seerr source)

`Settings/shared.tsx` (`useSection`, `SettingsPage`, `SecretInput`, `CopyRow`, `NumberInput`,
`ScanPanel`, `useConnectionTest`/`TestButton`/`ConnectionStatus`, `useRelativeTime`),
`Settings/MusicLibraries.tsx`, `SettingsNavidrome.tsx`, `SettingsLocal.tsx`,
`SettingsYoutube.tsx`, `SettingsClients.tsx`, `SettingsMetadata.tsx`, `SettingsDiscover.tsx`
(Spotify, Deezer, iTunes, Ticketmaster, Skiddle), `SettingsScrobbling.tsx`,
`Setup/LocalAdminSetup.tsx`.

## Dropped

`Settings/SonarrModal`, `Settings/OverrideRule/*` (backlog item 4), `SettingsBadge`,
`CopyButton`, `LibraryItem`, `SettingsAbout/Releases`, the ten `Notifications/*` files, and
`src/components/Selector` (TMDB company/genre/keyword selectors). Pages `settings/main` and
`settings/services` are replaced by `settings/general` and `settings/lidarr`.

## Routes

`/settings` → `/settings/general`; `general users network plex jellyfin navidrome local youtube
clients lidarr metadata spotify deezer itunes ticketmaster skiddle scrobbling logs jobs about`;
`/settings/notifications` → `/settings/notifications/email`; `/settings/notifications/[agent]`.

## Deviations from the mockup / spec

- **Secrets** use a local `SecretInput` (input + Show/Hide) instead of Seerr's
  `SensitiveInput`, whose two-element fragment doesn't fit the kit's `Field`. The masked value
  from GET is posted back unchanged, which the server reads as "keep the stored secret".
- **Emby** has no toggle: the Jellyfin page is titled "Emby" when the owner signed in with
  Emby (`mediaServerType`), as Seerr does.
- **Jellyfin connection** is hostname / port / SSL / URL base / API key (the server keeps
  Seerr's shape) rather than the mockup's single "Server URL"; external URL and forgot-password
  URL are kept from Seerr.
- **About → Getting help**: the mockup's "Documentation / GitHub discussions / Report a problem"
  links need a public repository, and none exists yet. The panel links to the built-in API
  reference and to the Lidarr and MusicBrainz docs instead. Swap in the repo links once it is
  public.
- **Job schedule editor** is a 6-field cron input with a live plain-words preview, not Seerr's
  interval pickers (the job list now has second-level and fixed schedules).
- **Pushover sound** is a text field; Seerr's sound list needs the unmasked token.
- **Lidarr** cards add a Remove button with a confirm dialog (the mockup only shows Test / Edit).
- **Test buttons** were added on YouTube, MusicBrainz, fanart.tv, Last.fm, Spotify, Deezer,
  iTunes, Ticketmaster, Skiddle and ListenBrainz, using the server's real test endpoints.
- **ListenBrainz trending** switch lives on the Scrobbling page and saves immediately
  (it belongs to the `discover` section).
- **Setup** steps are owner → music → Lidarr, with a local-admin path; steps 2 and 3 can be
  skipped.
- **Tested apps** (Symfonium, Finamp, Feishin, Amperfy, Jellify) are product documentation,
  listed in the page source; their "Ready" state follows the real API switches.

## Owner configuration surfaced by these pages

Application URL (General) drives the app endpoints and the Spotify redirect URL; MusicBrainz
contact (Metadata) is required for the public server.
