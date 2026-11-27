//! Phase 0 diagnostic for GitHub issue #332 (ODD task `332-fit-window`, task D1).
//!
//! Measurement only: the estimator, the engine's public behavior and every
//! existing test are untouched. What this prints:
//!
//! 1. The local-slope table per configuration: for each effective level
//!    (count-valid, `0 < count < N`, finest-first) the box count N(eps), the
//!    boxes per axis, the FORWARD local slope
//!    `(log_counts[k+1]-log_counts[k]) / (log_scales[k+1]-log_scales[k])`
//!    and, for comparison with the table in the issue body, the slope INTO
//!    the level from the previous one (that table's convention). Saturated
//!    raw levels (`count == N`) are marked explicitly — they are what makes
//!    the fine end of the curve useless.
//! 2. Candidate window rules, each a PURE function of the per-level counts
//!    (no rule ever sees a true/reference Df):
//!      R1 plateau: widest contiguous run of levels whose |local slope −
//!                  global slope| ≤ tol, tol ∈ {0.10, 0.15, 0.20}
//!      R2 best-R²: contiguous run of ≥ 3 levels maximizing the OLS R²
//!      R3 elbow:   cut at the level after which the local slope falls
//!                  below 0.5 × max local slope
//!      R4 best-adjusted-R²: contiguous run of ≥ 3 levels maximizing the
//!                  degrees-of-freedom-adjusted R²,
//!                  R2_adj = 1 − (1 − R²)·(n−1)/(n−2) with n the window
//!                  width (L8: R2 degenerates to 3-point fits because a
//!                  3-point fit almost always has a high raw R²; the raw
//!                  R² of the chosen window is printed next to the
//!                  adjusted one so the penalty is visible)
//!      R5 coarse:  fixed window over effective indices 1..=last — the
//!                  engine's effective sequence is finest-first and its
//!                  slopes RISE toward the coarse end (the opposite
//!                  orientation of the issue's 2D table), so the only
//!                  excluded level is the saturation transition at
//!                  index 0. If that window would hold < 3 levels, no
//!                  window is reported (the window is never shrunk, L8).
//!    For each rule: the chosen window, the windowed Df via the public
//!    `box_counting_3d_windowed`, and the signed error vs the reference Df —
//!    next to the legacy default-path Df (what the app ships today) and the
//!    oracle window (min |error| over all windows; diagnostic only, NOT a
//!    rule).
//! 3. The dependency on N: mean signed error and mean window width per rule
//!    across N ∈ {100, 500, 2000} at fixed Df_target.
//! 4. A closing block stating, from the measured numbers only, which rule
//!    chose the window a human would pick (operationalized as the oracle
//!    window), the width distribution and the width-vs-N trend per rule, and
//!    — for the reoriented contract (L7: publish the window, no ±0.20
//!    promise) — which of the five rule families (R1 at three tolerances,
//!    R2, R3, R4, R5) are degenerate and which are defensible as the
//!    explicit, measured criterion for T2. A negative result is a result.
//!
//! Configurations:
//!   - `sierpinski_triangle_3d(d)`, d ∈ {3,4,5}: theoretical Df = log3/log2
//!     ≈ 1.585 (points = 3^d).
//!   - `cantor_dust_3d(d)`, d ∈ {3,4,5}: theoretical Df = log8/log3 ≈ 1.893.
//!     The repo has no 2D Sierpinski carpet generator; the Cantor dust is
//!     its 3D sibling (same log8/log3 dimension, keep 8 of 27 sub-cubes)
//!     and reproduces the issue's canonical carpet numbers: at depth 4 it
//!     has exactly 8^4 = 4096 points, the count that saturates the issue's
//!     table.
//!   - Engine clouds from `run_tunable_cc_internal` at Df_target ∈ {2.5,
//!     2.7} × N ∈ {100, 500, 2000} × seeds {1,2,3}, R27.4 setup (Dimers,
//!     target_kf = 1.3, monodisperse rp = 1.0). Reference = the cloud's own
//!     Rg-evolution Df (`result.fractal_dimension`), reported next to every
//!     box-counting number.
//!
//! The per-level counts are recomputed independently from the same public
//! primitives the estimator uses (`find_bounding_box`, `compute_scale`,
//! `normalize_coord`, `morton_encode_3d`, sorted `count_unique_masked` per
//! level, count-validity filter) — the same read-only-copy technique as
//! `bc_window_alignment_audit`. The copy is validated here by byte-identity:
//! the recomputed effective log vectors must equal
//! `box_counting_3d_windowed(points, precision, (0, eff-1))` exactly (when
//! eff ≥ 3), the default path's returned vectors must be a byte-identical
//! suffix of the recomputed ones (Step 4b may drop a fine-side prefix), and
//! `effective_levels` must match. Every rule window is additionally
//! cross-checked: the public windowed Df must equal the local OLS slope.
//!
//! Run: `cd aglogen_core && PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1 cargo run --release -p aglogen-engine --example bc_fit_window_curve`

use std::time::Instant;

use aglogen_engine::fractal::box_counting_3d::{
    box_counting_3d_morton, box_counting_3d_windowed, compute_scale, count_unique_masked,
    find_bounding_box, morton_encode_3d, normalize_coord,
};
use aglogen_engine::fractal::fractals::{cantor_dust_3d, sierpinski_triangle_3d};
use aglogen_engine::simulation::tunable_cc::{run_tunable_cc_internal, SeedType, TunableCcParams};

const PRECISION: u32 = 18;

const RULE_NAMES: [&str; 7] = [
    "R1 plateau tol=0.10",
    "R1 plateau tol=0.15",
    "R1 plateau tol=0.20",
    "R2 best-R2",
    "R3 elbow frac=0.50",
    "R4 best-R2adj",
    "R5 coarse 1..end",
];

// ─────────────────────────────────────────────────────────────────────────────
// Read-only recomputation of the estimator's counting pipeline
// (box_counting_3d.rs steps 1-4). The estimator is not modified; the copy is
// validated by byte-identity against the public API (see `validate_copy`).
// ─────────────────────────────────────────────────────────────────────────────

/// Per-level box counts for ALL raw levels (level 0 = finest), in the
/// estimator's own terms: count at level k = `count_unique_masked` with
/// shift 3k; box_size = scale · 2^k / max_val.
struct RawCounts {
    level: Vec<u32>,
    count: Vec<usize>,
    box_size: Vec<f64>,
    scale: f64,
}

/// Effective level sequence (count-valid `0 < count < N`, finest-first) plus
/// the saturation context just finer than it.
struct EffectiveCurve {
    raw_level: Vec<u32>,
    count: Vec<usize>,
    box_size: Vec<f64>,
    /// (count, box_size) of the raw level immediately finer than
    /// `raw_level[0]` — a saturated level (`count == N`) — if any.
    prev: Option<(usize, f64)>,
    /// How many raw levels finer than the first effective one are saturated.
    sat_prefix: usize,
    /// The bounding-box scale the box sizes were built with.
    scale: f64,
    n_points: usize,
}

