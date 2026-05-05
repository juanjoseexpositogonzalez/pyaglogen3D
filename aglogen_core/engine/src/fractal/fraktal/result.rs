//! FRAKTAL analysis result types (pure Rust, no PyO3).

/// Reason why bisection analysis failed to produce a valid result.
///
/// Used to classify the specific failure mode for user-facing diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureReason {
    /// No sign change found in objective function — golden section fallback used.
    NoSignChange,
    /// Prefactor kf was negative at the solution point.
    KfNegative,
    /// Maximum iterations reached without convergence.
    IterationLimit,
}

impl FailureReason {
    /// Stable string tag for serialization / Python / JSON payloads.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NoSignChange => "no_sign_change",
            Self::KfNegative => "kf_negative",
            Self::IterationLimit => "iteration_limit",
        }
    }
}

/// Quality classification of a bisection analysis result.
///
/// Replaces the binary success/failure distinction with a 4-tier system
/// based on convergence residual and failure mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AnalysisQuality {
    /// Residual < APPROXIMATE_RESIDUAL_THRESHOLD (0.1) — fully converged.
    #[default]
    Converged,
    /// 0.1 ≤ residual ≤ EXCLUDED_RESIDUAL_THRESHOLD (1.0) — usable approximation.
    Approximate,
    /// Residual > 1.0 OR no_sign_change — excluded from statistics.
    Excluded,
    /// kf_negative OR engine error — analysis failed entirely.
    Failed,
}

impl AnalysisQuality {
    /// Stable string tag for serialization / Python / JSON payloads.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Converged => "converged",
            Self::Approximate => "approximate",
            Self::Excluded => "excluded",
            Self::Failed => "failed",
        }
    }
}

/// Status of FRAKTAL analysis.
#[derive(Debug, Clone, PartialEq)]
pub enum FraktalStatus {
    /// Analysis completed successfully
    Success,
    /// Fractal dimension outside valid range (1.0-3.0)
    DfOutOfRange,
    /// Number of primary particles below minimum threshold
    NpoTooSmall,
    /// Bisection method failed to converge
    NoConvergence,
    /// Other error with message
    Error(String),
}

impl FraktalStatus {
    pub fn as_str(&self) -> &str {
        match self {
            FraktalStatus::Success => "success",
            FraktalStatus::DfOutOfRange => "df_out_of_range",
            FraktalStatus::NpoTooSmall => "npo_too_small",
            FraktalStatus::NoConvergence => "no_convergence",
            FraktalStatus::Error(_) => "error",
        }
    }

    pub fn message(&self) -> String {
        match self {
            FraktalStatus::Success => "Analysis completed successfully".to_string(),
            FraktalStatus::DfOutOfRange => {
                "Fractal dimension outside valid range (1.0-3.0)".to_string()
            }
            FraktalStatus::NpoTooSmall => {
                "Number of primary particles below minimum threshold".to_string()
            }
            FraktalStatus::NoConvergence => "Bisection method failed to converge".to_string(),
            FraktalStatus::Error(msg) => msg.clone(),
        }
    }
}

/// Internal FRAKTAL analysis result.
#[derive(Debug, Clone)]
pub struct FraktalResult {
    /// Radius of gyration in nm (optionally 3D corrected)
    pub rg: f64,
    /// Projected area in nm squared
    pub ap: f64,
    /// Fractal dimension (1.0 - 3.0)
    pub df: f64,
    /// Number of primary particles (calculated from fractal equation)
    pub npo: u64,
    /// Number of primary particles (estimated visually from image)
    pub npo_visual: u64,
    /// Prefactor kf from power law
    pub kf: f64,
    /// Overlap exponent zf
    pub zf: f64,
    /// Coordination index Jf (only for 2012 granulated model)
    pub jf: Option<f64>,
    /// Volume in nm cubed
    pub volume: f64,
    /// Mass in fg (femtograms) using soot density 1.85e-06 fg/nm cubed
    pub mass: f64,
    /// Surface area in nm squared
    pub surface_area: f64,
    /// Analysis status
    pub status: FraktalStatus,
    /// Execution time in milliseconds
    pub execution_time_ms: u64,
    /// Model used for analysis ("granulated_2012" or "voxel_2018")
    pub model: String,
    /// Ratio of calculated npo / visual npo (1.0 = perfect match)
    pub npo_ratio: f64,
    /// Whether calculated and visual npo are aligned (within 2x tolerance)
    pub npo_aligned: bool,
    /// Estimated dpo from visual particle analysis (nm)
    pub dpo_estimated: f64,
    // ── Bisection diagnostic fields (PYA-13 fraktal-bisection-ux) ──
    /// Number of bisection iterations performed (None if not surfaced).
    pub bisection_iterations: Option<usize>,
    /// Final bisection residual |f(Df)| (None if not surfaced).
    pub bisection_residual: Option<f64>,
    /// Categorized failure reason (None when analysis succeeded).
    pub failure_reason: Option<FailureReason>,
    /// Best Df estimate even when not converged (None when no estimate computable).
    pub df_estimate: Option<f64>,
    /// Quality classification of this analysis result.
    pub quality: AnalysisQuality,
}

