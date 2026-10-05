# NOTICE

Shufflerr includes and is derived from software developed by the Seerr project.

**Seerr** — https://github.com/seerr-team/seerr
Copyright (c) 2020 sct
Licensed under the MIT License. A full copy is in `LICENSES/seerr-MIT.txt` and must be
distributed with Shufflerr (source, Docker images and release archives).

Seerr is the merged successor of **Overseerr** and **Jellyseerr**. Shufflerr's platform layer
is derived from Seerr at commit `2cfbcf8940225f1597d44f507fd78040887c5597`: authentication
(Plex, Jellyfin, local), user management and profiles, the permission system, request quotas
and the request approval lifecycle, settings and the admin pages, notification agents, the job
scheduler, media-server scanners, the image proxy, and the UI primitives.

`docs/REUSE_MAP.md` lists every derived path and whether it was kept or adapted. Each derived
source file starts with a header comment crediting Seerr.

Design note: Shufflerr's visual direction was inspired by the "Rekord" HTML template licensed by
the project owner. No code, styles, fonts, icons or images from that template are included.

Data and services: music metadata from MusicBrainz (CC0) and the Cover Art Archive; artist
information from Last.fm; listening history with ListenBrainz and Last.fm. Each third-party
service is used under its own terms.

Shufflerr is an independent project and is not affiliated with or endorsed by the Seerr team,
Plex, Jellyfin, Spotify, Deezer, Apple, Ticketmaster, Skiddle, Last.fm, MetaBrainz or YouTube.
