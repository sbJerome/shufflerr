# UI kit — what page agents compose

Everything here exists in the repo. Build pages from these; don't re-port mockup CSS.
Source of the visuals: `design/shufflerr-mockup.html` (its classes are ported 1:1 with an
`sh-` prefix in `src/styles/globals.css`).

## Ground rules

- **Never hardcode content.** Every list, count and image comes from the API. Empty → `EmptyState`.
- **Colors only through tokens.** Tailwind: `bg-bg bg-surface bg-raised bg-hover border-line
  border-line-2 text-ink text-muted text-faint text-accent text-link bg-accent text-on-accent
  bg-rail bg-slot text-st-available|partial|processing|pending|declined|none` (+ `brand-plex`,
  `brand-jellyfin`, `brand-spotify`, … for integration tiles only). CSS: `var(--bg)`,
  `var(--surface)`, `var(--accent)`, `var(--st-pending)`, … Don't use `text-white`, raw hex, or
  Tailwind `gray-*`/`indigo-*` in new code (they are remapped to tokens only so inherited Seerr
  components keep working).
- Dark is default; light is `<html data-theme="light">`. Both must work — tokens do that for you.
- Fonts: `font-sans` (IBM Plex Sans) and `font-mono` (JetBrains Mono — numbers, times, IDs,
  endpoints, log lines, the `$` command line).
- Radii: `rounded-ctl` 8px (buttons, inputs, covers), `rounded-pill` 12px, `rounded-panel` 14px,
  `rounded-hero` 16px.
- Breakpoints: `max-[760px]:` phone (rail becomes a top bar), `max-[980px]:` admin sidebar
  collapses. Tailwind screens `rail:` (≥761px) and `admin:` (≥981px) exist.
- Strings: `defineMessages('components.X', {...})` + `intl.formatMessage`. Sentence case, exact
  mockup copy.
- Any file you copy/adapt from Seerr starts with
  `// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.`

## Page layout

The shell (`src/components/Layout`) wraps every page except `/login`, `/logout`,
`/resetpassword`, `/setup`. A page renders **direct children of `<main class="sh-view">`**:
max-width 1400px, padding 32px (16px phone), 48px vertical gap between top-level children
(36px phone). So a page is just a fragment of sections:

```tsx
const Page = () => (
  <>
    <PageHeader title="Requests" description="…" actions={<Button>…</Button>} />
    <section>…</section>
    <HorizontalRow title="Recently added" sub="…" linkHref="/albums" linkText="See all">…</HorizontalRow>
  </>
);
```

- Section heading: `<div className="sh-sec-head"><div><h2 className="sh-h-section">Title</h2>
  <p className="sh-sub">caption</p></div><Link href>…</Link></div>` (or use `HorizontalRow`).
- Detail pages (artist/album): `sh-crumb`, `sh-detail` (`.art` 280px + `.info`), `sh-meta`,
  `sh-tags` + `sh-tag`, `sh-facts` (2×2 `dl`), `sh-two` (`.wide` + `.narrow`), `sh-kv` (`dl`).
- Discover: `sh-base-hero` (`.cmd`, `h1` with `<span>` accent line, `.blurb`, `sh-bh-copy`,
  `sh-bh-cta`, `sh-bh-stats` `dl`), featured band `sh-hero band` (`.photo`, `.scrim`, `.fade`,
  `.content`, `.kicker`, `h1`, `.by`, `p.blurb`, `.stats`).
- Don't set page titles by hand: `PageHeader` does it; elsewhere use `PageTitle`.

## Components

### Buttons — `@app/components/Common/Button`
Props (Seerr API kept): `buttonType?: 'default' | 'primary' | 'accent' | 'danger' | 'success' |
'warning' | 'ghost'`, `buttonSize?: 'default' | 'sm' | 'lg'`, `as?: 'a'`, plus native props.
`default`/`ghost` = outline, `primary` = accent fill, `accent` = accent outline (mockup
`ghost-accent`, used for "Request"), `success` = Approve (teal outline), `danger` = filled red.
46px tall (`sm` 40px).
```tsx
<Button buttonType="primary" onClick={save}>Save changes</Button>
<Button buttonType="accent" buttonSize="sm">Request</Button>
```
Raw classes when you need a link styled as a button: `sh-btn`, modifiers `primary small
ghost-accent ok no danger`. Icon-only: `<button className="sh-icon-btn" aria-label="…">` (44px).
`ConfirmButton` (two-click danger) and `ButtonWithDropdown`, `Dropdown` keep Seerr's API.

