//! Runtime configuration, read entirely from the environment.
//!
//! No secret is ever embedded in the binary: `LIDARR_API_KEY` and
//! `ACOUSTID_API_KEY` are read from the process environment (populated from a
//! Kubernetes Secret at deploy time) and nowhere else.

use anyhow::{anyhow, Context, Result};
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct Config {
    /// Base URL of the Lidarr instance, e.g. `http://lidarr.the-arrs:8686`.
    pub lidarr_url: String,
    /// Lidarr API key (`X-Api-Key`).
    pub lidarr_api_key: String,
    /// AcoustID application API key.
    pub acoustid_api_key: Option<String>,

    /// Where Lidarr's completed-downloads folder is mounted inside this
    /// container (read-only).
    pub completed_root: String,
    /// The prefix Lidarr reports in `outputPath` for the same folder. Files are
    /// rebased from this onto `completed_root` so the sidecar can read them.
    pub lidarr_completed_prefix: Option<String>,

    /// Where verification state (processed download ids) is persisted.
    pub state_dir: String,

    /// How often to poll Lidarr's queue.
    pub poll_interval: Duration,

    /// When true, verify and log a verdict but never import or delete anything.
    pub dry_run: bool,

    /// When true, a track that cannot be positively identified via AcoustID is
    /// rejected. When false, an inconclusive AcoustID lookup does not by itself
    /// fail the track (ffprobe + spectral checks still apply).
    pub acoustid_required: bool,

    /// Fraction of a release's tracks that must pass for the release to be
    /// imported. 1.0 means every track must pass.
    pub min_track_coverage: f64,

    /// Reject tracks below this sample rate (Hz). 0 disables the check.
    pub min_sample_rate: u32,
    /// Reject lossless tracks below this bit depth. 0 disables the check.
    pub min_bit_depth: u32,

    /// Allowed difference between the file's duration and the expected track
    /// duration, in seconds.
    pub duration_tolerance_secs: f64,

    /// Reject lossless files whose spectral content cuts off below this
    /// fraction of Nyquist (fake-lossless / upscaled-from-lossy detection).
    pub spectral_min_cutoff_ratio: f64,

    /// Path to the `ffprobe` binary.
    pub ffprobe_bin: String,
    /// Path to the `fpcalc` (Chromaprint) binary.
    pub fpcalc_bin: String,

    /// AcoustID client string sent as the `client` parameter (the API key).
    /// Kept separate so it can be logged safely if it ever diverges.
    pub acoustid_endpoint: String,
}

fn env_opt(key: &str) -> Option<String> {
    match std::env::var(key) {
        Ok(v) if !v.trim().is_empty() => Some(v.trim().to_string()),
        _ => None,
    }
}

fn env_required(key: &str) -> Result<String> {
    env_opt(key).ok_or_else(|| anyhow!("required environment variable {key} is not set"))
}

fn env_bool(key: &str, default: bool) -> bool {
    match env_opt(key) {
        Some(v) => matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"),
        None => default,
    }
}

