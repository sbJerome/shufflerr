//! Shufflerr audio-verification sidecar.
//!
//! Polls Lidarr's download queue for completed downloads that are pending or
//! failed import, hard-verifies every audio file (ffprobe specs + Chromaprint/
//! AcoustID identity + spectral transcode detection), and then either drives
//! Lidarr's manual import (on a pass) or removes and blocklists the download
//! (on a fail). In DRY_RUN it only logs the verdict.

mod acoustid;
mod config;
mod downloadclient;
mod ffprobe;
mod fpcalc;
mod lidarr;
mod spectral;
mod state;
mod verify;

use anyhow::{Context, Result};
use config::Config;
use lidarr::{Lidarr, LidarrTrack, QueueItem};
use reqwest::Client;
use spectral::SpectralReport;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::time::{interval, MissedTickBehavior};
use tracing::{debug, error, info, warn};
use verify::{evaluate, Thresholds, TrackEvidence, TrackExpectation, Verdict};

const AUDIO_EXTENSIONS: &[&str] = &[
    "flac", "mp3", "m4a", "aac", "ogg", "opus", "wav", "wv", "alac", "ape", "aiff", "aif", "mpc",
];

/// Lidarr command poll settings.
const COMMAND_POLL_INTERVAL: Duration = Duration::from_secs(2);
const COMMAND_POLL_MAX: u32 = 60; // ~2 minutes

/// How many distinct releases we let Lidarr re-grab for one album before we
/// stop asking for a replacement. Once an album has failed verification this
/// many times, further rejects blocklist the bad release but do NOT trigger a
/// re-search — otherwise an album whose every available release is bad churns
/// through blocklist→re-search→re-grab→reject endlessly.
const MAX_RESEARCH_ATTEMPTS: u32 = 3;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cfg = Config::from_env().context("loading configuration from environment")?;
    info!(
        lidarr = %cfg.lidarr_url,
        completed_root = %cfg.completed_root,
        dry_run = cfg.dry_run,
        acoustid_required = cfg.acoustid_required,
        acoustid_enabled = cfg.acoustid_api_key.is_some(),
        poll_secs = cfg.poll_interval.as_secs(),
        "shufflerr-verifier starting"
    );
    if cfg.dry_run {
        warn!("DRY_RUN is on: verdicts will be logged but nothing will be imported or deleted");
    }

    let http = Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(concat!("shufflerr-verifier/", env!("CARGO_PKG_VERSION")))
        .build()
        .context("building HTTP client")?;
    let lidarr = Lidarr::new(http.clone(), cfg.lidarr_url.clone(), cfg.lidarr_api_key.clone());
    let mut st = state::State::load(&cfg.state_dir).context("loading state")?;

    let mut ticker = interval(cfg.poll_interval);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                if let Err(e) = run_cycle(&cfg, &lidarr, &http, &mut st).await {
                    error!(error = %format!("{e:#}"), "poll cycle failed");
                }
            }
            _ = tokio::signal::ctrl_c() => {
                info!("shutdown signal received");
                break;
            }
        }
    }

    st.save().ok();
    Ok(())
}

