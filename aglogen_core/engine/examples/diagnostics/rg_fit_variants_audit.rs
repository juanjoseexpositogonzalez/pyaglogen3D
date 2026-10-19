//! Phase 0 diagnostic for SDD change `cc-tunable-rg-fit-fix` (Cycle 3 sub-cycle 1, PYA-17).
//!
//! Compares three Rg-evolution fit variants for the CC-tunable Df/kf estimator
//! (`calculate_fractal_dimension_from_evolution`, tunable_cc.rs), on the R27.4
//! high-Df configs where the current unweighted OLS undershoots the prefactor
//! (Cycle 2 documented deviation: mean kf = 0.929 at Df_target = 2.9 / N = 100):
//!
//! 1. UNW  — current unweighted log-space OLS over all points (baseline; must
//!           reproduce the engine's `fractal_dimension`/`prefactor` exactly,
//!           which validates the point reconstruction below).
//! 2. WGT  — design D1 candidate: N-weighted OLS with `w_i = N_i / ΣN`
//!           (weighted means, `slope = S_xy / S_xx`).
//! 3. TAIL — design D1 fallback candidate: unweighted OLS restricted to points
//!           with `N ≥ N_max / 2` (falls back to all points if < 3 qualify).
//!
//! Also verifies design D5 (no-clamp): no prefactor may touch the clamp
//! boundary (100.0) — nor Df ∈ [0.5, 3.5] / kf ∈ [0.01, 100] boundaries —
//! under any variant at Df ∈ {2.5, 2.7, 2.9} × N ∈ {100, 500}.
//!
//! Point reconstruction (read-only, additive-free): the engine pushes one
//! `rg_evolution[i]` (largest-cluster Rg) per successful merge, but `n_values`
//! is not publicly exposed. The largest-cluster size after merge `i` is
//! `max(n_{i-1}, n1 + n2)` of that merge (the merged cluster wins `max_by_key`
//! ties because it is pushed last; if it is smaller than the incumbent largest,
//! the incumbent's size and Rg are unchanged and re-pushed). `no_feasible_pair`
//! trace entries carry no merge and are skipped; the surviving entry count must
//! equal `rg_evolution.len()`. The reconstruction is self-validated by
//! re-fitting variant 1 and comparing to the engine estimator output.
//!
//! Evidence feeds design decision D1 (formula lock) — see design.md `## Log`.
//!
//! Run: `cd aglogen_core && PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1 \
//!       cargo run --release -p aglogen-engine --example rg_fit_variants_audit`

use aglogen_engine::simulation::tunable_cc::{run_tunable_cc_internal, SeedType, TunableCcParams};

/// One fit variant's outcome for a single run.
#[derive(Clone, Copy)]
struct Fit {
    df: f64,
    kf: f64,
    r2: f64,
    n_points: usize,
    /// True when the tail variant had < 3 qualifying points and fell back to all.
    fallback: bool,
}

/// Clamp-boundary label per design D5, or None when strictly inside.
fn clamp_boundary(df: f64, kf: f64) -> Option<&'static str> {
    if df <= 0.5 {
        Some("Df<=0.5")
    } else if df >= 3.5 {
        Some("Df>=3.5")
    } else if kf <= 0.01 {
        Some("kf<=0.01")
    } else if kf >= 100.0 {
        Some("kf>=100.0")
    } else {
        None
    }
}

/// Unweighted log-space OLS — mirrors the engine estimator exactly.
fn unweighted_fit(x: &[f64], y: &[f64]) -> Option<Fit> {
    let n = x.len();
    if n < 3 {
        return None;
    }
    let nf = n as f64;
    let sx: f64 = x.iter().sum();
    let sy: f64 = y.iter().sum();
    let sxx: f64 = x.iter().map(|v| v * v).sum();
    let sxy: f64 = x.iter().zip(y).map(|(a, b)| a * b).sum();
    let denom = nf * sxx - sx * sx;
    if denom.abs() < 1e-10 {
        return None;
    }
    let slope = (nf * sxy - sx * sy) / denom;
    let intercept = (sy - slope * sx) / nf;
    let mean_y = sy / nf;
    let ss_tot: f64 = y.iter().map(|v| (v - mean_y).powi(2)).sum();
    let ss_res: f64 = x
        .iter()
        .zip(y)
        .map(|(a, b)| (b - (intercept + slope * a)).powi(2))
        .sum();
    let r2 = if ss_tot > 0.0 { 1.0 - ss_res / ss_tot } else { 0.0 };
    Some(Fit {
        df: slope.max(0.5).min(3.5),
        kf: intercept.exp().max(0.01).min(100.0),
        r2,
        n_points: n,
        fallback: false,
    })
}

