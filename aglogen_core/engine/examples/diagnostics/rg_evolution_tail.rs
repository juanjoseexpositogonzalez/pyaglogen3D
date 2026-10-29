//! Test Hypothesis A from the SDD explore phase:
//!
//! "The Rg-evolution OLS regression is contaminated by the first ~N/2 merges,
//! which are monomer+monomer ballistic-like events. If we re-fit using only
//! the LAST 30% of (N, Rg) samples (large clusters that should be in the
//! true scaling regime), Df should approach Df_target."
//!
//! If the tail-only fit converges to Df_target, the bug is the ESTIMATOR
//! (the OLS uses the full sequence) and the AGGREGATION algorithm itself
//! may be largely correct.
//!
//! Run: `cargo run --release --example rg_evolution_tail -p aglogen-engine`

use aglogen_engine::simulation::tunable_cc::{run_tunable_cc_internal, TunableCcParams};

/// Re-do the OLS regression with a configurable tail fraction.
/// Mirrors `calculate_fractal_dimension_from_evolution` in tunable_cc.rs.
fn fit_powerlaw(
    n_values: &[usize],
    rg_values: &[f64],
    rp: f64,
    tail_fraction: f64,
) -> Option<(f64, f64, f64, usize)> {
    let total = n_values.len();
    if total < 3 {
        return None;
    }
    let start = ((total as f64) * (1.0 - tail_fraction)).floor() as usize;
    let start = start.min(total - 3);

    let data: Vec<(f64, f64)> = n_values
        .iter()
        .zip(rg_values.iter())
        .enumerate()
        .filter(|(i, _)| *i >= start)
        .filter(|(_, (&n, &rg))| n > 1 && rg > rp * 0.1)
        .map(|(_, (&n, &rg))| ((rg / rp).ln(), (n as f64).ln()))
        .collect();

    if data.len() < 3 {
        return None;
    }

    let n_used = data.len();
    let n = n_used as f64;
    let sx: f64 = data.iter().map(|(x, _)| x).sum();
    let sy: f64 = data.iter().map(|(_, y)| y).sum();
    let sxx: f64 = data.iter().map(|(x, _)| x * x).sum();
    let sxy: f64 = data.iter().map(|(x, y)| x * y).sum();
    let denom = n * sxx - sx * sx;
    if denom.abs() < 1e-10 {
        return None;
    }
    let slope = (n * sxy - sx * sy) / denom;
    let intercept = (sy - slope * sx) / n;
    let mean_y = sy / n;
    let ss_tot: f64 = data.iter().map(|(_, y)| (y - mean_y).powi(2)).sum();
    let ss_res: f64 = data
        .iter()
        .map(|(x, y)| {
            let pred = intercept + slope * x;
            (y - pred).powi(2)
        })
        .sum();
    let r2 = if ss_tot > 0.0 {
        1.0 - ss_res / ss_tot
    } else {
        0.0
    };
    Some((slope, intercept.exp(), r2, n_used))
}

