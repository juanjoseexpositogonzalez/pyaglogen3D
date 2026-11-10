//! Phase 0 diagnostic for issue #275 — the scaling plot's N axis is fabricated.
//!
//! The engine records one Rg point per successful merge together with the real
//! largest-cluster particle count (`n_values`), and fits `ln N = ln kf + Df·ln(Rg/rp)`
//! over those points. `n_values` is not part of `SimulationResult`, and the
//! frontend therefore rebuilds it as `n_i = (i+1)·round(totalParticles/len)`.
//!
//! This diagnostic measures, on real runs, what that substitution does to the
//! number a reader gets from the drawn line:
//!
//! 1. TRUE  — unweighted OLS over the reconstructed exact counts (the engine's own
//!            estimator). Self-validated: it must reproduce `result.fractal_dimension`
//!            and `result.prefactor` bit-for-bit-ish (`recErr`).
//! 2. FAKE  — the same OLS over `n_i = (i+1)·step`, which is what `FractalPlot.tsx`
//!            and `page.tsx` compute in the browser.
//! 3. INV   — `1 / slope` of `ln(Rg) = a + b·ln(N)` over the TRUE counts, i.e. the
//!            estimator `metrics::calculate_fractal_dimension` uses for
//!            ballistic/ballistic_cc/cca/dla. Printed to show the two families the
//!            engine carries are not the same statistic.
//!
//! It also reports how irregular the recorded counts are (they jump by the size of
//! the cluster being merged), which is the mechanical reason FAKE cannot agree, and
//! a polydisperse configuration to measure whether the frontend's hardcoded
//! `PRIMARY_PARTICLE_RADIUS = 1.0` (the engine uses `params.mean_radius()`) moves the
//! slope or only the axis label.
//!
//! Run: `cd aglogen_core && PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1 \
//!       cargo run --release -p aglogen-engine --example scaling_axis_audit`

use aglogen_engine::simulation::result::SimulationResult;
use aglogen_engine::simulation::tunable_cc::{run_tunable_cc_internal, SeedType, TunableCcParams};

/// Unweighted log-space OLS of `y` on `x`, returning `(slope, intercept, r2, points)`.
fn ols(x: &[f64], y: &[f64]) -> Option<(f64, f64, f64, usize)> {
    if x.len() != y.len() || x.len() < 3 {
        return None;
    }
    let n = x.len() as f64;
    let sx: f64 = x.iter().sum();
    let sy: f64 = y.iter().sum();
    let sxx: f64 = x.iter().map(|v| v * v).sum();
    let sxy: f64 = x.iter().zip(y).map(|(a, b)| a * b).sum();
    let denom = n * sxx - sx * sx;
    if denom.abs() < 1e-12 {
        return None;
    }
    let slope = (n * sxy - sx * sy) / denom;
    let intercept = (sy - slope * sx) / n;
    let mean_y = sy / n;
    let ss_tot: f64 = y.iter().map(|v| (v - mean_y).powi(2)).sum();
    let ss_res: f64 = x
        .iter()
        .zip(y)
        .map(|(a, b)| (b - (intercept + slope * a)).powi(2))
        .sum();
    let r2 = if ss_tot > 0.0 {
        1.0 - ss_res / ss_tot
    } else {
        0.0
    };
    Some((slope, intercept, r2, x.len()))
}

/// Reconstruct the exact (Rg, N) points the engine estimator consumed.
///
/// Same technique as `rg_fit_variants_audit`: one `rg_evolution[i]` per successful
/// merge, and the largest-cluster size after merge `i` is `max(n_{i-1}, n1 + n2)`.
/// `no_feasible_pair` entries carry no merge and are skipped. Returns `None` when
/// the trace and the evolution disagree, which would invalidate the comparison.
fn reconstruct_points(result: &SimulationResult) -> Option<Vec<(f64, usize)>> {
    let merges: Vec<_> = result
        .merge_trace
        .iter()
        .filter(|e| e.merge_type != "no_feasible_pair")
        .collect();
    if merges.len() != result.rg_evolution.len() {
        return None;
    }
    let mut n_prev = 1usize;
    let mut pts = Vec::with_capacity(merges.len());
    for (i, e) in merges.iter().enumerate() {
        let n_i = n_prev.max(e.n1 + e.n2);
        pts.push((result.rg_evolution[i], n_i));
        n_prev = n_i;
    }
    Some(pts)
}

