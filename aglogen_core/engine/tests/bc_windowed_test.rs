//! Tests for the windowed box-counting estimator (SDD change
//! `cc-tunable-bc-alignment`, R29.1–R29.4, design D1/D3/D5).
//!
//! Semantics (design Log L2): `fit_window = (s, e)` is an inclusive range of
//! indices into the EFFECTIVE level sequence — the count-valid levels
//! (`0 < count < N`) ordered finest-first — exactly the semantics validated
//! by the Phase 0 diagnostic (`bc_window_alignment_audit`). NOT raw Morton
//! level indices.
//!
//! Byte-identity (R29.1): the default path's outputs for fixed coordinate
//! fixtures are recorded as full-precision f64 literals captured from the
//! PRE-refactor implementation (commit 8e2e81b, before the `morton_core`
//! extraction and D5 dead-variable cleanup). Any change to these values
//! after the refactor is a non-regression failure.

use aglogen_engine::fractal::box_counting_3d::{
    box_counting_3d_morton, box_counting_3d_windowed, compute_scale, count_unique_masked,
    find_bounding_box, generate_sphere_points, morton_encode_3d, normalize_coord, BoxCountingError,
};

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/// Deterministic pseudo-random coordinates in [0, 1)^3 (no external deps).
fn lcg_cloud(n: usize, seed: u64) -> Vec<[f64; 3]> {
    let mut state = seed;
    let mut next = || {
        // xorshift64*
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        state.wrapping_mul(0x2545_F491_4F6C_DD1D)
    };
    (0..n)
        .map(|_| {
            [
                (next() >> 11) as f64 / (1u64 << 53) as f64,
                (next() >> 11) as f64 / (1u64 << 53) as f64,
                (next() >> 11) as f64 / (1u64 << 53) as f64,
            ]
        })
        .collect()
}

/// 32 points on a line, precision 5: exact per-level counts are hand-derived.
///
/// Normalized x = i (max_val = 31), Morton codes = expand_bits(x).
/// Effective (count-valid) levels, finest-first:
///   level 1 → 16 boxes, level 2 → 8, level 3 → 4, level 4 → 2
/// (level 0 has 32 = N boxes and is filtered). With box_size = 2^level this
/// gives x = ln(1/2^L) = -L·ln2 and y = ln(2^(5-L)) = (5-L)·ln2, i.e. exactly
/// collinear points y = x + 5·ln2 → slope 1.0, R² 1.0 on ANY sub-window of
/// ≥ 3 levels.
fn line32_p5() -> Vec<[f64; 3]> {
    (0..32).map(|i| [i as f64, 0.0, 0.0]).collect()
}

fn fixtures() -> Vec<(&'static str, u32, Vec<[f64; 3]>)> {
    let mut fx = Vec::new();
    fx.push(("line32_p5", 5, line32_p5()));
    fx.push((
        "line_500_p18",
        18,
        (0..500).map(|i| [i as f64, 0.0, 0.0]).collect(),
    ));
    // Plane grid.
    let mut plane = Vec::new();
    for i in 0..40 {
        for j in 0..40 {
            plane.push([i as f64, j as f64, 0.0]);
        }
    }
    fx.push(("plane_40x40_p18", 18, plane));
    // Filled cube.
    let mut cube = Vec::new();
    for i in 0..20 {
        for j in 0..20 {
            for k in 0..20 {
                cube.push([i as f64, j as f64, k as f64]);
            }
        }
    }
    fx.push(("cube_20_p18", 18, cube));
    // Sphere surface.
    fx.push((
        "sphere_500_p18",
        18,
        generate_sphere_points(0.5, 0.5, 0.5, 1.0, 500),
    ));
    // Random clouds (legacy saturation/robust-fit branches get exercised).
    fx.push(("cloud_lcg1_800_p18", 18, lcg_cloud(800, 1)));
    fx.push(("cloud_lcg42_1500_p16", 16, lcg_cloud(1500, 42)));
    fx
}

