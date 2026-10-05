<p align="center">
<img src="./public/logo_full.svg" alt="Shufflerr" width="360" style="margin: 20px 0;">
</p>

# Shufflerr

Shufflerr is a self-hosted request and discovery manager for music. People search for artists,
albums and tracks, request what's missing, admins approve (or permissions approve it
automatically), Lidarr downloads it, and your media server — Plex, Jellyfin, Navidrome or plain
folders — marks it available.

- **Requests** for missing tracks, whole albums or full discographies, with per-user limits and
  auto-approval rules.
- **Metadata** from MusicBrainz, the Cover Art Archive, fanart.tv and Last.fm.
- **Sign-in** with Plex, Jellyfin or a local account.
- **Library** scanning for Plex, Jellyfin, Navidrome and local folders, with a built-in player.
- **Notifications** by email, web push, Discord, Slack, Telegram, Pushbullet, Pushover, webhook,
  Gotify and ntfy.

> Status: under construction (v0.1.0). See [CHANGES.md](CHANGES.md) for what is built so far
> and [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) for the plan.

## Quick start

### Docker

```bash
docker compose up -d          # SQLite; data in ./config
# or
docker compose -f compose.postgres.yaml up -d
```

Open <http://localhost:5055>, sign in (the first account becomes the owner) and add your Lidarr
server and library sources under Settings. To index and play local music, mount it read-only
(see the commented volume in `compose.yaml`) and add the folder under Settings → Local files.

### From source

Requires Node 22 and pnpm 10.

```bash
pnpm install
pnpm dev            # http://localhost:5055
pnpm build && pnpm start
```

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `5055` / all | Listen address |
| `CONFIG_DIRECTORY` | `./config` | Settings, database, logs and image cache |
| `LOG_LEVEL` | `debug` | `debug`, `info`, `warn`, `error` |
| `TZ` | system | Time zone for schedules and logs |
| `API_KEY` | generated | Fix the API key instead of generating one |
| `DB_TYPE` | `sqlite` | `postgres` to use PostgreSQL (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME`, `DB_USE_SSL`, …) |

`config/settings.json` holds API keys and the server secret; it is written with mode `0600`.

## Development

```bash
pnpm lint
pnpm typecheck
pnpm test           # unit tests (no network access)
pnpm build
```

- [HANDOFF.md](HANDOFF.md) — product brief and decisions
- [docs/API_CONTRACT.md](docs/API_CONTRACT.md) — every HTTP route and its types
- [docs/](docs) — data model, permissions, auth, integrations, front end, admin pages
- [CHANGELOG.md](CHANGELOG.md) · [RELEASELOG.md](RELEASELOG.md) · [CHANGES.md](CHANGES.md)

## Acknowledgements

Shufflerr is built on the platform of **[Seerr](https://github.com/seerr-team/seerr)**
(MIT License, Copyright (c) 2020 sct), the merged successor of
**[Overseerr](https://github.com/sct/overseerr)** and
**[Jellyseerr](https://github.com/fallenbagel/jellyseerr)**. Authentication, users and
permissions, request quotas and approvals, settings, notification agents, the job scheduler, the
image proxy and the UI primitives are derived from Seerr; see [NOTICE.md](NOTICE.md),
[LICENSES/seerr-MIT.txt](LICENSES/seerr-MIT.txt) and [docs/REUSE_MAP.md](docs/REUSE_MAP.md).
Thank you to everyone who built them.

Music metadata comes from [MusicBrainz](https://musicbrainz.org) and the
[Cover Art Archive](https://coverartarchive.org); artist information from
[Last.fm](https://www.last.fm) and [fanart.tv](https://fanart.tv); listening history is shared
with [ListenBrainz](https://listenbrainz.org) and Last.fm when you link them.

Shufflerr is an independent project. It is not affiliated with or endorsed by the Seerr team,
Plex, Jellyfin, Lidarr, Spotify, Deezer, Apple, Ticketmaster, Skiddle, Last.fm, MetaBrainz or
YouTube.

## License

[MIT](LICENSE)