async fn run_cycle(
    cfg: &Config,
    lidarr: &Lidarr,
    http: &Client,
    st: &mut state::State,
) -> Result<()> {
    let queue = lidarr.queue().await.context("fetching Lidarr queue")?;
    let pending: Vec<&QueueItem> = queue.iter().filter(|q| lidarr::needs_verification(q)).collect();

    // Forget state for anything no longer in the queue so the file cannot grow
    // without bound and a re-grabbed download starts fresh.
    let live_ids: std::collections::HashSet<&str> =
        queue.iter().map(|q| q.download_id.as_str()).collect();
    for known in st.known_ids() {
        if !live_ids.contains(known.as_str()) {
            st.forget(&known);
        }
    }
    // Drop grab mappings whose download has fully left the queue (imported or
    // removed), and expire stale per-album grab cooldowns.
    for gid in st.grab_ids() {
        if !live_ids.contains(gid.as_str()) {
            st.forget_grab(&gid);
        }
    }
    st.prune_grab_cooldowns(cfg.grab_cooldown_secs);

    debug!(queue = queue.len(), pending = pending.len(), "polled Lidarr queue");

    // Resolve direct-grab config once per cycle. `track_scopes` also drives
    // track-scoped IMPORTS below (import only the requested tracks of a release).
    let dg = direct_grab_config(cfg, http).await;

    for item in pending {
        if st.is_processed(&item.download_id) {
            debug!(queue_id = item.id, "already handled this cycle; skipping");
            continue;
        }
        match handle_item(cfg, lidarr, http, item, st, &dg.track_scopes).await {
            Ok(outcome) => st.mark(&item.download_id, &outcome),
            Err(e) => {
                // A transient error (network, ffprobe hiccup) must not get
                // marked processed — leave it to retry next cycle.
                warn!(queue_id = item.id, error = %format!("{e:#}"), "verification errored; will retry");
            }
        }
    }

    // Direct-submit bypass (toggleable): Shufflerr owns release selection, and
    // scopes it to the albums the user actually requested.
    if dg.enabled {
        if let Err(e) = direct_grab_cycle(cfg, lidarr, http, st, &queue, &dg.album_ids).await {
            warn!(error = %format!("{e:#}"), "direct-grab cycle error");
        }
    }

    st.save().context("persisting state")?;
    Ok(())
}

#[derive(serde::Deserialize)]
struct ToggleResponse {
    #[serde(default)]
    enabled: bool,
    /// Albums the user has an open request for — the ONLY albums direct-grab
    /// will fetch. Absent/empty means grab nothing.
    #[serde(default, rename = "albumIds")]
    album_ids: Vec<i64>,
    /// Per-album requested recording MBIDs, present ONLY for albums wanted
    /// purely by track scope. When an album appears here, only those tracks are
    /// imported (not the whole release). Absent → import the whole album.
    #[serde(default, rename = "trackScopes")]
    track_scopes: std::collections::HashMap<i64, Vec<String>>,
}

/// Resolved direct-grab config for one cycle.
#[derive(Default)]
struct DirectGrabConfig {
    enabled: bool,
    album_ids: Vec<i64>,
    track_scopes: std::collections::HashMap<i64, Vec<String>>,
}

/// Resolve the direct-grab toggle: prefer the Shufflerr-owned config endpoint
/// (so it can be flipped at runtime), falling back to the static env default.
/// Returns (enabled, requested album ids). The album ids are the request-scoped
/// candidate set from Shufflerr; an unreachable/unparseable endpoint falls back
/// to the env default with no albums (so nothing is grabbed).
async fn direct_grab_config(cfg: &Config, http: &Client) -> DirectGrabConfig {
    if let Some(url) = &cfg.direct_grab_config_url {
        match http.get(url).timeout(Duration::from_secs(5)).send().await {
            Ok(resp) => match resp.json::<ToggleResponse>().await {
                Ok(t) => {
                    return DirectGrabConfig {
                        enabled: t.enabled,
                        album_ids: t.album_ids,
                        track_scopes: t.track_scopes,
                    }
                }
                Err(_) => debug!("direct-grab toggle endpoint returned unparseable body; using env default"),
            },
            Err(_) => debug!("direct-grab toggle endpoint unreachable; using env default"),
        }
    }
    DirectGrabConfig {
        enabled: cfg.direct_grab,
        album_ids: Vec::new(),
        track_scopes: std::collections::HashMap::new(),
    }
}

/// Cap on how many albums the driver will submit per cycle, so turning the
/// toggle on trickles downloads instead of flooding the client.
const MAX_GRABS_PER_CYCLE: usize = 2;
/// Hard bound on how many albums we even *attempt* per cycle, so a run of
/// failures (e.g. a mis-set download-client key) cannot churn through every
/// missing album and flood the indexers/logs hunting for successes.
const MAX_ATTEMPTS_PER_CYCLE: usize = 6;
/// Generous per-track size budget (bytes). A release larger than the album's
/// track count times this is treated as a wrong/oversized pack and skipped.
/// ~200 MB/track comfortably covers 24-bit FLAC without admitting discography packs.
const MAX_BYTES_PER_TRACK: i64 = 200_000_000;

