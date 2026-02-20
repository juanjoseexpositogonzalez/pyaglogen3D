//! Sintering coefficient module for particle aggregation.
//!
//! Sintering represents the neck formation (overlap) between particles at contact points.
//! A sintering coefficient of 1.0 means particles just touch (no overlap).
//! Values < 1.0 mean particles overlap (sintered), e.g., 0.9 = 10% overlap.
//!
//! This module supports three sintering modes:
//! - Fixed: same coefficient for all contacts
//! - Uniform: coefficient sampled from uniform distribution [min, max]
//! - Normal: coefficient sampled from normal distribution N(mean, std)

use rand::Rng;
use rand_distr::{Distribution, Normal, Uniform};
use pyo3::prelude::*;

/// Sintering distribution type for particle contacts.
#[derive(Debug, Clone)]
pub enum SinteringDistribution {
    /// Fixed sintering coefficient (same for all contacts)
    Fixed(f64),
    /// Uniform distribution U(min, max)
    Uniform { min: f64, max: f64 },
    /// Normal distribution N(mean, std), clamped to [0.5, 1.0]
    Normal { mean: f64, std: f64 },
}

impl Default for SinteringDistribution {
    fn default() -> Self {
        SinteringDistribution::Fixed(1.0) // No sintering by default
    }
}

impl SinteringDistribution {
    /// Create a fixed sintering coefficient.
    pub fn fixed(value: f64) -> Self {
        SinteringDistribution::Fixed(value.clamp(0.5, 1.0))
    }

    /// Create a uniform distribution for sintering.
    pub fn uniform(min: f64, max: f64) -> Self {
        let min = min.clamp(0.5, 1.0);
        let max = max.clamp(min, 1.0);
        SinteringDistribution::Uniform { min, max }
    }

    /// Create a normal distribution for sintering.
    pub fn normal(mean: f64, std: f64) -> Self {
        let mean = mean.clamp(0.5, 1.0);
        let std = std.abs().min(0.2); // Limit std to prevent extreme values
        SinteringDistribution::Normal { mean, std }
    }

    /// Sample a sintering coefficient from the distribution.
    pub fn sample<R: Rng>(&self, rng: &mut R) -> f64 {
        match self {
            SinteringDistribution::Fixed(v) => *v,
            SinteringDistribution::Uniform { min, max } => {
                let dist = Uniform::new_inclusive(*min, *max);
                dist.sample(rng)
            }
            SinteringDistribution::Normal { mean, std } => {
                if let Ok(dist) = Normal::new(*mean, *std) {
                    let value = dist.sample(rng);
                    value.clamp(0.5, 1.0)
                } else {
                    *mean
                }
            }
        }
    }

    /// Get the mean sintering coefficient (for metrics calculation).
    pub fn mean(&self) -> f64 {
        match self {
            SinteringDistribution::Fixed(v) => *v,
            SinteringDistribution::Uniform { min, max } => (min + max) / 2.0,
            SinteringDistribution::Normal { mean, .. } => *mean,
        }
    }

    /// Check if sintering is enabled (coefficient < 1.0).
    pub fn is_enabled(&self) -> bool {
        self.mean() < 0.999
    }
}

/// Sintering parameters for PyO3 interface.
///
/// Provides a Python-friendly interface for configuring sintering.
#[pyclass]
#[derive(Debug, Clone)]
pub struct PySinteringParams {
    /// Distribution type: "fixed", "uniform", or "normal"
    #[pyo3(get, set)]
    pub distribution_type: String,
    /// Sintering coefficient (for fixed mode)
    #[pyo3(get, set)]
    pub coefficient: f64,
    /// Minimum coefficient (for uniform mode)
    #[pyo3(get, set)]
    pub min_coefficient: f64,
    /// Maximum coefficient (for uniform mode)
    #[pyo3(get, set)]
    pub max_coefficient: f64,
    /// Mean coefficient (for normal mode)
    #[pyo3(get, set)]
    pub mean_coefficient: f64,
    /// Standard deviation (for normal mode)
    #[pyo3(get, set)]
    pub std_coefficient: f64,
}