impl Default for FraktalResult {
    fn default() -> Self {
        Self {
            rg: 0.0,
            ap: 0.0,
            df: 0.0,
            npo: 0,
            npo_visual: 0,
            kf: 0.0,
            zf: 0.0,
            jf: None,
            volume: 0.0,
            mass: 0.0,
            surface_area: 0.0,
            status: FraktalStatus::Error("Not initialized".to_string()),
            execution_time_ms: 0,
            model: String::new(),
            npo_ratio: 0.0,
            npo_aligned: false,
            dpo_estimated: 0.0,
            bisection_iterations: None,
            bisection_residual: None,
            failure_reason: None,
            df_estimate: None,
            quality: AnalysisQuality::Converged,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_failure_reason_as_str() {
        assert_eq!(FailureReason::NoSignChange.as_str(), "no_sign_change");
        assert_eq!(FailureReason::KfNegative.as_str(), "kf_negative");
        assert_eq!(FailureReason::IterationLimit.as_str(), "iteration_limit");
    }

    #[test]
    fn test_failure_reason_eq_and_clone() {
        let a = FailureReason::NoSignChange;
        let b = a; // Copy
        let c = a.clone();
        assert_eq!(a, b);
        assert_eq!(b, c);
    }

    #[test]
    fn test_analysis_quality_as_str() {
        assert_eq!(AnalysisQuality::Converged.as_str(), "converged");
        assert_eq!(AnalysisQuality::Approximate.as_str(), "approximate");
        assert_eq!(AnalysisQuality::Excluded.as_str(), "excluded");
        assert_eq!(AnalysisQuality::Failed.as_str(), "failed");
    }

    #[test]
    fn test_analysis_quality_default_is_converged() {
        let q = AnalysisQuality::default();
        assert_eq!(q, AnalysisQuality::Converged);
    }

    #[test]
    fn test_analysis_quality_eq_and_clone() {
        let a = AnalysisQuality::Approximate;
        let b = a; // Copy
        let c = a.clone();
        assert_eq!(a, b);
        assert_eq!(b, c);
    }

    #[test]
    fn test_fraktal_result_diagnostic_fields_default() {
        let r = FraktalResult::default();
        assert_eq!(r.bisection_iterations, None);
        assert_eq!(r.bisection_residual, None);
        assert_eq!(r.failure_reason, None);
        assert_eq!(r.df_estimate, None);
        assert_eq!(r.quality, AnalysisQuality::Converged);
    }

    #[test]
    fn test_fraktal_result_diagnostic_fields_populated() {
        let r = FraktalResult {
            bisection_iterations: Some(42),
            bisection_residual: Some(0.05),
            failure_reason: Some(FailureReason::IterationLimit),
            df_estimate: Some(1.82),
            quality: AnalysisQuality::Approximate,
            ..Default::default()
        };
        assert_eq!(r.bisection_iterations, Some(42));
        assert_eq!(r.bisection_residual, Some(0.05));
        assert_eq!(r.failure_reason, Some(FailureReason::IterationLimit));
        assert_eq!(r.df_estimate, Some(1.82));
        assert_eq!(r.quality, AnalysisQuality::Approximate);
    }
}