/// For each monitored-missing album not already downloading or recently grabbed,
/// interactively search the configured indexers, pick the best release, and
/// submit it STRAIGHT to the download client — never through Lidarr's matcher.
async fn direct_grab_cycle(
    cfg: &Config,
    lidarr: &Lidarr,
    http: &Client,
    st: &mut state::State,
    queue: &[QueueItem],
    album_ids: &[i64],
) -> Result<()> {
    // Candidate set is the user's requested albums (from Shufflerr), NOT Lidarr's
    // whole monitored-missing catalog. Empty → nothing to do.
    if album_ids.is_empty() {
        return Ok(());
    }

    let clients = lidarr.download_clients().await.context("reading Lidarr download clients")?;
    let enabled_clients: Vec<_> = clients.into_iter().filter(|c| c.enable).collect();
    if enabled_clients.is_empty() {
        warn!("direct-grab on but Lidarr has no enabled download client");
        return Ok(());
    }

    let active_albums: std::collections::HashSet<i64> =
        queue.iter().map(|q| q.album_id).filter(|&a| a > 0).collect();

    let mut grabbed = 0usize;
    let mut attempts = 0usize;
    for &album_id in album_ids {
        if grabbed >= MAX_GRABS_PER_CYCLE || attempts >= MAX_ATTEMPTS_PER_CYCLE {
            break;
        }
        if active_albums.contains(&album_id) || st.recently_grabbed(album_id, cfg.grab_cooldown_secs) {
            continue;
        }
        attempts += 1;
        // Stamp the cooldown up front: whatever the outcome below, this album is
        // not retried until the cooldown expires. This bounds churn and log
        // volume when an album has no acceptable release or a submit fails.
        st.record_grab("", album_id);
        let releases = match lidarr.releases(album_id).await {
            Ok(r) => r,
            Err(e) => {
                warn!(album_id, error = %format!("{e:#}"), "release search failed");
                continue;
            }
        };
        // Budget the release size by the album's own track count so a
        // discography/compilation pack is never grabbed for a single album
        // (hundreds of wrong tracks that fail verification and starve the queue).
        let expected_tracks = lidarr
            .album_tracks(album_id)
            .await
            .map(|t| t.len())
            .unwrap_or(0);
        let max_size = if expected_tracks > 0 {
            Some(expected_tracks as i64 * MAX_BYTES_PER_TRACK)
        } else {
            None
        };
        let Some(best) = lidarr::pick_best_release(&releases, max_size) else {
            info!(album_id, expected_tracks, "no acceptably-sized release found; skipping");
            continue;
        };
        let Some(client) = select_client(&enabled_clients, &best.protocol) else {
            warn!(album_id, protocol = %best.protocol, "no enabled download client for release protocol");
            continue;
        };
        match client.submit(http, &best.download_url).await {
            Ok(ids) => {
                for id in &ids {
                    st.record_grab(id, album_id);
                }
                info!(album_id, quality = %best.quality_name, "direct-grab: submitted release to download client");
                grabbed += 1;
            }
            // Error is already scrubbed (status/category only, never the URL).
            Err(e) => warn!(album_id, error = %format!("{e:#}"), "direct-grab submit failed"),
        }
    }
    Ok(())
}

/// Pick an enabled client matching the release protocol (usenet→SABnzbd,
/// torrent→qBittorrent), falling back to any enabled client of that transport.
fn select_client<'a>(
    clients: &'a [downloadclient::DownloadClient],
    protocol: &str,
) -> Option<&'a downloadclient::DownloadClient> {
    let usenet = protocol.eq_ignore_ascii_case("usenet");
    clients
        .iter()
        .find(|c| if usenet { c.is_sabnzbd() } else { c.is_qbittorrent() })
        .or_else(|| clients.iter().find(|c| if usenet { c.is_usenet() } else { !c.is_usenet() }))
}

