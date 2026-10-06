//! Container/stream inspection via `ffprobe`.
//!
//! We shell out to `ffprobe -v quiet -print_format json -show_format
//! -show_streams <file>` and pull out the first audio stream's technical
//! specs plus the container duration.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use std::path::Path;
use tokio::process::Command;

/// Technical specs of a single audio file, as reported by ffprobe.
#[derive(Debug, Clone, PartialEq)]
pub struct AudioSpecs {
    pub codec: String,
    /// True for codecs that carry no generational loss (flac, alac, wav/pcm…).
    pub lossless: bool,
    pub sample_rate: u32,
    pub channels: u32,
    /// Bits per raw sample for lossless codecs; 0 when not meaningful (lossy).
    pub bit_depth: u32,
    /// Container/stream duration in seconds.
    pub duration_secs: f64,
    /// Nominal bit rate in bits/sec, when reported.
    pub bit_rate: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ProbeOutput {
    #[serde(default)]
    streams: Vec<ProbeStream>,
    #[serde(default)]
    format: Option<ProbeFormat>,
}

#[derive(Debug, Deserialize)]
struct ProbeStream {
    #[serde(default)]
    codec_type: Option<String>,
    #[serde(default)]
    codec_name: Option<String>,
    #[serde(default)]
    sample_rate: Option<String>,
    #[serde(default)]
    channels: Option<u32>,
    #[serde(default)]
    bits_per_raw_sample: Option<String>,
    #[serde(default)]
    bits_per_sample: Option<u32>,
    #[serde(default)]
    duration: Option<String>,
    #[serde(default)]
    bit_rate: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProbeFormat {
    #[serde(default)]
    duration: Option<String>,
    #[serde(default)]
    bit_rate: Option<String>,
}

const LOSSLESS_CODECS: &[&str] = &[
    "flac", "alac", "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_s16be", "pcm_s24be", "wavpack",
    "tta", "ape", "truehd", "mlp",
];

fn parse_specs(json: &str) -> Result<AudioSpecs> {
    let probe: ProbeOutput = serde_json::from_str(json).context("ffprobe JSON was not parseable")?;

    let audio = probe
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("audio"))
        .ok_or_else(|| anyhow!("file contains no audio stream"))?;

    let codec = audio
        .codec_name
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    let lossless = LOSSLESS_CODECS.contains(&codec.as_str());

    let sample_rate = audio
        .sample_rate
        .as_deref()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);

    let channels = audio.channels.unwrap_or(0);

    // Prefer bits_per_raw_sample (set for flac); fall back to bits_per_sample.
    let bit_depth = audio
        .bits_per_raw_sample
        .as_deref()
        .and_then(|s| s.parse::<u32>().ok())
        .filter(|&d| d > 0)
        .or(audio.bits_per_sample.filter(|&d| d > 0))
        .unwrap_or(0);

    // Duration can live on the stream or the format; take whichever parses.
    let duration_secs = audio
        .duration
        .as_deref()
        .and_then(|s| s.parse::<f64>().ok())
        .or_else(|| {
            probe
                .format
                .as_ref()
                .and_then(|f| f.duration.as_deref())
                .and_then(|s| s.parse::<f64>().ok())
        })
        .unwrap_or(0.0);

    let bit_rate = audio
        .bit_rate
        .as_deref()
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| {
            probe
                .format
                .as_ref()
                .and_then(|f| f.bit_rate.as_deref())
                .and_then(|s| s.parse::<u64>().ok())
        });

    Ok(AudioSpecs {
        codec,
        lossless,
        sample_rate,
        channels,
        bit_depth,
        duration_secs,
        bit_rate,
    })
}

/// Run ffprobe against `path` and return its audio specs.
pub async fn probe(ffprobe_bin: &str, path: &Path) -> Result<AudioSpecs> {
    let output = Command::new(ffprobe_bin)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .output()
        .await
        .with_context(|| format!("failed to run {ffprobe_bin}"))?;

    if !output.status.success() {
        // Deliberately path-free: logs must not reveal what was downloaded.
        return Err(anyhow!("ffprobe exited with status {}", output.status));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_specs(&stdout).context("parsing ffprobe output")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_flac_stream() {
        let json = r#"{
            "streams": [
                {
                    "codec_type": "audio",
                    "codec_name": "flac",
                    "sample_rate": "44100",
                    "channels": 2,
                    "bits_per_raw_sample": "16",
                    "duration": "213.546667"
                }
            ],
            "format": { "duration": "213.546667", "bit_rate": "905000" }
        }"#;
        let specs = parse_specs(json).unwrap();
        assert_eq!(specs.codec, "flac");
        assert!(specs.lossless);
        assert_eq!(specs.sample_rate, 44100);
        assert_eq!(specs.channels, 2);
        assert_eq!(specs.bit_depth, 16);
        assert!((specs.duration_secs - 213.546667).abs() < 1e-6);
        assert_eq!(specs.bit_rate, Some(905000));
    }

    #[test]
    fn parses_lossy_mp3_without_bit_depth() {
        let json = r#"{
            "streams": [
                {
                    "codec_type": "audio",
                    "codec_name": "mp3",
                    "sample_rate": "44100",
                    "channels": 2,
                    "bit_rate": "320000"
                }
            ],
            "format": { "duration": "180.0" }
        }"#;
        let specs = parse_specs(json).unwrap();
        assert_eq!(specs.codec, "mp3");
        assert!(!specs.lossless);
        assert_eq!(specs.bit_depth, 0);
        assert_eq!(specs.bit_rate, Some(320000));
        assert!((specs.duration_secs - 180.0).abs() < 1e-9);
    }

    #[test]
    fn falls_back_to_format_duration() {
        let json = r#"{
            "streams": [ { "codec_type": "audio", "codec_name": "flac", "sample_rate": "48000", "channels": 2 } ],
            "format": { "duration": "99.5" }
        }"#;
        let specs = parse_specs(json).unwrap();
        assert!((specs.duration_secs - 99.5).abs() < 1e-9);
    }

    #[test]
    fn errors_when_no_audio_stream() {
        let json = r#"{ "streams": [ { "codec_type": "video", "codec_name": "mjpeg" } ], "format": {} }"#;
        assert!(parse_specs(json).is_err());
    }

    #[test]
    fn errors_on_garbage() {
        assert!(parse_specs("not json").is_err());
    }
}
