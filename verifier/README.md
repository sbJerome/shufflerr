# Shufflerr audio-verification sidecar

A standalone service that confirms a finished download actually contains the
audio it claims to, before it enters the library — closing the gap left by
Lidarr's percentage-based auto-import.

It polls Lidarr's download queue for completed downloads that are pending or
failed import, then **hard-verifies** every audio file:

1. **ffprobe** — reads codec, sample rate, channels, bit depth and duration.
2. **Chromaprint + AcoustID** — fingerprints the file (`fpcalc`) and looks it up,
   confirming the recording's MusicBrainz MBID is one that belongs to the
   release Lidarr expects.
3. **Spectral analysis** — decodes the audio and measures where its frequency
   content cuts off. A "lossless" file band-limited well below Nyquist was
   almost certainly transcoded from a lossy source, and is rejected.
4. **Sanity gates** — duration within tolerance of the expected track, sample
   rate / bit depth at or above configured floors.

A single failed check fails the track (hard reject). When the share of passing
tracks meets `MIN_TRACK_COVERAGE`:

- **Pass** → the sidecar drives Lidarr's **manual import** (`move` mode) so
  Lidarr still does the tagging, renaming and art, but the 80%-match threshold
  no longer blocks a good download.
- **Fail** → the download is removed from the queue and the client and
  **blocklisted** so the same bad release is not grabbed again.

`DRY_RUN=true` (the default) logs the verdict and does nothing else. Turn Lidarr's
own *Completed Download Handling* off so the two do not race.

## Configuration (environment only)

| Variable | Default | Meaning |
| --- | --- | --- |
| `LIDARR_URL` | — (required) | Lidarr base URL, e.g. `http://lidarr.the-arrs:8686` |
| `LIDARR_API_KEY` | — (required) | Lidarr API key (`X-Api-Key`) |
| `ACOUSTID_API_KEY` | — | AcoustID application key; required when `ACOUSTID_REQUIRED=true` |
| `ACOUSTID_REQUIRED` | `true` | Fail tracks that cannot be positively identified |
| `COMPLETED_ROOT` | `/completed` | Where the completed-downloads folder is mounted (read-only) |
| `LIDARR_COMPLETED_PREFIX` | — | Path prefix Lidarr reports for that folder, rebased onto `COMPLETED_ROOT` |
| `STATE_DIR` | `/state` | Where the processed-downloads record is kept |
| `POLL_INTERVAL_SECS` | `60` | Queue poll interval (min 5) |
| `DRY_RUN` | `true` | Verify and log only; never import or delete |
| `MIN_TRACK_COVERAGE` | `1.0` | Fraction of a release's files that must pass |
| `MIN_SAMPLE_RATE` | `0` | Reject below this sample rate (Hz); 0 disables |
| `MIN_BIT_DEPTH` | `0` | Reject lossless below this bit depth; 0 disables |
| `DURATION_TOLERANCE_SECS` | `4.0` | Allowed duration difference from the expected track |
| `SPECTRAL_MIN_CUTOFF_RATIO` | `0.80` | Reject lossless cutting off below this fraction of Nyquist |
| `FFPROBE_BIN` | `ffprobe` | ffprobe binary path |
| `FPCALC_BIN` | `fpcalc` | Chromaprint fpcalc binary path |
| `ACOUSTID_ENDPOINT` | `https://api.acoustid.org/v2/lookup` | AcoustID lookup endpoint |
| `DIRECT_GRAB_CONFIG_URL` | — | Shufflerr endpoint polled for the on/off toggle, e.g. `http://shufflerr-service.the-arrs/api/v1/verifier/config` (returns `{"enabled":bool,"albumIds":[...]}`) |
| `DIRECT_GRAB` | `false` | Fallback toggle when the config URL is unset/unreachable |
| `GRAB_COOLDOWN_SECS` | `3600` | Minimum gap before re-submitting a grab for the same album |

No secret is compiled in; `LIDARR_API_KEY` and `ACOUSTID_API_KEY` are read from
the environment (a Kubernetes Secret at deploy time) and nowhere else.

## Build and test

Everything builds inside the image; no local Rust toolchain is needed:

```sh
podman build -t shufflerr-verifier:dev .
```

The build runs `cargo test --release`, so a failing test fails the image build.

## Direct grab (bypass Lidarr's release matcher)

When enabled, the sidecar stops relying on Lidarr to grab releases (Lidarr
refuses releases its parser can't match). Instead it reads Lidarr's configured
**indexers and download clients**, interactive-searches for each monitored
missing album, picks the best release, and submits it **straight to the download
client** (SABnzbd/qBittorrent). It records the client's download id → album id,
so when the completed download shows up (which Lidarr can't parse) the sidecar
verifies it against the right album and drives a scoped manual-import — Lidarr is
used only to tag/rename/organize. The on/off switch lives in **Shufflerr
settings** ("Direct grab"); the sidecar polls `DIRECT_GRAB_CONFIG_URL` for it.
That endpoint also returns `albumIds` — the albums the user has an open request
for — and direct-grab is **scoped to those albums only** (never Lidarr's whole
monitored-missing catalog); an empty list means grab nothing. Per-cycle grab
count and `GRAB_COOLDOWN_SECS` bound the activity. Your indexers and download
clients must be configured in Lidarr — that is where they come from.

## Mounts

- `COMPLETED_ROOT` — the completed-downloads folder, **read-only**.
- `STATE_DIR` — a small writable volume for the processed-downloads record.

## Track-scoped imports

When `/api/v1/verifier/config` returns a `trackScopes` map (album id → requested recording
MBIDs), the sidecar imports **only** those tracks from the grabbed release via manual-import
(matching each candidate track's `foreignRecordingId`), not the whole album. It is populated only
for albums wanted purely by a `tracks`-scope request; album/discography requests omit the album
from `trackScopes` and import in full.

## License

AGPL-3.0-only, matching the Shufflerr project.