/// Verify one queue item and act on the verdict. Returns the outcome label to
/// record in state.
async fn handle_item(
    cfg: &Config,
    lidarr: &Lidarr,
    http: &Client,
    item: &QueueItem,
    st: &mut state::State,
    track_scopes: &std::collections::HashMap<i64, Vec<String>>,
) -> Result<String> {
    // For a direct-submitted download Lidarr cannot parse, its queue album id is
    // 0/unknown; fall back to the album we grabbed it for (recorded in state).
    let mapped_album = st.mapped_album(&item.download_id);
    let album_id = mapped_album.filter(|&a| a > 0).unwrap_or(item.album_id);
    let mapped = mapped_album.is_some();
    // If this album is wanted purely by track scope, import only those tracks.
    let track_scope: Option<&[String]> = track_scopes.get(&album_id).map(|v| v.as_slice());

    let local_dir = cfg.rebase_path(&item.output_path);
    let files = enumerate_audio_files(Path::new(&local_dir));
    info!(
        queue_id = item.id,
        state = %item.tracked_download_state,
        audio_files = files.len(),
        direct = mapped,
        "verifying download"
    );

    if files.is_empty() {
        warn!(queue_id = item.id, "no audio files found at output path");
        return act_on_verdict(cfg, lidarr, st, item, album_id, mapped, track_scope, false, &["no audio files found".to_string()]).await;
    }

    let tracks = lidarr
        .album_tracks(album_id)
        .await
        .unwrap_or_else(|e| {
            warn!(queue_id = item.id, error = %format!("{e:#}"), "could not fetch release tracks");
            Vec::new()
        });
    let album_mbids: Vec<String> = tracks.iter().map(|t| t.recording_mbid.clone()).collect();

    let thresholds = Thresholds::from(cfg);
    let mut passed = 0usize;
    let mut all_reasons: Vec<String> = Vec::new();

    for file in &files {
        match verify_file(cfg, http, file, &tracks, &album_mbids, &thresholds).await {
            Ok(Verdict::Pass) => passed += 1,
            Ok(Verdict::Fail(reasons)) => {
                debug!(queue_id = item.id, ?reasons, "a file failed verification");
                for r in reasons {
                    if !all_reasons.contains(&r) {
                        all_reasons.push(r);
                    }
                }
            }
            Err(e) => {
                let r = format!("could not analyse a file: {e}");
                warn!(queue_id = item.id, error = %format!("{e:#}"), "file analysis failed");
                if !all_reasons.contains(&r) {
                    all_reasons.push(r);
                }
            }
        }
    }

    let coverage = passed as f64 / files.len() as f64;
    let release_pass = coverage >= cfg.min_track_coverage;
    info!(
        queue_id = item.id,
        passed,
        total = files.len(),
        coverage = format!("{:.0}%", coverage * 100.0),
        required = format!("{:.0}%", cfg.min_track_coverage * 100.0),
        verdict = if release_pass { "PASS" } else { "FAIL" },
        "release verdict"
    );

    act_on_verdict(cfg, lidarr, st, item, album_id, mapped, track_scope, release_pass, &all_reasons).await
}