fn env_parse<T>(key: &str, default: T) -> Result<T>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    match env_opt(key) {
        Some(v) => v
            .parse::<T>()
            .map_err(|e| anyhow!("environment variable {key} is invalid: {e}")),
        None => Ok(default),
    }
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let lidarr_url = env_required("LIDARR_URL")
            .context("Lidarr base URL is required")?
            .trim_end_matches('/')
            .to_string();
        let lidarr_api_key = env_required("LIDARR_API_KEY")?;
        let acoustid_api_key = env_opt("ACOUSTID_API_KEY");
        let acoustid_required = env_bool("ACOUSTID_REQUIRED", true);

        if acoustid_required && acoustid_api_key.is_none() {
            return Err(anyhow!(
                "ACOUSTID_REQUIRED is true but ACOUSTID_API_KEY is not set"
            ));
        }

        let cfg = Config {
            lidarr_url,
            lidarr_api_key,
            acoustid_api_key,
            completed_root: env_opt("COMPLETED_ROOT").unwrap_or_else(|| "/completed".to_string()),
            lidarr_completed_prefix: env_opt("LIDARR_COMPLETED_PREFIX"),
            state_dir: env_opt("STATE_DIR").unwrap_or_else(|| "/state".to_string()),
            poll_interval: Duration::from_secs(env_parse::<u64>("POLL_INTERVAL_SECS", 60)?.max(5)),
            dry_run: env_bool("DRY_RUN", true),
            acoustid_required,
            min_track_coverage: env_parse::<f64>("MIN_TRACK_COVERAGE", 1.0)?.clamp(0.0, 1.0),
            min_sample_rate: env_parse::<u32>("MIN_SAMPLE_RATE", 0)?,
            min_bit_depth: env_parse::<u32>("MIN_BIT_DEPTH", 0)?,
            duration_tolerance_secs: env_parse::<f64>("DURATION_TOLERANCE_SECS", 4.0)?.max(0.0),
            spectral_min_cutoff_ratio: env_parse::<f64>("SPECTRAL_MIN_CUTOFF_RATIO", 0.80)?
                .clamp(0.0, 1.0),
            ffprobe_bin: env_opt("FFPROBE_BIN").unwrap_or_else(|| "ffprobe".to_string()),
            fpcalc_bin: env_opt("FPCALC_BIN").unwrap_or_else(|| "fpcalc".to_string()),
            acoustid_endpoint: env_opt("ACOUSTID_ENDPOINT")
                .unwrap_or_else(|| "https://api.acoustid.org/v2/lookup".to_string()),
        };

        Ok(cfg)
    }

    /// Rebase a path Lidarr reported (under `lidarr_completed_prefix`, if set)
    /// onto the locally mounted `completed_root`.
    pub fn rebase_path(&self, lidarr_path: &str) -> String {
        if let Some(prefix) = &self.lidarr_completed_prefix {
            let trimmed = prefix.trim_end_matches('/');
            if let Some(rest) = lidarr_path.strip_prefix(trimmed) {
                let rest = rest.trim_start_matches('/');
                let root = self.completed_root.trim_end_matches('/');
                if rest.is_empty() {
                    return root.to_string();
                }
                return format!("{root}/{rest}");
            }
        }
        lidarr_path.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn base_config() -> Config {
        Config {
            lidarr_url: "http://lidarr:8686".into(),
            lidarr_api_key: "k".into(),
            acoustid_api_key: Some("a".into()),
            completed_root: "/completed".into(),
            lidarr_completed_prefix: Some("/data/torrents/completed".into()),
            state_dir: "/state".into(),
            poll_interval: Duration::from_secs(60),
            dry_run: true,
            acoustid_required: true,
            min_track_coverage: 1.0,
            min_sample_rate: 0,
            min_bit_depth: 0,
            duration_tolerance_secs: 4.0,
            spectral_min_cutoff_ratio: 0.80,
            ffprobe_bin: "ffprobe".into(),
            fpcalc_bin: "fpcalc".into(),
            acoustid_endpoint: "https://api.acoustid.org/v2/lookup".into(),
        }
    }

    #[test]
    fn rebases_prefixed_path() {
        let cfg = base_config();
        assert_eq!(
            cfg.rebase_path("/data/torrents/completed/music/Some.Folder/01.flac"),
            "/completed/music/Some.Folder/01.flac"
        );
    }

    #[test]
    fn rebases_exact_prefix_to_root() {
        let cfg = base_config();
        assert_eq!(cfg.rebase_path("/data/torrents/completed"), "/completed");
    }

    #[test]
    fn leaves_unprefixed_path_untouched() {
        let cfg = base_config();
        assert_eq!(cfg.rebase_path("/elsewhere/x.flac"), "/elsewhere/x.flac");
    }

    #[test]
    fn no_prefix_is_identity() {
        let mut cfg = base_config();
        cfg.lidarr_completed_prefix = None;
        assert_eq!(cfg.rebase_path("/completed/x.flac"), "/completed/x.flac");
    }
}
