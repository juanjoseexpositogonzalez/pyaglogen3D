//! Simulation result types.

/// Per-merge diagnostic record emitted by CC-tunable aggregation (R16 spec).
///
/// One entry per successful merge step (tunable OR ballistic fallback).
/// Non-CC algorithms emit an empty `Vec<MergeTraceEntry>`.
#[derive(Debug, Clone, Default)]
pub struct MergeTraceEntry {
    /// 0-indexed merge counter (0 = first merge, N-2 = last).
    pub step: usize,
    /// Particle count of the impacted sub-cluster at merge time.
    pub n1: usize,
    /// Particle count of the impactor sub-cluster at merge time.
    pub n2: usize,
    /// COM-COM distance computed by `calculate_com_distance` (the target d).
    pub required_distance: f64,
    /// Measured COM-COM distance after positioning + contact resolution.
    pub actual_distance: f64,
    /// Measured radius of gyration of the merged cluster.
    pub rg_after: f64,
    /// Target Rg: `rp · ((n1 + n2) / kf)^(1/Df)`.
    pub rg_target: f64,
    /// `"tunable"` or `"ballistic"`.
    pub merge_type: String,
    /// Number of placement attempts before this merge succeeded.
    pub retries: usize,
    /// `true` when bounding radii sufficed at first attempt.
    pub bounding_check_passed: bool,
    /// Overshoot percentage for adaptive merges: `(actual - required) / required`.
    /// Only populated when `merge_type == "adaptive"`. `None` for tunable/ballistic.
    pub overshoot_pct: Option<f64>,
}

/// Python wrapper for simulation results.
#[derive(Clone)]

/// Internal simulation result (before conversion to Python).
pub struct SimulationResult {
    pub coordinates: Vec<[f64; 3]>,
    pub radii: Vec<f64>,
    pub rg_evolution: Vec<f64>,
    pub fractal_dimension: f64,
    pub fractal_dimension_std: f64,
    pub prefactor: f64,
    pub porosity: f64,
    pub coordination_mean: f64,
    pub coordination_std: f64,
    pub execution_time_ms: u64,
    pub seed: u64,
    // Inertia tensor results
    pub anisotropy: f64,
    pub asphericity: f64,
    pub acylindricity: f64,
    pub principal_moments: [f64; 3],
    pub principal_axes: [[f64; 3]; 3],
    // CC-tunable diagnostic metadata (R7 spec)
    /// Count of merge steps completed via tunable geometry.
    pub tunable_merges: usize,
    /// Count of merge steps that fell back to ballistic.
    pub ballistic_merges: usize,
    /// Count of merge steps completed via adaptive fallback (Phase 3).
    pub adaptive_merges: usize,
    /// Count of steps where zero feasible pairs existed.
    pub no_feasible_pair_events: usize,
    /// Highest retry count observed across all merge steps.
    pub max_retries_per_merge: usize,
    // Parametric distribution results (R14 — parametric-values-dpo-and-kf / PYA-15)
    /// Effective primary particle diameter used in this run.
    /// `Some(v)` for CC-tunable (sampled from `dpo_distribution`);
    /// `None` for algorithms that don't use distribution sampling.
    pub dpo_used: Option<f64>,
    /// Effective fractal prefactor used in this run.
    /// `Some(v)` for CC-tunable (sampled from `target_kf_distribution`);
    /// `None` for algorithms without kf distribution support.
    pub target_kf_used: Option<f64>,
    // Per-merge diagnostic trace (R16 — cc-tunable-merge-trace / PYA-14)
    /// Per-step merge diagnostic records. One entry per successful merge
    /// (tunable OR ballistic fallback). Non-CC algorithms emit `Vec::new()`.
    pub merge_trace: Vec<MergeTraceEntry>,
}

impl SimulationResult {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_trace_entry_default_zeros() {
        let e = MergeTraceEntry::default();
        assert_eq!(e.step, 0);
        assert_eq!(e.n1, 0);
        assert_eq!(e.n2, 0);
        assert_eq!(e.required_distance, 0.0);
        assert_eq!(e.actual_distance, 0.0);
        assert_eq!(e.rg_after, 0.0);
        assert_eq!(e.rg_target, 0.0);
        assert_eq!(e.merge_type, "");
        assert_eq!(e.retries, 0);
        assert_eq!(e.bounding_check_passed, false);
    }