/// Measure one file and run it through the gate.
async fn verify_file(
    cfg: &Config,
    http: &Client,
    file: &Path,
    tracks: &[LidarrTrack],
    album_mbids: &[String],
    thresholds: &Thresholds,
) -> Result<Verdict> {
    let specs = ffprobe::probe(&cfg.ffprobe_bin, file)
        .await
        .context("ffprobe failed")?;

    // AcoustID identity (best-effort unless required).
    let mut acoustid_attempted = false;
    let mut acoustid_matches = Vec::new();
    if let Some(key) = &cfg.acoustid_api_key {
        match fpcalc::fingerprint(&cfg.fpcalc_bin, file).await {
            Ok(fp) => {
                acoustid_attempted = true;
                match acoustid::lookup(http, &cfg.acoustid_endpoint, key, fp.duration, &fp.fingerprint)
                    .await
                {
                    Ok(m) => acoustid_matches = m,
                    Err(e) => warn!(error = %format!("{e:#}"), "AcoustID lookup failed"),
                }
            }
            Err(e) => warn!(error = %format!("{e:#}"), "fingerprinting failed"),
        }
    }

    // Spectral analysis is CPU-bound; run it off the async runtime.
    let spectral: Option<SpectralReport> = {
        let path = file.to_path_buf();
        match tokio::task::spawn_blocking(move || spectral::analyze_file(&path)).await {
            Ok(Ok(report)) => Some(report),
            Ok(Err(e)) => {
                warn!(error = %format!("{e:#}"), "spectral analysis failed");
                None
            }
            Err(e) => {
                warn!(error = %e, "spectral task panicked");
                None
            }
        }
    };

    // Expected duration: if AcoustID identified a specific recording that is on
    // this release, use that track's duration.
    let expected_duration = acoustid_matches
        .iter()
        .find_map(|m| {
            tracks
                .iter()
                .find(|t| t.recording_mbid.eq_ignore_ascii_case(&m.recording_mbid))
                .and_then(|t| t.duration_secs)
        })
        // Fall back to a single-track release's only duration.
        .or_else(|| {
            if tracks.len() == 1 {
                tracks[0].duration_secs
            } else {
                None
            }
        });

    let expectation = TrackExpectation {
        expected_duration_secs: expected_duration,
        album_recording_mbids: album_mbids.to_vec(),
    };
    let evidence = TrackEvidence {
        specs,
        acoustid_attempted,
        acoustid_matches,
        spectral,
    };

    Ok(evaluate(thresholds, &expectation, &evidence))
}

/// Import (pass) or remove+blocklist (fail), honouring DRY_RUN.
#[allow(clippy::too_many_arguments)]
async fn act_on_verdict(
    cfg: &Config,
    lidarr: &Lidarr,
    st: &mut state::State,
    item: &QueueItem,
    album_id: i64,
    mapped: bool,
    track_scope: Option<&[String]>,
    pass: bool,
    reasons: &[String],
) -> Result<String> {
    if cfg.dry_run {
        if pass {
            info!(queue_id = item.id, track_scoped = track_scope.is_some(), "DRY_RUN: would import");
            return Ok("dry-pass".to_string());
        }
        info!(queue_id = item.id, ?reasons, "DRY_RUN: would remove and blocklist");
        return Ok("dry-fail".to_string());
    }

    if pass {
        // A direct-submitted download is scoped to the album we grabbed it for,
        // so Lidarr maps its (otherwise unparseable) files to that album.
        let scoped = if mapped { Some(album_id) } else { None };
        import_download(lidarr, item, scoped, track_scope).await?;
        Ok("imported".to_string())
    } else {
        // Cap re-search per album so a release-set that is entirely bad does not
        // churn through blocklist→re-search→re-grab forever.
        let attempts = st.record_album_reject(album_id);
        let research = attempts <= MAX_RESEARCH_ATTEMPTS;
        if research {
            info!(queue_id = item.id, attempts, ?reasons, "rejecting: removing + blocklisting (will re-search)");
        } else {
            info!(
                queue_id = item.id, attempts, ?reasons,
                "rejecting: removing + blocklisting WITHOUT re-search (no acceptable release found for this album)"
            );
        }
        lidarr
            .remove_and_blocklist(item.id, research)
            .await
            .context("removing rejected download")?;
        Ok("rejected".to_string())
    }
}

