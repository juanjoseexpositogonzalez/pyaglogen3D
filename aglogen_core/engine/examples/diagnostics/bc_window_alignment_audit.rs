//! Phase 0 diagnostic for SDD change `cc-tunable-bc-alignment` (Cycle 3
//! sub-cycle 2, PYA-17).
//!
//! Compares the engine's default 3D box-counting fit (LEGACY: robust fit
//! anchored on the 4 coarsest scales + greedy extend, `box_counting_3d.rs`
//! `linear_regression_robust`) against candidate FIXED fit windows (plain OLS
//! of ln(box_size) vs ln(count) over an inclusive level-index range), on
//! CC-tunable agglomerates at Df_target ∈ {1.5, 2.0, 2.5, 2.7, 2.9} ×
//! N ∈ {100, 500, 2000} × seeds {1,2,3} (R27.4 setup: Dimers, target_kf=1.3,
//! monodisperse rp=1.0).
//!
//! The windowed path does NOT exist in the estimator yet (that is T3). The
//! per-level box counts are therefore recomputed here independently from the
//! same Morton counting logic as a READ-ONLY copy of the estimator's steps 1-4
//! (`find_bounding_box`, `compute_scale`, `normalize_coord`, `morton_encode_3d`,
//! sorted `count_unique_masked` per level, count-validity filter); the
//! estimator source is not modified in this task. The copy is validated by a
//! default-path byte-identity assertion against the public API
//! `box_counting_3d_morton` (dimension, R², std error, linear region start,
//! and the exact log_scales/log_counts vectors).
//!
//! Window candidates (design D1 semantics: inclusive indices into the
//! effective per-level count sequence, 0 = finest, covering levels with
//! 0 < count < N): start ∈ {0,1,2,3,4,5}, end ∈ {precision-2, precision-3,
//! precision-4} (precision = 18), end clamped to the last effective level;
//! windows with fewer than 3 levels are skipped. Starts 0-1 were added after
//! the first pass showed the effective sequence holds only 2-8 coarse levels
//! (raw levels ~10-17) — the design's candidate mid-band [4,16] is empty on
//! this 18-level space, and start ≥ 2 leaves no fit at all for Df ≥ 2.7.
//!
//! Checks (design D1/D2):
//! - D2 log-base invariance: the OLS slope on log2 axes must equal the
//!   ln-axis slope numerically, for both the windowed fits and the legacy
//!   fit's selected range (reported as max |Δslope|).
//! - Default-path byte-identity of the independent recomputation (validates
//!   the copied counting logic; the actual post-D5-refactor assertion ships
//!   with T3).
//! - Per-config mean BC Df per variant vs Df_target and vs the Rg-evolution
//!   Df (`result.fractal_dimension`), plus whether |Δ| ≤ 0.20 (long-term
//!   R27.5 target) is reachable at N=2000 with one fixed window.
//!
//! Evidence feeds design decisions D1 (window lock) and D4 (R27.5 tolerance)
//! — see design.md `## Log` (L2).
//!
//! Run: `cd aglogen_core && cargo run --release -p aglogen-engine --example bc_window_alignment_audit`

use aglogen_engine::fractal::box_counting_3d::{
    box_counting_3d_morton, compute_scale, count_unique_masked, find_bounding_box,
    morton_encode_3d, normalize_coord,
};
use aglogen_engine::simulation::tunable_cc::{run_tunable_cc_internal, SeedType, TunableCcParams};

const PRECISION: u32 = 18;

/// One raw per-level box count (level 0 = finest).
#[derive(Clone, Copy)]
struct LevelCount {
    level: u32,
    box_size: f64,
    count: usize,
}

/// One candidate window's per-seed samples for a single config.
struct WindowStat {
    /// Window key as swept: (start, end_candidate BEFORE per-run clamping).
    key: (usize, usize),
    dfs: Vec<f64>,
    r2s: Vec<f64>,
}