    #[test]
    fn simulation_result_merge_trace_defaults_empty() {
        let r = SimulationResult {
            coordinates: Vec::new(),
            radii: Vec::new(),
            rg_evolution: Vec::new(),
            fractal_dimension: 0.0,
            fractal_dimension_std: 0.0,
            prefactor: 0.0,
            porosity: 0.0,
            coordination_mean: 0.0,
            coordination_std: 0.0,
            execution_time_ms: 0,
            seed: 0,
            anisotropy: 0.0,
            asphericity: 0.0,
            acylindricity: 0.0,
            principal_moments: [0.0; 3],
            principal_axes: [[0.0; 3]; 3],
            tunable_merges: 0,
            ballistic_merges: 0,
            adaptive_merges: 0,
            no_feasible_pair_events: 0,
            max_retries_per_merge: 0,
            dpo_used: None,
            target_kf_used: None,
            merge_trace: Vec::new(),
        };
        assert!(r.merge_trace.is_empty());
    }

    #[test]
    fn merge_trace_entry_clone_and_debug() {
        let e = MergeTraceEntry {
            step: 3,
            n1: 10,
            n2: 5,
            required_distance: 2.5,
            actual_distance: 2.4,
            rg_after: 4.1,
            rg_target: 4.0,
            merge_type: "tunable".to_string(),
            retries: 2,
            bounding_check_passed: true,
            overshoot_pct: None,
        };
        let cloned = e.clone();
        assert_eq!(cloned.step, 3);
        assert_eq!(cloned.merge_type, "tunable");
        // Debug must compile
        let _debug = format!("{:?}", e);
    }

    // ── Phase 3 data structure tests (PYA-14) ─────────────────────────

    /// T1.1 — MergeTraceEntry supports overshoot_pct field (None for non-adaptive).
    #[test]
    fn merge_trace_entry_overshoot_pct_none_for_tunable() {
        let e = MergeTraceEntry::default();
        assert_eq!(e.overshoot_pct, None, "Default overshoot_pct must be None");
    }

    /// T1.1 — MergeTraceEntry supports overshoot_pct populated for adaptive.
    #[test]
    fn merge_trace_entry_overshoot_pct_populated_for_adaptive() {
        let e = MergeTraceEntry {
            merge_type: "adaptive".to_string(),
            required_distance: 10.0,
            actual_distance: 12.0,
            overshoot_pct: Some(0.2), // (12 - 10) / 10 = 0.2
            ..Default::default()
        };
        assert_eq!(e.merge_type, "adaptive");
        assert_eq!(e.overshoot_pct, Some(0.2));
    }

    /// T1.1 — merge_type "adaptive" is a valid string value.
    #[test]
    fn merge_trace_entry_adaptive_merge_type() {
        let e = MergeTraceEntry {
            merge_type: "adaptive".to_string(),
            overshoot_pct: Some(0.05),
            ..Default::default()
        };
        assert_eq!(e.merge_type, "adaptive");
        assert!(e.overshoot_pct.unwrap() >= 0.0);
    }

    /// T1.3 — no_feasible_pair event is a trace entry with merge_type="no_feasible_pair".
    /// It carries step + pool_size (in n1) but NOT actual_distance/rg fields.
    #[test]
    fn merge_trace_no_feasible_pair_event() {
        let e = MergeTraceEntry {
            step: 42,
            n1: 15, // pool_size stored in n1 for no_feasible_pair events
            n2: 0,
            required_distance: 0.0,
            actual_distance: 0.0,
            rg_after: 0.0,
            rg_target: 0.0,
            merge_type: "no_feasible_pair".to_string(),
            retries: 0,
            bounding_check_passed: false,
            overshoot_pct: None,
        };
        assert_eq!(e.merge_type, "no_feasible_pair");
        assert_eq!(e.step, 42);
        assert_eq!(e.n1, 15); // pool_size
    }

    /// T1.3 — SimulationResult has adaptive_merges and no_feasible_pair_events counters.
    #[test]
    fn simulation_result_has_phase3_metadata_fields() {
        let r = SimulationResult {
            coordinates: Vec::new(),
            radii: Vec::new(),
            rg_evolution: Vec::new(),
            fractal_dimension: 0.0,
            fractal_dimension_std: 0.0,
            prefactor: 0.0,
            porosity: 0.0,
            coordination_mean: 0.0,
            coordination_std: 0.0,
            execution_time_ms: 0,
            seed: 0,
            anisotropy: 0.0,
            asphericity: 0.0,
            acylindricity: 0.0,
            principal_moments: [0.0; 3],
            principal_axes: [[0.0; 3]; 3],
            tunable_merges: 5,
            ballistic_merges: 2,
            adaptive_merges: 3,
            no_feasible_pair_events: 1,
            max_retries_per_merge: 10,
            dpo_used: None,
            target_kf_used: None,
            merge_trace: Vec::new(),
        };
        assert_eq!(r.adaptive_merges, 3);
        assert_eq!(r.no_feasible_pair_events, 1);
    }
}
