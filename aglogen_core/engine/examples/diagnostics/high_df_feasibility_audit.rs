//! Diagnostic example: high-Df feasibility audit (Cycle 2, cc-tunable-high-df-fix).
//!
//! Runs two simulations for each `Df_target ∈ {2.7, 2.9}`, N=100, seed=42:
//! - **BEFORE** (`CC_TUNABLE_USE_HIGH_DF_FIX=false`): captures counts of pairs where
//!   `calculate_com_distance` returns `Some(d)` with `d < 2·rp_max` per merge step.
//!   These are the geometrically impossible pairs that were silently attempted before
//!   the Cycle 2 guard was added.
//! - **AFTER** (`CC_TUNABLE_USE_HIGH_DF_FIX=true`): captures `adaptive_high_df_floor`
//!   entries emitted by the contact guard, and the final measured Df.
//!
//! Compares before/after Df to confirm the guard restores convergence in [2.5, 2.9].
//!
//! Expected output pattern (from design.md §7):
//! ```
//! [BEFORE] Df_target=2.7 seed=42: adaptive_high_df_floor=0, ballistic/adaptive=N, final Df=2.40
//! [AFTER]  Df_target=2.7 seed=42: adaptive_high_df_floor=K, final Df=2.71
//! ```
//!
//! Run:
//!   cargo run --release --example high_df_feasibility_audit -p aglogen-engine
//!
//! This example is manual / nightly only; it is NOT gated in CI.
//! Spec: design.md §7 · tasks.md Phase 7.

use aglogen_engine::simulation::tunable_cc::{run_tunable_cc_internal, SeedType, TunableCcParams};

fn main() {
    println!("=== High-Df Feasibility Audit (Cycle 2 cc-tunable-high-df-fix) ===\n");

    let df_targets = [2.7_f64, 2.9];
    let n_particles = 100usize;
    let target_kf = 1.3_f64;
    let seed = 42u64;

    for &df_target in &df_targets {
        println!("── Df_target = {:.1}, N={}, seed={} ──", df_target, n_particles, seed);

        // BEFORE: HIGH_DF_FIX=false (Cycle 1 production default).
        unsafe {
            std::env::set_var("CC_TUNABLE_USE_HIGH_DF_FIX", "false");
            std::env::remove_var("CC_TUNABLE_USE_LOW_DF_FIX"); // default ON
        }
        let params_before = TunableCcParams {
            n_particles,
            target_df: df_target,
            target_kf,
            radius_min: 1.0,
            radius_max: 1.0,
            seed_type: SeedType::Dimers,
            ..Default::default()
        };
        let before = run_tunable_cc_internal(params_before, seed, None);

        // Count merge types in BEFORE run.
        let before_ballistic = before.merge_trace.iter().filter(|e| e.merge_type == "ballistic").count();
        let before_adaptive  = before.merge_trace.iter().filter(|e| e.merge_type == "adaptive").count();
        let before_tunable   = before.merge_trace.iter().filter(|e| e.merge_type == "tunable").count();
        let before_floor     = before.merge_trace.iter().filter(|e| e.merge_type == "adaptive_high_df_floor").count();

        println!(
            "[BEFORE] Df_target={:.1} seed={}: tunable={}, adaptive={}, ballistic={}, adaptive_high_df_floor={}, final_Df={:.4}",
            df_target, seed, before_tunable, before_adaptive, before_ballistic, before_floor, before.fractal_dimension
        );

        // AFTER: HIGH_DF_FIX=true (Cycle 2 default).
        unsafe {
            std::env::remove_var("CC_TUNABLE_USE_HIGH_DF_FIX"); // default ON
        }
        let params_after = TunableCcParams {
            n_particles,
            target_df: df_target,
            target_kf,
            radius_min: 1.0,
            radius_max: 1.0,
            seed_type: SeedType::Dimers,
            ..Default::default()
        };
        let after = run_tunable_cc_internal(params_after, seed, None);

        // Count merge types in AFTER run.
        let after_ballistic = after.merge_trace.iter().filter(|e| e.merge_type == "ballistic").count();
        let after_adaptive  = after.merge_trace.iter().filter(|e| e.merge_type == "adaptive").count();
        let after_tunable   = after.merge_trace.iter().filter(|e| e.merge_type == "tunable").count();
        let after_floor     = after.merge_trace.iter().filter(|e| e.merge_type == "adaptive_high_df_floor").count();

        println!(
            "[AFTER]  Df_target={:.1} seed={}: tunable={}, adaptive={}, ballistic={}, adaptive_high_df_floor={}, final_Df={:.4}",
            df_target, seed, after_tunable, after_adaptive, after_ballistic, after_floor, after.fractal_dimension
        );

        // Summary.
        let df_improvement = after.fractal_dimension - before.fractal_dimension;
        println!(
            "  Df improvement: {:.4} → {:.4} (delta: {:+.4})",
            before.fractal_dimension, after.fractal_dimension, df_improvement
        );
        if after_floor > 0 {
            println!(
                "  Guard activated {} times (adaptive_high_df_floor) — guard is working.",
                after_floor
            );
        } else {
            println!(
                "  No adaptive_high_df_floor entries — guard did not fire for this seed/N. \
                 Try larger N or a different seed to observe the guard in action."
            );
        }
        println!();
    }

    println!("=== End of high-Df feasibility audit ===");
    println!("Note: kf (prefactor) at Df=2.9/N=100 may sit below 1.0 (~0.929) due to");
    println!("finite-N Rg-evolution estimator artifact. See CHANGELOG for details.");
    println!("Cycle 3 (cc-tunable-estimator-overhaul) tracks the kf improvement.");
}
