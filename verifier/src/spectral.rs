//! Spectral transcode / fake-lossless detection.
//!
//! A file can claim a lossless codec (FLAC, ALAC…) yet have been produced by
//! re-encoding a lossy source (MP3/AAC). The giveaway is the frequency
//! spectrum: lossy encoders discard everything above a cutoff (commonly
//! 16–20 kHz), so a "lossless" file whose energy falls off a cliff well below
//! Nyquist was almost certainly upscaled from a lossy source.
//!
//! We decode the audio to mono PCM, average the power spectrum over several
//! windows, and report the cutoff as a fraction of Nyquist. The decode step
//! lives behind `analyze_file`; the detection math lives in `analyze_samples`
//! so it can be unit-tested on synthesised signals with no real files.

use anyhow::{anyhow, Context, Result};
use rustfft::{num_complex::Complex, FftPlanner};
use std::path::Path;
use symphonia::core::audio::{SampleBuffer, SignalSpec};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

const FFT_SIZE: usize = 4096;
/// Energy more than this far below the spectral peak is treated as absence of
/// signal (noise floor), in decibels.
const CUTOFF_FLOOR_DB: f64 = 50.0;
/// Decode at most this many seconds; plenty to characterise the spectrum and
/// keeps CPU bounded on long files.
const MAX_DECODE_SECS: f64 = 90.0;

#[derive(Debug, Clone, PartialEq)]
pub struct SpectralReport {
    /// Highest frequency carrying signal, as a fraction of Nyquist (0.0–1.0).
    pub cutoff_ratio: f64,
    /// Number of FFT frames averaged.
    pub frames: usize,
    pub sample_rate: u32,
}

/// Detect the spectral cutoff of a block of mono samples.
///
/// Returns `None` when there is not enough audio for a single FFT frame.
pub fn analyze_samples(samples: &[f32], sample_rate: u32) -> Option<SpectralReport> {
    if sample_rate == 0 || samples.len() < FFT_SIZE {
        return None;
    }

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FFT_SIZE);

    // Hann window to suppress spectral leakage between bins.
    let window: Vec<f32> = (0..FFT_SIZE)
        .map(|n| {
            let x = std::f32::consts::PI * n as f32 / (FFT_SIZE as f32 - 1.0);
            x.sin().powi(2)
        })
        .collect();

    let half = FFT_SIZE / 2;
    let mut power = vec![0.0f64; half];
    let mut frames = 0usize;

    // Hop by half a window (50% overlap).
    let hop = FFT_SIZE / 2;
    let mut pos = 0;
    while pos + FFT_SIZE <= samples.len() {
        let mut buf: Vec<Complex<f32>> = (0..FFT_SIZE)
            .map(|i| Complex::new(samples[pos + i] * window[i], 0.0))
            .collect();
        fft.process(&mut buf);
        for (i, p) in power.iter_mut().enumerate().take(half) {
            let c = buf[i];
            *p += (c.re as f64) * (c.re as f64) + (c.im as f64) * (c.im as f64);
        }
        frames += 1;
        pos += hop;
    }

    if frames == 0 {
        return None;
    }

    // Average, and skip DC (bin 0) which carries no pitch information.
    for p in power.iter_mut() {
        *p /= frames as f64;
    }
    let peak = power
        .iter()
        .skip(1)
        .copied()
        .fold(0.0f64, f64::max);
    if peak <= 0.0 {
        return None;
    }

    let threshold = peak * 10f64.powf(-CUTOFF_FLOOR_DB / 10.0);

    // Walk down from the highest bin; the cutoff is the top bin still above the
    // noise floor.
    let mut cutoff_bin = 0usize;
    for bin in (1..half).rev() {
        if power[bin] >= threshold {
            cutoff_bin = bin;
            break;
        }
    }

    let cutoff_ratio = cutoff_bin as f64 / (half as f64 - 1.0);

    Some(SpectralReport {
        cutoff_ratio: cutoff_ratio.clamp(0.0, 1.0),
        frames,
        sample_rate,
    })
}

/// Decode `path` to mono f32 PCM (first `MAX_DECODE_SECS`) and analyse it.
pub fn analyze_file(path: &Path) -> Result<SpectralReport> {
    let (samples, sample_rate) = decode_to_mono(path)?;
    analyze_samples(&samples, sample_rate)
        .ok_or_else(|| anyhow!("not enough audio to analyse"))
}

