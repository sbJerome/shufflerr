//! Direct submission to the download client, bypassing Lidarr's grab endpoint
//! (and therefore its release matcher). The client connection settings are read
//! from Lidarr's own `/api/v1/downloadclient` config — Shufflerr does not
//! configure indexers/downloaders separately, it sources them from Lidarr.
//!
//! On submit we return the client-assigned download id(s): SABnzbd's `nzo_id`
//! or qBittorrent's torrent hash. That id is exactly what Lidarr reports as the
//! queue `downloadId` once it picks the completed download up, so the verifier
//! can map the finished download back to the album it was grabbed for.

use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::Deserialize;
use serde_json::Value;

/// One configured Lidarr download client. `fields` is kept raw so we can read
/// implementation-specific settings by name without a rigid schema.
#[derive(Debug, Clone, Deserialize)]
pub struct DownloadClient {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub enable: bool,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub implementation: String,
    #[serde(default)]
    pub fields: Vec<Field>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Field {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub value: Value,
}

impl DownloadClient {
    fn field(&self, name: &str) -> Option<&Value> {
        self.fields
            .iter()
            .find(|f| f.name.eq_ignore_ascii_case(name))
            .map(|f| &f.value)
    }

    fn field_str(&self, name: &str) -> Option<String> {
        match self.field(name)? {
            Value::String(s) if !s.is_empty() => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        }
    }

    fn field_u64(&self, name: &str) -> Option<u64> {
        match self.field(name)? {
            Value::Number(n) => n.as_u64(),
            Value::String(s) => s.parse().ok(),
            _ => None,
        }
    }

    fn field_bool(&self, name: &str) -> bool {
        matches!(self.field(name), Some(Value::Bool(true)))
    }

    /// The category this client files music under (empty if none configured).
    fn category(&self) -> String {
        self.field_str("musicCategory")
            .or_else(|| self.field_str("category"))
            .or_else(|| self.field_str("tvCategory"))
            .unwrap_or_default()
    }

    /// Base URL `scheme://host:port<urlBase>` with no trailing slash.
    fn base_url(&self) -> Result<String> {
        let host = self
            .field_str("host")
            .ok_or_else(|| anyhow!("download client has no host configured"))?;
        let port = self.field_u64("port").unwrap_or(0);
        let scheme = if self.field_bool("useSsl") { "https" } else { "http" };
        let mut url = if port > 0 {
            format!("{scheme}://{host}:{port}")
        } else {
            format!("{scheme}://{host}")
        };
        if let Some(base) = self.field_str("urlBase") {
            let base = base.trim_matches('/');
            if !base.is_empty() {
                url.push('/');
                url.push_str(base);
            }
        }
        Ok(url.trim_end_matches('/').to_string())
    }

    pub fn is_usenet(&self) -> bool {
        self.protocol.eq_ignore_ascii_case("usenet")
            || self.implementation.to_ascii_lowercase().contains("sab")
            || self.implementation.to_ascii_lowercase().contains("nzb")
    }

    pub fn is_sabnzbd(&self) -> bool {
        self.implementation.to_ascii_lowercase().contains("sab")
    }

    pub fn is_qbittorrent(&self) -> bool {
        self.implementation.to_ascii_lowercase().contains("qbit")
    }

    /// Submit a release's download URL straight to this client. Returns the
    /// client-assigned id(s) (nzo_id / torrent hash) to map back to the album.
    pub async fn submit(&self, http: &Client, download_url: &str) -> Result<Vec<String>> {
        if self.is_sabnzbd() {
            self.submit_sabnzbd(http, download_url).await
        } else if self.is_qbittorrent() {
            self.submit_qbittorrent(http, download_url)
                .await
                .map(|h| vec![h])
        } else {
            Err(anyhow!(
                "unsupported download client implementation for direct submit"
            ))
        }
    }

    async fn submit_sabnzbd(&self, http: &Client, download_url: &str) -> Result<Vec<String>> {
        // Lidarr's API masks download-client secrets, so prefer SAB_API_KEY from
        // the sidecar's own secret; fall back to Lidarr's (possibly masked) value.
        let apikey = std::env::var("SAB_API_KEY")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| self.field_str("apiKey"))
            .ok_or_else(|| anyhow!("SABnzbd client has no apiKey"))?;
        let url = format!("{}/api", self.base_url()?);
        let cat = self.category();
        let mut query: Vec<(&str, String)> = vec![
            ("mode", "addurl".to_string()),
            ("name", download_url.to_string()),
            ("output", "json".to_string()),
            ("apikey", apikey),
        ];
        if !cat.is_empty() {
            query.push(("cat", cat));
        }
        // SECURITY: errors here are built from the HTTP status ONLY — never from
        // the reqwest error or the request URL, which carry the indexer API key
        // and the release name in the `name=` parameter.
        let resp = http
            .get(&url)
            .query(&query)
            .send()
            .await
            .map_err(|e| {
                anyhow!(
                    "SABnzbd addurl request failed (timeout={}, connect={})",
                    e.is_timeout(),
                    e.is_connect()
                )
            })?;
        let status = resp.status();
        if !status.is_success() {
            return Err(anyhow!("SABnzbd addurl HTTP {}", status.as_u16()));
        }
        let body = resp
            .text()
            .await
            .map_err(|_| anyhow!("reading SABnzbd addurl response body"))?;
        parse_sab_addurl(&body)
    }