#[pymethods]
impl PySinteringParams {
    /// Create new sintering parameters.
    ///
    /// # Arguments
    /// * `distribution_type` - "fixed", "uniform", or "normal"
    /// * `coefficient` - Fixed coefficient (default: 1.0, no sintering)
    /// * `min_coefficient` - Min for uniform distribution (default: 0.85)
    /// * `max_coefficient` - Max for uniform distribution (default: 0.95)
    /// * `mean_coefficient` - Mean for normal distribution (default: 0.9)
    /// * `std_coefficient` - Std for normal distribution (default: 0.05)
    #[new]
    #[pyo3(signature = (distribution_type="fixed", coefficient=1.0, min_coefficient=0.85, max_coefficient=0.95, mean_coefficient=0.9, std_coefficient=0.05))]
    pub fn new(
        distribution_type: &str,
        coefficient: f64,
        min_coefficient: f64,
        max_coefficient: f64,
        mean_coefficient: f64,
        std_coefficient: f64,
    ) -> Self {
        Self {
            distribution_type: distribution_type.to_lowercase(),
            coefficient,
            min_coefficient,
            max_coefficient,
            mean_coefficient,
            std_coefficient,
        }
    }

    /// Create fixed sintering coefficient.
    #[staticmethod]
    pub fn fixed(coefficient: f64) -> Self {
        Self::new("fixed", coefficient, 0.85, 0.95, 0.9, 0.05)
    }

    /// Create uniform distribution sintering.
    #[staticmethod]
    pub fn uniform(min: f64, max: f64) -> Self {
        Self::new("uniform", 1.0, min, max, 0.9, 0.05)
    }

    /// Create normal distribution sintering.
    #[staticmethod]
    pub fn normal(mean: f64, std: f64) -> Self {
        Self::new("normal", 1.0, 0.85, 0.95, mean, std)
    }

    /// Get the effective mean sintering coefficient.
    pub fn effective_mean(&self) -> f64 {
        self.to_distribution().mean()
    }

    /// Check if sintering is enabled.
    pub fn is_enabled(&self) -> bool {
        self.to_distribution().is_enabled()
    }
}

impl Default for PySinteringParams {
    fn default() -> Self {
        Self::new("fixed", 1.0, 0.85, 0.95, 0.9, 0.05)
    }
}

impl PySinteringParams {
    /// Convert to internal distribution type.
    pub fn to_distribution(&self) -> SinteringDistribution {
        match self.distribution_type.as_str() {
            "uniform" => SinteringDistribution::uniform(self.min_coefficient, self.max_coefficient),
            "normal" => SinteringDistribution::normal(self.mean_coefficient, self.std_coefficient),
            _ => SinteringDistribution::fixed(self.coefficient),
        }
    }
}

/// Calculate sintered contact distance between two particles.
///
/// Returns the distance between centers when particles are in contact,
/// accounting for sintering overlap.
pub fn sintered_contact_distance(r1: f64, r2: f64, sintering_coeff: f64) -> f64 {
    sintering_coeff * (r1 + r2)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::rng::create_rng;

    #[test]
    fn test_fixed_sintering() {
        let dist = SinteringDistribution::fixed(0.9);
        let mut rng = create_rng(42);

        for _ in 0..10 {
            let coeff = dist.sample(&mut rng);
            assert!((coeff - 0.9).abs() < 1e-10);
        }
    }

    #[test]
    fn test_uniform_sintering() {
        let dist = SinteringDistribution::uniform(0.85, 0.95);
        let mut rng = create_rng(42);

        let mut min_seen: f64 = 1.0;
        let mut max_seen: f64 = 0.0;

        for _ in 0..1000 {
            let coeff = dist.sample(&mut rng);
            assert!(coeff >= 0.85 && coeff <= 0.95);
            min_seen = min_seen.min(coeff);
            max_seen = max_seen.max(coeff);
        }

        // Should span most of the range
        assert!(min_seen < 0.87);
        assert!(max_seen > 0.93);
    }

    #[test]
    fn test_normal_sintering() {
        let dist = SinteringDistribution::normal(0.9, 0.03);
        let mut rng = create_rng(42);

        let mut sum = 0.0;
        let n = 1000;

        for _ in 0..n {
            let coeff = dist.sample(&mut rng);
            assert!(coeff >= 0.5 && coeff <= 1.0);
            sum += coeff;
        }

        let mean = sum / n as f64;
        // Mean should be close to 0.9
        assert!((mean - 0.9).abs() < 0.05);
    }

    #[test]
    fn test_sintered_contact_distance() {
        let r1 = 1.0;
        let r2 = 1.0;

        // No sintering
        assert!((sintered_contact_distance(r1, r2, 1.0) - 2.0).abs() < 1e-10);

        // 10% sintering
        assert!((sintered_contact_distance(r1, r2, 0.9) - 1.8).abs() < 1e-10);
    }

    #[test]
    fn test_py_sintering_params() {
        let params = PySinteringParams::fixed(0.9);
        assert!((params.effective_mean() - 0.9).abs() < 1e-10);
        assert!(params.is_enabled());

        let params = PySinteringParams::fixed(1.0);
        assert!(!params.is_enabled());
    }
}