fn raw_level_counts(points: &[[f64; 3]], precision: u32) -> Option<RawCounts> {
    if points.len() < 2 {
        return None;
    }
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

    let mut raw = RawCounts {
        level: Vec::with_capacity(precision as usize),
        count: Vec::with_capacity(precision as usize),
        box_size: Vec::with_capacity(precision as usize),
        scale,
    };
    for level in 0..precision {
        let shift = 3 * level; // 3 bits per level for 3D
        let box_count = count_unique_masked(&sorted_codes, shift);
        let box_size = scale * (1u64 << level) as f64 / max_val as f64;
        raw.level.push(level);
        raw.count.push(box_count);
        raw.box_size.push(box_size);
    }
    Some(raw)
}

fn effective_curve(raw: &RawCounts, n_points: usize) -> EffectiveCurve {
    let mut eff = EffectiveCurve {
        raw_level: Vec::new(),
        count: Vec::new(),
        box_size: Vec::new(),
        prev: None,
        sat_prefix: 0,
        scale: raw.scale,
        n_points,
    };
    for i in 0..raw.level.len() {
        let c = raw.count[i];
        if c > 0 && c < n_points {
            if eff.raw_level.is_empty() {
                eff.sat_prefix = i;
                if i > 0 {
                    eff.prev = Some((raw.count[i - 1], raw.box_size[i - 1]));
                }
            }
            eff.raw_level.push(raw.level[i]);
            eff.count.push(c);
            eff.box_size.push(raw.box_size[i]);
        }
    }
    eff
}

/// The estimator's log vectors for the effective sequence, same expressions
/// and order as `morton_core` step 4 (byte-identical by construction).
fn log_vectors(counts: &[usize], box_sizes: &[f64]) -> (Vec<f64>, Vec<f64>) {
    let log_scales: Vec<f64> = box_sizes.iter().map(|b| (1.0 / b).ln()).collect();
    let log_counts: Vec<f64> = counts.iter().map(|c| (*c as f64).ln()).collect();
    (log_scales, log_counts)
}

/// Plain OLS. Returns (slope, r_squared) or None if degenerate.
fn ols(x: &[f64], y: &[f64]) -> Option<(f64, f64)> {
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
    let r2 = if ss_tot > 1e-15 {
        1.0 - ss_res / ss_tot
    } else {
        0.0
    };
    Some((slope, r2))
}