fn decode_to_mono(path: &Path) -> Result<(Vec<f32>, u32)> {
    // Error messages below are path-free so logs never reveal the file.
    let file = std::fs::File::open(path).context("opening file")?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .context("probing format")?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| anyhow!("no decodable audio track"))?;
    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .context("no decoder for this file")?;

    let mut mono: Vec<f32> = Vec::new();
    let mut sample_rate = 0u32;
    let mut sample_buf: Option<SampleBuffer<f32>> = None;
    let mut max_samples = usize::MAX;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(SymphoniaError::ResetRequired) => break,
            Err(e) => return Err(e).context("reading packet"),
        };
        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec: SignalSpec = *decoded.spec();
                if sample_rate == 0 {
                    sample_rate = spec.rate;
                    max_samples = (MAX_DECODE_SECS * sample_rate as f64) as usize;
                }
                if sample_buf.is_none() {
                    sample_buf = Some(SampleBuffer::<f32>::new(decoded.capacity() as u64, spec));
                }
                if let Some(buf) = &mut sample_buf {
                    buf.copy_interleaved_ref(decoded);
                    let channels = spec.channels.count().max(1);
                    for frame in buf.samples().chunks(channels) {
                        let sum: f32 = frame.iter().copied().sum();
                        mono.push(sum / channels as f32);
                    }
                }
                if mono.len() >= max_samples {
                    break;
                }
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(SymphoniaError::IoError(_)) => break,
            Err(e) => return Err(e).context("decoding packet"),
        }
    }

    if mono.is_empty() || sample_rate == 0 {
        return Err(anyhow!("decoded no audio"));
    }

    Ok((mono, sample_rate))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a signal densely filled with tones from ~100 Hz up to
    /// `cutoff_hz`, so the averaged spectrum is continuous up to the cutoff and
    /// empty above it.
    fn banded_signal(sample_rate: u32, cutoff_hz: f64, secs: f64) -> Vec<f32> {
        let n = (sample_rate as f64 * secs) as usize;
        let mut out = vec![0.0f32; n];
        let mut f = 100.0;
        while f < cutoff_hz {
            let w = 2.0 * std::f64::consts::PI * f / sample_rate as f64;
            for (i, s) in out.iter_mut().enumerate() {
                *s += (w * i as f64).sin() as f32;
            }
            f += 150.0;
        }
        // Normalise to avoid clipping the synthetic sum.
        let peak = out.iter().fold(0.0f32, |m, &x| m.max(x.abs())).max(1e-6);
        for s in out.iter_mut() {
            *s /= peak;
        }
        out
    }

    #[test]
    fn full_band_signal_reports_high_cutoff() {
        let sr = 44100;
        let samples = banded_signal(sr, 0.95 * (sr as f64 / 2.0), 2.0);
        let report = analyze_samples(&samples, sr).unwrap();
        assert!(
            report.cutoff_ratio > 0.85,
            "expected near-full-band, got {}",
            report.cutoff_ratio
        );
    }

    #[test]
    fn lowpassed_signal_reports_low_cutoff() {
        let sr = 44100;
        // Energy only up to 40% of Nyquist — like a 16 kHz-capped lossy source.
        let samples = banded_signal(sr, 0.40 * (sr as f64 / 2.0), 2.0);
        let report = analyze_samples(&samples, sr).unwrap();
        assert!(
            report.cutoff_ratio < 0.60,
            "expected clear low cutoff, got {}",
            report.cutoff_ratio
        );
    }

    #[test]
    fn transcode_is_distinguishable_from_genuine() {
        let sr = 44100;
        let genuine = analyze_samples(&banded_signal(sr, 0.95 * 22050.0, 2.0), sr)
            .unwrap()
            .cutoff_ratio;
        let transcode = analyze_samples(&banded_signal(sr, 0.40 * 22050.0, 2.0), sr)
            .unwrap()
            .cutoff_ratio;
        assert!(
            genuine - transcode > 0.3,
            "genuine {genuine} vs transcode {transcode} not separable"
        );
    }

    #[test]
    fn too_short_returns_none() {
        assert!(analyze_samples(&[0.0; 10], 44100).is_none());
    }

    #[test]
    fn zero_sample_rate_returns_none() {
        assert!(analyze_samples(&[0.0; FFT_SIZE * 2], 0).is_none());
    }

    #[test]
    fn silence_returns_none() {
        assert!(analyze_samples(&vec![0.0; FFT_SIZE * 4], 44100).is_none());
    }
}
