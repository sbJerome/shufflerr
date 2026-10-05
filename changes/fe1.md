# FE1 — UI foundation (tokens, primitives, shell, player, auth pages)

Guide for page agents: `docs/UI_KIT.md`.

## Kept (Seerr, restyled through tokens only)

`Common/{Accordion, ButtonWithDropdown, ConfirmButton, LabeledCheckbox, LoadingSpinner,
MultiRangeSlider, PageTitle, PlayButton, ProgressCircle, QuickConnectModal, SensitiveInput,
StatusBadgeMini, Tag, Tooltip}`, `LoadingBar`, `Layout/UserWarnings`, `Login/AddEmailModal`,
`Login/JellyfinQuickConnectModal`, `Setup/JellyfinSetup`, hooks (`useUser`, `useSettings`,
`usePlexLogin`, `useQuickConnect`, `useRouteGuard`, `useToasts`, …), `utils/plex.ts`.
They pick up the Shufflerr look because Tailwind's `gray`/`indigo` scales are remapped to the
design tokens in `tailwind.config.js`.

## Adapted (attribution header added)

- `tailwind.config.js`, `src/styles/globals.css` — tokens (dark default, light via
  `data-theme`), fonts, scrollbars, focus ring, reduced motion; mockup component CSS ported 1:1
  with an `sh-` prefix; legacy Seerr form classes kept and re-tokenised.
- `Common/{Button, Modal, SlideOver, Table, Badge, Alert, Dropdown, Header, List, SettingsTabs,
  CachedImage, SlideCheckbox}` — same props, new look. Modal gained focus trap, Esc, close button.
  Button gained `buttonType="accent"`. CachedImage `type` is now `cover | artist | avatar`.
- `Layout/index.tsx` — replaced sidebar/mobile menu with the icon rail + top bar + player.
- `Toast`, `StatusBadge` (now music labels: `status` / `requestStatus`), `PWAHeader`.
- `Login/*` (two-panel card, Plex PIN button, Jellyfin/Emby dialog with Quick Connect, local
  form), `ResetPassword/*`, `Setup/*` (same 4 steps on the auth shell), `_app.tsx`,
  `_document.tsx`, `SettingsContext`, `UserContext`, `useUser` (`/logout` is a public route).

## New (no Seerr source)

`Layout/{Rail, TopBar, AccountMenu}`, `Player/{index, Waveform}`, `context/PlayerContext`,
`hooks/{usePlayer, useTheme, useScrobbleTargets}`, `CoverArt`, `AlbumCard`, `ArtistCard`,
`HorizontalRow`, `Common/{Panel, SwitchRow, Field, FilterChips, EmptyState, ProgressBar,
QuotaRing, PageHeader, Avatar, StatusDot, RoleBadge}`, `Login/AuthShell` (slideshow),
`pages/logout.tsx`, `utils/{images, format, status, publicSettings}`.

## Dropped

`Layout/{Sidebar, MobileMenu, SearchInput, UserDropdown, PullToRefresh, Notifications,
VersionStatus, LanguagePicker}`, `Common/{ImageFader, ListView}`, `hooks/{useDiscover,
useRequestOverride, useSearchInput}`, `utils/creditHelpers`, `utils/refreshIntervalHelper.test`
(movie/TV only). `@fontsource-variable/inter` is no longer imported (dependency can be removed).

## Deviations from the mockup

- Plex button text is dark (`#1B1405`) as docs/FRONTEND.md specifies; the mockup's cascade
  rendered it white on orange (2.2:1 contrast).
- Login slideshow tiles are real covers only — no titles, no placeholder tiles. With an empty
  library the background is plain dark and the footer drops the "Background shows album art"
  clause.
- "Demo:" hint under the local form is not built (mockup-only).
- Auth screens stay dark under the light theme (the mockup hardcodes dark there too).
- The pending pill is hidden at 0 instead of showing "0 waiting for approval".
- Player with nothing queued shows "Nothing playing. Pick a track from your library to start."
  (the mockup always had a sample track). Prev/next/play are disabled then.
- Waveform is a `role="slider"` (arrow keys seek) rather than a plain button.
- Language picker removed from the auth screens (mockup has none); language is set in user
  settings.
- Toasts keep a dismiss button (Seerr behavior) in addition to auto-dismiss.
- Phone top bar: search, theme and account stay on one row (the `/` hint is hidden).
- Setup has no "create local admin" path: the API contract has no endpoint for it; the first
  Plex/Jellyfin/Emby sign-in becomes the owner (Seerr behavior).

## TODO / for other streams

- Run `pnpm i18n:extract` after adding messages; other locale files still carry Seerr strings
  for reused ids.
- `src/pages/404.tsx` and `_error.tsx` still have Seerr copy ("Page Not Found", "Return Home").
- `/setup` could not be rendered yet: it imports the old Seerr `Settings/SettingsPlex`,
  `SettingsJellyfin` and `SettingsServices`, which don't compile until the admin stream adapts
  them.
