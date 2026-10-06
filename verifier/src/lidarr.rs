//! Minimal Lidarr v1 API client: read the download queue, look up a release's
//! recording MBIDs, drive a manual import, poll a command, and remove/blocklist
//! a rejected download.

use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};

pub struct Lidarr {
    client: Client,
    base_url: String,
    api_key: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct QueueItem {
    pub id: i64,
    #[serde(default)]
    pub status: String,
    #[serde(default, rename = "trackedDownloadState")]
    pub tracked_download_state: String,
    #[serde(default, rename = "trackedDownloadStatus")]
    pub tracked_download_status: String,
    #[serde(default, rename = "outputPath")]
    pub output_path: String,
    #[serde(default, rename = "downloadId")]
    pub download_id: String,
    #[serde(default, rename = "albumId")]
    pub album_id: i64,
    #[serde(default, rename = "artistId")]
    pub artist_id: i64,
    #[serde(default)]
    pub title: String,
}

#[derive(Debug, Deserialize)]
struct QueueResponse {
    #[serde(default)]
    records: Vec<QueueItem>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CommandStatus {
    pub id: i64,
    /// Lidarr command status: queued | started | completed | failed | aborted.
    pub status: String,
}

#[derive(Debug, Deserialize)]
struct CommandResponse {
    id: i64,
    #[serde(default)]
    status: String,
}

/// A track-by-track download does not block-import; only a finished download
/// that Lidarr could not (or has not yet) imported is our concern.
pub fn needs_verification(item: &QueueItem) -> bool {
    item.status.eq_ignore_ascii_case("completed")
        && matches!(
            item.tracked_download_state.as_str(),
            "importPending" | "importFailed" | "importBlocked"
        )
}

/// One track of a release, as far as verification cares: its recording MBID
/// (for identity matching) and expected duration.
#[derive(Debug, Clone, PartialEq)]
pub struct LidarrTrack {
    pub recording_mbid: String,
    pub duration_secs: Option<f64>,
}

/// Parse a `/track` response body into tracks carrying recording MBID and
/// duration. Lidarr reports `duration` in milliseconds.
fn parse_tracks(json: &str) -> Result<Vec<LidarrTrack>> {
    let tracks: Vec<Value> =
        serde_json::from_str(json).context("Lidarr /track response was not parseable")?;
    Ok(tracks
        .iter()
        .filter_map(|t| {
            let mbid = t.get("foreignRecordingId").and_then(|v| v.as_str())?;
            if mbid.is_empty() {
                return None;
            }
            let duration_secs = t
                .get("duration")
                .and_then(|v| v.as_f64())
                .filter(|&ms| ms > 0.0)
                .map(|ms| ms / 1000.0);
            Some(LidarrTrack {
                recording_mbid: mbid.to_string(),
                duration_secs,
            })
        })
        .collect())
}

/// Turn a `/manualimport` candidate into the file object the `ManualImport`
/// command expects. Returns `None` if the candidate has rejections or is
/// missing the identifiers Lidarr needs to file it.
pub fn build_import_file(candidate: &Value) -> Option<Value> {
    let rejections = candidate
        .get("rejections")
        .and_then(|r| r.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    if rejections > 0 {
        return None;
    }

    let path = candidate.get("path").and_then(|v| v.as_str())?;
    let artist_id = candidate
        .get("artist")
        .and_then(|a| a.get("id"))
        .and_then(|v| v.as_i64())?;
    let album_id = candidate
        .get("album")
        .and_then(|a| a.get("id"))
        .and_then(|v| v.as_i64())?;
    let album_release_id = candidate.get("albumReleaseId").and_then(|v| v.as_i64())?;

    let track_ids: Vec<i64> = candidate
        .get("tracks")
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| t.get("id").and_then(|v| v.as_i64()))
                .collect()
        })
        .unwrap_or_default();
    if track_ids.is_empty() {
        return None;
    }

    let quality = candidate.get("quality").cloned().unwrap_or(Value::Null);