/// What one run says about the three axes.
struct Row {
    engine_df: f64,
    engine_kf: f64,
    rec_err: f64,
    true_df: f64,
    true_r2: f64,
    fake_df: f64,
    fake_r2: f64,
    inv_df: f64,
    points: usize,
    distinct_counts: usize,
    max_jump: usize,
}

fn audit(params: TunableCcParams, seed: u64, rp: f64) -> Option<Row> {
    let result = run_tunable_cc_internal(params, seed, None);
    if result.coordinates.is_empty() {
        return None;
    }
    let pts = reconstruct_points(&result)?;

    // The engine's own filter, mirrored from tunable_cc.rs.
    let filtered: Vec<(f64, usize)> = pts
        .into_iter()
        .filter(|&(rg, n)| n > 1 && rg > rp * 0.1)
        .collect();
    if filtered.len() < 3 {
        return None;
    }

    let x_true: Vec<f64> = filtered.iter().map(|&(rg, _)| (rg / rp).ln()).collect();
    let ns: Vec<usize> = filtered.iter().map(|&(_, n)| n).collect();
    let y_n: Vec<f64> = ns.iter().map(|&v| (v as f64).ln()).collect();

    let (true_df, _, true_r2, points) = ols(&x_true, &y_n)?;

    // The engine's reported Df comes from this same fit over these same points, so
    // |TRUE - engine| is the self-validation of the reconstruction: if it is not ~0,
    // the reconstruction is not what the engine consumed and nothing below is valid.
    let rec_err = (true_df - result.fractal_dimension).abs();

    // FAKE: exactly what the browser builds. `step` from the total particle count,
    // which the frontend takes from the simulation's parameters.
    let total = *ns.iter().max().unwrap_or(&ns.len()) as f64;
    let len = ns.len() as f64;
    let step = (total / len).round().max(1.0);
    let x_fake: Vec<f64> = x_true.clone();
    let y_fake: Vec<f64> = (0..ns.len())
        .map(|i| ((i as f64 + 1.0) * step).ln())
        .collect();
    let (fake_df, _, fake_r2, _) = ols(&x_fake, &y_fake)?;

    // The other estimator family in this engine: Df = 1/slope of ln(Rg) on ln(N).
    let inv_df = {
        let (b, _, _, _) = ols(&y_n, &x_true)?;
        if b.abs() > 0.01 {
            1.0 / b
        } else {
            f64::NAN
        }
    };

    let mut distinct: Vec<usize> = ns.clone();
    distinct.sort_unstable();
    distinct.dedup();
    let max_jump = ns
        .windows(2)
        .map(|w| w[1].saturating_sub(w[0]))
        .max()
        .unwrap_or(0);

    Some(Row {
        engine_df: result.fractal_dimension,
        engine_kf: result.prefactor,
        rec_err,
        true_df,
        true_r2,
        fake_df,
        fake_r2,
        inv_df,
        points,
        distinct_counts: distinct.len(),
        max_jump,
    })
}

