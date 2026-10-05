# Design reference

- **`shufflerr-mockup.html`** — the approved, clickable mockup. One file, no build, no network
  needed (fonts fall back if offline). Open it in a browser.
  - Sign in as `admin@shufflerr.local` (any password) for the full admin view.
  - Other accounts: `guest@shufflerr.local` (local, album requests only); via the Plex button:
    maya (track requests auto-approve), sam (over his limit), lena (new Plex user — account is
    created on first sign-in); via the Jellyfin button: dre (trusted, auto-approve) and kai (new
    Jellyfin user, blocked unless "Let new Jellyfin users sign in" is on).
  - Everything is in memory and resets on reload. Downloads, scans and logs are simulated.
  - Live copy: https://claude.ai/artifact/EfjfLGhHRV3C8xm5fh3ucj
- **`screens/`** — screenshots of every page: dark theme at 1440×900 (full page), plus
  `40-phone-discover.png` (390×844) and `41-light-discover.png` (light theme).
- **`legacy-canvas/`** — the earlier design-canvas version (`.dc.html` artboards). Superseded;
  kept only for history.

All images in the mockup are placeholders ("Cover art", "Artist photo"). The real app loads
album art from the Cover Art Archive and artist photos from fanart.tv through the image proxy.
CTRL ESCAPE by John Summit is used as real sample metadata; no real artwork is included.
