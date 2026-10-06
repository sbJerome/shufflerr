//! Shufflerr audio-verification sidecar.
//!
//! Polls Lidarr's download queue for completed downloads that are pending or
//! failed import, hard-verifies every audio file (ffprobe specs + Chromaprint/
//! AcoustID identity + spectral transcode detection), and then either drives
//! Lidarr's manual import (on a pass) or removes and blocklists the download
//! (on a fail). In DRY_RUN it only logs the verdict.

mod acoustid;
mod config;
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

    debug!(queue = queue.len(), pending = pending.len(), "polled Lidarr queue");

    for item in pending {
        if st.is_processed(&item.download_id) {
            debug!(queue_id = item.id, "already handled this cycle; skipping");
            continue;
        }
        match handle_item(cfg, lidarr, http, item, st).await {
            Ok(outcome) => st.mark(&item.download_id, &outcome),
            Err(e) => {
                // A transient error (network, ffprobe hiccup) must not get
                // marked processed — leave it to retry next cycle.
                warn!(queue_id = item.id, error = %format!("{e:#}"), "verification errored; will retry");
            }
        }
    }

    st.save().context("persisting state")?;
    Ok(())
}

/// Verify one queue item and act on the verdict. Returns the outcome label to
/// record in state.
async fn handle_item(
    cfg: &Config,
    lidarr: &Lidarr,
    http: &Client,
    item: &QueueItem,
    st: &mut state::State,
) -> Result<String> {
    let local_dir = cfg.rebase_path(&item.output_path);
    let files = enumerate_audio_files(Path::new(&local_dir));
    info!(
        queue_id = item.id,
        state = %item.tracked_download_state,
        audio_files = files.len(),
        "verifying download"
    );

    if files.is_empty() {
        warn!(queue_id = item.id, "no audio files found at output path");
        return act_on_verdict(cfg, lidarr, st, item, false, &["no audio files found".to_string()]).await;
    }

    let tracks = lidarr
        .album_tracks(item.album_id)
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

    act_on_verdict(cfg, lidarr, st, item, release_pass, &all_reasons).await
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
async fn act_on_verdict(
    cfg: &Config,
    lidarr: &Lidarr,
    st: &mut state::State,
    item: &QueueItem,
    pass: bool,
    reasons: &[String],
) -> Result<String> {
    if cfg.dry_run {
        if pass {
            info!(queue_id = item.id, "DRY_RUN: would import");
            return Ok("dry-pass".to_string());
        }
        info!(queue_id = item.id, ?reasons, "DRY_RUN: would remove and blocklist");
        return Ok("dry-fail".to_string());
    }

    if pass {
        import_download(lidarr, item).await?;
        Ok("imported".to_string())
    } else {
        // Cap re-search per album so a release-set that is entirely bad does not
        // churn through blocklist→re-search→re-grab forever.
        let attempts = st.record_album_reject(item.album_id);
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

async fn import_download(lidarr: &Lidarr, item: &QueueItem) -> Result<()> {
    let candidates = lidarr
        .manual_import_candidates(&item.download_id)
        .await
        .context("fetching manual-import candidates")?;

    let files: Vec<serde_json::Value> = candidates
        .iter()
        .filter_map(lidarr::build_import_file)
        .collect();

    if files.is_empty() {
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
