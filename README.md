<p align="center">
<img src="./public/favicon.svg" alt="Shufflerr" width="128" height="128">
</p>

# Shufflerr

Shufflerr is a self-hosted request and discovery manager for music. People search for artists,
albums and tracks, request what's missing, admins approve (or permissions approve it
automatically), Lidarr downloads it, and your media server — Plex, Jellyfin, Navidrome or plain
folders — marks it available.

- **Requests** for missing tracks, whole albums or full discographies, with per-user limits and
  auto-approval rules. Lidarr does the downloading.
- **Metadata** from MusicBrainz, the Cover Art Archive, fanart.tv and Last.fm. Artist photos
  come through Lidarr when no fanart.tv key is set.
- **Sign-in** with Plex, Jellyfin/Emby or a local account.
- **Library** scanning for Plex, Jellyfin/Emby, Navidrome and local folders, with a built-in
  player (waveform, range streaming, optional transcoding).
- **Import** albums from Spotify, Deezer and Apple Music links; concerts from Ticketmaster and
  Skiddle; scrobbling to ListenBrainz and Last.fm; missing tracks play from YouTube's own
  player.
- **Your own music app:** OpenSubsonic (`/rest`) and Jellyfin-compatible (`/jellyfin`) APIs for
  Symfonium, Finamp, Feishin, Amperfy, Jellify and others, signed in with app passwords.
- **Notifications** by email, web push, Discord, Slack, Telegram, Pushbullet, Pushover, webhook,
  Gotify and ntfy.
- **Issues, a manage panel and a blocklist** for albums and artists.

> Version 0.1.14. [RELEASELOG.md](RELEASELOG.md) says what is in it in plain words;
> [CHANGES.md](CHANGES.md) records how it was built, what was verified against real services
> and what was tested with recorded responses only.

## Quick start

### Docker

The image is published at `ghcr.io/sbjerome/shufflerr` (tags `latest` and the version, for
example `0.1.14`):

```bash
docker run -d --name shufflerr \
  -p 5055:5055 \
  -e TZ=America/New_York \
  -v ./config:/app/config \
  -v /path/to/music:/music:ro \
  --restart unless-stopped \
  ghcr.io/sbjerome/shufflerr:latest
```

The music volume is optional; mount it only if Shufflerr should scan plain folders.

To build from source instead:

```bash
docker compose up -d          # SQLite; data in ./config
# or
docker compose -f compose.postgres.yaml up -d
```

Open <http://localhost:5055>. The setup wizard creates the owner (sign in with Plex, Jellyfin
or Emby, or create a local admin), then connects a library source and Lidarr.

First things to set under Settings:

1. **General → Application URL**: the address people use; it goes into links, app endpoints
   and OAuth callbacks.
2. **MusicBrainz and Last.fm → Contact**: an email or URL. MusicBrainz asks for one.
3. **Lidarr**: host, port and API key, then Test and choose the profiles and root folder.
4. **A library source**: Plex, Jellyfin/Emby, Navidrome, or Local files. For local files,
   mount the music read-only (see the commented volume in `compose.yaml`) and add the folder,
   for example `/music`.

Everything else (Spotify, Ticketmaster, Skiddle, YouTube, fanart.tv, Last.fm, notification
agents) is optional and off until its page is filled in.

#### Volumes

| Path in the container | Purpose |
|---|---|
| `/app/config` | Settings (`settings.json`, mode `0600`), SQLite database, logs, image and metadata caches. Keep it. |
| `/music` (any path, read-only) | Optional: music folders for the Local files source and the player. |

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
| `DB_TYPE` | `sqlite` | `postgres` to use PostgreSQL |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` | — / `5432` / — / — / `shufflerr` | PostgreSQL connection (`DB_SOCKET_PATH` for a Unix socket) |
| `DB_USE_SSL`, `DB_SSL_CA`, `DB_SSL_KEY`, `DB_SSL_CERT`, `DB_SSL_REJECT_UNAUTHORIZED` | off | PostgreSQL TLS (each also accepts a `_FILE` variant) |
| `DB_POOL_SIZE`, `DB_CONNECT_TIMEOUT_MS`, `DB_LOG_QUERIES` | driver default / `30000` / `false` | PostgreSQL pool and query logging |
| `FFMPEG_PATH` | `ffmpeg` on `PATH` | ffmpeg binary for transcoding and waveforms (in the image already) |

The database schema is created and upgraded by migrations at start-up.

`config/settings.json` holds API keys and the server secret; it is written with mode `0600`.

## Development

```bash
pnpm lint
pnpm typecheck
pnpm test           # unit tests (no network access), about a minute
pnpm build
```

After changing a route, regenerate the OpenAPI document (served at `/api-docs`):

```bash
pnpm exec ts-node -r tsconfig-paths/register --files --project server/tsconfig.json server/scripts/generateApiSpec.ts
pnpm exec prettier --write shufflerr-api.yml
```

After changing an entity, generate a migration for both databases
(`pnpm migration:generate server/migration/sqlite/<Name>` with `NODE_ENV=production`, and
again with `DB_TYPE=postgres` for `server/migration/postgres/<Name>`).

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

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). Copyright (c) 2026 Jerome S B.

The parts derived from Seerr remain available under the MIT License, Copyright (c) 2020 sct;
see [NOTICE.md](NOTICE.md) and [LICENSES/seerr-MIT.txt](LICENSES/seerr-MIT.txt).