### Modal — `@app/components/Common/Modal`
Seerr props kept: `title`, `subTitle`, `onCancel`, `onOk`, `okText`, `cancelText`, `okDisabled`,
`okButtonType`, `onSecondary`/`secondaryText`, `onTertiary`/`tertiaryText`, `loading`,
`backgroundClickable`, `dialogClass`. Renders the mockup dialog (header + close, `.body` with
22px gap, right-aligned footer: Cancel … OK). Traps focus, closes on Esc and backdrop, restores
focus. Render it conditionally (`{open && <Modal …/>}`); wrapping in headless `Transition` still
works.
```tsx
{open && (
  <Modal title="Delete Maya?" okText="Delete user" okButtonType="danger"
         onOk={remove} onCancel={() => setOpen(false)}>
    <p>This removes Maya's account and all 4 of their requests. Music already in the library stays.</p>
  </Modal>
)}
```
Inside a dialog body: radio cards `<label className="sh-opt"><input type="radio"/><span
className="grow"><b>…</b><small>…</small></span></label>` inside a `<fieldset><legend>`;
checkbox rows `<label className="sh-check"><input type="checkbox"/> …</label>`; outcome box
`<div className="sh-outcome auto|wait|block" role="status">`.
`SlideOver` (`show`, `title`, `subText`, `onClose`) is restyled, same API.

### PageHeader — `@app/components/Common/PageHeader`
`title` (H1 + document title), `description?`, `actions?`, `documentTitle?`.

### Panel — `@app/components/Common/Panel`
Settings card. `title?`, `sub?`, `actions?` (right-aligned row at the bottom), `as?:
'section' | 'form' | 'div'`, `onSubmit?`, native attrs. Stack panels in
`<div className="sh-stack">`.
```tsx
<Panel as="form" title="Server" sub="…" onSubmit={submit}
       actions={<Button buttonType="primary" type="submit">Save changes</Button>}>
  <div className="sh-fields">…Field…</div>
  <div className="sh-box">…SwitchRow…</div>
</Panel>
```

### Field — `@app/components/Common/Field`
`label`, `hint?`, `error?`, `full?` (span the grid), `required?`, children = control or render
function receiving `{id, 'aria-describedby', 'aria-invalid'}`. Put fields in
`<div className="sh-fields">` (auto-fit grid, 240px min).
```tsx
<Field label="Application URL" hint="The address people use to reach Shufflerr." error={errors.url}>
  {(p) => <input {...p} type="text" value={url} onChange={…} />}
</Field>
```
Works with Formik's `<Field {...p} name="…" />` too. Plain `input/select/textarea` are globally
styled (46px, 8px radius). Secrets: `SensitiveInput` (Seerr API). Copy row:
`<div className="sh-copyrow"><input readOnly/><Button>Copy</Button></div>`. Mono endpoint row:
`<div className="sh-endpoint">`.

### SwitchRow / Switch — `@app/components/Common/SwitchRow`
`<SwitchRow label description? checked onChange disabled? />` — row for a bordered box
(`<div className="sh-box">` with several rows). `import { Switch }` for a bare switch
(needs `aria-label`). Real button with `aria-pressed`. (`SlideCheckbox` now renders the same.)

### FilterChips — `@app/components/Common/FilterChips`
`chips: {value, label, count?}[]`, `value`, `onChange`, `aria-label`.
```tsx
<FilterChips aria-label="Filter requests" value={filter} onChange={setFilter}
  chips={[{ value: 'all', label: 'All', count: 12 }, { value: 'pending', label: 'Waiting', count: 3 }]} />
```