/// Design D1 candidate: N-weighted OLS with `w_i = N_i / ΣN` (weighted means).
fn weighted_fit(x: &[f64], ns: &[usize]) -> Option<Fit> {
    let n = x.len();
    if n < 3 {
        return None;
    }
    let sum_n: usize = ns.iter().sum();
    if sum_n == 0 {
        return None;
    }
    let w: Vec<f64> = ns.iter().map(|&v| v as f64 / sum_n as f64).collect();
    let x_bar: f64 = x.iter().zip(&w).map(|(a, wi)| a * wi).sum(); // Σw = 1
    let y: Vec<f64> = ns.iter().map(|&v| (v as f64).ln()).collect();
    let y_bar: f64 = y.iter().zip(&w).map(|(a, wi)| a * wi).sum();
    let s_xy: f64 = x
        .iter()
        .zip(&y)
        .zip(&w)
        .map(|((a, b), wi)| wi * (a - x_bar) * (b - y_bar))
        .sum();
    let s_xx: f64 = x.iter().zip(&w).map(|(a, wi)| wi * (a - x_bar).powi(2)).sum();
    if s_xx.abs() < 1e-10 {
        return None;
    }
    let slope = s_xy / s_xx;
    let intercept = y_bar - slope * x_bar;
    // Weighted R² (same weighting as the fit itself).
    let ss_tot: f64 = y
        .iter()
        .zip(&w)
        .map(|(b, wi)| wi * (b - y_bar).powi(2))
        .sum();
    let ss_res: f64 = x
        .iter()
        .zip(&y)
        .zip(&w)
        .map(|((a, b), wi)| wi * (b - (intercept + slope * a)).powi(2))
        .sum();
    let r2 = if ss_tot > 0.0 { 1.0 - ss_res / ss_tot } else { 0.0 };
    Some(Fit {
        df: slope.max(0.5).min(3.5),
        kf: intercept.exp().max(0.01).min(100.0),
        r2,
        n_points: n,
        fallback: false,
    })
}

/// Design D1 fallback candidate: unweighted OLS on points with `N ≥ N_max / 2`.
fn tail_fit(x: &[f64], ns: &[usize]) -> Option<Fit> {
    let n_max = ns.iter().copied().max()?;
    let threshold = n_max as f64 / 2.0;
    let idx: Vec<usize> = (0..x.len()).filter(|&i| ns[i] as f64 >= threshold).collect();
    if idx.len() < 3 {
        // D1 fallback: not enough tail points — use all points.
        let ys: Vec<f64> = y_of(ns);
        return unweighted_fit(x, &ys).map(|mut f| {
            f.fallback = true;
            f
        });
    }
    let xs: Vec<f64> = idx.iter().map(|&i| x[i]).collect();
    let ys: Vec<f64> = idx.iter().map(|&i| (ns[i] as f64).ln()).collect();
    unweighted_fit(&xs, &ys).map(|mut f| {
        f.n_points = idx.len();
        f
    })
}

/// Placeholder helper so the fallback arm above reads cleanly; returns ln(N).
fn y_of(ns: &[usize]) -> Vec<f64> {
    ns.iter().map(|&v| (v as f64).ln()).collect()
}

/// Reconstruct the exact (Rg, N) evolution points the engine estimator consumed.
/// Returns None if the trace/evolution alignment check fails.
fn reconstruct_points(result: &aglogen_engine::simulation::result::SimulationResult) -> Option<Vec<(f64, usize)>> {
    let merges: Vec<_> = result
        .merge_trace
        .iter()
        .filter(|e| e.merge_type != "no_feasible_pair")
        .collect();
    if merges.len() != result.rg_evolution.len() {
        return None;
    }
    let mut n_prev = 1usize; // pre-merge largest (dimers: first merge 2+2=4 > 2, so exact)
    let mut pts = Vec::with_capacity(merges.len());
    for (i, e) in merges.iter().enumerate() {
        let n_i = n_prev.max(e.n1 + e.n2);
        pts.push((result.rg_evolution[i], n_i));
        n_prev = n_i;
    }
    Some(pts)
}

