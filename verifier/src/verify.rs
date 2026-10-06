//! The hard gate: given everything we measured about one audio file, decide
//! whether it may be imported. A single failed check fails the track.
//!
//! Reasons are deliberately generic (specs and check names only) so that
//! nothing identifying about what was downloaded leaks into logs or state.

use crate::acoustid::RecordingMatch;
use crate::config::Config;
use crate::ffprobe::AudioSpecs;
use crate::spectral::SpectralReport;

/// Minimum AcoustID match score we trust for an identity confirmation.
const MIN_IDENTITY_SCORE: f64 = 0.5;

#[derive(Debug, Clone)]
pub struct Thresholds {
    pub acoustid_required: bool,
    pub min_sample_rate: u32,
    pub min_bit_depth: u32,
    pub duration_tolerance_secs: f64,
    pub spectral_min_cutoff_ratio: f64,
}

impl From<&Config> for Thresholds {
    fn from(c: &Config) -> Self {
        Thresholds {
            acoustid_required: c.acoustid_required,
            min_sample_rate: c.min_sample_rate,
            min_bit_depth: c.min_bit_depth,
            duration_tolerance_secs: c.duration_tolerance_secs,
            spectral_min_cutoff_ratio: c.spectral_min_cutoff_ratio,
        }
    }
}

/// What we expect a track to be, from Lidarr's metadata.
#[derive(Debug, Clone, Default)]
pub struct TrackExpectation {
    pub expected_duration_secs: Option<f64>,
    /// Recording MBIDs that belong to this release (from Lidarr's `/track`).
    pub album_recording_mbids: Vec<String>,
}

/// What we measured about the file on disk.
#[derive(Debug, Clone)]
pub struct TrackEvidence {
    pub specs: AudioSpecs,
    /// Whether an AcoustID lookup was performed at all.
    pub acoustid_attempted: bool,
    pub acoustid_matches: Vec<RecordingMatch>,
    pub spectral: Option<SpectralReport>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    Pass,
    Fail(Vec<String>),
}

impl Verdict {
    pub fn is_pass(&self) -> bool {
        matches!(self, Verdict::Pass)
    }
}

fn identity_confirmed(expectation: &TrackExpectation, matches: &[RecordingMatch]) -> bool {
    if expectation.album_recording_mbids.is_empty() {
        return false;
    }
    matches.iter().any(|m| {
        m.score >= MIN_IDENTITY_SCORE
            && expectation
                .album_recording_mbids
                .iter()
                .any(|mbid| mbid.eq_ignore_ascii_case(&m.recording_mbid))
    })
}