async fn import_download(
    lidarr: &Lidarr,
    item: &QueueItem,
    scoped_album: Option<i64>,
    track_scope: Option<&[String]>,
) -> Result<()> {
    // For a direct-submitted download, scope the manual-import to the known
    // artist+album so Lidarr maps the files it could not parse on its own.
    let candidates = match scoped_album {
        Some(aid) => {
            let artist_id = lidarr
                .album_artist_id(aid)
                .await
                .context("looking up artist for direct-submit import")?;
            lidarr
                .manual_import_candidates_scoped(&item.download_id, Some(artist_id), Some(aid))
                .await
                .context("fetching scoped manual-import candidates")?
        }
        None => lidarr
            .manual_import_candidates(&item.download_id)
            .await
            .context("fetching manual-import candidates")?,
    };

    let files: Vec<serde_json::Value> = candidates
        .iter()
        .filter_map(|c| lidarr::build_import_file_scoped(c, track_scope))
        .collect();

    if files.is_empty() {
        // For a track-scoped request this means the download did not contain any
        // requested track; leave it rather than importing the whole release.
        anyhow::bail!("no importable files returned by Lidarr for this download");
    }

    info!(queue_id = item.id, files = files.len(), "submitting manual import");
    let command_id = lidarr.manual_import(files).await.context("submitting import")?;

    // Poll the command to completion.
    for _ in 0..COMMAND_POLL_MAX {
        tokio::time::sleep(COMMAND_POLL_INTERVAL).await;
        let status = lidarr.command_status(command_id).await?;
        match status.status.as_str() {
            "completed" => {
                info!(queue_id = item.id, command_id, "import completed");
                return Ok(());
            }
            "failed" | "aborted" => {
                anyhow::bail!("Lidarr import command {} ended: {}", command_id, status.status);
            }
            _ => continue,
        }
    }
    anyhow::bail!("Lidarr import command {command_id} did not finish in time");
}

/// Recursively collect audio files under `dir` by extension.
fn enumerate_audio_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    collect(dir, &mut out);
    out.sort();
    out
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(&path, out);
        } else if is_audio_file(&path) {
            out.push(path);
        }
    }
}

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toggle_response_parses_enabled_and_album_ids() {
        let t: ToggleResponse =
            serde_json::from_str(r#"{"enabled":true,"albumIds":[139,162,5]}"#).unwrap();
        assert!(t.enabled);
        assert_eq!(t.album_ids, vec![139, 162, 5]);
    }

    #[test]
    fn toggle_response_defaults_album_ids_empty() {
        // Older/absent field -> empty list (grab nothing), not an error.
        let t: ToggleResponse = serde_json::from_str(r#"{"enabled":true}"#).unwrap();
        assert!(t.enabled);
        assert!(t.album_ids.is_empty());
        assert!(t.track_scopes.is_empty());
    }

    #[test]
    fn toggle_response_parses_track_scopes() {
        let t: ToggleResponse = serde_json::from_str(
            r#"{"enabled":true,"albumIds":[139],"trackScopes":{"139":["rec-a","rec-b"]}}"#,
        )
        .unwrap();
        assert_eq!(t.track_scopes.get(&139).map(|v| v.len()), Some(2));
    }

    #[test]
    fn recognises_audio_extensions() {
        assert!(is_audio_file(Path::new("/a/01.flac")));
        assert!(is_audio_file(Path::new("/a/01.FLAC")));
        assert!(is_audio_file(Path::new("/a/02.mp3")));
        assert!(is_audio_file(Path::new("/a/03.m4a")));
        assert!(!is_audio_file(Path::new("/a/cover.jpg")));
        assert!(!is_audio_file(Path::new("/a/notes.txt")));
        assert!(!is_audio_file(Path::new("/a/noext")));
    }

    #[test]
    fn enumerates_recursively_and_sorted() {
        let dir = std::env::temp_dir().join(format!(
            "shufflerr-verifier-enum-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let sub = dir.join("disc1");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(dir.join("02.flac"), b"x").unwrap();
        std::fs::write(dir.join("01.flac"), b"x").unwrap();
        std::fs::write(dir.join("cover.jpg"), b"x").unwrap();
        std::fs::write(sub.join("03.mp3"), b"x").unwrap();

        let files = enumerate_audio_files(&dir);
        assert_eq!(files.len(), 3);
        // Sorted, images excluded.
        assert!(files[0].ends_with("01.flac"));
        assert!(files.iter().all(|f| !f.ends_with("cover.jpg")));

        std::fs::remove_dir_all(&dir).ok();
    }
}
