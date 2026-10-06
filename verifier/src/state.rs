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
    /// How many distinct downloads we have rejected for a given Lidarr album id.
    /// Used to bound blocklist→re-search churn: once every available release for
    /// an album keeps failing verification, we stop asking Lidarr to grab yet
    /// another copy. Keyed by album id as a string.
    #[serde(default)]
    album_rejects: HashMap<String, u32>,
    /// Direct-submit bypass: download-client id (SAB nzo_id / qBittorrent hash,
    /// which equals Lidarr's queue `downloadId`) → the Lidarr album id we
    /// submitted it for. Lets the verifier import a download Lidarr itself
    /// cannot parse, against the album we know it belongs to.
    #[serde(default)]
    grab_map: HashMap<String, i64>,
    /// Album id → unix seconds of the last direct submit, so the same album is
    /// not re-submitted every cycle while its download is in flight.
    #[serde(default)]
    grabbed_albums: HashMap<String, u64>,
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
                album_rejects: HashMap::new(),
                grab_map: HashMap::new(),
                grabbed_albums: HashMap::new(),
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

    /// Record a rejection for an album and return the running count. Album ids
    /// <= 0 (unknown/unmapped) are not tracked and return `u32::MAX`, so the
    /// caller treats them as already past the re-search cap (no point asking
    /// Lidarr to re-grab something it cannot even map).
    pub fn record_album_reject(&mut self, album_id: i64) -> u32 {
        if album_id <= 0 {
            return u32::MAX;
        }
        let entry = self.album_rejects.entry(album_id.to_string()).or_insert(0);
        *entry = entry.saturating_add(1);
        *entry
    }

    pub fn known_ids(&self) -> Vec<String> {
        self.processed.keys().cloned().collect()
    }

    /// Record a direct-submit: map the download-client id to the album it was
    /// grabbed for, and stamp the album's grab time for the cooldown.
    pub fn record_grab(&mut self, download_id: &str, album_id: i64) {
        if !download_id.is_empty() {
            self.grab_map.insert(download_id.to_string(), album_id);
        }
        if album_id > 0 {
            self.grabbed_albums.insert(album_id.to_string(), now_secs());
        }
    }

    /// The album a direct-submitted download was grabbed for, if known. Lidarr's
    /// own `albumId` is 0/unknown for these (it could not parse them), so this
    /// mapping is how we still import them against the right album.
    pub fn mapped_album(&self, download_id: &str) -> Option<i64> {
        if download_id.is_empty() {
            return None;
        }
        self.grab_map.get(download_id).copied()
    }

    /// True if this album was direct-submitted within the cooldown window, so we
    /// should not submit it again yet.
    pub fn recently_grabbed(&self, album_id: i64, cooldown_secs: u64) -> bool {
        if album_id <= 0 {
            return false;
        }
        match self.grabbed_albums.get(&album_id.to_string()) {
            Some(&at) => now_secs().saturating_sub(at) < cooldown_secs,
            None => false,
        }
    }

    /// Drop a grab mapping once its download has left the queue (imported or
    /// removed), keeping the file bounded.
    pub fn forget_grab(&mut self, download_id: &str) {
        self.grab_map.remove(download_id);
    }

    pub fn grab_ids(&self) -> Vec<String> {
        self.grab_map.keys().cloned().collect()
    }

    /// Expire album grab-cooldown stamps older than `cooldown_secs`.
    pub fn prune_grab_cooldowns(&mut self, cooldown_secs: u64) {
        let now = now_secs();
        self.grabbed_albums
            .retain(|_, &mut at| now.saturating_sub(at) < cooldown_secs);
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

    #[test]
    fn album_reject_count_increments_and_persists() {
        let dir = std::env::temp_dir().join(format!("shufflerr-verifier-ar-{}", now_secs()));
        std::fs::create_dir_all(&dir).unwrap();
        let dir_str = dir.to_str().unwrap();
        {
            let mut s = State::load(dir_str).unwrap();
            assert_eq!(s.record_album_reject(42), 1);
            assert_eq!(s.record_album_reject(42), 2);
            assert_eq!(s.record_album_reject(7), 1);
            s.save().unwrap();
        }
        let mut s2 = State::load(dir_str).unwrap();
        assert_eq!(s2.record_album_reject(42), 3); // persisted across reload
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unmapped_album_is_past_cap() {
        let mut s = State::default();
        assert_eq!(s.record_album_reject(0), u32::MAX);
        assert_eq!(s.record_album_reject(-1), u32::MAX);
    }

    #[test]
    fn grab_mapping_roundtrips_and_persists() {
        let dir = std::env::temp_dir().join(format!("shufflerr-verifier-grab-{}", now_secs()));
        std::fs::create_dir_all(&dir).unwrap();
        let dir_str = dir.to_str().unwrap();
        {
            let mut s = State::load(dir_str).unwrap();
            assert!(s.mapped_album("nzo_123").is_none());
            s.record_grab("nzo_123", 520);
            assert_eq!(s.mapped_album("nzo_123"), Some(520));
            assert!(s.recently_grabbed(520, 3600));
            assert!(!s.recently_grabbed(999, 3600));
            s.save().unwrap();
        }
        let mut s2 = State::load(dir_str).unwrap();
        assert_eq!(s2.mapped_album("nzo_123"), Some(520)); // persisted
        assert!(s2.recently_grabbed(520, 3600));
        s2.forget_grab("nzo_123");
        assert!(s2.mapped_album("nzo_123").is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn empty_download_id_never_maps() {
        let mut s = State::default();
        s.record_grab("", 10);
        assert!(s.mapped_album("").is_none());
    }

    #[test]
    fn cooldown_window_respected() {
        let mut s = State::default();
        s.record_grab("x", 5);
        assert!(s.recently_grabbed(5, 3600));
        // A zero-length window means nothing is ever "recent".
        assert!(!s.recently_grabbed(5, 0));
    }
}
