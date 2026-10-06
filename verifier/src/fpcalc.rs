//! Chromaprint fingerprinting via the `fpcalc` binary.
//!
//! `fpcalc -json <file>` prints `{"duration": <secs>, "fingerprint": "<...>"}`.
//! The fingerprint and duration are what AcoustID's lookup needs.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use std::path::Path;
use tokio::process::Command;

#[derive(Debug, Clone, PartialEq)]
pub struct Fingerprint {
    pub duration: f64,
    pub fingerprint: String,
}

#[derive(Debug, Deserialize)]
struct FpcalcOutput {
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    fingerprint: String,
}

fn parse_fpcalc(json: &str) -> Result<Fingerprint> {
    let out: FpcalcOutput =
        serde_json::from_str(json).context("fpcalc JSON output was not parseable")?;
    if out.fingerprint.is_empty() {
        return Err(anyhow!("fpcalc returned an empty fingerprint"));
    }
    if out.duration <= 0.0 {
        return Err(anyhow!("fpcalc returned a non-positive duration"));
    }
    Ok(Fingerprint {
        duration: out.duration,
        fingerprint: out.fingerprint,
    })
}

/// Compute a Chromaprint fingerprint for `path`.
pub async fn fingerprint(fpcalc_bin: &str, path: &Path) -> Result<Fingerprint> {
    let output = Command::new(fpcalc_bin)
        .arg("-json")
        .arg(path)
        .output()
        .await
        .with_context(|| format!("failed to run {fpcalc_bin}"))?;

    if !output.status.success() {
        // Deliberately path-free: logs must not reveal what was downloaded.
        return Err(anyhow!("fpcalc exited with status {}", output.status));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_fpcalc(&stdout).context("parsing fpcalc output")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_fingerprint() {
        let json = r#"{"duration": 213.55, "fingerprint": "AQADtEmUaEkSJZIO"}"#;
        let fp = parse_fpcalc(json).unwrap();
        assert!((fp.duration - 213.55).abs() < 1e-9);
        assert_eq!(fp.fingerprint, "AQADtEmUaEkSJZIO");
    }

    #[test]
    fn rejects_empty_fingerprint() {
        let json = r#"{"duration": 100.0, "fingerprint": ""}"#;
        assert!(parse_fpcalc(json).is_err());
    }

    #[test]
    fn rejects_zero_duration() {
        let json = r#"{"duration": 0, "fingerprint": "AQAD"}"#;
        assert!(parse_fpcalc(json).is_err());
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse_fpcalc("<html>error</html>").is_err());
    }
}