### Status — `@app/components/StatusBadge`, `@app/components/Common/StatusDot`, `@app/utils/status`
`<StatusBadge status={media.status} />` (MediaStatus) or `<StatusBadge requestStatus={r.status} />`
(MediaRequestStatus) → dot + fixed label. `variant="badge"` is the pill on covers (CoverArt adds
it for you). `label` overrides the text, `tone` the color. `<StatusDot tone="available">Connected
</StatusDot>` for free-form states. Helpers: `mediaStatusInfo(status)`,
`requestStatusInfo(status)` → `{tone, message}`; `statusMessages` (inlibrary, missing,
connected, …); `toneColor(tone)`. Admin on/off badges: `sh-badge-on` / `sh-badge-off` spans.
Roles: `<RoleBadge user={user} />` (`@app/components/Common/RoleBadge`) → Owner / Admin / User.

### CoverArt — `@app/components/CoverArt`
`src?` (same-origin URL), `mbid?` (tint key), `title?`, `round?`, `thumb?` (48px), `status?`
(badge), `showInitials?`, `decorative?`, `className?`. Shows the tinted slot until/unless the
image loads. Size it with a wrapper width (it is `aspect-ratio: 1`).
```tsx
<CoverArt src={coverUrl(album.mbid, 500)} mbid={album.mbid} title={album.title} status={album.status} />
<CoverArt thumb decorative src={coverUrl(mbid)} mbid={mbid} />
```

### AlbumCard / ArtistCard — `@app/components/AlbumCard`, `@app/components/ArtistCard`
`<AlbumCard mbid title artistName? year? status? imageSrc? href? action? meta? />` — links to
`/album/<mbid>`, cover from Cover Art Archive by default, `action` = e.g. a small Request button.
`<ArtistCard mbid name imageSrc? meta? href? />` — round, links to `/artist/<mbid>`.

### HorizontalRow — `@app/components/HorizontalRow`
`title`, `sub?`, `linkHref?`, `linkText?`, `children` (cards), `empty?` (shown when no children;
without it the whole row hides), `grid?` (wrapping grid instead of scroll row).
Raw classes: `sh-row` (scroll-snap, columns `minmax(176px,212px)`), `sh-grid` (auto-fill 176px).

### Lists and tables
- Bordered list: `<div className="sh-box"><ul className="sh-list"><li>…<div className="grow">…
  </div><span className="who">…</span></li></ul></div>`.
- Grid table (requests, users, tracklist, discography): wrap `<div className="sh-box
  sh-scroll-x"><div className="sh-table" role="table">`; rows `<div className="sh-tr" role="row"
  style={{gridTemplateColumns: '48px 2fr 1fr …'}}>`; header row adds `head`; cells get
  `role="cell"`/`columnheader`; helpers `.num` (mono), `.dim`, `.actions`, `sh-title`, `sh-feat`,
  row modifiers `missing`, `sel`.
- Seerr's `Table` (`Table.TH/TBody/TD`) and `List` are restyled and fine for simple admin tables.

### Other primitives (all `@app/components/Common/<Name>`)
- `EmptyState` — `title`, children (next step), `action?`.
- `ProgressBar` — `value` 0–100, `label` (a11y), `tone?`.
- `QuotaRing` (default export) — `used`, `limit?`, `label`; `import { LimitMeter }` — dashed box
  with usage bar: `<LimitMeter used={3} limit={10}>3 of 10 albums used this week</LimitMeter>`.
- `Avatar` — `name`, `src` (`user.avatar`), `size?: 'sm' | 'lg'`.
- `Alert` (`title`, `type: 'warning' | 'info' | 'error'`), `Badge`, `Tooltip`, `LoadingSpinner`,
  `SettingsTabs` (`tabType="default"` = underline tabs `sh-tabs-h`, `"button"` = pills
  `sh-subnav-pills`; needs `settingsRoutes`), `Accordion`, `SensitiveInput` — Seerr APIs.
- Profile bits: `sh-uhead` header card, `sh-stats3` + `sh-stat` cards, `sh-linked` rows,
  `sh-perm` permission tree (`label.child` for children), `sh-credit` footer line.
- Admin bits: `sh-admin` (250px sidebar grid) + `sh-snav` (`h3` group labels, links with
  `aria-current="page"`, `.dot`/`.dot.off`) + `sh-snav-select`; `sh-int-grid` + `sh-int` cards
  with `sh-logo` two-letter tile (set `style={{background: brand}}`); `sh-server` cards; `sh-kvs`
  stat grid; log level pill `sh-lvl debug|info|warn|error`; `sh-mono-s`; `sh-running`;
  `sh-toolbar`; `sh-events` + `sh-date` (concerts); `sh-choice` radio cards; `sh-save-bar`.

