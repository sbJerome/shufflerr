//! Minimal Lidarr v1 API client: read the download queue, look up a release's
//! recording MBIDs, drive a manual import, poll a command, and remove/blocklist
//! a rejected download.

use crate::downloadclient::DownloadClient;
use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};

/// A candidate release from Lidarr's interactive search (`/release`). This
/// includes releases Lidarr's own grab path would REJECT (unparseable/unknown
/// artist), which is exactly what the direct-submit bypass needs.
#[derive(Debug, Clone, PartialEq)]
pub struct Release {
    pub guid: String,
    pub download_url: String,
    pub protocol: String,
    pub indexer_id: i64,
    pub quality_name: String,
    pub quality_weight: i64,
    pub age_days: f64,
    /// Release size in bytes (0 = unknown). Used to reject a release that is
    /// implausibly large for the album (a discography/VA pack grabbed for a
    /// single album), which would otherwise download hundreds of wrong tracks.
    pub size: i64,
}

fn release_is_lossless(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    ["flac", "alac", "ape", "wav", "wavpack"].iter().any(|k| n.contains(k))
}

/// Parse `/release` results, keeping only releases with a usable download URL.
fn parse_releases(json: &str) -> Result<Vec<Release>> {
    let arr: Vec<Value> =
        serde_json::from_str(json).context("Lidarr /release response was not parseable")?;
    Ok(arr
        .iter()
        .filter_map(|r| {
            let download_url = r.get("downloadUrl").and_then(|v| v.as_str())?.to_string();
            if download_url.is_empty() {
                return None;
            }
            Some(Release {
                guid: r.get("guid").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                download_url,
                protocol: r.get("protocol").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                indexer_id: r.get("indexerId").and_then(|v| v.as_i64()).unwrap_or(0),
                quality_name: r
                    .get("quality")
                    .and_then(|q| q.get("quality"))
                    .and_then(|q| q.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                quality_weight: r.get("qualityWeight").and_then(|v| v.as_i64()).unwrap_or(0),
                age_days: r.get("age").and_then(|v| v.as_f64()).unwrap_or(0.0),
                size: r.get("size").and_then(|v| v.as_i64()).unwrap_or(0),
            })
        })
        .collect())
}

/// Pick the best release: prefer lossless, then highest quality weight, then
/// the newest (smallest age) as a tie-break. Ignores Lidarr's own rejections.
pub fn pick_best_release(releases: &[Release], max_size: Option<i64>) -> Option<&Release> {
    releases
        .iter()
        .filter(|r| match max_size {
            // Keep releases within the size budget; size 0 = unknown, keep it.
            Some(max) if max > 0 => r.size <= max || r.size == 0,
            _ => true,
        })
        .max_by(|a, b| {
        release_is_lossless(&a.quality_name)
            .cmp(&release_is_lossless(&b.quality_name))
            .then(a.quality_weight.cmp(&b.quality_weight))
            .then(
                b.age_days
                    .partial_cmp(&a.age_days)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    })
}

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
/// command expects. Returns `None` only when the candidate lacks the
/// identifiers Lidarr needs to file it (artist/album/release/tracks).
///
/// Lidarr's manual-import `rejections` are deliberately IGNORED here: they are
/// advisory warnings for the interactive UI (e.g. "Has missing tracks" on a
/// partial album, quality/cutoff notes), not hard errors. This sidecar is the
/// authority — the file has already passed identity + specs + transcode
/// verification — so a verifier-approved release is imported regardless of
/// Lidarr's own conservative judgement, which is the entire point of bypassing
/// its auto-import. A candidate that genuinely cannot be mapped (no artist,
/// album, release or track ids) is still skipped below.
pub fn build_import_file(candidate: &Value) -> Option<Value> {
    build_import_file_scoped(candidate, None)
}

/// As [`build_import_file`], but when `allowed_recording_mbids` is `Some`, only
/// the candidate's tracks whose `foreignRecordingId` is in that set are filed —
/// so a release downloaded for a track-scope request imports ONLY the requested
/// track(s), not the whole album. Returns `None` if the candidate maps to none
/// of the requested tracks. `None` for the scope → all tracks (album scope).
pub fn build_import_file_scoped(
    candidate: &Value,
    allowed_recording_mbids: Option<&[String]>,
) -> Option<Value> {
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
                .filter_map(|t| {
                    let id = t.get("id").and_then(|v| v.as_i64())?;
                    if let Some(allowed) = allowed_recording_mbids {
                        let rec = t
                            .get("foreignRecordingId")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if !allowed.iter().any(|m| m.eq_ignore_ascii_case(rec)) {
                            return None;
                        }
                    }
                    Some(id)
                })
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
        self.manual_import_candidates_scoped(download_id, None, None)
            .await
    }

    /// Like `manual_import_candidates`, but optionally scoped to a known
    /// artist/album. For a direct-submitted download Lidarr cannot parse, its
    /// queue item has no album; passing the album we grabbed it for makes Lidarr
    /// map the files to that album's tracks and return usable candidates.
    pub async fn manual_import_candidates_scoped(
        &self,
        download_id: &str,
        artist_id: Option<i64>,
        album_id: Option<i64>,
    ) -> Result<Vec<Value>> {
        let mut query: Vec<(&str, String)> = vec![
            ("downloadId", download_id.to_string()),
            ("filterExistingFiles", "true".to_string()),
        ];
        if let Some(a) = artist_id {
            query.push(("artistId", a.to_string()));
        }
        if let Some(a) = album_id {
            query.push(("albumId", a.to_string()));
        }
        let body = self
            .client
            .get(self.url("manualimport"))
            .header("X-Api-Key", &self.api_key)
            .query(&query)
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

    /// Lidarr's configured download clients (Shufflerr submits directly to the
    /// enabled one, bypassing Lidarr's grab).
    pub async fn download_clients(&self) -> Result<Vec<DownloadClient>> {
        let body = self
            .client
            .get(self.url("downloadclient"))
            .header("X-Api-Key", &self.api_key)
            .send()
            .await
            .context("Lidarr downloadclient request failed")?
            .error_for_status()
            .context("Lidarr downloadclient returned an error status")?
            .text()
            .await?;
        serde_json::from_str(&body).context("parsing Lidarr downloadclient response")
    }

    /// Interactive release search for an album (queries the configured
    /// indexers). Returns ALL releases, including ones Lidarr would reject.
    pub async fn releases(&self, album_id: i64) -> Result<Vec<Release>> {
        let body = self
            .client
            .get(self.url("release"))
            .header("X-Api-Key", &self.api_key)
            .query(&[("albumId", album_id.to_string())])
            .send()
            .await
            .context("Lidarr release search failed")?
            .error_for_status()
            .context("Lidarr release search returned an error status")?
            .text()
            .await?;
        parse_releases(&body)
    }

    /// Monitored albums that are missing tracks (candidates for direct grab).
    pub async fn missing_album_ids(&self) -> Result<Vec<i64>> {
        let body = self
            .client
            .get(self.url("wanted/missing"))
            .header("X-Api-Key", &self.api_key)
            .query(&[
                ("pageSize", "200"),
                ("includeArtist", "false"),
                ("monitored", "true"),
            ])
            .send()
            .await
            .context("Lidarr wanted/missing request failed")?
            .error_for_status()
            .context("Lidarr wanted/missing returned an error status")?
            .text()
            .await?;
        let v: Value = serde_json::from_str(&body).context("parsing wanted/missing")?;
        Ok(v.get("records")
            .and_then(|r| r.as_array())
            .map(|arr| {
                arr.iter()
                    .filter(|a| a.get("monitored").and_then(|m| m.as_bool()).unwrap_or(false))
                    .filter_map(|a| a.get("id").and_then(|i| i.as_i64()))
                    .collect()
            })
            .unwrap_or_default())
    }

    /// The artist id that owns an album (needed to scope a manual import).
    pub async fn album_artist_id(&self, album_id: i64) -> Result<i64> {
        let body = self
            .client
            .get(self.url(&format!("album/{album_id}")))
            .header("X-Api-Key", &self.api_key)
            .send()
            .await
            .context("Lidarr album request failed")?
            .error_for_status()
            .context("Lidarr album returned an error status")?
            .text()
            .await?;
        let v: Value = serde_json::from_str(&body).context("parsing album")?;
        v.get("artistId")
            .and_then(|x| x.as_i64())
            .or_else(|| v.get("artist").and_then(|a| a.get("id")).and_then(|x| x.as_i64()))
            .ok_or_else(|| anyhow!("album response had no artist id"))
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
    ///
    /// `research` controls whether Lidarr immediately searches for a replacement
    /// (`skipRedownload=false`) or just blocklists without re-grabbing
    /// (`skipRedownload=true`). The caller caps re-search per album so that an
    /// album whose every release keeps failing verification does not churn
    /// through blocklist→re-search→re-grab forever.
    pub async fn remove_and_blocklist(&self, queue_id: i64, research: bool) -> Result<()> {
        let skip_redownload = if research { "false" } else { "true" };
        self.client
            .delete(self.url(&format!("queue/{queue_id}")))
            .header("X-Api-Key", &self.api_key)
            .query(&[
                ("removeFromClient", "true"),
                ("blocklist", "true"),
                ("skipRedownload", skip_redownload),
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
    fn imports_despite_advisory_rejections_when_mapping_present() {
        // Lidarr's manual-import rejections (e.g. "Has missing tracks") are
        // advisory; a verifier-approved, fully-mapped candidate is imported.
        let candidate = json!({
            "path": "/x/01.flac",
            "artist": { "id": 5 },
            "album": { "id": 10 },
            "albumReleaseId": 99,
            "tracks": [ { "id": 100 } ],
            "quality": { "quality": { "id": 6, "name": "FLAC" } },
            "rejections": [ { "reason": "Has missing tracks" } ]
        });
        let file = build_import_file(&candidate).expect("should still build");
        assert_eq!(file["trackIds"], json!([100]));
    }

    #[test]
    fn skips_candidate_with_no_mapping() {
        // Truly unmappable (e.g. unknown artist): no ids to file it under.
        let candidate = json!({
            "path": "/x/01.flac",
            "rejections": [ { "reason": "Unknown Artist" } ]
        });
        assert!(build_import_file(&candidate).is_none());
    }

    fn two_track_candidate() -> Value {
        json!({
            "path": "/x/01.flac",
            "artist": { "id": 5 },
            "album": { "id": 10 },
            "albumReleaseId": 99,
            "tracks": [
                { "id": 100, "foreignRecordingId": "rec-a" },
                { "id": 101, "foreignRecordingId": "rec-b" }
            ],
            "rejections": []
        })
    }

    #[test]
    fn scope_none_imports_all_tracks() {
        let file = build_import_file_scoped(&two_track_candidate(), None).unwrap();
        assert_eq!(file["trackIds"], json!([100, 101]));
    }

    #[test]
    fn scope_imports_only_requested_tracks() {
        let allowed = vec!["REC-A".to_string()]; // case-insensitive match
        let file = build_import_file_scoped(&two_track_candidate(), Some(&allowed)).unwrap();
        assert_eq!(file["trackIds"], json!([100]));
    }

    #[test]
    fn scope_with_no_requested_track_present_is_skipped() {
        let allowed = vec!["rec-z".to_string()];
        assert!(build_import_file_scoped(&two_track_candidate(), Some(&allowed)).is_none());
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

    #[test]
    fn parses_releases_and_skips_urlless() {
        let json = r#"[
            {"guid":"g1","downloadUrl":"http://x/1.nzb","protocol":"usenet","indexerId":2,
             "quality":{"quality":{"name":"FLAC"}},"qualityWeight":1005,"age":12.0},
            {"guid":"g2","downloadUrl":"","protocol":"usenet","quality":{"quality":{"name":"MP3-320"}}},
            {"guid":"g3","downloadUrl":"http://x/3.torrent","protocol":"torrent","indexerId":4,
             "quality":{"quality":{"name":"MP3-320"}},"qualityWeight":800,"age":3.0}
        ]"#;
        let rs = parse_releases(json).unwrap();
        assert_eq!(rs.len(), 2); // the url-less one is dropped
        assert_eq!(rs[0].quality_name, "FLAC");
        assert_eq!(rs[0].indexer_id, 2);
    }

    fn rel(guid: &str, quality: &str, weight: i64, age: f64, size: i64) -> Release {
        Release {
            guid: guid.into(),
            download_url: "u".into(),
            protocol: "usenet".into(),
            indexer_id: 1,
            quality_name: quality.into(),
            quality_weight: weight,
            age_days: age,
            size,
        }
    }

    #[test]
    fn picks_lossless_over_higher_weight_lossy() {
        let rs = vec![
            rel("a", "MP3-320", 900, 1.0, 0),
            rel("b", "FLAC", 500, 50.0, 0),
        ];
        assert_eq!(pick_best_release(&rs, None).unwrap().quality_name, "FLAC");
    }

    #[test]
    fn picks_higher_weight_then_newer_among_lossless() {
        let rs = vec![
            rel("a", "FLAC", 1005, 40.0, 0),
            rel("b", "FLAC 24bit", 1010, 5.0, 0),
        ];
        assert_eq!(pick_best_release(&rs, None).unwrap().guid, "b"); // higher weight wins
    }

    #[test]
    fn pick_best_on_empty_is_none() {
        assert!(pick_best_release(&[], None).is_none());
    }

    #[test]
    fn size_guard_skips_oversized_pack() {
        // A small album release and a huge discography pack; budget allows only
        // album-sized releases. The oversized pack (higher weight) is skipped.
        let album = rel("album", "FLAC", 900, 10.0, 500_000_000); // ~500 MB
        let pack = rel("pack", "FLAC", 1010, 2.0, 25_000_000_000); // ~25 GB
        let rs = vec![pack, album];
        let budget = Some(12 * 200_000_000i64); // ~2.4 GB for a 12-track album
        assert_eq!(pick_best_release(&rs, budget).unwrap().guid, "album");
        // Unknown size (0) is always allowed.
        let unknown = vec![rel("x", "FLAC", 1, 1.0, 0)];
        assert_eq!(pick_best_release(&unknown, budget).unwrap().guid, "x");
        // No budget → size ignored, highest weight wins.
        let rs2 = vec![rel("p", "FLAC", 1010, 1.0, 25_000_000_000), rel("a", "FLAC", 900, 1.0, 500_000_000)];
        assert_eq!(pick_best_release(&rs2, None).unwrap().guid, "p");
    }
}
