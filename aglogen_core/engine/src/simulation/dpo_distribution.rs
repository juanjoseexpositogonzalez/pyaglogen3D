//! Distribution types for `dpo` (primary particle diameter) and `target_kf` (fractal prefactor).
//!
//! Both parameters support three sampling modes following the same pattern
//! as [`SinteringDistribution`](super::sintering::SinteringDistribution):
//!
//! - **Fixed**: deterministic, returns the same value every time.
//! - **Normal**: truncated Gaussian bounded to [mean - 3*std, mean + 3*std].
//! - **Uniform**: uniform sample over [min, max].
//!
//! Validation of parameter ranges (e.g. std > 0, max > min) is intentionally
//! NOT performed here. Enums are simple data carriers; validation belongs
//! at the integration layer (P4 backend serializer).

use rand::Rng;
use rand_distr::{Distribution, StandardNormal};

/// Distribution for the primary particle diameter (`dpo`).
///
/// Controls how `radius_min`/`radius_max` are sampled at the start of each
/// CC-tunable run. See R12 in the delta spec.
#[derive(Debug, Clone, Copy)]
pub enum DpoDistribution {
    /// Deterministic — always returns `value`.
    Fixed { value: f64 },
    /// Truncated Gaussian N(mean, std) bounded to [mean - 3*std, mean + 3*std].
    Normal { mean: f64, std: f64 },
    /// Uniform sample over [min, max].
    Uniform { min: f64, max: f64 },
}

/// Distribution for the fractal prefactor (`target_kf`).
///
/// Controls how `target_kf` is sampled at the start of each CC-tunable run.
/// See R11 in the delta spec.
#[derive(Debug, Clone, Copy)]
pub enum TargetKfDistribution {
    /// Deterministic — always returns `value`.
    Fixed { value: f64 },
    /// Truncated Gaussian N(mean, std) bounded to [mean - 3*std, mean + 3*std].
    Normal { mean: f64, std: f64 },
    /// Uniform sample over [min, max].
    Uniform { min: f64, max: f64 },
}

impl Default for DpoDistribution {
    fn default() -> Self {
        DpoDistribution::Fixed { value: 1.0 }
    }
}

impl Default for TargetKfDistribution {
    fn default() -> Self {
        TargetKfDistribution::Fixed { value: 1.3 }
    }
}

/// Sample from a truncated Normal bounded to [mean - 3*std, mean + 3*std].
///
/// Draws from StandardNormal, scales by `std` and shifts by `mean`.
/// If the sample falls outside bounds, re-draws up to 10 times.
/// After 10 failed attempts, returns `mean` as a safe fallback.
fn sample_truncated_normal<R: Rng>(rng: &mut R, mean: f64, std: f64) -> f64 {
    let lower = mean - 3.0 * std;
    let upper = mean + 3.0 * std;
    for _ in 0..10 {
        let z: f64 = StandardNormal.sample(rng);
        let x = mean + std * z;
        if x >= lower && x <= upper {
            return x;
        }
    }
    mean
}

impl DpoDistribution {
    /// Sample a `dpo` value from this distribution.
    ///
    /// Accepts an external RNG for reproducibility — same seed yields the
    /// same sample sequence.
    pub fn sample<R: Rng>(&self, rng: &mut R) -> f64 {
        match self {
            Self::Fixed { value } => *value,
            Self::Normal { mean, std } => sample_truncated_normal(rng, *mean, *std),
            Self::Uniform { min, max } => rng.gen_range(*min..=*max),
        }
    }
}