## Toasts — `@app/hooks/useToasts`
Bottom-center above the player, `aria-live="polite"`.
```tsx
const { addToast } = useToasts();
addToast('Requested CTRL ESCAPE. It’s waiting for an admin to approve it.', { appearance: 'success' });
addToast('That email address is already used.', { appearance: 'error' }); // red
```

## Player — `@app/hooks/usePlayer`
```tsx
const { playTracks, enqueue, current, playing, toggle } = usePlayer();
playTracks(tracks, startIndex);
```
`PlayableTrack`: `{ id (Track id; 0 for YouTube-only), title, artist, album?, albumMbid?,
artistMbid?, recordingMbid?, durationMs?, peaks?, streamUrl?, source?: 'local' | 'plex' |
'jellyfin' | 'navidrome' | 'youtube', youtubeVideoId? }`. Audio comes from
`/api/v1/stream/track/<id>` (or `streamUrl`); peaks are fetched from
`/api/v1/stream/track/<id>/peaks` when not passed. A track with `youtubeVideoId` plays in
YouTube's own visible IFrame player docked above the bar (get the id from
`GET /api/v1/youtube/track/<recordingMbid>`). The player reports plays itself
(`POST /api/v1/scrobble/now-playing`, `POST /api/v1/scrobble`). Only usable inside the shell.

## Images — `@app/utils/images`
`coverUrl(releaseGroupMbid, 250 | 500 | 1200)` → `/imageproxy/caa/release-group/<mbid>/front-<n>`.
`proxied(url)` → rewrites known third-party hosts (CAA, archive.org, fanart.tv, Last.fm, Spotify,
Deezer, iTunes, Ticketmaster, Skiddle, YouTube thumbs) to `/imageproxy/<type>/…`; relative URLs
pass through; unknown hosts → `undefined` (slot stays). `avatarUrl(user.avatar)`.
Never put a third-party image URL in `src` directly.

## Formatting — `@app/utils/format`
`formatDuration(ms)` → `3:23`; `formatSeconds(s)`; `initials(name)`; `tintFor(mbid)` →
`[bg, ink]`; `releaseYear(date)`.

## Hooks and context
- `useUser()` → `{ user, hasPermission, revalidate }`; `Permission` re-exported from
  `@app/hooks/useUser`. `useRouteGuard(Permission.MANAGE_USERS)` at the top of gated pages.
- `useSettings()` → `currentSettings` (`PublicSettingsResponse`: `integrations.*`,
  `importEnabled`, `concertsEnabled`, `allowTrackRequests`, …).
- `loginMethods(settings)`, `importEnabled(settings)` in `@app/utils/publicSettings`.
- `useTheme()` → `{ theme, setTheme, toggleTheme }`.
- `useScrobbleTargets()` → `['ListenBrainz', 'Last.fm']` for the signed-in user.
- `accountTypeMessage(userType)` in `@app/components/Layout/AccountMenu` → "Plex user" etc.

## Shell routes (the rail links to these — they must exist)
`/discover` (and `/` → discover), `/search?query=`, `/artists`, `/albums`, `/requests`
(`?filter=pending` from the top-bar pill), `/import`, `/users`, `/settings`, `/profile`,
`/profile/requests`, `/profile/settings`.

## Accessibility checklist for pages
Real `<button>`/`<a>`/`<label>`; every icon-only control has `aria-label`; 44px targets (the
classes above already are); status = dot + text; tables have header rows; one H1 per page;
dialogs via `Modal`; no motion beyond what the kit ships.

## i18n gotchas (important)
- **One `defineMessages` call per file, with a namespace unique to that file**
  (`components.Login.LocalLogin`, not `components.Login`). The extractor only reads the first
  call in a file, and two files sharing a namespace overwrite each other's keys.
- The app renders strings from `src/i18n/locale/en.json`, not from `defaultMessage`. After adding
  or changing messages run `pnpm i18n:extract` or you will see stale Seerr copy.