// ─────────────────────────────────────────────────────────────────────────────
// Byte-identity of the default path (R29.1 / D5)
// ─────────────────────────────────────────────────────────────────────────────

/// Pre-refactor baseline captured at commit 8e2e81b via
/// `capture_legacy_baseline --ignored --nocapture` (release profile).
/// Exact f64 equality required — this is the R29.1/D5 drift guard.
/// Only fixtures that existed at capture time are listed; fixtures added
/// afterwards are guarded by `default_path_byte_identity_vs_prerefactor_replica`.
#[test]
fn default_path_byte_identity_against_prerefactor_baseline() {
    let expected: &[(&str, f64, f64, f64, usize)] = &[
        (
            "line_500_p18",
            9.999999999999997e-1,
            1e0,
            2.1850980010409252e-16,
            0,
        ),
        ("plane_40x40_p18", 2e0, 1e0, 1.30779339380907e-16, 0),
        (
            "cube_20_p18",
            2.999999999999999e0,
            1e0,
            8.353514307424049e-16,
            0,
        ),
        (
            "sphere_500_p18",
            1.9868180375173075e0,
            9.645889241707086e-1,
            2.691792145393338e-1,
            0,
        ),
        (
            "cloud_lcg1_800_p18",
            2.212661098016797e0,
            9.505932710242208e-1,
            3.566938205841552e-1,
            1,
        ),
        (
            "cloud_lcg42_1500_p16",
            2.470489016238771e0,
            9.765779910742626e-1,
            2.705369156370753e-1,
            3,
        ),
    ];
    for (name, dimension, r_squared, std_error, linear_region_start) in expected {
        let (_, precision, points) = fixtures()
            .into_iter()
            .find(|(n, _, _)| n == name)
            .unwrap_or_else(|| panic!("fixture {name} missing"));
        let r = box_counting_3d_morton(&points, precision);
        assert_eq!(r.dimension, *dimension, "{name}: dimension drifted");
        assert_eq!(r.r_squared, *r_squared, "{name}: r_squared drifted");
        assert_eq!(r.std_error, *std_error, "{name}: std_error drifted");
        assert_eq!(
            r.linear_region_start, *linear_region_start,
            "{name}: linear_region_start drifted"
        );
    }
}

