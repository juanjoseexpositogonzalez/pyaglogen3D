//! THE deciding experiment.
//!
//! Generate REAL CC-tunable clusters at multiple target Df values and
//! compare:
//!   - Df reported by the simulator (via Rg-scaling, the construction metric)
//!   - Df measured by box-counting on the same particle centres
//!
//! If sim says 2.7 and BC says ~2.0 → CC-tunable generator builds an
//! object whose Rg-scaling is 2.7 but whose box-counting dimension is 2.0.
//! In that case BC is honest and the simulator (or its Df definition) is
//! the source of the discrepancy the user is seeing.
//!
//! If sim says 2.7 and BC also says ~2.7 → BC works fine on real clusters
//! and the original "BC topped at 2" observation was a specific edge case
//! (low N, specific Df target) we need to reproduce more carefully.
//!
//! Run: `cargo run --release --example bc_vs_sim_real -p aglogen-engine`

use aglogen_engine::fractal::box_counting_3d::box_counting_3d_morton;
use aglogen_engine::simulation::tunable_cc::{run_tunable_cc_internal, TunableCcParams};

fn main() {
    println!("CC-TUNABLE GENERATOR vs BOX-COUNTING ON REAL CLUSTERS");
    println!("=====================================================\n");

    let n_particles = 2000;
    let seeds_per_df = 3;
    let df_targets = [1.5_f64, 1.8, 2.0, 2.2, 2.5, 2.7, 2.9];

    println!(
        "Generating {} particles per cluster, {} seeds per Df target.",
        n_particles, seeds_per_df
    );
    println!("Each row: target Df → sim reports → BC measures.\n");

    println!(
        "{:<12} | {:>14} | {:>14} | {:>14} | {:>8}",
        "Df_target", "sim_Df (mean)", "BC_Df (mean)", "BC_Df (std)", "BC_R²"
    );
    println!("{}", "-".repeat(78));

    for &df_target in &df_targets {
        let mut sim_dfs = Vec::new();
        let mut bc_dfs = Vec::new();
        let mut bc_r2s = Vec::new();
        let mut sim_failures = 0;

        for seed in 0..seeds_per_df {
            let params = TunableCcParams {
                n_particles,
                target_df: df_target,
                target_kf: 1.3,
                radius_min: 1.0,
                radius_max: 1.0,
                ..Default::default()
            };

            let result = run_tunable_cc_internal(params, seed, None);

            // Skip clearly broken sim outputs (negative Df, NaN, etc.)
            if !result.fractal_dimension.is_finite()
                || result.fractal_dimension <= 0.0
                || result.coordinates.is_empty()
            {
                sim_failures += 1;
                continue;
            }

            sim_dfs.push(result.fractal_dimension);

            // Run BC on the actual particle centres
            let bc = box_counting_3d_morton(&result.coordinates, 18);
            bc_dfs.push(bc.dimension);
            bc_r2s.push(bc.r_squared);
        }

        if sim_dfs.is_empty() {
            println!(
                "{:<12.2} | {:>14} | {:>14} | {:>14} | {:>8}",
                df_target, "ALL FAILED", "-", "-", "-"
            );
            continue;
        }

        let sim_mean: f64 = sim_dfs.iter().sum::<f64>() / sim_dfs.len() as f64;
        let bc_mean: f64 = bc_dfs.iter().sum::<f64>() / bc_dfs.len() as f64;
        let bc_std = (bc_dfs.iter().map(|v| (v - bc_mean).powi(2)).sum::<f64>()
            / bc_dfs.len() as f64)
            .sqrt();
        let bc_r2_mean: f64 = bc_r2s.iter().sum::<f64>() / bc_r2s.len() as f64;

        let suffix = if sim_failures > 0 {
            format!(" ({} sim failures)", sim_failures)
        } else {
            String::new()
        };

        println!(
            "{:<12.2} | {:>14.4} | {:>14.4} | {:>14.4} | {:>8.4}{}",
            df_target, sim_mean, bc_mean, bc_std, bc_r2_mean, suffix
        );
    }

    println!("\n=== Interpretation ===");
    println!("Column 'sim_Df' is what the simulator computes from Rg-scaling on the");
    println!("generated cluster. Column 'BC_Df' is box-counting on the same centres.");
    println!();
    println!("If sim_Df ≈ Df_target AND BC_Df ≈ Df_target → both metrics agree, no bug.");
    println!("If sim_Df ≈ Df_target BUT BC_Df < 2.2 for high targets → CC-tunable produces");
    println!("    clusters whose Rg-scaling says one thing but box-counting another.");
    println!("    BC is correct; the user's confusion is real, but the algorithm isn't broken.");
    println!("If sim_Df disagrees with target → the CC-tunable Phase 3 algorithm itself");
    println!("    fails at high Df (which we saw in 2026-04 — PYA-14 Phase 3).");
}