/// Apply every gate and return the combined verdict.
pub fn evaluate(
    thresholds: &Thresholds,
    expectation: &TrackExpectation,
    evidence: &TrackEvidence,
) -> Verdict {
    let mut reasons: Vec<String> = Vec::new();
    let specs = &evidence.specs;

    if specs.sample_rate == 0 || specs.channels == 0 || specs.duration_secs <= 0.0 {
        reasons.push("file has no decodable audio specs".to_string());
    }

    if thresholds.min_sample_rate > 0 && specs.sample_rate < thresholds.min_sample_rate {
        reasons.push(format!(
            "sample rate {} Hz below required {} Hz",
            specs.sample_rate, thresholds.min_sample_rate
        ));
    }

    if specs.lossless
        && thresholds.min_bit_depth > 0
        && specs.bit_depth > 0
        && specs.bit_depth < thresholds.min_bit_depth
    {
        reasons.push(format!(
            "bit depth {} below required {}",
            specs.bit_depth, thresholds.min_bit_depth
        ));
    }

    if let Some(expected) = expectation.expected_duration_secs {
        if expected > 0.0 {
            let delta = (specs.duration_secs - expected).abs();
            if delta > thresholds.duration_tolerance_secs {
                reasons.push(format!(
                    "duration off by {:.1}s (tolerance {:.1}s)",
                    delta, thresholds.duration_tolerance_secs
                ));
            }
        }
    }

    // Identity (AcoustID): only enforced when required.
    if thresholds.acoustid_required {
        if !evidence.acoustid_attempted {
            reasons.push("acoustic identity check did not run".to_string());
        } else if !identity_confirmed(expectation, &evidence.acoustid_matches) {
            reasons.push("acoustic fingerprint did not match the expected release".to_string());
        }
    }

    // Spectral transcode / fake-lossless: only meaningful for lossless codecs.
    if specs.lossless {
        if let Some(report) = &evidence.spectral {
            if report.cutoff_ratio < thresholds.spectral_min_cutoff_ratio {
                reasons.push(format!(
                    "lossless file band-limited to {:.0}% of Nyquist (likely transcoded from lossy)",
                    report.cutoff_ratio * 100.0
                ));
            }
        }
    }

    if reasons.is_empty() {
        Verdict::Pass
    } else {
        Verdict::Fail(reasons)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn thresholds() -> Thresholds {
        Thresholds {
            acoustid_required: true,
            min_sample_rate: 44100,
            min_bit_depth: 16,
            duration_tolerance_secs: 4.0,
            spectral_min_cutoff_ratio: 0.80,
        }
    }

    fn good_specs() -> AudioSpecs {
        AudioSpecs {
            codec: "flac".into(),
            lossless: true,
            sample_rate: 44100,
            channels: 2,
            bit_depth: 16,
            duration_secs: 200.0,
            bit_rate: Some(900_000),
        }
    }

    fn expectation() -> TrackExpectation {
        TrackExpectation {
            expected_duration_secs: Some(200.0),
            album_recording_mbids: vec!["97a6a79f-1111".into()],
        }
    }

    fn matching_evidence() -> TrackEvidence {
        TrackEvidence {
            specs: good_specs(),
            acoustid_attempted: true,
            acoustid_matches: vec![RecordingMatch {
                recording_mbid: "97a6a79f-1111".into(),
                score: 0.97,
            }],
            spectral: Some(SpectralReport {
                cutoff_ratio: 0.98,
                frames: 100,
                sample_rate: 44100,
            }),
        }
    }

    #[test]
    fn clean_track_passes() {
        let v = evaluate(&thresholds(), &expectation(), &matching_evidence());
        assert_eq!(v, Verdict::Pass);
    }

    #[test]
    fn low_sample_rate_fails() {
        let mut ev = matching_evidence();
        ev.specs.sample_rate = 22050;
        assert!(!evaluate(&thresholds(), &expectation(), &ev).is_pass());
    }

    #[test]
    fn low_bit_depth_fails() {
        let mut ev = matching_evidence();
        ev.specs.bit_depth = 8;
        assert!(!evaluate(&thresholds(), &expectation(), &ev).is_pass());
    }

    #[test]
    fn wrong_duration_fails() {
        let mut ev = matching_evidence();
        ev.specs.duration_secs = 120.0; // 80s off, tolerance 4s
        assert!(!evaluate(&thresholds(), &expectation(), &ev).is_pass());
    }

    #[test]
    fn duration_within_tolerance_passes() {
        let mut ev = matching_evidence();
        ev.specs.duration_secs = 202.5; // 2.5s off, within 4s
        assert_eq!(evaluate(&thresholds(), &expectation(), &ev), Verdict::Pass);
    }

    #[test]
    fn fake_lossless_fails() {
        let mut ev = matching_evidence();
        ev.spectral = Some(SpectralReport {
            cutoff_ratio: 0.45,
            frames: 100,
            sample_rate: 44100,
        });
        assert!(!evaluate(&thresholds(), &expectation(), &ev).is_pass());
    }

    #[test]
    fn missing_acoustid_fails_when_required() {
        let mut ev = matching_evidence();
        ev.acoustid_attempted = false;
        assert!(!evaluate(&thresholds(), &expectation(), &ev).is_pass());
    }

    #[test]
    fn unmatched_acoustid_fails_when_required() {
        let mut ev = matching_evidence();
        ev.acoustid_matches = vec![RecordingMatch {
            recording_mbid: "different-mbid".into(),
            score: 0.99,
        }];
        assert!(!evaluate(&thresholds(), &expectation(), &ev).is_pass());
    }

    #[test]
    fn low_score_match_fails_when_required() {
        let mut ev = matching_evidence();
        ev.acoustid_matches = vec![RecordingMatch {
            recording_mbid: "97a6a79f-1111".into(),
            score: 0.2, // below MIN_IDENTITY_SCORE
        }];
        assert!(!evaluate(&thresholds(), &expectation(), &ev).is_pass());
    }

    #[test]
    fn acoustid_optional_skips_identity() {
        let mut t = thresholds();
        t.acoustid_required = false;
        let mut ev = matching_evidence();
        ev.acoustid_attempted = false;
        ev.acoustid_matches = vec![];
        assert_eq!(evaluate(&t, &expectation(), &ev), Verdict::Pass);
    }

    #[test]
    fn lossy_file_skips_spectral_and_bit_depth() {
        let mut t = thresholds();
        t.acoustid_required = false;
        let ev = TrackEvidence {
            specs: AudioSpecs {
                codec: "mp3".into(),
                lossless: false,
                sample_rate: 44100,
                channels: 2,
                bit_depth: 0,
                duration_secs: 200.0,
                bit_rate: Some(320_000),
            },
            acoustid_attempted: false,
            acoustid_matches: vec![],
            // A lossy file is legitimately band-limited; spectral must not fail it.
            spectral: Some(SpectralReport {
                cutoff_ratio: 0.42,
                frames: 100,
                sample_rate: 44100,
            }),
        };
        assert_eq!(evaluate(&t, &expectation(), &ev), Verdict::Pass);
    }

    #[test]
    fn multiple_failures_are_all_reported() {
        let mut ev = matching_evidence();
        ev.specs.sample_rate = 8000;
        ev.specs.duration_secs = 10.0;
        match evaluate(&thresholds(), &expectation(), &ev) {
            Verdict::Fail(reasons) => assert!(reasons.len() >= 2),
            Verdict::Pass => panic!("expected failure"),
        }
    }
}