fn main() {
    let t_start = std::time::Instant::now();
    println!("Phase 0 diagnostic: Rg-evolution fit variants audit (cc-tunable-rg-fit-fix T1/T2)");
    println!("==================================================================================");
    println!("Configs: Df_target in {{2.5, 2.7, 2.9}} x N in {{100, 500}} x seeds {{1,2,3}},");
    println!("         target_kf=1.3, monodisperse rp=1.0, seed_type=Dimers (R27.4 setup).");
    println!("Variants: UNW = current unweighted OLS; WGT = N-weighted OLS (w=N/ΣN, design D1);");
    println!("          TAIL = unweighted on N >= N_max/2 (design D1 fallback).");
    println!("R² metric: unweighted for UNW/TAIL, weighted (Σw residuals) for WGT.");
    println!("D5 check: no fitted Df/kf may sit on clamp boundaries [0.5,3.5] / [0.01,100].\n");

    let df_targets = [2.5_f64, 2.7, 2.9];
    let n_sizes = [100usize, 500];
    let seeds = [1u64, 2, 3];
    let rp = 1.0_f64;

    // Aggregates per config: (unw, wgt, tail) vectors of Fits + clamp hit counts.
    struct ConfigAcc {
        fits: [Vec<Fit>; 3],
        clamp_hits: [usize; 3],
        max_rec_err: f64,
    }
    let mut all_acc: Vec<((f64, usize), ConfigAcc)> = Vec::new();

    for &df_target in &df_targets {
        for &n_particles in &n_sizes {
            let mut acc = ConfigAcc {
                fits: [Vec::new(), Vec::new(), Vec::new()],
                clamp_hits: [0; 3],
                max_rec_err: 0.0,
            };

            println!("--- Df_target = {:.1}, N = {} ---", df_target, n_particles);
            println!(
                "{:>4} | {:>9} | {:>22} | {:>22} | {:>22} | {:>9}",
                "seed", "engine kf", "UNW (Df kf R² pts)", "WGT (Df kf R² pts)", "TAIL (Df kf R² pts)", "recErr"
            );

            for &seed in &seeds {
                let params = TunableCcParams {
                    n_particles,
                    target_df: df_target,
                    target_kf: 1.3,
                    radius_min: 1.0,
                    radius_max: 1.0,
                    seed_type: SeedType::Dimers,
                    ..Default::default()
                };
                let result = run_tunable_cc_internal(params, seed, None);
                if result.coordinates.is_empty() {
                    eprintln!("WARNING: seed {} produced empty result, skipping", seed);
                    continue;
                }

                let pts = match reconstruct_points(&result) {
                    Some(p) => p,
                    None => {
                        eprintln!(
                            "WARNING: seed {} trace/rg_evolution misaligned ({} vs {}), skipping",
                            seed,
                            result.merge_trace.len(),
                            result.rg_evolution.len()
                        );
                        continue;
                    }
                };

                // Mirror the engine estimator's point filter (n > 1 && rg > rp*0.1).
                let filtered: Vec<(f64, usize)> = pts
                    .into_iter()
                    .filter(|&(_, n)| n > 1)
                    .filter(|&(rg, _)| rg > rp * 0.1)
                    .collect();
                let x: Vec<f64> = filtered.iter().map(|&(rg, _)| (rg / rp).ln()).collect();
                let ns: Vec<usize> = filtered.iter().map(|&(_, n)| n).collect();
                let y: Vec<f64> = ns.iter().map(|&v| (v as f64).ln()).collect();

                let fits = [
                    unweighted_fit(&x, &y),
                    weighted_fit(&x, &ns),
                    tail_fit(&x, &ns),
                ];

                // Self-validation: UNW must reproduce the engine estimator output.
                let rec_err = match fits[0] {
                    Some(f) => {
                        let e = (f.df - result.fractal_dimension)
                            .abs()
                            .max((f.kf - result.prefactor).abs());
                        acc.max_rec_err = acc.max_rec_err.max(e);
                        e
                    }
                    None => f64::NAN,
                };

                let cell = |f: &Option<Fit>| match f {
                    Some(f) => format!(
                        "{:>6.3} {:>7.3} {:>5.3} {:>3}{}",
                        f.df,
                        f.kf,
                        f.r2,
                        f.n_points,
                        if f.fallback { " FB" } else { "" }
                    ),
                    None => "n/a".to_string(),
                };
                println!(
                    "{:>4} | {:>9.3} | {} | {} | {} | {:>9.2e}",
                    seed,
                    result.prefactor,
                    cell(&fits[0]),
                    cell(&fits[1]),
                    cell(&fits[2]),
                    rec_err
                );

                for (k, f) in fits.iter().enumerate() {
                    if let Some(f) = f {
                        acc.fits[k].push(*f);
                        if clamp_boundary(f.df, f.kf).is_some() {
                            acc.clamp_hits[k] += 1;
                        }
                    }
                }
            }
            all_acc.push(((df_target, n_particles), acc));
            println!();
        }
    }

    // ── Means table ──
    println!("=== Per-config means (over seeds) ===");
    println!(
        "{:<12} | {:<4} | {:>7} {:>7} {:>7} {:>7} {:>7} {:>5} | {}",
        "config", "var", "meanDf", "meanKf", "minKf", "maxKf", "meanR²", "pts", "clampHits D5"
    );
    println!("{}", "-".repeat(96));
    let variant_names = ["UNW", "WGT", "TAIL"];
    for ((df_target, n), acc) in &all_acc {
        for (k, fits) in acc.fits.iter().enumerate() {
            if fits.is_empty() {
                continue;
            }
            let m = |f: fn(&Fit) -> f64| fits.iter().map(f).sum::<f64>() / fits.len() as f64;
            let mean_pts = fits.iter().map(|f| f.n_points).sum::<usize>() / fits.len();
            println!(
                "{:<12} | {:<4} | {:>7.3} {:>7.3} {:>7.3} {:>7.3} {:>7.3} {:>5} | {}",
                format!("{:.1}/{}", df_target, n),
                variant_names[k],
                m(|f| f.df),
                m(|f| f.kf),
                fits.iter().map(|f| f.kf).fold(f64::INFINITY, f64::min),
                fits.iter().map(|f| f.kf).fold(f64::NEG_INFINITY, f64::max),
                m(|f| f.r2),
                mean_pts,
                acc.clamp_hits[k]
            );
        }
        if acc.max_rec_err > 1e-9 {
            println!(
                "  WARNING: reconstruction mismatch vs engine estimator at {:.1}/{}: max err {:.3e}",
                df_target, n, acc.max_rec_err
            );
        }
    }

    // ── D5 verdict ──
    let total_clamp: usize = all_acc.iter().map(|(_, a)| a.clamp_hits.iter().sum::<usize>()).sum();
    println!("\n=== D5 no-clamp check ===");
    println!(
        "Clamp-boundary hits across all runs/variants: {} (Df boundaries: 0 expected; kf boundary 100.0 must be 0)",
        total_clamp
    );

    // ── T2 verdict inputs: focus on the failing config Df=2.9 / N=100 ──
    println!("\n=== T2 verdict inputs (design D1): mean kf at Df_target = 2.9, N = 100 ===");
    println!("Baseline (Cycle 2, unweighted): mean kf = 0.929 < 1.0 (documented D3 deviation).");
    for ((df_target, n), acc) in &all_acc {
        if *df_target == 2.9 && *n == 100 {
            for (k, fits) in acc.fits.iter().enumerate() {
                if fits.is_empty() {
                    continue;
                }
                let mean_kf = fits.iter().map(|f| f.kf).sum::<f64>() / fits.len() as f64;
                let ge_1 = fits.iter().filter(|f| f.kf >= 1.0).count();
                println!(
                    "  {:<4}: mean kf = {:.3}  (seeds with kf >= 1.0: {}/{}){}",
                    variant_names[k],
                    mean_kf,
                    ge_1,
                    fits.len(),
                    if mean_kf >= 1.0 { "  -> PASSES kf >= 1.0" } else { "  -> FAILS kf >= 1.0" }
                );
            }
        }
    }

    println!("\nTotal runtime: {:.1} s", t_start.elapsed().as_secs_f64());
}
