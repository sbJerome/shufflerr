# CLAUDE.md — Shufflerr

You are building **Shufflerr**, a music request manager, by converting a fork of **Seerr**.
Start every session by reading `HANDOFF.md`, then the `docs/` file for the current phase in
`docs/BUILD_PLAN.md`. The approved UI is `design/shufflerr-mockup.html` — open it, click
through it, match it.

## Ground rules

1. **Match the mockup.** Layout, copy, states, and behavior in `design/shufflerr-mockup.html`
   and `design/screens/` are the spec. If something in the mockup is impossible or wrong,
   note it in `CHANGES.md` under "Deviations from mockup" with the reason; don't silently
   redesign.
2. **Reuse Seerr before writing new code.** Check `docs/REUSE_MAP.md`. Prefer adapting a Seerr
   module over writing a parallel one. Keep Seerr's patterns (TypeORM entities + subscribers,
   Express routers under `server/routes`, settings via `getSettings()`, SWR on the client,
   `defineMessages` for strings).
3. **Keep the build green.** After each phase: `pnpm lint`, `pnpm typecheck` (or `tsc --noEmit`),
   `pnpm test`, `pnpm build` all pass. Commit at the end of each phase with a message
   `phase N: <summary>`.
4. **No live third-party calls in tests.** Use recorded fixtures under `server/test/fixtures/`.
5. **Don't invent product decisions.** Open questions are listed in `HANDOFF.md` §6. If you hit
   one, implement the conservative option, leave a `// TODO(decision):` comment, and list it in
   `CHANGES.md`.
6. **Write `CHANGES.md`** as you go: per phase, what was kept / adapted / rewritten / dropped,
   deviations from the mockup, TODOs, and anything the owner must configure.

## Stack (keep Seerr's)

Next.js + React 19 (front end), Express 5 (API, under `/api/v1`), TypeORM 0.3 with SQLite by
default and PostgreSQL supported, Tailwind 3, SWR, react-intl, pnpm, Docker. Node version per
the fork's `.nvmrc` / `package.json` engines.

## Domain vocabulary

- Album = MusicBrainz **release group**. Track = **recording**. Artist = **artist**.
- Request scope: `tracks` | `album` | `discography`.
- Statuses: see `starter/server/constants/media.ts` (numerically identical to Seerr).
- UI labels are fixed: "Waiting for approval", "Approved, downloading", "Declined", "Failed",
  "Available", "Partly available", "Not in library".

## Permissions & approvals

Use `starter/server/lib/permissions.ts` as the new `server/lib/permissions.ts`. The request
engine must follow `docs/PERMISSIONS_AND_APPROVALS.md` exactly — same order of checks as
Seerr's `MediaRequest.request()`, same error classes (`RequestPermissionError`,
`QuotaRestrictedError`, `DuplicateMediaRequestError`).

## Front-end conventions

- Design tokens and component rules: `docs/FRONTEND.md`. Put tokens in `tailwind.config.js`
  and CSS variables; support dark (default) and light.
- Fonts: IBM Plex Sans + JetBrains Mono (self-host via `next/font` or bundle; don't hotlink in
  production).
- Reuse `src/components/Common/*` (Modal, SlideOver, Table, Button, Badge, SettingsTabs,
  SensitiveInput, …), restyled. Don't add a second component library.
- Copy: sentence case, plain verbs, no "Submit", errors say what happened and how to fix it.
- Accessibility: real `<button>`/`<a>`/`<label>`, 44px touch targets, visible focus,
  4.5:1 contrast, status always has a text label, respect `prefers-reduced-motion`.

## Integrations

Every external service has a section in `docs/INTEGRATIONS.md` with endpoints, auth, rate
limits and terms to respect. Rules that always apply:
- All HTTP clients extend Seerr's `ExternalAPI` (axios + node-cache) and use the cache manager.
- MusicBrainz: ≤1 req/s on the public server, `User-Agent: Shufflerr/<version> ( <contact> )`.
- Images only through the image proxy (`/imageproxy/...`), with allow-listed hosts.
- YouTube: IFrame Player API only. Never download from YouTube.
- Secrets live in settings, are masked in the UI (`SensitiveInput`), and never logged.

## Attribution (MIT compliance — required)

1. Keep `LICENSES/seerr-MIT.txt` (verbatim Seerr license) and `NOTICE.md` in the repo and in
   every distributed artifact (Docker image: copy to `/app/LICENSES` and `/app/NOTICE.md`).
2. Root `LICENSE`: MIT, with both lines:
   `Copyright (c) 2020 sct` and `Copyright (c) <year> <Shufflerr owner>`.
3. Every file copied or adapted from Seerr starts with:
   ```ts
   // Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
   // Original: <original path> at commit 2cfbcf8940225f1597d44f507fd78040887c5597
   ```
   (Omit the second line if the path is unchanged.) Untouched files inherited from the fork
   are covered by `NOTICE.md` and the license; the header is required when you modify one.
4. Keep `docs/REUSE_MAP.md` and `NOTICE.md` in sync with what you actually reuse.
5. README "Acknowledgements" and the in-app About page credit Seerr (and Overseerr/Jellyseerr).
6. Do not use Seerr's name, logo, or screenshots as Shufflerr branding. Remove `public/` Seerr
   assets in phase 0.
7. The Rekord HTML template was **design inspiration only**. Do not copy any of its code,
   CSS, fonts, icons or images.

## Definition of done (MVP = phases 0–6)

`docker compose up` → setup → sign in with Plex → search "john summit" → open CTRL ESCAPE →
request missing tracks → (as admin) approve → Lidarr receives it → after the media server scan
the album shows Available → requester gets a notification. Tests, lint, typecheck, build pass.