    Some(json!({
        "path": path,
        "artistId": artist_id,
        "albumId": album_id,
        "albumReleaseId": album_release_id,
        "trackIds": track_ids,
        "quality": quality,
        "disableReleaseSwitching": false,
    }))
}

impl Lidarr {
    pub fn new(client: Client, base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Lidarr {
            client,
            base_url: base_url.into().trim_end_matches('/').to_string(),
            api_key: api_key.into(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}/api/v1/{}", self.base_url, path.trim_start_matches('/'))
    }

    pub async fn queue(&self) -> Result<Vec<QueueItem>> {
        let body = self
            .client
            .get(self.url("queue"))
            .header("X-Api-Key", &self.api_key)
            .query(&[
                ("pageSize", "200"),
                ("includeUnknownArtistItems", "true"),
                ("includeArtist", "false"),
                ("includeAlbum", "false"),
            ])
            .send()
            .await
            .context("Lidarr queue request failed")?
            .error_for_status()
            .context("Lidarr queue returned an error status")?
            .text()
            .await?;
        let parsed: QueueResponse =
            serde_json::from_str(&body).context("parsing Lidarr queue response")?;
        Ok(parsed.records)
    }

    pub async fn album_tracks(&self, album_id: i64) -> Result<Vec<LidarrTrack>> {
        let body = self
            .client
            .get(self.url("track"))
            .header("X-Api-Key", &self.api_key)
            .query(&[("albumId", album_id.to_string())])
            .send()
            .await
            .context("Lidarr track request failed")?
            .error_for_status()
            .context("Lidarr track returned an error status")?
            .text()
            .await?;
        parse_tracks(&body)
    }

    pub async fn manual_import_candidates(&self, download_id: &str) -> Result<Vec<Value>> {
        let body = self
            .client
            .get(self.url("manualimport"))
            .header("X-Api-Key", &self.api_key)
            .query(&[
                ("downloadId", download_id),
                ("filterExistingFiles", "true"),
            ])
            .send()
            .await
            .context("Lidarr manualimport request failed")?
            .error_for_status()
            .context("Lidarr manualimport returned an error status")?
            .json::<Vec<Value>>()
            .await
            .context("parsing Lidarr manualimport response")?;
        Ok(body)
    }

    /// Submit a `ManualImport` command (move mode) for the given file objects
    /// and return the command id to poll.
    pub async fn manual_import(&self, files: Vec<Value>) -> Result<i64> {
        let payload = json!({
            "name": "ManualImport",
            "importMode": "move",
            "files": files,
        });
        let resp: CommandResponse = self
            .client
            .post(self.url("command"))
            .header("X-Api-Key", &self.api_key)
            .json(&payload)
            .send()
            .await
            .context("Lidarr ManualImport command failed")?
            .error_for_status()
            .context("Lidarr ManualImport returned an error status")?
            .json()
            .await
            .context("parsing Lidarr command response")?;
        Ok(resp.id)
    }

    pub async fn command_status(&self, command_id: i64) -> Result<CommandStatus> {
        let resp: CommandResponse = self
            .client
            .get(self.url(&format!("command/{command_id}")))
            .header("X-Api-Key", &self.api_key)
            .send()
            .await
            .context("Lidarr command status request failed")?
            .error_for_status()
            .context("Lidarr command status returned an error")?
            .json()
            .await
            .context("parsing Lidarr command status")?;
        Ok(CommandStatus {
            id: resp.id,
            status: resp.status,
        })
    }

    /// Remove a download from the queue, from the client, and blocklist it so
    /// the same bad release is not grabbed again.
    pub async fn remove_and_blocklist(&self, queue_id: i64) -> Result<()> {
        self.client
            .delete(self.url(&format!("queue/{queue_id}")))
            .header("X-Api-Key", &self.api_key)
            .query(&[
                ("removeFromClient", "true"),
                ("blocklist", "true"),
                ("skipRedownload", "false"),
            ])
            .send()
            .await
            .context("Lidarr queue delete failed")?
            .error_for_status()
            .context("Lidarr queue delete returned an error")?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(status: &str, state: &str) -> QueueItem {
        QueueItem {
            id: 1,
            status: status.into(),
            tracked_download_state: state.into(),
            tracked_download_status: String::new(),
            output_path: "/x".into(),
            download_id: "d".into(),
            album_id: 10,
            artist_id: 5,
            title: String::new(),
        }
    }

    #[test]
    fn selects_only_completed_pending_imports() {
        assert!(needs_verification(&item("completed", "importPending")));
        assert!(needs_verification(&item("completed", "importFailed")));
        assert!(needs_verification(&item("completed", "importBlocked")));
        assert!(needs_verification(&item("Completed", "importPending")));
        assert!(!needs_verification(&item("downloading", "downloading")));
        assert!(!needs_verification(&item("completed", "imported")));
        assert!(!needs_verification(&item("paused", "importPending")));
    }

    #[test]
    fn parses_queue_records() {
        let json = r#"{"records":[
            {"id":42,"status":"completed","trackedDownloadState":"importFailed","outputPath":"/completed/x","downloadId":"ABC","albumId":7,"artistId":3,"title":"t"}
        ]}"#;
        let parsed: QueueResponse = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.records.len(), 1);
        let r = &parsed.records[0];
        assert_eq!(r.id, 42);
        assert_eq!(r.album_id, 7);
        assert_eq!(r.download_id, "ABC");
        assert!(needs_verification(r));
    }

    #[test]
    fn collects_tracks_with_mbid_and_duration() {
        let json = r#"[
            {"id":1,"foreignRecordingId":"97a6a79f-1111","duration":213547},
            {"id":2,"foreignRecordingId":"b2c3d4e5-2222"},
            {"id":3,"foreignRecordingId":""},
            {"id":4,"foreignRecordingId":"c3d4e5f6-3333","duration":0}
        ]"#;
        let tracks = parse_tracks(json).unwrap();
        assert_eq!(tracks.len(), 3);
        assert_eq!(tracks[0].recording_mbid, "97a6a79f-1111");
        assert!((tracks[0].duration_secs.unwrap() - 213.547).abs() < 1e-6);
        // MBID present, duration absent.
        assert_eq!(tracks[1].recording_mbid, "b2c3d4e5-2222");
        assert!(tracks[1].duration_secs.is_none());
        // Zero duration is treated as absent.
        assert!(tracks[2].duration_secs.is_none());
    }

    #[test]
    fn builds_import_file_from_candidate() {
        let candidate = json!({
            "path": "/completed/x/01.flac",
            "artist": { "id": 5 },
            "album": { "id": 10 },
            "albumReleaseId": 99,
            "tracks": [ { "id": 100 }, { "id": 101 } ],
            "quality": { "quality": { "id": 6, "name": "FLAC" } },
            "rejections": []
        });
        let file = build_import_file(&candidate).unwrap();
        assert_eq!(file["path"], "/completed/x/01.flac");
        assert_eq!(file["artistId"], 5);
        assert_eq!(file["albumId"], 10);
        assert_eq!(file["albumReleaseId"], 99);
        assert_eq!(file["trackIds"], json!([100, 101]));
        assert_eq!(file["disableReleaseSwitching"], false);
    }

    #[test]
    fn rejects_candidate_with_rejections() {
        let candidate = json!({
            "path": "/x/01.flac",
            "artist": { "id": 5 },
            "album": { "id": 10 },
            "albumReleaseId": 99,
            "tracks": [ { "id": 100 } ],
            "rejections": [ { "reason": "Unknown artist" } ]
        });
        assert!(build_import_file(&candidate).is_none());
    }

    #[test]
    fn rejects_candidate_without_tracks() {
        let candidate = json!({
            "path": "/x/01.flac",
            "artist": { "id": 5 },
            "album": { "id": 10 },
            "albumReleaseId": 99,
            "tracks": [],
            "rejections": []
        });
        assert!(build_import_file(&candidate).is_none());
    }
}
