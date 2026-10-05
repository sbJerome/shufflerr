# FE5 — issues, manage panel, blocklist, platform leftovers

## Adapted from Seerr (rewritten on the UI kit, attribution header added)
- `IssueModal` (+ `CreateIssueModal`, `constants`): "Report a problem" dialog. Props
  `{ mediaType, mbid, show, onClose }`. Music issue types; per-track checklist for bad tags /
  missing tracks / low quality (missing tracks pre-checks tracks not in the library).
- `IssueList` + `IssueItem` (`/issues`): open / resolved / all chips with counts, sort, paging.
- `IssueDetails` + `IssueComment` + `IssueDescription` (`/issues/[issueId]`): comment thread,
  edit/delete own comments, resolve / reopen (optionally with a comment), delete.
- `IssueBlock`: compact `<li>` row used in the manage panel.
- `ManageSlideOver`: props `{ mediaType, mbid, show, onClose }`. Requests with approve/decline,
  open issues, library data (mark available, clear data), blocklist, "Open in" links.
- `Blocklist` (`/blocklist`), `BlocklistModal`, `BlocklistBlock`: MBID-based.
- `ExternalLinkBlock`: now takes the API's `ExternalLink[]` (`only` filters/orders types).
- `StatusChecker`, `AppDataWarning`: reworded. `ServiceWorkerSetup`: guards browsers without
  the Notification API.
- `public/sw.js`: absolute icon paths, default notification title "Shufflerr".
  `public/offline.html`: rewritten in Shufflerr's look.

## Dropped
- Seerr's blocklisted-tags filter on the blocklist page and the Tautulli/watch-data,
  4K and "remove from Radarr/Sonarr" parts of the manage panel (no music equivalent in the API).

## Decisions
- Per-item issues in the manage panel are filtered client-side from the first 100 open issues,
  because `GET /issue` has no media filter.
- Issue counts on `/issues` are only shown to people with MANAGE_ISSUES / VIEW_ISSUES: the count
  route is server-wide.
- No "Remove from Lidarr" button: the contract has no route for it.

## Not verified
- Nothing was run in a browser (dev servers are off-limits while streams share the tree).
  Typecheck, eslint and prettier are clean for these files.