fn main() {
    println!("Hypothesis A test: Rg-evolution tail-only regression");
    println!("=====================================================\n");
    println!("For each Df_target, refit the (N, Rg) samples using full set, last 50%, ");
    println!("last 30%, last 20%. If tail-only converges to target, the OLS is the bug.\n");

    let n_particles = 2000;
    let seeds = 3;
    let df_targets = [1.5_f64, 1.8, 2.0, 2.2, 2.5, 2.7, 2.9];

    println!(
        "{:<10} | {:^36} | {:^36} | {:^36} | {:^36}",
        "", "FULL (all merges)", "TAIL 50%", "TAIL 30%", "TAIL 20%"
    );
    println!(
        "{:<10} | {:<10} {:<8} {:<8} {:<5} | {:<10} {:<8} {:<8} {:<5} | {:<10} {:<8} {:<8} {:<5} | {:<10} {:<8} {:<8} {:<5}",
        "Df_target", "Df", "kf", "R²", "N", "Df", "kf", "R²", "N", "Df", "kf", "R²", "N", "Df", "kf", "R²", "N"
    );
    println!("{}", "-".repeat(170));

    for &df_target in &df_targets {
        let mut acc = [
            (Vec::<f64>::new(), Vec::<f64>::new(), Vec::<f64>::new(), Vec::<usize>::new()),
            (Vec::<f64>::new(), Vec::<f64>::new(), Vec::<f64>::new(), Vec::<usize>::new()),
            (Vec::<f64>::new(), Vec::<f64>::new(), Vec::<f64>::new(), Vec::<usize>::new()),
            (Vec::<f64>::new(), Vec::<f64>::new(), Vec::<f64>::new(), Vec::<usize>::new()),
        ];

        let fractions = [1.0, 0.5, 0.3, 0.2];

        for seed in 0..seeds {
            let params = TunableCcParams {
                n_particles,
                target_df: df_target,
                target_kf: 1.3,
                radius_min: 1.0,
                radius_max: 1.0,
                ..Default::default()
            };
            let result = run_tunable_cc_internal(params, seed, None);
            if result.coordinates.is_empty() {
                continue;
            }

            // Reconstruct (N, Rg) sequence from result.rg_evolution.
            // n_values is not in the result but rg_evolution.len() should equal
            // the number of recorded merges. We rebuild N from index: each merge
            // grows N by some amount, but we only have rg_evolution. We assume
            // the rg_evolution[i] corresponds to N = (i+seed_count+1) — close
            // enough since most merges add 1 particle (monomer+cluster).
            // Better: read the merge_trace which has n1 + n2 per step.
            let n_seq: Vec<usize> = result
                .merge_trace
                .iter()
                .scan(0usize, |running, e| {
                    *running = e.n1 + e.n2;
                    Some(*running)
                })
                .collect();
            let rg_seq: Vec<f64> = result
                .merge_trace
                .iter()
                .map(|e| e.rg_after)
                .collect();

            if n_seq.len() < 10 {
                continue;
            }

            for (i, &frac) in fractions.iter().enumerate() {
                if let Some((df, kf, r2, n_used)) = fit_powerlaw(&n_seq, &rg_seq, 1.0, frac) {
                    acc[i].0.push(df);
                    acc[i].1.push(kf);
                    acc[i].2.push(r2);
                    acc[i].3.push(n_used);
                }
            }
        }

        let mean = |v: &[f64]| -> f64 {
            if v.is_empty() {
                f64::NAN
            } else {
                v.iter().sum::<f64>() / v.len() as f64
            }
        };
        let mean_u = |v: &[usize]| -> f64 {
            if v.is_empty() {
                0.0
            } else {
                v.iter().sum::<usize>() as f64 / v.len() as f64
            }
        };

        let cell = |a: &(Vec<f64>, Vec<f64>, Vec<f64>, Vec<usize>)| -> String {
            format!(
                "{:<10.4} {:<8.3} {:<8.3} {:<5.0}",
                mean(&a.0),
                mean(&a.1),
                mean(&a.2),
                mean_u(&a.3)
            )
        };

        println!(
            "{:<10.2} | {} | {} | {} | {}",
            df_target,
            cell(&acc[0]),
            cell(&acc[1]),
            cell(&acc[2]),
            cell(&acc[3])
        );
    }

    println!("\n=== Interpretation ===");
    println!("If TAIL 20–30% Df converges to Df_target → Hypothesis A confirmed.");
    println!("  → The bug is in the ESTIMATOR (full-sequence OLS contaminated by");
    println!("    early ballistic-like merges).");
    println!("If TAIL Df still diverges from target → the bug is in the AGGREGATION");
    println!("  algorithm itself (clusters genuinely have wrong Df).");
    println!("If kf drops below 1 with FULL fit but recovers with TAIL → confirms");
    println!("  the intercept gets dragged negative by early-merge bias.");
}
