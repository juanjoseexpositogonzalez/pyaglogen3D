//! Batch FRAKTAL analysis: one-shot dpo calibration + per-image analyzer loop.
//!
//! Wraps the existing single-image analyzers (`analyze_granulated_2012`,
//! `analyze_voxel_2018`) so the caller can process N images with a single
//! `pixels_per_100nm` scale and a single `dpo` value (shared across the
//! batch for speed — the dpo is a property of the aggregate, not of
//! individual projections).
//!
//! Spec: `fraktal-batch-contract` (R3 one-shot dpo, R6 per-image shape).
//!
//! ## Design note on inputs
//!
//! The batch API takes already-decoded grayscale images (`Array2<u8>`),
//! matching what the existing analyzers consume. PNG decoding is the
//! caller's responsibility (performed in the backend service layer via
//! Pillow before calling into the PyO3 binding). This keeps the engine
//! crate free of image-format dependencies.

use ndarray::Array2;

use super::image_processing::{estimate_particles_and_dpo, smart_segment};
use super::params::{Granulated2012Params, Voxel2018Params};
use super::result::FraktalStatus;
use super::{analyze_granulated_2012, analyze_voxel_2018};

/// Which batch algorithm to run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BatchAlgorithm {
    Granulated2012,
    Voxel2018,
}

/// Where the dpo value used for the batch came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutocalibrateSource {
    /// dpo was supplied by the caller (no autocalibrate attempted).
    Manual,
    /// autocalibrate succeeded on image[0].
    Image0,
    /// image[0] autocalibrate failed, succeeded on image[N/2].
    ImageNHalf,
}

impl AutocalibrateSource {
    /// Stable string tag for Python/JSON payloads.
    pub fn as_str(&self) -> &'static str {
        match self {
            AutocalibrateSource::Manual => "manual",
            AutocalibrateSource::Image0 => "image0",
            AutocalibrateSource::ImageNHalf => "image_n_half",
        }
    }

    /// Which image index (0-based) was used for autocalibrate, when
    /// applicable. Returns `None` for `Manual`.
    pub fn image_index(&self, n: usize) -> Option<usize> {
        match self {
            AutocalibrateSource::Manual => None,
            AutocalibrateSource::Image0 => Some(0),
            AutocalibrateSource::ImageNHalf => Some(n / 2),
        }
    }
}

/// Input to `analyze_batch`.
///
/// `images` are pre-decoded grayscale frames. For `Voxel2018`, `dpo_hint`
/// and `autocalibrate_dpo` are accepted for API symmetry but the voxel
/// analyzer does not consume dpo; the value is still tracked in the
/// output for traceability.
pub struct BatchInput {
    pub images: Vec<Array2<u8>>,
    /// Pixels-per-100nm scale shared across every image in the batch.
    pub pixels_per_100nm: f64,
    /// If true, run one-shot autocalibrate per R3; otherwise use
    /// `dpo_hint` as-is.
    pub autocalibrate_dpo: bool,
    /// Manual dpo value (nm) used when `autocalibrate_dpo` is false.
    pub dpo_hint: f64,
    pub algorithm: BatchAlgorithm,
}

/// Per-image result. Fields are `Option` so a failure on image[i] does
/// not kill the batch — the error message is captured in `error`.
#[derive(Debug, Clone)]
pub struct BatchImageResult {
    pub index: usize,
    pub fractal_dimension: Option<f64>,
    pub prefactor: Option<f64>,
    /// Always `None` for the current FRAKTAL analyzers (they use an
    /// iterative bisection, not a linear regression, so there is no
    /// coefficient of determination). Kept in the shape for future
    /// compatibility and to match the spec's R6 field list.
    pub r_squared: Option<f64>,
    pub n_particles_counted: Option<u64>,
    pub dpo_used: f64,
    pub error: Option<String>,
}

/// Full batch output.
#[derive(Debug, Clone)]
pub struct BatchOutput {
    pub results: Vec<BatchImageResult>,
    pub dpo_used: f64,
    pub autocalibrate_source: AutocalibrateSource,
}