/// Forward local slopes, one per consecutive pair: slope[k] is the slope
/// from effective level k to k+1 (the parent task's formula).
fn local_slopes(log_scales: &[f64], log_counts: &[f64]) -> Vec<f64> {
    (0..log_scales.len().saturating_sub(1))
        .map(|k| (log_counts[k + 1] - log_counts[k]) / (log_scales[k + 1] - log_scales[k]))
        .collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate window rules. Pure functions of the per-level counts and box
// sizes — no access to any true/reference Df.
// ─────────────────────────────────────────────────────────────────────────────

struct RulePick {
    window: Option<(usize, usize)>,
    note: &'static str,
    /// Extra auditable number for the chosen window (R4: the raw R², so
    /// the degrees-of-freedom penalty is visible next to the adjusted R²).
    aux: Option<f64>,
}

impl RulePick {
    fn none(note: &'static str) -> Self {
        Self {
            window: None,
            note,
            aux: None,
        }
    }
    fn some(window: (usize, usize), note: &'static str) -> Self {
        Self {
            window: Some(window),
            note,
            aux: None,
        }
    }
    /// `some` plus the extra auditable number.
    fn some_aux(window: (usize, usize), note: &'static str, aux: f64) -> Self {
        Self {
            window: Some(window),
            note,
            aux: Some(aux),
        }
    }
}

fn pick_rule(i: usize, counts: &[usize], box_sizes: &[f64]) -> RulePick {
    match i {
        0 => rule_r1_plateau(counts, box_sizes, 0.10),
        1 => rule_r1_plateau(counts, box_sizes, 0.15),
        2 => rule_r1_plateau(counts, box_sizes, 0.20),
        3 => rule_r2_best_r2(counts, box_sizes),
        4 => rule_r3_elbow(counts, box_sizes, 0.5),
        5 => rule_r4_best_r2_adj(counts, box_sizes),
        _ => rule_r5_coarse(counts),
    }
}

/// R1 plateau: the widest contiguous run of levels whose |local slope −
/// global OLS slope| ≤ tol. A run of L qualifying consecutive slopes spans
/// L+1 levels; needs L ≥ 2 (≥ 3 levels). Ties → earliest run.
fn rule_r1_plateau(counts: &[usize], box_sizes: &[f64], tol: f64) -> RulePick {
    let n = counts.len();
    if n < 3 {
        return RulePick::none("fewer than 3 effective levels");
    }
    let (ls, lc) = log_vectors(counts, box_sizes);
    let Some((global, _)) = ols(&ls, &lc) else {
        return RulePick::none("degenerate global fit");
    };
    let slopes = local_slopes(&ls, &lc);
    let mut best_len = 0usize;
    let mut best_start = 0usize;
    let mut cur_len = 0usize;
    let mut cur_start = 0usize;
    for (k, &s) in slopes.iter().enumerate() {
        if (s - global).abs() <= tol {
            if cur_len == 0 {
                cur_start = k;
            }
            cur_len += 1;
            if cur_len > best_len {
                best_len = cur_len;
                best_start = cur_start;
            }
        } else {
            cur_len = 0;
        }
    }
    if best_len < 2 {
        return RulePick::none("no run of >= 3 levels within tolerance of the global slope");
    }
    // Slope run [best_start .. best_start+best_len-1] → levels
    // [best_start .. best_start+best_len].
    RulePick::some((best_start, best_start + best_len), "ok")
}

/// R2 best-R²: the contiguous run of ≥ 3 levels maximizing the OLS R² of
/// log_counts vs log_scales. Ties (1e-12) → wider, then earliest.
fn rule_r2_best_r2(counts: &[usize], box_sizes: &[f64]) -> RulePick {
    let n = counts.len();
    if n < 3 {
        return RulePick::none("fewer than 3 effective levels");
    }
    let (ls, lc) = log_vectors(counts, box_sizes);
    // best = (r2, width, start, end)
    let mut best: Option<(f64, usize, usize, usize)> = None;
    for s in 0..=n - 3 {
        for e in (s + 2)..n {
            let Some((_, r2)) = ols(&ls[s..=e], &lc[s..=e]) else {
                continue;
            };
            let w = e - s + 1;
            let take = match best {
                None => true,
                Some((br2, bw, _, _)) => r2 > br2 + 1e-12 || ((r2 - br2).abs() <= 1e-12 && w > bw),
            };
            if take {
                best = Some((r2, w, s, e));
            }
        }
    }
    match best {
        None => RulePick::none("no fittable window"),
        Some((_, w, s, e)) => {
            let note = if w == 3 {
                "minimum width (exactly 3 levels)"
            } else {
                "ok"
            };
            RulePick::some((s, e), note)
        }
    }
}

/// R3 elbow: keep levels 0..=k where k is the first level whose outgoing
/// local slope falls below `frac` × max local slope ("it saturated here").
/// No elbow → whole effective curve (fallback, flagged).
fn rule_r3_elbow(counts: &[usize], box_sizes: &[f64], frac: f64) -> RulePick {
    let n = counts.len();
    if n < 3 {
        return RulePick::none("fewer than 3 effective levels");
    }
    let (ls, lc) = log_vectors(counts, box_sizes);
    let slopes = local_slopes(&ls, &lc);
    let max_s = slopes.iter().copied().fold(f64::MIN, f64::max);
    if max_s <= 1e-12 {
        return RulePick::none("flat curve (max local slope ~ 0)");
    }
    match slopes.iter().position(|&s| s < frac * max_s) {
        Some(k) => {
            if k < 2 {
                RulePick::none("elbow before the 3rd level — window would hold < 3 levels")
            } else {
                RulePick::some((0, k), "ok")
            }
        }
        None => RulePick::some(
            (0, n - 1),
            "no elbow — whole effective curve (slope never falls below frac of max)",
        ),
    }
}

/// R4 best-adjusted-R²: the contiguous run of ≥ 3 levels maximizing the
/// degrees-of-freedom-adjusted R², `R2_adj = 1 − (1 − R2)·(n−1)/(n−2)` with
/// n the number of levels in the window. R2 degenerates to 3-point fits
/// because a 3-point fit almost always has a high raw R²; the (n−1)/(n−2)
/// factor is the penalty that removes that free lunch. Ties (1e-12) →
/// wider window, then earliest. The raw R² of the chosen window travels in
/// `aux` so the output shows the penalty (L8).
fn rule_r4_best_r2_adj(counts: &[usize], box_sizes: &[f64]) -> RulePick {
    let n = counts.len();
    if n < 3 {
        return RulePick::none("fewer than 3 effective levels");
    }
    let (ls, lc) = log_vectors(counts, box_sizes);
    // best = (r2_adj, width, start, end, r2_raw)
    let mut best: Option<(f64, usize, usize, usize, f64)> = None;
    for s in 0..=n - 3 {
        for e in (s + 2)..n {
            let Some((_, r2)) = ols(&ls[s..=e], &lc[s..=e]) else {
                continue;
            };
            let w = e - s + 1;
            let nf = w as f64;
            let r2_adj = 1.0 - (1.0 - r2) * (nf - 1.0) / (nf - 2.0);
            let take = match best {
                None => true,
                Some((ba, bw, _, _, _)) => {
                    r2_adj > ba + 1e-12 || ((r2_adj - ba).abs() <= 1e-12 && w > bw)
                }
            };
            if take {
                best = Some((r2_adj, w, s, e, r2));
            }
        }
    }
    match best {
        None => RulePick::none("no fittable window"),
        Some((_, 3, s, e, r2_raw)) => {
            RulePick::some_aux((s, e), "minimum width (exactly 3 levels)", r2_raw)
        }
        Some((_, _, s, e, r2_raw)) => RulePick::some_aux((s, e), "ok", r2_raw),
    }
}

/// R5 coarse window: in the engine's effective sequence (finest first) the
/// saturation transition sits at index 0 and the local slopes RISE toward
/// the coarse end — the opposite orientation of the issue's 2D table — so
/// the only level this rule excludes is that transition. Window = effective
/// indices 1..=last. If that would hold fewer than 3 levels, NO window is
/// reported: the rule never shrinks or widens its fixed window (L8).
fn rule_r5_coarse(counts: &[usize]) -> RulePick {
    let n = counts.len();
    if n < 4 {
        return RulePick::none(
            "effective sequence too short: window (1, last) would hold < 3 levels",
        );
    }
    RulePick::some(
        (1, n - 1),
        "fixed: effective indices 1..=last (drops the index-0 saturation transition)",
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-configuration evaluation and printing
// ─────────────────────────────────────────────────────────────────────────────

struct RuleEval {
    window: Option<(usize, usize)>,
    note: &'static str,
    df: Option<f64>,
    err: Option<f64>,
    /// Raw R² of the chosen window when the rule reports it (R4).
    aux: Option<f64>,
}

struct ConfigOutcome {
    reference_df: f64,
    eff_len: usize,
    legacy_err: f64,
    cloud: bool,
    df_target: Option<f64>,
    n_size: Option<usize>,
    rules: Vec<RuleEval>,
    oracle_window: Option<(usize, usize)>,
    oracle_abs_err: Option<f64>,
}

#[derive(Default)]
struct ValStats {
    full_exact: usize,
    suffix_only_exact: usize,
    mismatch: usize,
    max_api_local_mismatch: f64,
}

fn is_suffix(tail: &[f64], full: &[f64]) -> bool {
    !tail.is_empty() && tail.len() <= full.len() && full[full.len() - tail.len()..] == tail[..]
}

fn boxes_per_axis(raw_level: u32) -> u64 {
    1u64 << (PRECISION - raw_level)
}

fn fmt_slope(v: Option<f64>) -> String {
    match v {
        Some(s) => format!("{s:9.3}"),
        None => format!("{:>9}", "-"),
    }
}

/// Print the local-slope table for one configuration (the issue's table,
/// on this repo's objects): per effective level the count, boxes per axis,
/// the forward local slope and the slope into the level. Saturation is
/// marked explicitly.
fn print_level_table(eff: &EffectiveCurve) {
    let n = eff.n_points;
    if eff.raw_level.is_empty() {
        println!("  no count-valid levels at all (0 < count < {n} is empty)");
        return;
    }
    if eff.sat_prefix > 0 {
        let last_sat = eff.raw_level[0] - 1;
        println!(
            "  raw levels 0..={last_sat} (boxes/axis {}..={}): SATURATED, count == N == {n} \
             on {} levels — already excluded by the count-valid filter; they are the useless fine end",
            boxes_per_axis(0),
            boxes_per_axis(last_sat),
            eff.sat_prefix
        );
    } else {
        println!("  no saturated raw levels: count < N already at the finest level");
    }

    println!(
        "  {:>4} {:>4} {:>10} {:>7} {:>9} {:>9}  flags",
        "eff", "lvl", "boxes/axis", "count", "slopeOut", "slopeIn"
    );

    // Last saturated level row (context for the transition slope).
    if eff.sat_prefix > 0 {
        let lvl = eff.raw_level[0] - 1;
        let bs = raw_box_size(eff, lvl);
        // Slope into the sat row: from the previous saturated level, where the
        // count is also N — always 0 (the plateau that defines saturation).
        let slope_in = if lvl > 0 { Some(0.0) } else { None };
        let slope_out = Some(slope_between(
            n as f64,
            bs,
            eff.count[0] as f64,
            eff.box_size[0],
        ));
        println!(
            "  {:>4} {:>4} {:>10} {:>7} {} {}  SAT (count == N == {n}) — excluded from the fit",
            "sat",
            lvl,
            boxes_per_axis(lvl),
            n,
            fmt_slope(slope_out),
            fmt_slope(slope_in)
        );
    }

    let (ls, lc) = log_vectors(&eff.count, &eff.box_size);
    let m = eff.count.len();
    for i in 0..m {
        let lvl = eff.raw_level[i];
        let c = eff.count[i];
        // Forward slope (parent task's formula): level i → i+1.
        let slope_out = if i + 1 < m {
            Some((lc[i + 1] - lc[i]) / (ls[i + 1] - ls[i]))
        } else {
            None
        };
        // Slope into the level (the issue table's convention): from the
        // previous raw level (saturated or effective).
        let slope_in = if i == 0 {
            eff.prev
                .map(|(pc, pb)| slope_between(pc as f64, pb, c as f64, eff.box_size[i]))
        } else {
            Some((lc[i] - lc[i - 1]) / (ls[i] - ls[i - 1]))
        };
        let mut flags = Vec::new();
        if i == 0 && eff.prev.is_some() {
            flags.push("transition out of saturation");
        }
        if c == 1 {
            flags.push("count == 1 floor (still inside the fit)");
        }
        println!(
            "  {:>4} {:>4} {:>10} {:>7} {} {}  {}",
            i,
            lvl,
            boxes_per_axis(lvl),
            c,
            fmt_slope(slope_out),
            fmt_slope(slope_in),
            flags.join("; ")
        );
    }

    if m >= 2 {
        if let Some((global, _)) = ols(&ls, &lc) {
            println!(
                "  global OLS slope over all {m} effective levels: {global:.3}  (R1's reference slope)"
            );
        }
    }
}

/// Box size of a raw level finer than the effective sequence start, rebuilt
/// with the same scale the effective box sizes were built with.
fn raw_box_size(eff: &EffectiveCurve, lvl: u32) -> f64 {
    let max_val = ((1u64 << PRECISION) - 1) as f64;
    eff.scale * (1u64 << lvl) as f64 / max_val
}

fn slope_between(count_hi: f64, box_hi: f64, count_lo: f64, box_lo: f64) -> f64 {
    ((count_lo).ln() - (count_hi).ln()) / ((1.0 / box_lo).ln() - (1.0 / box_hi).ln())
}

#[allow(clippy::too_many_arguments)]
fn evaluate_config(
    label: &str,
    points: &[[f64; 3]],
    reference_df: f64,
    ref_kind: &str,
    df_target: Option<f64>,
    n_size: Option<usize>,
    cloud: bool,
    val_stats: &mut ValStats,
) -> Option<ConfigOutcome> {
    let n_points = points.len();
    println!(
        "--- {label} | points = {n_points} | reference Df = {reference_df:.3} ({ref_kind}) ---"
    );

    let Some(raw) = raw_level_counts(points, PRECISION) else {
        println!("  SKIPPED: fewer than 2 points");
        println!();
        return None;
    };
    let eff = effective_curve(&raw, n_points);
    let m = eff.count.len();

    // Legacy default path (what the app ships today).
    let legacy = box_counting_3d_morton(points, PRECISION);
    let legacy_df = legacy.dimension;
    let legacy_err = legacy_df - reference_df;

    // Byte-identity validation of the read-only copy.
    let eff_match = legacy.effective_levels == m;
    let suffix_ok = is_suffix(&legacy.log_scales, &eff_box_log_scales(&eff))
        && is_suffix(&legacy.log_counts, &eff_box_log_counts(&eff));
    let valid_note;
    if m >= 3 {
        match box_counting_3d_windowed(points, PRECISION, (0, m - 1)) {
            Ok(w) => {
                let vecs_ok = w.log_scales == eff_box_log_scales(&eff)
                    && w.log_counts == eff_box_log_counts(&eff)
                    && w.effective_levels == m;
                if vecs_ok && eff_match && suffix_ok {
                    val_stats.full_exact += 1;
                    valid_note = "exact (full-window vectors byte-identical; default-path vectors suffix-identical)".to_string();
                } else {
                    val_stats.mismatch += 1;
                    valid_note = format!(
                        "MISMATCH (vecs_ok={vecs_ok} eff_match={eff_match} suffix_ok={suffix_ok})"
                    );
                }
            }
            Err(e) => {
                val_stats.mismatch += 1;
                valid_note = format!("MISMATCH (full-window API rejected a valid window: {e})");
            }
        }
    } else if eff_match && suffix_ok {
        val_stats.suffix_only_exact += 1;
        valid_note =
            "exact (suffix-only; eff < 3 so the full-window API is not callable)".to_string();
    } else {
        val_stats.mismatch += 1;
        valid_note = format!("MISMATCH (eff_match={eff_match} suffix_ok={suffix_ok})");
    }
    if valid_note.starts_with("MISMATCH") {
        println!("  WARNING: copy validation {valid_note}");
    }

    // 1. The local-slope table.
    print_level_table(&eff);

    // 2. Candidate rules + oracle.
    let (ls, lc) = log_vectors(&eff.count, &eff.box_size);
    let mut rule_evals = Vec::with_capacity(RULE_NAMES.len());
    for i in 0..RULE_NAMES.len() {
        let pick = pick_rule(i, &eff.count, &eff.box_size);
        let mut window = None;
        let mut df = None;
        let mut err = None;
        if let Some((s, e)) = pick.window {
            match box_counting_3d_windowed(points, PRECISION, (s, e)) {
                Ok(r) => {
                    // Cross-check: public windowed Df == local OLS slope.
                    if let Some((slope_local, _)) = ols(&ls[s..=e], &lc[s..=e]) {
                        val_stats.max_api_local_mismatch = val_stats
                            .max_api_local_mismatch
                            .max((r.dimension - slope_local).abs());
                    }
                    df = Some(r.dimension);
                    err = Some(r.dimension - reference_df);
                    window = Some((s, e));
                }
                Err(e2) => {
                    println!(
                        "  WARNING: {} window ({s}, {e}) rejected by the API: {e2}",
                        RULE_NAMES[i]
                    );
                }
            }
        }
        rule_evals.push(RuleEval {
            window,
            note: pick.note,
            aux: pick.aux,
            df,
            err,
        });
    }

    // Oracle: min |Δ| window over all >= 3-level windows. Uses the
    // reference Df — diagnostic only, never a rule input.
    let mut oracle: Option<(f64, usize, usize, usize)> = None; // (abs_err, width, s, e)
    if m >= 3 {
        for s in 0..=m - 3 {
            for e in (s + 2)..m {
                if let Some((slope, _)) = ols(&ls[s..=e], &lc[s..=e]) {
                    let a = (slope - reference_df).abs();
                    let w = e - s + 1;
                    let take = match oracle {
                        None => true,
                        Some((ba, bw, _, _)) => {
                            a < ba - 1e-12 || ((a - ba).abs() <= 1e-12 && w > bw)
                        }
                    };
                    if take {
                        oracle = Some((a, w, s, e));
                    }
                }
            }
        }
    }
    let oracle_window = oracle.map(|(_, _, s, e)| (s, e));
    let oracle_abs_err = oracle.map(|(a, _, _, _)| a);

    println!("  fit windows (inclusive indices into the effective sequence; Δ = Df − reference):");
    println!(
        "  {:<19}: Df={legacy_df:.3} Δ={legacy_err:+.3}  (no window — the default path; effective_levels={}, linear_region_start={})",
        "LEGACY (ships today)",
        legacy.effective_levels,
        legacy.linear_region_start
    );
    for (i, re) in rule_evals.iter().enumerate() {
        match (re.window, re.df, re.err) {
            (Some((s, e)), Some(df), Some(err)) => {
                let oracle_mark = if Some((s, e)) == oracle_window {
                    "  = ORACLE window"
                } else {
                    ""
                };
                // R4 prints the raw R² of the chosen window next to the
                // adjusted one, so the degrees-of-freedom penalty is
                // visible (both are shown for every other rule as `aux` is
                // only set by R4).
                let aux_txt = match re.aux {
                    Some(r2) => {
                        let w = (e - s + 1) as f64;
                        let r2_adj = 1.0 - (1.0 - r2) * (w - 1.0) / (w - 2.0);
                        format!("  R2raw={r2:.5} R2adj={r2_adj:.5}")
                    }
                    None => String::new(),
                };
                println!(
                    "  {:<19}: window ({s}, {e}), {} levels, Df={df:.3} Δ={err:+.3} |Δ|={:.3}  [{}]{}{}",
                    RULE_NAMES[i],
                    e - s + 1,
                    err.abs(),
                    re.note,
                    aux_txt,
                    oracle_mark
                );
            }
            _ => {
                println!("  {:<19}: no window — {}", RULE_NAMES[i], re.note);
            }
        }
    }
    match (oracle_window, oracle_abs_err) {
        (Some((s, e)), Some(a)) => println!(
            "  {:<19}: window ({s}, {e}), {} levels, |Δ|={a:.3}  (uses the reference Df — diagnostic only, not a rule)",
            "ORACLE min|Δ|",
            e - s + 1
        ),
        _ => println!(
            "  {:<19}: none (fewer than 3 effective levels)",
            "ORACLE min|Δ|"
        ),
    }
    println!();

    Some(ConfigOutcome {
        reference_df,
        eff_len: m,
        legacy_err,
        cloud,
        df_target,
        n_size,
        rules: rule_evals,
        oracle_window,
        oracle_abs_err,
    })
}

fn eff_box_log_scales(eff: &EffectiveCurve) -> Vec<f64> {
    eff.box_size.iter().map(|b| (1.0 / b).ln()).collect()
}

fn eff_box_log_counts(eff: &EffectiveCurve) -> Vec<f64> {
    eff.count.iter().map(|c| (*c as f64).ln()).collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

fn mean(vals: &[f64]) -> f64 {
    vals.iter().sum::<f64>() / vals.len() as f64
}

fn mean_opt(vals: &[Option<f64>]) -> Option<f64> {
    let v: Vec<f64> = vals.iter().filter_map(|x| *x).collect();
    if v.is_empty() {
        None
    } else {
        Some(mean(&v))
    }
}

fn main() {
    let t0 = Instant::now();
    println!("Phase 0 diagnostic: BC local-slope curve + candidate fit-window rules (issue #332, task D1)");
    println!("===========================================================================================");
    println!("Measurement only: the estimator and its public behavior are NOT modified.");
    println!("Precision = {PRECISION} bits/axis. slopeOut = (lc[k+1]-lc[k])/(ls[k+1]-ls[k]);");
    println!(
        "slopeIn = the issue table's convention (slope into the row from the previous level)."
    );
    println!("References: sierpinski_triangle_3d → log3/log2 = {:.4}; cantor_dust_3d → log8/log3 = {:.4};",
        (3.0f64).log2(),
        (8.0f64).ln() / (3.0f64).ln()
    );
    println!("cantor_dust_3d is the 3D sibling of the issue's canonical Sierpinski carpet (same");
    println!(
        "log8/log3 Df; depth 4 → 8^4 = 4096 points, the count that saturates the issue's table)."
    );
    println!("Engine clouds: Df_target {{2.5, 2.7}} x N {{100, 500, 2000}} x seeds {{1,2,3}}, R27.4 setup");
    println!("(Dimers, target_kf=1.3, monodisperse rp=1.0); reference = the cloud's own Rg-evolution Df.");
    println!(
        "Rule set (L8): R1 plateau (tol 0.10/0.15/0.20), R2 best-R², R3 elbow, plus the two new"
    );
    println!(
        "candidates: R4 best-adjusted-R² (degrees-of-freedom penalty against 3-point fits; the"
    );
    println!("raw R² is printed next to the adjusted one) and R5 coarse window (effective indices");
    println!("1..=last, excluding only the saturation transition at index 0).");
    println!();

    let mut val_stats = ValStats::default();
    let mut outcomes: Vec<ConfigOutcome> = Vec::new();
    let mut failed_configs = 0usize;

    // ── Section 1: deterministic fractals ──
    println!("=== 1. Local-slope tables: deterministic fractals ===");
    println!();
    let log3_2 = (3.0f64).log2();
    let log8_3 = (8.0f64).ln() / (3.0f64).ln();
    let fractal_cfgs: Vec<(&str, u32, f64, fn(u32) -> Vec<[f64; 3]>)> = vec![
        (
            "sierpinski_triangle_3d(3)",
            3,
            log3_2,
            sierpinski_triangle_3d,
        ),
        (
            "sierpinski_triangle_3d(4)",
            4,
            log3_2,
            sierpinski_triangle_3d,
        ),
        (
            "sierpinski_triangle_3d(5)",
            5,
            log3_2,
            sierpinski_triangle_3d,
        ),
        ("cantor_dust_3d(3)", 3, log8_3, cantor_dust_3d),
        ("cantor_dust_3d(4)", 4, log8_3, cantor_dust_3d),
        ("cantor_dust_3d(5)", 5, log8_3, cantor_dust_3d),
    ];
    for (label, depth, ref_df, gen) in fractal_cfgs {
        let points = gen(depth);
        if let Some(o) = evaluate_config(
            label,
            &points,
            ref_df,
            "theoretical",
            None,
            None,
            false,
            &mut val_stats,
        ) {
            outcomes.push(o);
        } else {
            failed_configs += 1;
        }
    }

    // ── Section 2: engine clouds ──
    println!("=== 2. Local-slope tables: engine clouds (run_tunable_cc_internal) ===");
    println!();
    let df_targets = [2.5_f64, 2.7];
    let n_sizes = [100_usize, 500, 2000];
    let seeds = [1_u64, 2, 3];
    for &df_target in &df_targets {
        for &n in &n_sizes {
            for &seed in &seeds {
                let label = format!("cloud Df_target={df_target} N={n} seed={seed}");
                let params = TunableCcParams {
                    n_particles: n,
                    target_df: df_target,
                    target_kf: 1.3,
                    radius_min: 1.0,
                    radius_max: 1.0,
                    seed_type: SeedType::Dimers,
                    ..Default::default()
                };
                match run_tunable_cc_internal(params, seed, None) {
                    Ok(res) => {
                        if res.coordinates.is_empty() {
                            println!("--- {label} ---");
                            println!("  SKIPPED: simulation returned no coordinates");
                            println!();
                            failed_configs += 1;
                            continue;
                        }
                        if !res.fractal_dimension.is_finite() || res.fractal_dimension <= 0.0 {
                            println!("--- {label} ---");
                            println!(
                                "  SKIPPED: invalid Rg-evolution Df = {}",
                                res.fractal_dimension
                            );
                            println!();
                            failed_configs += 1;
                            continue;
                        }
                        if let Some(o) = evaluate_config(
                            &label,
                            &res.coordinates,
                            res.fractal_dimension,
                            "Rg-evolution, the cloud's own",
                            Some(df_target),
                            Some(n),
                            true,
                            &mut val_stats,
                        ) {
                            outcomes.push(o);
                        } else {
                            failed_configs += 1;
                        }
                    }
                    Err(e) => {
                        println!("--- {label} ---");
                        println!("  FAILED: run_tunable_cc_internal returned: {e}");
                        println!();
                        failed_configs += 1;
                    }
                }
            }
        }
    }

    // ── Section 3: dependency on N ──
    let cloud_runs: Vec<&ConfigOutcome> = outcomes.iter().filter(|o| o.cloud).collect();
    println!(
        "=== 3. Dependency on N (engine clouds; Δ = windowed Df − cloud's own Rg Df, per seed) ==="
    );
    println!();
    let col_key = |dt: f64, n: usize| format!("Df={dt} N={n}");
    println!("Mean signed Δ per rule (n/a = no window on any seed of the cell):");
    println!(
        "  {:<19} | {:>13} | {:>13} | {:>13} | {:>13} | {:>13} | {:>13}",
        "rule",
        col_key(2.5, 100),
        col_key(2.5, 500),
        col_key(2.5, 2000),
        col_key(2.7, 100),
        col_key(2.7, 500),
        col_key(2.7, 2000)
    );
    let mut legacy_row: Vec<Option<f64>> = Vec::with_capacity(6);
    let mut ref_row: Vec<Option<f64>> = Vec::with_capacity(6);
    for &dt in &df_targets {
        for &n in &n_sizes {
            let cell: Vec<Option<f64>> = cloud_runs
                .iter()
                .filter(|o| o.df_target == Some(dt) && o.n_size == Some(n))
                .map(|o| Some(o.legacy_err))
                .collect();
            legacy_row.push(mean_opt(&cell));
            let rcell: Vec<Option<f64>> = cloud_runs
                .iter()
                .filter(|o| o.df_target == Some(dt) && o.n_size == Some(n))
                .map(|o| Some(o.reference_df))
                .collect();
            ref_row.push(mean_opt(&rcell));
        }
    }
    print!("  {:<19}", "cloud Rg Df (mean)");
    for v in &ref_row {
        match v {
            Some(x) => print!(" | {:>13.3}", x),
            None => print!(" | {:>13}", "n/a"),
        }
    }
    println!();
    print!("  {:<19}", "LEGACY (ships today)");
    for v in &legacy_row {
        match v {
            Some(x) => print!(" | {:>13.3}", x),
            None => print!(" | {:>13}", "n/a"),
        }
    }
    println!();
    for i in 0..RULE_NAMES.len() {
        print!("  {:<19}", RULE_NAMES[i]);
        for &dt in &df_targets {
            for &n in &n_sizes {
                let cell: Vec<Option<f64>> = cloud_runs
                    .iter()
                    .filter(|o| o.df_target == Some(dt) && o.n_size == Some(n))
                    .map(|o| o.rules[i].err)
                    .collect();
                match mean_opt(&cell) {
                    Some(x) => print!(" | {:>13.3}", x),
                    None => print!(" | {:>13}", "n/a"),
                }
            }
        }
        println!();
    }
    println!();
    println!("Mean chosen window width in levels (same cells):");
    println!(
        "  {:<19} | {:>13} | {:>13} | {:>13} | {:>13} | {:>13} | {:>13}",
        "rule",
        col_key(2.5, 100),
        col_key(2.5, 500),
        col_key(2.5, 2000),
        col_key(2.7, 100),
        col_key(2.7, 500),
        col_key(2.7, 2000)
    );
    for i in 0..RULE_NAMES.len() {
        print!("  {:<19}", RULE_NAMES[i]);
        for &dt in &df_targets {
            for &n in &n_sizes {
                let cell: Vec<Option<f64>> = cloud_runs
                    .iter()
                    .filter(|o| o.df_target == Some(dt) && o.n_size == Some(n))
                    .map(|o| o.rules[i].window.map(|(s, e)| (e - s + 1) as f64))
                    .collect();
                match mean_opt(&cell) {
                    Some(x) => print!(" | {:>13.1}", x),
                    None => print!(" | {:>13}", "n/a"),
                }
            }
        }
        println!();
    }
    println!();

    // ── Copy validation summary ──
    println!("=== Copy validation (read-only recomputation vs public API) ===");
    println!(
        "  full-window byte-identity (windowed (0, eff-1) == recomputed): {} configs",
        val_stats.full_exact
    );
    println!(
        "  suffix-only identity (eff < 3; default-path vectors suffix of recomputed): {} configs",
        val_stats.suffix_only_exact
    );
    println!(
        "  mismatches (warnings printed above): {} configs",
        val_stats.mismatch
    );
    println!(
        "  max |API windowed Df − local OLS slope| over all rule windows: {:.3e}",
        val_stats.max_api_local_mismatch
    );
    println!();

    // ── Section 4: closing block ──
    let total = outcomes.len();
    let with_oracle: Vec<&ConfigOutcome> = outcomes
        .iter()
        .filter(|o| o.oracle_window.is_some())
        .collect();
    let oracle_total = with_oracle.len();
    let cloud_total = cloud_runs.len();

    println!("=== 4. Closing block ===");
    println!("Every statement below is generated from the measured numbers above.");
    println!("\"The window a human would pick\" is operationalized as the oracle window: the");
    println!("min |Δ| window over all >= 3-level windows. It uses the reference Df; the");
    println!("candidate rules never see it.");
    println!("Five rule families are measured: R1 plateau (tol 0.10/0.15/0.20), R2 best-R²,");
    println!("R3 elbow, R4 best-adjusted-R² and R5 coarse window (L8). The contract no longer");
    println!("promises ±0.20 (L7): the question is which family is an explicit, measured,");
    println!("non-degenerate criterion.");
    println!();

    // Oracle matches per rule.
    let mut best_rule = 0usize;
    let mut best_matches = 0usize;
    for i in 0..RULE_NAMES.len() {
        let matches = with_oracle
            .iter()
            .filter(|o| o.rules[i].window == o.oracle_window)
            .count();
        if matches > best_matches {
            best_matches = matches;
            best_rule = i;
        }
        println!(
            "  - {} matched the oracle window exactly on {} of {} configurations with an oracle.",
            RULE_NAMES[i], matches, oracle_total
        );
    }
    println!(
        "  - The rule that most often chose the window a human would pick: {} ({} of {}).",
        RULE_NAMES[best_rule], best_matches, oracle_total
    );
    println!();

    // Degenerate picks per rule.
    println!("  Degenerate picks:");
    for i in 0..RULE_NAMES.len() {
        let no_window = outcomes
            .iter()
            .filter(|o| o.rules[i].window.is_none())
            .count();
        let min_width = outcomes
            .iter()
            .filter(|o| matches!(o.rules[i].window, Some((s, e)) if e - s + 1 == 3))
            .count();
        let no_elbow = outcomes
            .iter()
            .filter(|o| o.rules[i].note.starts_with("no elbow"))
            .count();
        let no_plateau = outcomes
            .iter()
            .filter(|o| o.rules[i].note.starts_with("no run of"))
            .count();
        println!(
            "  - {}: no window on {}/{} configs; minimum-width pick on {}; no-elbow fallback on {}; no-plateau on {}.",
            RULE_NAMES[i],
            no_window,
            total,
            min_width,
            no_elbow,
            no_plateau
        );
    }
    println!();

    // Width distribution per rule: degeneracy evidence for the reoriented
    // contract — a rule whose chosen width never varies is fitting its own
    // structure, not the curve.
    println!("  Chosen window width distribution (all {total} configurations):");
    for i in 0..RULE_NAMES.len() {
        let mut widths: Vec<usize> = outcomes
            .iter()
            .filter_map(|o| o.rules[i].window.map(|(s, e)| e - s + 1))
            .collect();
        widths.sort_unstable();
        let mut parts: Vec<String> = Vec::new();
        let mut j = 0usize;
        while j < widths.len() {
            let w = widths[j];
            let mut c = 0usize;
            while j < widths.len() && widths[j] == w {
                c += 1;
                j += 1;
            }
            parts.push(format!("w{w} on {c}"));
        }
        let no_w = total - widths.len();
        let dist = if parts.is_empty() {
            "none".to_string()
        } else {
            parts.join(", ")
        };
        println!(
            "  - {}: no window on {no_w}/{total}; widths: {dist}",
            RULE_NAMES[i]
        );
    }
    println!();

    // Cloud error bands per rule + legacy.
    println!(
        "  Error bands on the {} engine-cloud runs (|Δ| vs the cloud's own Rg Df):",
        cloud_total
    );
    println!(
        "  {:<19} | {:>8} | {:>8} | {:>8} | {:>8}",
        "rule", "<=0.20", "<=0.35", "max|Δ|", "mean|Δ|"
    );
    let cloud_errs = |i: usize| -> Vec<f64> {
        cloud_runs
            .iter()
            .filter_map(|o| o.rules[i].err.map(|e| e.abs()))
            .collect()
    };
    let legacy_cloud_errs: Vec<f64> = cloud_runs.iter().map(|o| o.legacy_err.abs()).collect();
    let oracle_cloud_errs: Vec<f64> = cloud_runs.iter().filter_map(|o| o.oracle_abs_err).collect();
    let fmt_band = |name: &str, errs: &[f64]| {
        if errs.is_empty() {
            println!(
                "  {:<19} | {:>8} | {:>8} | {:>8} | {:>8}",
                name, "-", "-", "-", "-"
            );
        } else {
            println!(
                "  {:<19} | {:>4}/{:<3} | {:>4}/{:<3} | {:>8.3} | {:>8.3}",
                name,
                format!("{}", errs.iter().filter(|e| **e <= 0.20).count()),
                errs.len(),
                format!("{}", errs.iter().filter(|e| **e <= 0.35).count()),
                errs.len(),
                errs.iter().copied().fold(f64::MIN, f64::max),
                mean(errs)
            );
        }
    };
    fmt_band("LEGACY (ships today)", &legacy_cloud_errs);
    fmt_band("ORACLE min|\u{394}| (best)", &oracle_cloud_errs);
    for i in 0..RULE_NAMES.len() {
        fmt_band(RULE_NAMES[i], &cloud_errs(i));
    }
    println!();

    // Fractal-side max error per rule.
    println!(
        "  Deterministic fractal configs ({} configs): max |Δ| per rule:",
        total - cloud_total
    );
    for i in 0..RULE_NAMES.len() {
        let fractal_errs: Vec<f64> = outcomes
            .iter()
            .filter(|o| !o.cloud)
            .filter_map(|o| o.rules[i].err.map(|e| e.abs()))
            .collect();
        match fractal_errs.iter().copied().fold(f64::MIN, f64::max) {
            v if v > f64::MIN => println!("  - {}: max |Δ| = {v:.3}.", RULE_NAMES[i]),
            _ => println!("  - {}: no window on any fractal config.", RULE_NAMES[i]),
        }
    }
    println!();

    // N-dependency of the chosen width for EVERY rule: degeneracy evidence
    // for the reoriented contract. A criterion that adapts to the curve should
    // choose a wider window as N (and the effective sequence) grows; a width
    // that stays flat while the curve lengthens is fitting the rule's own
    // structure, not the data.
    let width_by_n = |i: usize| -> Vec<Option<f64>> {
        n_sizes
            .iter()
            .map(|&n| {
                let cell: Vec<Option<f64>> = cloud_runs
                    .iter()
                    .filter(|o| o.n_size == Some(n))
                    .map(|o| o.rules[i].window.map(|(s, e)| (e - s + 1) as f64))
                    .collect();
                mean_opt(&cell)
            })
            .collect()
    };
    let eff_by_n: Vec<Option<f64>> = n_sizes
        .iter()
        .map(|&n| {
            let cell: Vec<Option<f64>> = cloud_runs
                .iter()
                .filter(|o| o.n_size == Some(n))
                .map(|o| Some(o.eff_len as f64))
                .collect();
            mean_opt(&cell)
        })
        .collect();
    print!("  Mean effective levels on clouds at N=100/500/2000 =");
    for v in &eff_by_n {
        match v {
            Some(x) => print!(" {x:.1}"),
            None => print!(" n/a"),
        }
    }
    println!(";");
    println!("  Mean chosen window width vs N on clouds (both Df targets pooled):");
    println!(
        "  {:<19} | {:>7} | {:>7} | {:>7} | {:>7}",
        "rule", "N=100", "N=500", "N=2000", "grows?"
    );
    // grows? = yes (strictly increasing), weak (non-decreasing, some flat
    // step), flat (constant), no (decreases somewhere), n/a (a cell missing).
    let grows_label = |w: &[Option<f64>]| -> String {
        let vals: Vec<f64> = w.iter().filter_map(|x| *x).collect();
        if vals.len() < 3 {
            return "n/a".to_string();
        }
        if vals.windows(2).all(|p| p[1] > p[0] + 1e-9) {
            "yes".to_string()
        } else if vals.windows(2).all(|p| p[1] >= p[0] - 1e-9) {
            "weak".to_string()
        } else if vals.windows(2).all(|p| (p[1] - p[0]).abs() <= 1e-9) {
            "flat".to_string()
        } else {
            "no".to_string()
        }
    };
    let mut grows: Vec<String> = Vec::with_capacity(RULE_NAMES.len());
    for i in 0..RULE_NAMES.len() {
        let widths = width_by_n(i);
        let g = grows_label(&widths);
        grows.push(g.clone());
        print!("  {:<19}", RULE_NAMES[i]);
        for v in &widths {
            match v {
                Some(x) => print!(" | {x:>7.1}"),
                None => print!(" | {:>7}", "n/a"),
            }
        }
        println!(" | {g:>7}");
    }
    println!();

    // Reoriented-contract verdict (L7/L8): no ±0.20 is promised. S2 asks for
    // an explicit, auditable, measured criterion. "Degenerate" keeps the
    // meaning it has in L6/L8: a rule that RETREATS to the minimum 3-level
    // window by preference while wider windows are available in its search
    // space (R2's failure mode: a 3-point fit almost always has a high raw
    // R²). A width-3 pick forced by the curve (only 3 effective levels) or by
    // a fixed-window design (R5) is a constraint, not a preference, and is
    // not counted as a retreat. A rule that refuses on at least half the
    // configurations is reported as REFUSING. Everything else is reported
    // as defensible; the bands and width trends above are the numbers to
    // compare before locking anything for T2.
    println!("  Reoriented-contract verdict (five rule families: R1 tol 0.10/0.15/0.20, R2, R3,");
    println!("  R4, R5; no ±0.20 is promised — the criterion must be explicit and measured):");
    let r5_idx = RULE_NAMES
        .iter()
        .position(|n| n.starts_with("R5"))
        .unwrap_or(0);
    let mut defensible: Vec<usize> = Vec::new();
    for i in 0..RULE_NAMES.len() {
        let picks = outcomes
            .iter()
            .filter(|o| o.rules[i].window.is_some())
            .count();
        let no_window = total - picks;
        // Retreats: minimum-width picks on curves that HAD a wider window
        // in the rule's search space (>= 4 effective levels). R5's window is
        // fixed at the widest its design allows, so it cannot retreat by
        // construction.
        let retreats = if i == r5_idx {
            0
        } else {
            outcomes
                .iter()
                .filter(|o| {
                    matches!(o.rules[i].window, Some((s, e)) if e - s + 1 == 3 && o.eff_len >= 4)
                })
                .count()
        };
        let cloud_abs = cloud_errs(i);
        let band = if cloud_abs.is_empty() {
            "no window on any cloud run".to_string()
        } else {
            format!(
                "max |Δ| = {:.3}, mean |Δ| = {:.3} on {} cloud runs{}",
                cloud_abs.iter().copied().fold(f64::MIN, f64::max),
                mean(&cloud_abs),
                cloud_abs.len(),
                if no_window > 0 {
                    " (conditional on the runs where it picked)"
                } else {
                    ""
                }
            )
        };
        if picks == 0 {
            println!(
                "  - {}: never picks — no window on any of the {total} configs.",
                RULE_NAMES[i]
            );
            continue;
        }
        if retreats * 2 > picks {
            println!(
                "  - {}: DEGENERATE — retreats to the 3-level minimum on {} of its {} picks with wider windows available; {band}.",
                RULE_NAMES[i],
                retreats,
                picks
            );
            continue;
        }
        if no_window * 2 >= total {
            println!(
                "  - {}: REFUSES on {} of {total} configs — not a universal criterion; {band}.",
                RULE_NAMES[i], no_window
            );
            continue;
        }
        defensible.push(i);
        println!(
            "  - {}: defensible as the explicit criterion — picks on {picks}/{total} configs (refuses on {no_window}), minimum-width retreats {retreats}, width vs N: {}; {band}.",
            RULE_NAMES[i],
            grows[i]
        );
    }
    if defensible.is_empty() {
        println!("  - None of the five families is defensible: every one is degenerate or never");
        println!("  picks. A negative result, recorded as such; nothing is locked.");
    } else {
        let names: Vec<&str> = defensible.iter().map(|&i| RULE_NAMES[i]).collect();
        println!(
            "  - Defensible (non-degenerate, explicit, measured): {}. Compare the bands",
            names.join(", ")
        );
        println!("  and width trends above before locking one for T2; this diagnostic locks");
        println!("  nothing.");
    }
    if !oracle_cloud_errs.is_empty() {
        let over = oracle_cloud_errs.iter().filter(|&e| *e > 0.20).count();
        println!("  - Audit trail (the contract no longer promises ±0.20): even the oracle window");
        println!(
            "  exceeds |Δ| <= 0.20 on {} of {} cloud runs with a window (max |Δ| = {:.3}).",
            over,
            oracle_cloud_errs.len(),
            oracle_cloud_errs.iter().copied().fold(f64::MIN, f64::max)
        );
    }
    println!();
    if failed_configs > 0 {
        println!(
            "  NOTE: {failed_configs} configuration(s) were skipped or failed (reasons printed above)."
        );
    }
    println!("\nTotal runtime: {:.1} s", t0.elapsed().as_secs_f64());
}
