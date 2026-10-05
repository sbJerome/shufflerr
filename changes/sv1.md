# SV1 — metadata and browse (BUILD_PLAN Phase 2)

## Rewritten (new code, no Seerr source)

- `server/api/musicbrainz/` — client on `ExternalAPI`: search (artist / release group /
  recording, Lucene-escaped), lookups with `inc`, browse release groups by artist with type
  filter and paging, release lookup for tracklists, raw Lucene searches for the import matcher
  (`searchReleaseGroupsRaw`, `searchReleasesRaw`, `searchRecordingsRaw`).
  One process-wide token bucket (`rateLimiter.ts`) fed by
  `metadata.musicbrainz.requestsPerSecond`; `User-Agent: Shufflerr/<version> ( <contact> )`;
  503/429 → back off and retry up to 3 times; mirror URL from settings; lookups cached 24 h,
  searches 1 h; identical simultaneous requests share one call.
- `server/api/coverartarchive.ts` — image-proxy path builders only (the browser never gets a
  CAA URL); returns null when Cover Art Archive is off.
- `server/api/fanart.ts` — artist thumb / background / logo by MBID as image-proxy paths.
- `server/api/lastfm.ts` — `artist.getInfo`, `artist.getSimilar`, `album.getInfo`,
  `tag.getTopAlbums`, plus the signed side for SV4/SV6: `getAuthUrl`, `sign`, `signedCall`,
  `getSession`, `updateNowPlaying`, `scrobble` (≤ 50 per call).
- `server/api/listenbrainz.ts` — sitewide artists / release groups, fresh releases (cached as a
  compact index), `validateToken`, `submitListens` / `submitPlayingNow` / `submitPlays`.
- `server/lib/metadata/` — `ensureMedia`, `syncTracklist`, `getDiscographyReleaseGroups`,
  `coverUrlFor`, `pickCanonicalRelease`, `flattenRelease`, `isMbid`; `details.ts` (album,
  artist, recording pages); `library.ts` (merging library status / requests into results);
  `mappers.ts`; `errors.ts`.
- `server/lib/search.ts` — unified search with library status merged in.
- Routes: `search`, `artist`, `release` (`/album`), `recording`, `discover`, `library`,
  `public` (slideshow).

## Adapted from Seerr

- `server/routes/media.ts` (list / get / set status / clear).

## Decisions

- **Canonical release:** preferred release (when it belongs to the group) → official only →
  earliest → digital → worldwide / home country / most common country → most tracks → MBID.
  Once picked, a release group keeps its release so Track ids stay stable; pass
  `preferReleaseMbid` (e.g. the release Lidarr has) to switch.
- **Re-syncing a tracklist never loses library data.** Existing rows are matched by recording
  MBID, then position + title, then title + length (±3 s). Unmatched rows that hold a library
  file or belong to a request are kept as extras (`discNumber 0`, position `x-NN`) and do not
  count towards `trackCount`; other unmatched rows are removed.
- **Search:** albums and tracks match every word across title and artist (MusicBrainz searches
  one field by default). When the words are exactly an artist's name, the album bucket lists
  that artist's own releases, studio albums first.
- **Artist library status** is derived from release groups in the library (`artistMbid`), so it
  does not depend on a scanner writing artist rows.
- **Discography filter** (`getDiscographyReleaseGroups`): primary type Album with no secondary
  types — Lidarr's "Standard" metadata profile. TODO(decision): read the real metadata profile
  of the target Lidarr server instead.
- **Trending** = release groups ListenBrainz users played most this week, those released in the
  last 60 days first. ListenBrainz's fresh-releases endpoint cannot sort by listens and its
  listen counts are zero, so on its own it is not a trending list.
- **Popular artists** = ListenBrainz sitewide artists when ListenBrainz trending is on,
  otherwise library artists ranked by plays (90 days), requests and albums held.
- **Slideshow** returns cover URLs only (no titles) — the privacy-friendly option in AUTH.md.
- **Request visibility:** viewers without REQUEST_VIEW / MANAGE_REQUESTS see that an album is
  requested but not by whom.

## Owner configuration

- Settings → MusicBrainz and Last.fm → **Contact**: set an email or URL; MusicBrainz asks for
  one in the User-Agent (falls back to the application URL).
- fanart.tv API key for artist photos; without it artists show initials.
- Last.fm API key (+ shared secret for scrobbling) for bios, tags and similar artists.
- ListenBrainz trending switch for the Trending and Popular rows (no key needed).

## Tests

63 tests in `server/api/musicbrainz/musicbrainz.test.ts`, `server/api/metadataClients.test.ts`,
`server/lib/metadata/metadata.test.ts`, `server/lib/metadata/library.test.ts`. Fixtures under
`server/test/fixtures/{musicbrainz,listenbrainz,coverartarchive}` are recorded responses;
`lastfm/` and `fanart/` are hand-written from the documented shapes (no keys were available).
`server/test/fixtureAdapter.ts` is a small shared helper for serving fixtures to any client.