    /// qBittorrent: log in for a session cookie, add the URL, then read back the
    /// newest torrent in our category to learn its hash. Best-effort — the hash
    /// lookup is racy under heavy concurrent adds, but direct-submit is paced.
    async fn submit_qbittorrent(&self, http: &Client, download_url: &str) -> Result<String> {
        let base = self.base_url()?;
        let user = self.field_str("username").unwrap_or_default();
        let pass = self.field_str("password").unwrap_or_default();

        // 1) login -> capture the SID cookie from Set-Cookie.
        let login = http
            .post(format!("{base}/api/v2/auth/login"))
            .form(&[("username", user.as_str()), ("password", pass.as_str())])
            .send()
            .await
            .context("qBittorrent login failed")?;
        let cookie = login
            .headers()
            .get(reqwest::header::SET_COOKIE)
            .and_then(|v| v.to_str().ok())
            .and_then(|c| c.split(';').next())
            .map(|s| s.to_string());

        let cat = self.category();
        let mut add = http.post(format!("{base}/api/v2/torrents/add"));
        if let Some(c) = &cookie {
            add = add.header(reqwest::header::COOKIE, c);
        }
        let mut form = vec![("urls".to_string(), download_url.to_string())];
        if !cat.is_empty() {
            form.push(("category".to_string(), cat.clone()));
        }
        let add_status = add
            .form(&form)
            .send()
            .await
            .map_err(|e| {
                anyhow!(
                    "qBittorrent add failed (timeout={}, connect={})",
                    e.is_timeout(),
                    e.is_connect()
                )
            })?
            .status();
        if !add_status.is_success() {
            return Err(anyhow!("qBittorrent add HTTP {}", add_status.as_u16()));
        }

        // 2) read newest torrent in the category to get its hash.
        let mut info = http.get(format!("{base}/api/v2/torrents/info"));
        if let Some(c) = &cookie {
            info = info.header(reqwest::header::COOKIE, c);
        }
        let mut q = vec![("sort", "added_on"), ("reverse", "true")];
        if !cat.is_empty() {
            q.push(("category", cat.as_str()));
        }
        let torrents: Vec<Value> = info
            .query(&q)
            .send()
            .await
            .context("qBittorrent info failed")?
            .json()
            .await
            .context("parsing qBittorrent info")?;
        torrents
            .first()
            .and_then(|t| t.get("hash"))
            .and_then(|h| h.as_str())
            .map(|h| h.to_string())
            .ok_or_else(|| anyhow!("qBittorrent did not report a torrent hash"))
    }
}

/// Parse SABnzbd's `addurl` JSON response into the returned `nzo_ids`.
fn parse_sab_addurl(body: &str) -> Result<Vec<String>> {
    let v: Value = serde_json::from_str(body).context("SABnzbd response was not JSON")?;
    if v.get("status").and_then(|s| s.as_bool()) == Some(false) {
        let err = v
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("unknown error");
        return Err(anyhow!("SABnzbd rejected the submission: {err}"));
    }
    let ids: Vec<String> = v
        .get("nzo_ids")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    if ids.is_empty() {
        return Err(anyhow!("SABnzbd accepted the submission but returned no nzo_id"));
    }
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sab() -> DownloadClient {
        serde_json::from_value(json!({
            "id": 3, "name": "SABnzbd", "enable": true, "protocol": "usenet",
            "implementation": "Sabnzbd",
            "fields": [
                {"name":"host","value":"sab.local"},
                {"name":"port","value":8080},
                {"name":"apiKey","value":"KEY"},
                {"name":"urlBase","value":"/sab"},
                {"name":"useSsl","value":false},
                {"name":"musicCategory","value":"music"}
            ]
        }))
        .unwrap()
    }

    #[test]
    fn builds_base_url_with_urlbase() {
        assert_eq!(sab().base_url().unwrap(), "http://sab.local:8080/sab");
    }

    #[test]
    fn reads_category_and_classification() {
        let c = sab();
        assert_eq!(c.category(), "music");
        assert!(c.is_sabnzbd());
        assert!(c.is_usenet());
        assert!(!c.is_qbittorrent());
    }

    #[test]
    fn https_base_url_without_port() {
        let c: DownloadClient = serde_json::from_value(json!({
            "implementation":"QBittorrent","protocol":"torrent",
            "fields":[{"name":"host","value":"qb.local"},{"name":"useSsl","value":true}]
        }))
        .unwrap();
        assert_eq!(c.base_url().unwrap(), "https://qb.local");
        assert!(c.is_qbittorrent());
    }

    #[test]
    fn parses_sab_nzo_ids() {
        let ids = parse_sab_addurl(r#"{"status":true,"nzo_ids":["SABnzbd_nzo_abc","SABnzbd_nzo_def"]}"#).unwrap();
        assert_eq!(ids, vec!["SABnzbd_nzo_abc", "SABnzbd_nzo_def"]);
    }

    #[test]
    fn sab_failure_is_an_error() {
        assert!(parse_sab_addurl(r#"{"status":false,"error":"API Key Incorrect"}"#).is_err());
    }

    #[test]
    fn sab_no_ids_is_an_error() {
        assert!(parse_sab_addurl(r#"{"status":true,"nzo_ids":[]}"#).is_err());
    }
}