#[test]
#[ignore = "capture helper: run with --ignored --nocapture to record baseline values"]
fn capture_legacy_baseline() {
    for (name, precision, points) in fixtures() {
        let r = box_counting_3d_morton(&points, precision);
        println!(
            "{name}: dimension={:e}, r_squared={:e}, std_error={:e}, linear_region_start={}",
            r.dimension, r.r_squared, r.std_error, r.linear_region_start
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Byte-identity of the default path (R29.1 / D5)
// ─────────────────────────────────────────────────────────────────────────────

/// Verbatim read-only replica of the PRE-refactor Step 4b + Step 5 (copied
/// from commit 8e2e81b, dead variables included). This is the oracle the
/// Phase 0 diagnostic validated 45/45 byte-identical against the public API;
/// it is reproduced here so the guard covers fixtures added after the
/// pre-refactor capture as well. Do not modernize this code.
#[allow(clippy::needless_range_loop)]
fn legacy_replica_prerefactor(
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
        let r_squared = if ss_tot > 1e-15 {
            1.0 - ss_res / ss_tot
        } else {
            0.0
        };
        let mse = ss_res / (n - 2.0).max(1.0);
        let std_error = (mse / (sum_xx - sum_x * sum_x / n).abs().max(1e-15)).sqrt();
        (slope, intercept, r_squared, std_error)
    }

    // linear_regression_robust (verbatim, dead variables included).
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

/// Public API vs the verbatim pre-refactor replica, on every fixture
/// (dimension, r_squared, std_error, linear_region_start — exact equality).
#[test]
fn default_path_byte_identity_vs_prerefactor_replica() {
    for (name, precision, points) in fixtures() {
        let levels = effective_levels(&points, precision);
        let (log_scales, log_counts): (Vec<f64>, Vec<f64>) = levels.iter().copied().unzip();
        let (rep_start, rep_df, rep_r2, rep_se) =
            legacy_replica_prerefactor(log_scales, log_counts);
        let r = box_counting_3d_morton(&points, precision);
        assert_eq!(
            r.dimension, rep_df,
            "{name}: dimension vs pre-refactor replica"
        );
        assert_eq!(
            r.r_squared, rep_r2,
            "{name}: r_squared vs pre-refactor replica"
        );
        assert_eq!(
            r.std_error, rep_se,
            "{name}: std_error vs pre-refactor replica"
        );
        assert_eq!(
            r.linear_region_start, rep_start,
            "{name}: linear_region_start vs pre-refactor replica"
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Independent recomputation of the effective level sequence (same public
// helpers the Phase 0 diagnostic validated byte-identical against the
// pre-refactor estimator).
// ─────────────────────────────────────────────────────────────────────────────

/// (log(1/box_size), log(count)) per effective level, finest-first.
fn effective_levels(points: &[[f64; 3]], precision: u32) -> Vec<(f64, f64)> {
    let (min_coords, max_coords) = find_bounding_box(points);
    let scale = compute_scale(&min_coords, &max_coords);
    let max_val = (1u64 << precision) - 1;
    let mut sorted_codes: Vec<u64> = points
        .iter()
        .map(|p| {
            morton_encode_3d(
                normalize_coord(p[0], min_coords[0], scale, max_val),
                normalize_coord(p[1], min_coords[1], scale, max_val),
                normalize_coord(p[2], min_coords[2], scale, max_val),
            )
        })
        .collect();
    sorted_codes.sort_unstable();
    let mut levels = Vec::new();
    for level in 0..precision {
        let shift = 3 * level;
        let count = count_unique_masked(&sorted_codes, shift);
        if count > 0 && count < sorted_codes.len() {
            let box_size = scale * (1u64 << level) as f64 / max_val as f64;
            levels.push(((1.0 / box_size).ln(), (count as f64).ln()));
        }
    }
    levels
}

/// Plain OLS (diagnostic-style), independent of the estimator internals.
fn ols(x: &[f64], y: &[f64]) -> (f64, f64) {
    let n = x.len() as f64;
    let sx: f64 = x.iter().sum();
    let sy: f64 = y.iter().sum();
    let sxx: f64 = x.iter().map(|v| v * v).sum();
    let sxy: f64 = x.iter().zip(y).map(|(a, b)| a * b).sum();
    let slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    let intercept = (sy - slope * sx) / n;
    let mean_y = sy / n;
    let ss_tot: f64 = y.iter().map(|v| (v - mean_y).powi(2)).sum();
    let ss_res: f64 = x
        .iter()
        .zip(y)
        .map(|(a, b)| (b - (intercept + slope * a)).powi(2))
        .sum();
    (slope, 1.0 - ss_res / ss_tot)
}

// ─────────────────────────────────────────────────────────────────────────────
// Windowed path semantics (R29.2)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn windowed_hand_computed_line32_full_window() {
    let points = line32_p5();
    // Effective sequence: counts [16, 8, 4, 2] → exact line, slope 1.
    let r = box_counting_3d_windowed(&points, 5, (0, 3)).expect("window (0,3) is valid");
    assert!(
        (r.dimension - 1.0).abs() < 1e-12,
        "hand-computed slope must be 1.0, got {}",
        r.dimension
    );
    assert!(
        (r.r_squared - 1.0).abs() < 1e-12,
        "hand-computed R² must be 1.0, got {}",
        r.r_squared
    );
    assert_eq!(r.linear_region_start, 0, "start must report s");
}

#[test]
fn windowed_hand_computed_line32_subwindow() {
    let points = line32_p5();
    // Window (1, 3) → effective levels 1..=3, counts [8, 4, 2] — same line.
    let r = box_counting_3d_windowed(&points, 5, (1, 3)).expect("window (1,3) is valid");
    assert!((r.dimension - 1.0).abs() < 1e-12);
    assert!((r.r_squared - 1.0).abs() < 1e-12);
    assert_eq!(r.linear_region_start, 1);
}

#[test]
fn windowed_matches_independent_ols_on_cloud() {
    let points = lcg_cloud(800, 1);
    let precision = 18;
    let levels = effective_levels(&points, precision);
    assert!(
        levels.len() >= 4,
        "fixture must have enough effective levels"
    );
    // Window (1, last): the diagnostic-locked (s*, e*) shape (Log L2).
    let s = 1;
    let e = levels.len() - 1;
    let r = box_counting_3d_windowed(&points, precision, (s, e)).expect("window valid");
    let (slope, r2) = ols(
        &levels[s..=e].iter().map(|(x, _)| *x).collect::<Vec<_>>(),
        &levels[s..=e].iter().map(|(_, y)| *y).collect::<Vec<_>>(),
    );
    assert!(
        (r.dimension - slope).abs() < 1e-12,
        "windowed slope {} vs independent OLS {}",
        r.dimension,
        slope
    );
    assert!(
        (r.r_squared - r2).abs() < 1e-12,
        "windowed R² {} vs independent OLS {}",
        r.r_squared,
        r2
    );
    assert_eq!(r.linear_region_start, s);
    // log_scales/log_counts carry the full effective (count-valid) sequence.
    assert_eq!(r.log_scales.len(), levels.len());
    assert_eq!(r.log_counts.len(), levels.len());
}

#[test]
fn windowed_validation_errors() {
    let points = line32_p5(); // exactly 4 effective levels

    // start > end → empty window error, never a panic.
    assert!(matches!(
        box_counting_3d_windowed(&points, 5, (2, 1)),
        Err(BoxCountingError::EmptyWindow { start: 2, end: 1 })
    ));

    // end beyond the effective sequence → out of range.
    assert!(matches!(
        box_counting_3d_windowed(&points, 5, (0, 6)),
        Err(BoxCountingError::WindowOutOfRange {
            start: 0,
            end: 6,
            num_levels: 4
        })
    ));
    assert!(matches!(
        box_counting_3d_windowed(&points, 5, (4, 4)),
        Err(BoxCountingError::WindowOutOfRange {
            start: 4,
            end: 4,
            num_levels: 4
        })
    ));

    // Fewer than 3 count-valid levels inside the window (Log L2: happens at
    // small N / high Df) → error, never a panic.
    assert!(matches!(
        box_counting_3d_windowed(&points, 5, (0, 1)),
        Err(BoxCountingError::InsufficientLevels { have: 2, need: 3 })
    ));
}

#[test]
fn windowed_error_display_is_informative() {
    let e = BoxCountingError::InsufficientLevels { have: 2, need: 3 };
    let msg = e.to_string();
    assert!(msg.contains("2") && msg.contains("3"), "got: {msg}");
}

#[test]
fn windowed_degenerate_flat_counts_no_panic() {
    // All points identical → every level counts 1 box → constant log_counts.
    let points = vec![[1.5, 2.5, 3.5]; 8];
    let r = box_counting_3d_windowed(&points, 18, (4, 10)).expect("window valid");
    assert_eq!(r.linear_region_start, 4);
    // Flat y → R² defined as 0 by the shared OLS convention, slope 0.
    assert!((r.r_squared - 0.0).abs() < 1e-15 || r.r_squared == 0.0);
}

#[test]
fn windowed_degenerate_tiny_input_errors_not_panics() {
    // Fewer than 2 points → no count-valid levels at all → validation error.
    let one = vec![[1.0, 2.0, 3.0]];
    assert!(box_counting_3d_windowed(&one, 18, (0, 0)).is_err());
}

#[test]
fn default_path_untouched_by_windowed_addition() {
    // R29.3 engine side: the 2-arg function must still exist and delegate.
    let points = line32_p5();
    let r = box_counting_3d_morton(&points, 5);
    assert_eq!(r.linear_region_start, 0);
    assert!(r.dimension > 0.9 && r.dimension < 1.1);
}
