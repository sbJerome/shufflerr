//! AcoustID lookup: turn a Chromaprint fingerprint into candidate MusicBrainz
//! recording MBIDs.
//!
//! We POST `client`, `duration`, `fingerprint` and `meta=recordingids` to the
//! AcoustID v2 lookup endpoint and collect the recording ids of every match,
//! each tagged with the match score so the caller can weigh confidence.

use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::Deserialize;
use std::collections::BTreeMap;

/// One candidate recording returned by AcoustID, with the best score seen.
#[derive(Debug, Clone, PartialEq)]
pub struct RecordingMatch {
    pub recording_mbid: String,
    pub score: f64,
}

#[derive(Debug, Deserialize)]
struct LookupResponse {
    #[serde(default)]
    status: String,
    #[serde(default)]
    error: Option<LookupError>,
    #[serde(default)]
    results: Vec<LookupResult>,
}

#[derive(Debug, Deserialize)]
struct LookupError {
    #[serde(default)]
    message: String,
}

#[derive(Debug, Deserialize)]
struct LookupResult {
    #[serde(default)]
    score: f64,
    #[serde(default)]
    recordings: Vec<LookupRecording>,
}

#[derive(Debug, Deserialize)]
struct LookupRecording {
    #[serde(default)]
    id: String,
}

/// Parse an AcoustID lookup response body into de-duplicated recording matches,
/// keeping the highest score for each recording id.
fn parse_lookup(json: &str) -> Result<Vec<RecordingMatch>> {
    let resp: LookupResponse =
        serde_json::from_str(json).context("AcoustID response was not parseable")?;

    if resp.status != "ok" {
        let msg = resp
            .error
            .map(|e| e.message)
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| "unknown error".to_string());
        return Err(anyhow!("AcoustID lookup failed: {msg}"));
    }

    let mut best: BTreeMap<String, f64> = BTreeMap::new();
    for result in &resp.results {
        for rec in &result.recordings {
            if rec.id.is_empty() {
                continue;
            }
            let entry = best.entry(rec.id.clone()).or_insert(0.0);
            if result.score > *entry {
                *entry = result.score;
            }
        }
    }

    Ok(best
        .into_iter()
        .map(|(recording_mbid, score)| RecordingMatch { recording_mbid, score })
        .collect())
}

/// Query AcoustID for the recordings matching `fingerprint`/`duration`.
pub async fn lookup(
    client: &Client,
    endpoint: &str,
    api_key: &str,
    duration: f64,
    fingerprint: &str,
) -> Result<Vec<RecordingMatch>> {
    let duration_str = (duration.round() as i64).to_string();
    let params = [
        ("client", api_key),
        ("duration", duration_str.as_str()),
        ("fingerprint", fingerprint),
        ("meta", "recordingids"),
    ];

    let resp = client
        .post(endpoint)
        .form(&params)
        .send()
        .await
        .context("AcoustID request failed")?;

    let status = resp.status();
    let body = resp.text().await.context("reading AcoustID response body")?;
    if !status.is_success() {
        return Err(anyhow!("AcoustID returned HTTP {status}"));
    }

    parse_lookup(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_recording_ids_with_best_score() {
        let json = r#"{
            "status": "ok",
            "results": [
                { "score": 0.91, "recordings": [ { "id": "aaaa" }, { "id": "bbbb" } ] },
                { "score": 0.99, "recordings": [ { "id": "aaaa" } ] }
            ]
        }"#;
        let matches = parse_lookup(json).unwrap();
        // De-duped and sorted by id; "aaaa" keeps the higher 0.99 score.
        assert_eq!(matches.len(), 2);
        let aaaa = matches.iter().find(|m| m.recording_mbid == "aaaa").unwrap();
        assert!((aaaa.score - 0.99).abs() < 1e-9);
        let bbbb = matches.iter().find(|m| m.recording_mbid == "bbbb").unwrap();
        assert!((bbbb.score - 0.91).abs() < 1e-9);
    }

    #[test]
    fn empty_results_is_ok_but_empty() {
        let json = r#"{ "status": "ok", "results": [] }"#;
        assert!(parse_lookup(json).unwrap().is_empty());
    }

    #[test]
    fn error_status_is_an_error() {
        let json = r#"{ "status": "error", "error": { "message": "invalid fingerprint" } }"#;
        let err = parse_lookup(json).unwrap_err();
        assert!(err.to_string().contains("invalid fingerprint"));
    }

    #[test]
    fn skips_results_without_recordings() {
        let json = r#"{ "status": "ok", "results": [ { "score": 0.8 } ] }"#;
        assert!(parse_lookup(json).unwrap().is_empty());
    }
}