/// Scale reference in nm — matches the default in `Granulated2012Params` /
/// `Voxel2018Params` (the `escala` field).
const ESCALA_NM: f64 = 100.0;

/// Run a FRAKTAL batch.
///
/// Returns `Err(msg)` only for batch-level failures:
///   1. empty input,
///   2. autocalibrate requested but failed on both image[0] and
///      image[N/2] (per R3).
///
/// Per-image analyzer failures are captured in the corresponding
/// `BatchImageResult.error` and do NOT short-circuit the batch.
pub fn analyze_batch(input: BatchInput) -> Result<BatchOutput, String> {
    if input.images.is_empty() {
        return Err("batch requires at least one image".to_string());
    }

    let (dpo, source) = resolve_dpo(&input)?;

    let mut results = Vec::with_capacity(input.images.len());
    for (i, img) in input.images.iter().enumerate() {
        let res = run_one_image(i, img, input.pixels_per_100nm, dpo, input.algorithm);
        results.push(res);
    }

    Ok(BatchOutput {
        results,
        dpo_used: dpo,
        autocalibrate_source: source,
    })
}

/// R3 one-shot dpo policy: try image[0]; on failure retry image[N/2];
/// on second failure, error the whole batch.
fn resolve_dpo(input: &BatchInput) -> Result<(f64, AutocalibrateSource), String> {
    if !input.autocalibrate_dpo {
        return Ok((input.dpo_hint, AutocalibrateSource::Manual));
    }

    match try_autocalibrate(&input.images[0], input.pixels_per_100nm) {
        Ok(dpo) => Ok((dpo, AutocalibrateSource::Image0)),
        Err(e0) => {
            let n = input.images.len();
            if n <= 1 {
                return Err(format!("autocalibrate failed on image[0]: {}", e0));
            }
            let mid = n / 2;
            // n > 1 implies mid >= 1 (n=2 -> mid=1; n=3 -> mid=1), so
            // mid is always a distinct index from 0 when we reach here.
            match try_autocalibrate(&input.images[mid], input.pixels_per_100nm) {
                Ok(dpo) => Ok((dpo, AutocalibrateSource::ImageNHalf)),
                Err(e_mid) => Err(format!(
                    "autocalibrate failed on image[0] ({}) and image[{}] ({})",
                    e0, mid, e_mid
                )),
            }
        }
    }
}

/// Segment the image and run `estimate_particles_and_dpo`, translating
/// "no particles detected" into an `Err` so the caller can decide to
/// retry on a different frame.
fn try_autocalibrate(image: &Array2<u8>, pixels_per_100nm: f64) -> Result<f64, String> {
    // Use the same segmentation defaults as the single-image analyzers.
    let (binary, _threshold, _inverted) = smart_segment(image.view(), 10, 240, true);
    let length_per_pixel = ESCALA_NM / pixels_per_100nm;
    let (count, dpo, _avg_radius) = estimate_particles_and_dpo(binary.view(), length_per_pixel);
    if count == 0 || !dpo.is_finite() || dpo <= 0.0 {
        return Err("no primary particles detected".to_string());
    }
    Ok(dpo)
}

