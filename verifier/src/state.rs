//! Durable record of which downloads we have already acted on, so a download
//! that is still sitting in Lidarr's queue between polls (an in-flight import,
//! or anything left untouched in DRY_RUN) is not verified again every cycle.
//!
//! Stored as a small JSON file under `STATE_DIR`. Keyed by Lidarr's
//! `downloadId`, which is stable for the life of a download. Only the outcome
//! and a timestamp are kept — never a track, album or file name.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProcessedRecord {
    pub outcome: String,
    pub at: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct State {
    #[serde(default)]
    processed: HashMap<String, ProcessedRecord>,
    #[serde(skip)]
    path: PathBuf,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl State {
    /// Load the state file from `state_dir`, or start empty if none exists.
    pub fn load(state_dir: &str) -> Result<Self> {
        let path = Path::new(state_dir).join("processed.json");
        if path.exists() {
            let raw = std::fs::read_to_string(&path)
                .with_context(|| format!("reading state file {}", path.display()))?;
            let mut state: State = serde_json::from_str(&raw)
                .with_context(|| format!("parsing state file {}", path.display()))?;
            state.path = path;
            Ok(state)
        } else {
            Ok(State {
                processed: HashMap::new(),
                path,
            })
        }
    }

    pub fn is_processed(&self, download_id: &str) -> bool {
        !download_id.is_empty() && self.processed.contains_key(download_id)
    }

    pub fn mark(&mut self, download_id: &str, outcome: &str) {
        if download_id.is_empty() {
            return;
        }
        self.processed.insert(
            download_id.to_string(),
            ProcessedRecord {
                outcome: outcome.to_string(),
                at: now_secs(),
            },
        );
    }

    /// Drop a record (e.g. an item that left the queue), so its id can be
    /// re-used by a future download without growing the file unbounded.
    pub fn forget(&mut self, download_id: &str) {
        self.processed.remove(download_id);
    }

    pub fn known_ids(&self) -> Vec<String> {
        self.processed.keys().cloned().collect()
    }

    pub fn save(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating state dir {}", parent.display()))?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let body = serde_json::to_string_pretty(self).context("serialising state")?;
        std::fs::write(&tmp, body).with_context(|| format!("writing {}", tmp.display()))?;
        std::fs::rename(&tmp, &self.path)
            .with_context(|| format!("renaming into {}", self.path.display()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_through_disk() {
        let dir = std::env::temp_dir().join(format!("shufflerr-verifier-test-{}", now_secs()));
        std::fs::create_dir_all(&dir).unwrap();
        let dir_str = dir.to_str().unwrap();

        {
            let mut s = State::load(dir_str).unwrap();
            assert!(!s.is_processed("ABC"));
            s.mark("ABC", "pass");
            s.mark("DEF", "fail");
            s.save().unwrap();
        }

        let s2 = State::load(dir_str).unwrap();
        assert!(s2.is_processed("ABC"));
        assert!(s2.is_processed("DEF"));
        assert!(!s2.is_processed("GHI"));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn empty_download_id_is_never_processed() {
        let s = State::default();
        assert!(!s.is_processed(""));
    }

    #[test]
    fn forget_removes_record() {
        let mut s = State::default();
        s.mark("ABC", "pass");
        assert!(s.is_processed("ABC"));
        s.forget("ABC");
        assert!(!s.is_processed("ABC"));
    }
}