fn main() {
    println!("Phase 0 diagnostic: scaling axis audit (issue #275)");
    println!("===================================================");
    println!("Question: the detail screen shows the record's Df in its header and draws a");
    println!("regression line over a rebuilt N axis. How far apart are they, and which one");
    println!("is the engine's?\n");
    println!("TRUE = exact counts reconstructed from merge_trace (engine estimator)");
    println!("FAKE = n_i = (i+1)*round(N/len), what FractalPlot.tsx and page.tsx compute");
    println!("INV  = 1/slope of ln(Rg)~ln(N), the metrics.rs family (cca/dla/ballistic)");
    println!("recErr = |TRUE - result.fractal_dimension| (self-validation, must be ~0)\n");

    let mut worst_fake = 0.0_f64;
    let mut worst_fake_cfg = String::new();
    let mut max_rec_err = 0.0_f64;

    for &df_target in &[2.5_f64, 2.7, 2.9] {
        for &n_particles in &[100usize, 500] {
            println!("--- Df_target = {:.1}, N = {} ---", df_target, n_particles);
            println!(
                "{:>4} | {:>7} | {:>7} | {:>7} | {:>7} | {:>6} | {:>7} | {:>4} {:>4} {:>5}",
                "seed", "engine", "TRUE", "FAKE", "INV", "recErr", "FAKE-TR", "pts", "dst", "jump"
            );
            for &seed in &[1u64, 2, 3] {
                let params = TunableCcParams {
                    n_particles,
                    target_df: df_target,
                    target_kf: 1.3,
                    radius_min: 1.0,
                    radius_max: 1.0,
                    seed_type: SeedType::Dimers,
                    ..Default::default()
                };
                match audit(params, seed, 1.0) {
                    Some(row) => {
                        max_rec_err = max_rec_err.max(row.rec_err);
                        let delta = row.fake_df - row.true_df;
                        if delta.abs() > worst_fake.abs() {
                            worst_fake = delta;
                            worst_fake_cfg =
                                format!("Df {:.1} / N {} / seed {}", df_target, n_particles, seed);
                        }
                        println!(
                            "{:>4} | {:>7.3} | {:>7.3} | {:>7.3} | {:>7.3} | {:>6.1e} | {:>+7.3} | {:>4} {:>4} {:>5}",
                            seed,
                            row.engine_df,
                            row.true_df,
                            row.fake_df,
                            row.inv_df,
                            row.rec_err,
                            delta,
                            row.points,
                            row.distinct_counts,
                            row.max_jump
                        );
                    }
                    None => println!("{:>4} | could not audit this run", seed),
                }
            }
            println!();
        }
    }

    println!("=== Polydisperse check: does the hardcoded rp = 1.0 move the slope? ===");
    println!("(engine normalises by params.mean_radius(); the frontend divides by 1.0)");
    for &(rmin, rmax) in &[(1.0_f64, 1.0_f64), (1.0, 2.0), (1.0, 3.0)] {
        let params = TunableCcParams {
            n_particles: 100,
            target_df: 2.7,
            target_kf: 1.3,
            radius_min: rmin,
            radius_max: rmax,
            seed_type: SeedType::Dimers,
            ..Default::default()
        };
        let mean_rp = (rmin + rmax) / 2.0;
        let a = audit(params.clone(), 1, mean_rp);
        let b = audit(params, 1, 1.0);
        match (a, b) {
            (Some(a), Some(b)) => println!(
                "r in [{:.1}, {:.1}]  mean rp {:.2} | TRUE with mean_rp {:.3}, with rp=1.0 {:.3} -> slope delta {:+.4} | kf {:.3} vs {:.3}",
                rmin, rmax, mean_rp, a.true_df, b.true_df, b.true_df - a.true_df, a.engine_kf, b.engine_kf
            ),
            _ => println!("r in [{:.1}, {:.1}]  could not audit", rmin, rmax),
        }
    }

    println!();
    println!("=== The form's own defaults (CC-tunable, monomers, rp=1.0, kf=1.3) ===");
    println!("This is what a study created from the UI runs, seeds aside: if the reader's");
    println!("2.469 / 2.769 pair is inside this spread, the axis is the whole story.");
    println!(
        "{:>6} | {:>7} | {:>7} | {:>7} | {:>+7} | {:>4} {:>4}",
        "seed", "engine", "FAKE", "gap", "delta", "pts", "dst"
    );
    let mut gaps = Vec::new();
    for seed in 1u64..=10 {
        let params = TunableCcParams {
            n_particles: 100,
            target_df: 2.7,
            target_kf: 1.3,
            radius_min: 1.0,
            radius_max: 1.0,
            seed_type: SeedType::Monomers,
            ..Default::default()
        };
        if let Some(row) = audit(params, seed, 1.0) {
            gaps.push(row.fake_df - row.true_df);
            println!(
                "{:>6} | {:>7.3} | {:>7.3} | {:>7.3} | {:>+7.3} | {:>4} {:>4}",
                seed,
                row.engine_df,
                row.true_df,
                row.fake_df,
                row.fake_df - row.true_df,
                row.points,
                row.distinct_counts
            );
        }
    }
    if !gaps.is_empty() {
        let lo = gaps.iter().cloned().fold(f64::INFINITY, f64::min);
        let hi = gaps.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        println!("gap over {} runs: {:+.3} .. {:+.3}", gaps.len(), lo, hi);
    }

    println!();
    println!("=== Verdict inputs ===");
    println!(
        "max |TRUE - engine| : {:.2e}  (reconstruction validated if ~0)",
        max_rec_err
    );
    println!(
        "worst |FAKE - TRUE| : {:+.3} at {}",
        worst_fake, worst_fake_cfg
    );
}