/// Run a single image through the selected analyzer, capturing per-image
/// errors in the result rather than propagating them.
fn run_one_image(
    index: usize,
    image: &Array2<u8>,
    pixels_per_100nm: f64,
    dpo: f64,
    algorithm: BatchAlgorithm,
) -> BatchImageResult {
    match algorithm {
        BatchAlgorithm::Granulated2012 => {
            let params = Granulated2012Params {
                npix: pixels_per_100nm,
                dpo,
                escala: ESCALA_NM,
                ..Granulated2012Params::default()
            };
            let r = analyze_granulated_2012(image.view(), &params);
            match r.status {
                FraktalStatus::Success => BatchImageResult {
                    index,
                    fractal_dimension: Some(r.df),
                    prefactor: Some(r.kf),
                    r_squared: None,
                    n_particles_counted: Some(r.npo_visual),
                    dpo_used: dpo,
                    error: None,
                },
                ref status => BatchImageResult {
                    index,
                    fractal_dimension: None,
                    prefactor: None,
                    r_squared: None,
                    n_particles_counted: None,
                    dpo_used: dpo,
                    error: Some(status.message()),
                },
            }
        }
        BatchAlgorithm::Voxel2018 => {
            let params = Voxel2018Params {
                npix: pixels_per_100nm,
                escala: ESCALA_NM,
                ..Voxel2018Params::default()
            };
            let r = analyze_voxel_2018(image.view(), &params);
            match r.status {
                FraktalStatus::Success => BatchImageResult {
                    index,
                    fractal_dimension: Some(r.df),
                    prefactor: Some(r.kf),
                    r_squared: None,
                    // Voxel model does not populate npo_visual (always 0);
                    // expose it anyway so the shape stays stable.
                    n_particles_counted: Some(r.npo_visual),
                    dpo_used: dpo,
                    error: None,
                },
                ref status => BatchImageResult {
                    index,
                    fractal_dimension: None,
                    prefactor: None,
                    r_squared: None,
                    n_particles_counted: None,
                    dpo_used: dpo,
                    error: Some(status.message()),
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ndarray::Array2;

    /// Build a synthetic grayscale image with a soft-edged disk cluster
    /// that the Otsu segmenter and adaptive particle detector can
    /// reliably locate.
    fn make_particle_image(size: usize, centers: &[(usize, usize)], radius: f64) -> Array2<u8> {
        // Light background, dark particles — matches typical TEM layout.
        let mut img = Array2::<u8>::from_elem((size, size), 220);
        for (cy, cx) in centers {
            for i in 0..size {
                for j in 0..size {
                    let dy = i as f64 - *cy as f64;
                    let dx = j as f64 - *cx as f64;
                    let d = (dy * dy + dx * dx).sqrt();
                    if d <= radius {
                        img[[i, j]] = 30;
                    }
                }
            }
        }
        img
    }

    /// Uniform-noise image that segmentation cannot resolve into
    /// primary particles — exercises the autocalibrate failure path.
    fn make_noise_image(size: usize, value: u8) -> Array2<u8> {
        Array2::<u8>::from_elem((size, size), value)
    }

    #[test]
    fn test_batch_empty_input_rejected() {
        let input = BatchInput {
            images: vec![],
            pixels_per_100nm: 50.0,
            autocalibrate_dpo: false,
            dpo_hint: 25.0,
            algorithm: BatchAlgorithm::Granulated2012,
        };
        let err = analyze_batch(input).unwrap_err();
        assert!(err.contains("at least one image"));
    }

    #[test]
    fn test_batch_single_image_edge_case() {
        // N=1 with manual dpo — no autocalibrate path, no retry.
        let img = make_particle_image(40, &[(20, 20)], 5.0);
        let input = BatchInput {
            images: vec![img],
            pixels_per_100nm: 50.0,
            autocalibrate_dpo: false,
            dpo_hint: 20.0,
            algorithm: BatchAlgorithm::Granulated2012,
        };
        let out = analyze_batch(input).expect("batch must succeed");
        assert_eq!(out.results.len(), 1);
        assert_eq!(out.results[0].index, 0);
        assert_eq!(out.dpo_used, 20.0);
        assert_eq!(out.autocalibrate_source, AutocalibrateSource::Manual);
    }

    #[test]
    fn test_batch_oneshot_dpo_image0_happy() {
        // image[0] autocalibrates cleanly → all images share that dpo.
        let centers: Vec<(usize, usize)> = (0..6)
            .flat_map(|r| (0..6).map(move |c| (8 + r * 8, 8 + c * 8)))
            .collect();
        let good = make_particle_image(64, &centers, 3.0);
        let input = BatchInput {
            images: vec![good.clone(), good.clone(), good],
            pixels_per_100nm: 50.0,
            autocalibrate_dpo: true,
            dpo_hint: 0.0,
            algorithm: BatchAlgorithm::Granulated2012,
        };
        let out = analyze_batch(input).expect("autocalibrate on image[0] should work");
        assert_eq!(out.autocalibrate_source, AutocalibrateSource::Image0);
        assert!(out.dpo_used > 0.0);
        assert_eq!(out.results.len(), 3);
        // All three images share the same dpo (one-shot reuse, R3).
        for r in &out.results {
            assert_eq!(r.dpo_used, out.dpo_used);
        }
    }

    #[test]
    fn test_batch_oneshot_dpo_image0_fails_retries_image_half() {
        // image[0] is pure noise (no particles) → image[1] (mid of N=3)
        // has a valid particle cluster → autocalibrate retries and
        // reports ImageNHalf.
        let centers: Vec<(usize, usize)> = (0..6)
            .flat_map(|r| (0..6).map(move |c| (8 + r * 8, 8 + c * 8)))
            .collect();
        let good = make_particle_image(64, &centers, 3.0);
        let bad = make_noise_image(64, 200);
        let input = BatchInput {
            images: vec![bad.clone(), good.clone(), bad],
            pixels_per_100nm: 50.0,
            autocalibrate_dpo: true,
            dpo_hint: 0.0,
            algorithm: BatchAlgorithm::Granulated2012,
        };
        let out = analyze_batch(input).expect("retry on image[N/2] should rescue the batch");
        assert_eq!(out.autocalibrate_source, AutocalibrateSource::ImageNHalf);
        assert!(out.dpo_used > 0.0);
    }

    #[test]
    fn test_batch_oneshot_dpo_double_failure_errors() {
        // Both image[0] and image[N/2] are noise → batch-level error.
        let bad = make_noise_image(64, 200);
        let input = BatchInput {
            images: vec![bad.clone(), bad.clone(), bad.clone(), bad],
            pixels_per_100nm: 50.0,
            autocalibrate_dpo: true,
            dpo_hint: 0.0,
            algorithm: BatchAlgorithm::Granulated2012,
        };
        let err = analyze_batch(input).unwrap_err();
        assert!(err.contains("image[0]"));
        assert!(
            err.contains("image["),
            "expected retry attempt mentioned: {}",
            err
        );
    }

    #[test]
    fn test_batch_per_image_error_does_not_fail_batch() {
        // Batch of 3: images 0 and 2 have clusters, image 1 is blank.
        // The blank one's analyzer call fails ("No object pixels
        // found"); the batch still returns 3 entries.
        let centers: Vec<(usize, usize)> = (0..6)
            .flat_map(|r| (0..6).map(move |c| (8 + r * 8, 8 + c * 8)))
            .collect();
        let good = make_particle_image(64, &centers, 3.0);
        // Fully light image — segmentation produces zero object pixels.
        let blank = Array2::<u8>::from_elem((64, 64), 255);

        let input = BatchInput {
            images: vec![good.clone(), blank, good],
            pixels_per_100nm: 50.0,
            autocalibrate_dpo: false,
            dpo_hint: 25.0,
            algorithm: BatchAlgorithm::Granulated2012,
        };
        let out = analyze_batch(input).expect("per-image failure must not kill the batch");
        assert_eq!(out.results.len(), 3);
        assert_eq!(out.results[1].index, 1);
        assert!(
            out.results[1].error.is_some(),
            "image 1 should have a captured error"
        );
        assert!(out.results[1].fractal_dimension.is_none());
        // Indices preserved and stable.
        assert_eq!(out.results[0].index, 0);
        assert_eq!(out.results[2].index, 2);
    }

    #[test]
    fn test_autocalibrate_source_image_index() {
        assert_eq!(AutocalibrateSource::Manual.image_index(10), None);
        assert_eq!(AutocalibrateSource::Image0.image_index(10), Some(0));
        assert_eq!(AutocalibrateSource::ImageNHalf.image_index(10), Some(5));
        assert_eq!(AutocalibrateSource::ImageNHalf.image_index(3), Some(1));
    }
}