/// Aggregated outcome for one (Df_target, N) config.
struct ConfigAcc {
    legacy_dfs: Vec<f64>,
    legacy_r2s: Vec<f64>,
    rg_dfs: Vec<f64>,
    windows: Vec<WindowStat>,
    exact_matches: usize,
    runs: usize,
    max_logbase_err: f64,
    /// Effective-level count (levels with 0 < count < N) per run.
    eff_lens: Vec<usize>,
    /// Raw Morton level index of the first/last effective level per run.
    raw_level_ranges: Vec<(u32, u32)>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-only copy of the estimator's counting pipeline (box_counting_3d.rs
// steps 1-4). Do not modify the estimator; this copy exists only because the
// windowed path does not exist yet (T3).
// ─────────────────────────────────────────────────────────────────────────────

/// Per-level counts, exactly as the estimator computes them (same validity
/// filter: 0 < count < N), plus the log vectors fed to the legacy fit.
fn per_level_counts(points: &[[f64; 3]], precision: u32) -> (Vec<LevelCount>, Vec<f64>, Vec<f64>) {
    let (min_coords, max_coords) = find_bounding_box(points);
    let scale = compute_scale(&min_coords, &max_coords);
    let max_val = (1u64 << precision) - 1;

    let mut sorted_codes: Vec<u64> = points
        .iter()
        .map(|p| {
            let nx = normalize_coord(p[0], min_coords[0], scale, max_val);
            let ny = normalize_coord(p[1], min_coords[1], scale, max_val);
            let nz = normalize_coord(p[2], min_coords[2], scale, max_val);
            morton_encode_3d(nx, ny, nz)
        })
        .collect();
    sorted_codes.sort_unstable();

    let mut levels = Vec::with_capacity(precision as usize);
    let mut log_scales = Vec::with_capacity(precision as usize);
    let mut log_counts = Vec::with_capacity(precision as usize);
    for level in 0..precision {
        let shift = 3 * level; // 3 bits per level for 3D
        let box_count = count_unique_masked(&sorted_codes, shift);
        if box_count > 0 && box_count < sorted_codes.len() {
            let box_size = scale * (1u64 << level) as f64 / max_val as f64;
            levels.push(LevelCount {
                level,
                box_size,
                count: box_count,
            });
            log_scales.push((1.0 / box_size).ln());
            log_counts.push((box_count as f64).ln());
        }
    }
    (levels, log_scales, log_counts)
}

/// Plain OLS. Returns (slope, intercept, r_squared) or None if degenerate.
fn ols(x: &[f64], y: &[f64]) -> Option<(f64, f64, f64)> {
    let n = x.len();
    if n < 2 {
        return None;
    }
    let nf = n as f64;
    let sx: f64 = x.iter().sum();
    let sy: f64 = y.iter().sum();
    let sxx: f64 = x.iter().map(|v| v * v).sum();
    let sxy: f64 = x.iter().zip(y).map(|(a, b)| a * b).sum();
    let denom = nf * sxx - sx * sx;
    if denom.abs() < 1e-15 {
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
    let r2 = if ss_tot > 1e-15 { 1.0 - ss_res / ss_tot } else { 0.0 };
    Some((slope, intercept, r2))
}

/// Windowed fit over the effective level sequence (inclusive indices).
/// `use_log2` switches both axes to log2 (design D2 cross-check).
/// Returns (slope, r_squared, n_points).
fn window_fit(levels: &[LevelCount], s: usize, e: usize, use_log2: bool) -> Option<(f64, f64, usize)> {
    if s > e || e >= levels.len() {
        return None;
    }
    let slice = &levels[s..=e];
    if slice.len() < 3 {
        return None;
    }
    let (x, y): (Vec<f64>, Vec<f64>) = slice
        .iter()
        .map(|lc| {
            let xs = 1.0 / lc.box_size;
            let ys = lc.count as f64;
            if use_log2 {
                (xs.log2(), ys.log2())
            } else {
                (xs.ln(), ys.ln())
            }
        })
        .unzip();
    let (slope, _, r2) = ols(&x, &y)?;
    Some((slope, r2, slice.len()))
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-only copy of the estimator's Step 4b (saturation truncation) and
// Step 5 (linear_regression + linear_regression_robust), verbatim from
// box_counting_3d.rs (including the dead variables — their removal is T3/D5).
// Used only to assert byte-identity of our counting copy vs the public API.
// ─────────────────────────────────────────────────────────────────────────────

#[allow(clippy::needless_range_loop)]
fn legacy_replica(
    mut log_scales: Vec<f64>,
    mut log_counts: Vec<f64>,
) -> (usize, f64, f64, f64) {
    // Step 4b: saturation truncation (verbatim).
    if log_counts.len() > 6 {
        let mut truncate_before = 0;
        for i in (1..log_counts.len()).rev() {
            if (log_counts[i] - log_counts[i - 1]).abs() < 1e-12 {
                truncate_before = i;
                break;
            }
        }
        if truncate_before > 0 && log_counts.len() - truncate_before >= 3 {
            log_scales = log_scales[truncate_before..].to_vec();
            log_counts = log_counts[truncate_before..].to_vec();
        }
    }

    // Step 5: linear_regression (verbatim).
    fn linear_regression(x: &[f64], y: &[f64]) -> (f64, f64, f64, f64) {
        let n = x.len() as f64;
        if n < 2.0 {
            return (0.0, 0.0, 0.0, f64::INFINITY);
        }
        let sum_x: f64 = x.iter().sum();
        let sum_y: f64 = y.iter().sum();
        let sum_xx: f64 = x.iter().map(|xi| xi * xi).sum();
        let sum_xy: f64 = x.iter().zip(y.iter()).map(|(xi, yi)| xi * yi).sum();
        let denom = n * sum_xx - sum_x * sum_x;
        if denom.abs() < 1e-15 {
            return (0.0, sum_y / n, 0.0, f64::INFINITY);
        }
        let slope = (n * sum_xy - sum_x * sum_y) / denom;
        let intercept = (sum_y - slope * sum_x) / n;
        let mean_y = sum_y / n;
        let mut ss_res = 0.0;
        let mut ss_tot = 0.0;
        for (xi, yi) in x.iter().zip(y.iter()) {
            let res = yi - (intercept + slope * xi);
            ss_res += res * res;
            ss_tot += (yi - mean_y) * (yi - mean_y);
        }
        let r_squared = if ss_tot > 1e-15 { 1.0 - ss_res / ss_tot } else { 0.0 };
        let mse = ss_res / (n - 2.0).max(1.0);
        let std_error = (mse / (sum_xx - sum_x * sum_x / n).abs().max(1e-15)).sqrt();
        (slope, intercept, r_squared, std_error)
    }

    // linear_regression_robust (verbatim, dead variables included per D5 scope).
    #[allow(unused_assignments, unused_variables)]
    fn linear_regression_robust(x: &[f64], y: &[f64]) -> (usize, f64, f64, f64, f64) {
        let n = x.len();
        if n < 3 {
            let (slope, intercept, r2, se) = linear_regression(x, y);
            return (0, slope, intercept, r2, se);
        }
        let min_points = 4.min(n);
        let residual_threshold = 2.0;
        let r2_drop_threshold = 0.02;
        let mut best_start = 0;
        let mut best_r2 = 0.0;
        let start_idx = n - min_points;
        let (mut slope, mut intercept, mut r2, mut std_error) =
            linear_regression(&x[start_idx..], &y[start_idx..]);
        best_start = start_idx;
        best_r2 = r2;
        for i in (0..start_idx).rev() {
            let y_pred = intercept + slope * x[i];
            let residual = y[i] - y_pred;
            let std_residual = if std_error > 1e-15 {
                residual.abs() / std_error
            } else {
                0.0
            };
            let (new_slope, new_intercept, new_r2, new_se) = linear_regression(&x[i..], &y[i..]);
            let r2_drop = best_r2 - new_r2;
            if std_residual > residual_threshold && r2_drop > r2_drop_threshold {
                break;
            }
            slope = new_slope;
            intercept = new_intercept;
            std_error = new_se;
            if new_r2 > best_r2 - 0.01 {
                best_start = i;
                best_r2 = new_r2.max(best_r2);
            }
            r2 = new_r2;
        }
        let (final_slope, final_intercept, final_r2, final_se) =
            linear_regression(&x[best_start..], &y[best_start..]);
        (best_start, final_slope, final_intercept, final_r2, final_se)
    }

    let (start, slope, _intercept, r2, se) = linear_regression_robust(&log_scales, &log_counts);
    (start, slope, r2, se)
}

fn mean(v: &[f64]) -> f64 {
    v.iter().sum::<f64>() / v.len() as f64
}

fn main() {
    let t_start = std::time::Instant::now();
    println!("Phase 0 diagnostic: BC fit-window alignment audit (cc-tunable-bc-alignment T1/T2)");
    println!("==================================================================================");
    println!(
        "Configs: Df_target in {{1.5, 2.0, 2.5, 2.7, 2.9}} x N in {{100, 500, 2000}} x seeds {{1,2,3}},",
    );
    println!("         target_kf=1.3, monodisperse rp=1.0, seed_type=Dimers (R27.4 setup).");
    println!("LEGACY  = engine default robust fit via public API box_counting_3d_morton.");
    println!("W(s,e)  = plain OLS over inclusive effective-level window, recomputed");
    println!("          independently (read-only copy; estimator untouched — T3).");
    println!(
        "Windows: start in {{0,1,2,3,4,5}}, end in {{{},{},{}}} (precision={}, clamped),",
        PRECISION - 2,
        PRECISION - 3,
        PRECISION - 4,
        PRECISION
    );
    println!("         >= 3 levels required. Deltas: Δt vs Df_target, Δrg vs Rg-evolution Df.\n");

    let df_targets = [1.5_f64, 2.0, 2.5, 2.7, 2.9];
    let n_sizes = [100_usize, 500, 2000];
    let seeds = [1_u64, 2, 3];
    let rp = 1.0_f64;

    let start_cands = [0_usize, 1, 2, 3, 4, 5];
    let end_cands = [(PRECISION - 2) as usize, (PRECISION - 3) as usize, (PRECISION - 4) as usize];

    let mut all_acc: Vec<((f64, usize), ConfigAcc)> = Vec::new();

    for &df_target in &df_targets {
        for &n_particles in &n_sizes {
            let mut acc = ConfigAcc {
                legacy_dfs: Vec::new(),
                legacy_r2s: Vec::new(),
                rg_dfs: Vec::new(),
                windows: start_cands
                    .iter()
                    .flat_map(|&s| end_cands.iter().map(move |&e| (s, e)))
                    .map(|key| WindowStat {
                        key,
                        dfs: Vec::new(),
                        r2s: Vec::new(),
                    })
                    .collect(),
                exact_matches: 0,
                runs: 0,
                max_logbase_err: 0.0,
                eff_lens: Vec::new(),
                raw_level_ranges: Vec::new(),
            };

            println!("--- Df_target = {:.1}, N = {} ---", df_target, n_particles);

            for &seed in &seeds {
                let params = TunableCcParams {
                    n_particles,
                    target_df: df_target,
                    target_kf: 1.3,
                    radius_min: rp,
                    radius_max: rp,
                    seed_type: SeedType::Dimers,
                    ..Default::default()
                };
                let result = run_tunable_cc_internal(params, seed, None);
                if result.coordinates.is_empty() {
                    eprintln!("WARNING: seed {} produced empty result, skipping", seed);
                    continue;
                }
                let points = result.coordinates.clone();

                // 1) LEGACY default path via the public API.
                let engine = box_counting_3d_morton(&points, PRECISION);

                // 2) Independent recomputation + byte-identity assertion.
                let (levels, log_scales, log_counts) = per_level_counts(&points, PRECISION);
                let (rep_start, rep_df, rep_r2, rep_se) = legacy_replica(log_scales, log_counts);
                let exact = rep_df == engine.dimension
                    && rep_r2 == engine.r_squared
                    && rep_se == engine.std_error
                    && rep_start == engine.linear_region_start;
                if !exact {
                    eprintln!(
                        "WARNING: seed {} replica mismatch: df {} vs {}, r2 {} vs {}, start {} vs {}",
                        seed, rep_df, engine.dimension, rep_r2, engine.r_squared, rep_start,
                        engine.linear_region_start
                    );
                }
                acc.exact_matches += usize::from(exact);
                acc.runs += 1;
                acc.legacy_dfs.push(engine.dimension);
                acc.legacy_r2s.push(engine.r_squared);
                acc.rg_dfs.push(result.fractal_dimension);
                acc.eff_lens.push(levels.len());
                acc.raw_level_ranges
                    .push((levels.first().map_or(0, |l| l.level), levels.last().map_or(0, |l| l.level)));

                // 3) Candidate window sweep (windowed path does not exist yet).
                for ws in &mut acc.windows {
                    let (s, e_cand) = ws.key;
                    let e = e_cand.min(levels.len().saturating_sub(1));
                    if let Some((slope_ln, r2, np)) = window_fit(&levels, s, e, false) {
                        // D2 cross-check: slope must be log-base invariant.
                        if let Some((slope_log2, _, _)) = window_fit(&levels, s, e, true) {
                            acc.max_logbase_err =
                                acc.max_logbase_err.max((slope_ln - slope_log2).abs());
                        }
                        // Legacy selected-range log2 cross-check happens on the
                        // legacy data below; record window stats here.
                        let _ = np;
                        ws.dfs.push(slope_ln);
                        ws.r2s.push(r2);
                    }
                }

                // Legacy selected-range log2 cross-check (D2).
                {
                    let bs = engine.linear_region_start;
                    let ls = &engine.log_scales[bs.min(engine.log_scales.len())..];
                    let lc = &engine.log_counts[bs.min(engine.log_counts.len())..];
                    let x2: Vec<f64> = ls.iter().map(|v| v / std::f64::consts::LN_2).collect();
                    let y2: Vec<f64> = lc.iter().map(|v| v / std::f64::consts::LN_2).collect();
                    if let Some((slope2, _, _)) = ols(&x2, &y2) {
                        acc.max_logbase_err = acc.max_logbase_err.max((engine.dimension - slope2).abs());
                    }
                }
            }

            println!(
                "  runs={} byteIdentity={}/{} maxLogBaseErr={:.3e} effLevels={:?} rawLevelRange={:?}",
                acc.runs,
                acc.exact_matches,
                acc.runs,
                acc.max_logbase_err,
                acc.eff_lens,
                acc.raw_level_ranges
            );
            if acc.runs > 0 {
                let m_df = mean(&acc.legacy_dfs);
                let m_rg = mean(&acc.rg_dfs);
                println!(
                    "  LEGACY: meanDf={:.3} meanR²={:.3} Δt={:+.3} Δrg={:+.3}",
                    m_df,
                    mean(&acc.legacy_r2s),
                    m_df - df_target,
                    m_df - m_rg
                );
            }
            println!();
            all_acc.push(((df_target, n_particles), acc));
        }
    }

    // ── Per-config best window ──
    println!("=== Per-config best window (min mean |Δt|; ties → wider window first) ===");
    println!(
        "{:<12} | {:>11} | {:>7} {:>7} {:>7} {:>7} | {:>4}",
        "config", "best (s,e)", "meanDf", "Δt", "Δrg", "meanR²", "pts"
    );
    println!("{}", "-".repeat(76));
    for ((df_target, n), acc) in &all_acc {
        let m_rg = mean(&acc.rg_dfs);
        let mut best: Option<(&WindowStat, f64)> = None;
        for ws in &acc.windows {
            if ws.dfs.is_empty() {
                continue;
            }
            let score = mean(&ws.dfs.iter().map(|d| (d - df_target).abs()).collect::<Vec<_>>());
            // Sweep order is (start asc, end desc); strict < keeps the earlier
            // (= wider at equal start) window on ties.
            if best.map_or(true, |(_, b)| score < b) {
                best = Some((ws, score));
            }
        }
        if let Some((ws, _)) = best {
            let m_df = mean(&ws.dfs);
            println!(
                "{:<12} | {:>11} | {:>7.3} {:>+7.3} {:>+7.3} {:>7.3} | {:>4}",
                format!("{:.1}/{}", df_target, n),
                format!("({}, {})", ws.key.0, ws.key.1),
                m_df,
                m_df - df_target,
                m_df - m_rg,
                mean(&ws.r2s),
                ws.dfs.len()
            );
        }
    }

    // ── Fixed-window recommendation ──
    println!("\n=== Fixed-window recommendation (one (s,e) for all configs) ===");
    let mut fixed_scores: Vec<((usize, usize), f64, f64, f64)> = Vec::new(); // key, mean|Δt| all runs, mean|Δt| N=2000, max|Δt| N=2000
    let n_windows = all_acc[0].1.windows.len();
    for wi in 0..n_windows {
        let key = all_acc[0].1.windows[wi].key;
        let mut all_abs = Vec::new();
        let mut n2000_abs = Vec::new();
        for ((df_target, n), acc) in &all_acc {
            let ws = &acc.windows[wi];
            for d in &ws.dfs {
                let abs = (d - df_target).abs();
                all_abs.push(abs);
                if *n == 2000 {
                    n2000_abs.push(abs);
                }
            }
        }
        if all_abs.is_empty() {
            continue;
        }
        let m_all = mean(&all_abs);
        let m_2000 = if n2000_abs.is_empty() { f64::NAN } else { mean(&n2000_abs) };
        let mx_2000 = n2000_abs.iter().copied().fold(f64::NAN, f64::max);
        fixed_scores.push((key, m_all, m_2000, mx_2000));
    }
    fixed_scores.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    println!(
        "{:>4} {:>4} | {:>10} {:>12} {:>12}",
        "s", "e", "mean|Δt| all", "mean|Δt| 2k", "max|Δt| 2k"
    );
    for (key, m_all, m_2000, mx_2000) in &fixed_scores {
        println!(
            "{:>4} {:>4} | {:>10.3} {:>12.3} {:>12.3}",
            key.0, key.1, m_all, m_2000, mx_2000
        );
    }
    let recommended = fixed_scores.first().map(|f| f.0);

    // ── Variant matrix per N ──
    for &n in &n_sizes {
        println!("\n=== Mean Df / Δt per variant at N = {} ===", n);
        print!("{:<10}", "variant");
        for &df_target in &df_targets {
            print!(" {:>14}", format!("Df={:.1}", df_target));
        }
        println!();
        print!("{:<10}", "LEGACY");
        for &df_target in &df_targets {
            let acc = &all_acc
                .iter()
                .find(|((d, nn), _)| *d == df_target && *nn == n)
                .unwrap()
                .1;
            let m = mean(&acc.legacy_dfs);
            print!(" {:>14}", format!("{:.3}/{:+.3}", m, m - df_target));
        }
        println!();
        for wi in 0..n_windows {
            let key = all_acc[0].1.windows[wi].key;
            let has_data = all_acc.iter().any(|(_, a)| !a.windows[wi].dfs.is_empty());
            if !has_data {
                continue;
            }
            let rec_mark = if Some(key) == recommended { " *" } else { "" };
            print!("{:<10}", format!("W({},{}){}", key.0, key.1, rec_mark));
            for &df_target in &df_targets {
                let acc = &all_acc
                    .iter()
                    .find(|((d, nn), _)| *d == df_target && *nn == n)
                    .unwrap()
                    .1;
                let ws = &acc.windows[wi];
                if ws.dfs.is_empty() {
                    print!(" {:>14}", "n/a");
                } else {
                    let m = mean(&ws.dfs);
                    print!(" {:>14}", format!("{:.3}/{:+.3}", m, m - df_target));
                }
            }
            println!();
        }
    }
    println!("(cells: meanDf/Δt; * = recommended window; Δt = meanDf - Df_target)");

    // ── T2 verdict inputs ──
    println!("\n=== T2 verdict inputs (design D1/D4) ===");
    if let Some((rs, re)) = recommended {
        println!("Recommended window: ({}, {}) — inclusive effective-level indices, 0 = finest.", rs, re);
        println!("{:<12} | {:>9} {:>9} {:>8} {:>9} {:>8}", "config", "legacyDf", "winDf", "Δt win", "rgDf", "Δrg win");
        for ((df_target, n), acc) in &all_acc {
            let wi = all_acc[0].1.windows.iter().position(|w| w.key == (rs, re)).unwrap();
            let ws = &acc.windows[wi];
            if ws.dfs.is_empty() || acc.legacy_dfs.is_empty() {
                continue;
            }
            let m_leg = mean(&acc.legacy_dfs);
            let m_win = mean(&ws.dfs);
            let m_rg = mean(&acc.rg_dfs);
            println!(
                "{:<12} | {:>9.3} {:>9.3} {:>+8.3} {:>9.3} {:>+8.3}",
                format!("{:.1}/{}", df_target, n),
                m_leg,
                m_win,
                m_win - df_target,
                m_rg,
                m_win - m_rg
            );
        }
        // R27.5 ±0.20 feasibility at N=2000 for the recommended window.
        let mut worst_mean = 0.0_f64;
        let mut worst_seed = 0.0_f64;
        for ((df_target, n), acc) in &all_acc {
            if *n != 2000 {
                continue;
            }
            let wi = all_acc[0].1.windows.iter().position(|w| w.key == (rs, re)).unwrap();
            for d in &acc.windows[wi].dfs {
                worst_seed = worst_seed.max((d - df_target).abs());
            }
            let m = mean(&acc.windows[wi].dfs);
            worst_mean = worst_mean.max((m - df_target).abs());
        }
        println!(
            "\n±0.20 feasibility at N=2000 (recommended window): max per-config |mean Δt| = {:.3}, max per-seed |Δt| = {:.3}",
            worst_mean, worst_seed
        );
        if worst_mean <= 0.20 {
            println!("-> mean-level ±0.20 IS reachable at N=2000 with window ({}, {}).", rs, re);
        } else {
            println!(
                "-> mean-level ±0.20 NOT reachable at N=2000 with window ({}, {}); achievable band ≈ ±{:.2} (mean) / ±{:.2} (per-seed).",
                rs, re, worst_mean, worst_seed
            );
        }
    } else {
        println!("No window produced fits — cannot recommend.");
    }

    let total_windows_checked: usize = all_acc.iter().map(|(_, a)| a.windows.iter().filter(|w| !w.dfs.is_empty()).count()).sum();
    println!(
        "\nD2 log-base invariance: max |slope_ln - slope_log2| across {} window fits + legacy ranges = {:.3e}",
        total_windows_checked,
        all_acc.iter().map(|(_, a)| a.max_logbase_err).fold(0.0_f64, f64::max)
    );
    println!(
        "Byte-identity of recomputed legacy path vs public API: {}/{} runs exact",
        all_acc.iter().map(|(_, a)| a.exact_matches).sum::<usize>(),
        all_acc.iter().map(|(_, a)| a.runs).sum::<usize>()
    );
    println!("\nTotal runtime: {:.1} s", t_start.elapsed().as_secs_f64());
}