impl TargetKfDistribution {
    /// Sample a `target_kf` value from this distribution.
    ///
    /// Accepts an external RNG for reproducibility — same seed yields the
    /// same sample sequence.
    pub fn sample<R: Rng>(&self, rng: &mut R) -> f64 {
        match self {
            Self::Fixed { value } => *value,
            Self::Normal { mean, std } => sample_truncated_normal(rng, *mean, *std),
            Self::Uniform { min, max } => rng.gen_range(*min..=*max),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::rng::create_rng;

    // ── DpoDistribution tests ──────────────────────────────────────────

    #[test]
    fn test_dpo_fixed_returns_exact_value() {
        let dist = DpoDistribution::Fixed { value: 12.5 };
        let mut rng = create_rng(42);
        assert_eq!(dist.sample(&mut rng), 12.5);
        // Must return the same for any seed
        let mut rng2 = create_rng(999);
        assert_eq!(dist.sample(&mut rng2), 12.5);
    }

    #[test]
    fn test_dpo_normal_within_bounds() {
        let dist = DpoDistribution::Normal {
            mean: 12.5,
            std: 1.5,
        };
        let mut rng = create_rng(42);
        let lower = 12.5 - 3.0 * 1.5; // 8.0
        let upper = 12.5 + 3.0 * 1.5; // 17.0

        for _ in 0..1000 {
            let v = dist.sample(&mut rng);
            assert!(
                v >= lower && v <= upper,
                "Sample {} outside [{}, {}]",
                v,
                lower,
                upper
            );
        }
    }

    #[test]
    fn test_dpo_normal_mean_within_tolerance() {
        let mean = 12.5;
        let dist = DpoDistribution::Normal { mean, std: 1.5 };
        let mut rng = create_rng(42);

        let sum: f64 = (0..1000).map(|_| dist.sample(&mut rng)).sum();
        let sample_mean = sum / 1000.0;
        assert!(
            (sample_mean - mean).abs() < 0.2,
            "Sample mean {} too far from {}",
            sample_mean,
            mean
        );
    }

    #[test]
    fn test_dpo_uniform_within_range() {
        let dist = DpoDistribution::Uniform {
            min: 10.0,
            max: 15.0,
        };
        let mut rng = create_rng(42);

        for _ in 0..1000 {
            let v = dist.sample(&mut rng);
            assert!(v >= 10.0 && v <= 15.0, "Sample {} outside [10, 15]", v);
        }
    }

    #[test]
    fn test_dpo_reproducibility() {
        let dist = DpoDistribution::Normal {
            mean: 12.5,
            std: 1.5,
        };
        let mut rng1 = create_rng(42);
        let mut rng2 = create_rng(42);
        assert_eq!(dist.sample(&mut rng1), dist.sample(&mut rng2));
    }

    #[test]
    fn test_default_dpo() {
        let d = DpoDistribution::default();
        match d {
            DpoDistribution::Fixed { value } => assert_eq!(value, 1.0),
            _ => panic!("Expected Fixed variant for default DpoDistribution"),
        }
    }

    // ── TargetKfDistribution tests ─────────────────────────────────────

    #[test]
    fn test_kf_fixed_returns_exact_value() {
        let dist = TargetKfDistribution::Fixed { value: 1.4 };
        let mut rng = create_rng(42);
        assert_eq!(dist.sample(&mut rng), 1.4);
    }

    #[test]
    fn test_kf_normal_within_bounds() {
        let dist = TargetKfDistribution::Normal {
            mean: 1.3,
            std: 0.1,
        };
        let mut rng = create_rng(42);
        let lower = 1.3 - 3.0 * 0.1; // 1.0
        let upper = 1.3 + 3.0 * 0.1; // 1.6

        for _ in 0..1000 {
            let v = dist.sample(&mut rng);
            assert!(
                v >= lower && v <= upper,
                "Sample {} outside [{}, {}]",
                v,
                lower,
                upper
            );
        }
    }

    #[test]
    fn test_kf_normal_mean_within_tolerance() {
        let mean = 1.3;
        let dist = TargetKfDistribution::Normal { mean, std: 0.1 };
        let mut rng = create_rng(42);

        let sum: f64 = (0..1000).map(|_| dist.sample(&mut rng)).sum();
        let sample_mean = sum / 1000.0;
        assert!(
            (sample_mean - mean).abs() < 0.05,
            "Sample mean {} too far from {}",
            sample_mean,
            mean
        );
    }

    #[test]
    fn test_kf_uniform_within_range() {
        let dist = TargetKfDistribution::Uniform { min: 1.1, max: 1.5 };
        let mut rng = create_rng(42);

        for _ in 0..1000 {
            let v = dist.sample(&mut rng);
            assert!(v >= 1.1 && v <= 1.5, "Sample {} outside [1.1, 1.5]", v);
        }
    }

    #[test]
    fn test_kf_reproducibility() {
        let dist = TargetKfDistribution::Normal {
            mean: 1.3,
            std: 0.1,
        };
        let mut rng1 = create_rng(42);
        let mut rng2 = create_rng(42);
        assert_eq!(dist.sample(&mut rng1), dist.sample(&mut rng2));
    }

    #[test]
    fn test_default_kf() {
        let d = TargetKfDistribution::default();
        match d {
            TargetKfDistribution::Fixed { value } => assert_eq!(value, 1.3),
            _ => panic!("Expected Fixed variant for default TargetKfDistribution"),
        }
    }

    // ── Shared / edge-case tests ───────────────────────────────────────

    /// R13 scenario 13.3: truncated Normal fallback to mean after 10 failed draws.
    ///
    /// We cannot easily force all 10 standard-normal draws outside ±3σ since
    /// that interval captures 99.7% of the mass. Instead, we verify the
    /// helper function directly with std = 0 (degenerate), which forces every
    /// candidate z * 0 + mean = mean, always within [mean, mean].
    #[test]
    fn test_truncated_normal_degenerate_returns_mean() {
        let dist = DpoDistribution::Normal {
            mean: 5.0,
            std: 0.0,
        };
        let mut rng = create_rng(42);
        // std=0 → lower == upper == mean, z*0 + mean == mean always
        assert_eq!(dist.sample(&mut rng), 5.0);
    }

    /// Verify uniform distribution spans most of the range (not collapsed).
    #[test]
    fn test_uniform_spans_range() {
        let dist = DpoDistribution::Uniform {
            min: 10.0,
            max: 15.0,
        };
        let mut rng = create_rng(42);
        let mut min_seen = f64::MAX;
        let mut max_seen = f64::MIN;

        for _ in 0..1000 {
            let v = dist.sample(&mut rng);
            min_seen = min_seen.min(v);
            max_seen = max_seen.max(v);
        }
        // Should span most of the [10, 15] range
        assert!(min_seen < 10.1, "min_seen {} not near 10.0", min_seen);
        assert!(max_seen > 14.9, "max_seen {} not near 15.0", max_seen);
    }

    /// Verify Uniform reproducibility (seed-deterministic).
    #[test]
    fn test_uniform_reproducibility() {
        let dist = DpoDistribution::Uniform {
            min: 10.0,
            max: 15.0,
        };
        let mut rng1 = create_rng(42);
        let mut rng2 = create_rng(42);
        assert_eq!(dist.sample(&mut rng1), dist.sample(&mut rng2));
    }

    /// Fixed with different values to triangulate (not hardcoded to specific value).
    #[test]
    fn test_fixed_different_values() {
        let mut rng = create_rng(42);
        assert_eq!(DpoDistribution::Fixed { value: 0.5 }.sample(&mut rng), 0.5);
        assert_eq!(
            TargetKfDistribution::Fixed { value: 99.9 }.sample(&mut rng),
            99.9
        );
    }
}
