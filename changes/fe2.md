# FE2 — browse and request pages

Phase 6 pages built on FE1's kit (`docs/UI_KIT.md`) against `docs/API_CONTRACT.md`.
Nothing here holds sample data: every list, count and image comes from the API, and each
screen has loading, empty and error states.

## Screens

| Route | Component | Notes |
|---|---|---|
| `/`, `/discover` | `Discover`, `Discover/FeaturedRelease` | Hero with live stats; featured band hidden when `/discover/featured` returns `album: null`; rows hide when `enabled` is false or empty |
| `/search?query=&type=` | `Search`, `Search/TrackResults` | Chips with counts from the `type=all` query; per-type tabs page with "Show more" |
| `/artist/[mbid]` | `ArtistDetails`, `ArtistDetails/Discography` | Facts, about, details, discography with type chips, similar, links, Manage |
| `/album/[mbid]` | `AlbumDetails`, `AlbumDetails/Tracklist` | Status banner, progress, tracklist (multi-disc headers), Report a problem, Manage |
| `/artists`, `/albums` | `Library/Artists`, `Library/Albums` | Paged grids; sort, filter and text filter kept in the URL |
| `/requests?filter=&sort=&page=` | `RequestList`, `RequestList/RequestItem` | Chips with counts, approve / decline (optional note) / cancel / retry / play, progress, 10 s refresh while anything downloads |
| `/import?job=` | `Import`, `Import/MatchList` | Link → albums → request checked; Spotify saved albums; recent links |
| 404, error | `pages/404.tsx`, `pages/_error.tsx` | Shufflerr copy |

Shared pieces: `RequestModal` (the release request dialog with live dry-run outcome, track
picker and advanced selects), `RequestButton` (opens it; hides without any request permission),
`RequestModal/subject.ts`, `Playback` (`usePlayback`: play album, play track, YouTube fallback),
`RequestList/requestText.ts` (titles, type labels, relative time), `RequestCard`,
`RequestBlock`, `DownloadBlock`.

## Kept / adapted / rewritten / dropped

- **Adapted (Seerr header added):** `RequestModal/index.tsx` (from `TvRequestModal`: season
  picker → scope radio cards + track picker), `RequestButton`, `RequestList`,
  `RequestList/RequestItem`, `RequestCard`, `RequestBlock`, `DownloadBlock`, `Search`,
  `Discover`, `pages/404.tsx`, `pages/_error.tsx`.
- **Rewritten (no Seerr source):** `ArtistDetails`, `AlbumDetails`, `Library/*`, `Import/*`,
  `Playback`, `Discover/FeaturedRelease`, `Search/TrackResults`.
- **Dropped:** `Slider`, `MediaSlider`, `TitleCard` (+ `TmdbTitleCard`, `ErrorCard`,
  `Placeholder`), `Discover/{CreateSlider,DiscoverSliderEdit,FilterSlideover,
  RecentlyAddedSlider,RecentRequestsSlider,Trending,constants}`,
  `RequestModal/{MovieRequestModal,TvRequestModal,CollectionRequestModal,AdvancedRequester,
  QuotaDisplay,SearchByNameModal}`, `pages/discover/trending.tsx`. `HorizontalRow`,
  `AlbumCard` and `ArtistCard` replace the sliders and title cards. The Discover row editor
  (`DiscoverSlider` admin UI) is a backlog item and has no UI.

## Deviations from the mockup

- Row captions that stated something the server can't guarantee were reworded:
  "Imported from Lidarr this week" → "The newest albums in your library"; "Popular on
  ListenBrainz in the last 7 days" → "New releases people are listening to this week" (the row
  may come from ListenBrainz or the iTunes chart); "Most requested on this server" → "Most
  played and requested on this server".
- The request dialog only offers "Everything by <artist>" to people who may request
  discographies, and "Only the missing tracks" only when track requests are on and tracks are
  missing. The mockup always shows all three.
- The request dialog has a track picker under "Only the missing tracks" (all missing tracks
  checked by default) and a "Watch for new releases from <artist>" checkbox on the discography
  scope (`monitorFuture` in DATA_MODEL). Neither is in the mockup.
- Declining a request opens a small dialog with an optional note (`declineReason`); the mockup
  declines in one click.
- The Requests page has a sort select and paging, and the Downloading chip filters on
  `approved`. The mockup shows one unpaged list.
- Tracks without a file get a "YouTube" button only while the YouTube integration is on; it
  plays in YouTube's own player. The mockup has no control on missing tracks.
- Artist and Album pages have a "Manage" button for request managers and a Links row built
  from `links`. The mockup has "Open in Plex" only.
- The search top-result card and artist rows show MusicBrainz's disambiguation, type and
  area — the mockup's "Featured on …" lines were invented sample copy.
- Album cards in rows have no "Cover art" caption (real art, or the tinted slot).

## Contract gaps

- **Watch for new releases (artist page).** `ArtistDetails.lidarr.monitorNewItems` is
  read-only in the contract and no route changes it. The button calls
  `POST /api/v1/artist/:mbid/watch { enabled: boolean }` (managers only, shown when the artist
  is in Lidarr). That route does not exist yet — it needs adding (SV1 route, SV2 Lidarr call),
  or the button removed.
- `RequestCountResponse` has both `approved` and `processing`; the Downloading chip uses
  `approved` to match the list filter it applies.
- The discography option's "N releases" line needs a count before a request exists; it comes
  from the dry run's `releaseCount` and falls back to a line without a number.

## Owner configuration

None. Import shows whichever of Spotify, Deezer and iTunes are turned on in Settings.
