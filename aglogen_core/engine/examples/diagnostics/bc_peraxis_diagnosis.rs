//! Compare current isotropic-scale BC vs experimental per-axis-scale variant.
//!
//! HYPOTHESIS:
//! The current `box_counting_3d_morton` uses one global scale = max(dx, dy, dz)
//! and applies it to all 3 axes. Elongated clusters end up squashed into a
//! thin slab inside the [0,1]^3 normalized cube, which can either inflate or
//! deflate Df depending on aspect ratio.
//!
//! The variant here normalizes EACH axis to [0,1] independently. Geometrically
//! this turns the bounding box into a unit cube. Box-counting then measures
//! Df with cubic boxes of size eps in normalized space, which corresponds to
//! ANISOTROPIC physical boxes (dx_phys/n × dy_phys/n × dz_phys/n).
//!
//! NOTE on theory: anisotropic boxes are NOT the textbook box-counting (which
//! requires cubic boxes in physical space). But they ARE the standard practice
//! when normalizing — and the result is invariant under linear stretch, which
//! many practitioners argue is desirable for clusters whose axes are not
//! physically meaningful. We test empirically.
//!
//! Run: `cargo run --release --example bc_peraxis_diagnosis -p aglogen-engine`

use aglogen_engine::fractal::box_counting_3d::{
    box_counting_3d_morton, count_unique_masked, morton_encode_3d,
};
use aglogen_engine::fractal::fractals;
use rand::{Rng, SeedableRng};
use rand_pcg::Pcg64Mcg;

const MAX_PRECISION: u32 = 21;

// ---------------------------------------------------------------------------
// Experimental BC variant: per-axis normalization
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct BcResult {
    dimension: f64,
    r_squared: f64,
}

fn box_counting_3d_peraxis(points: &[[f64; 3]], precision: u32) -> BcResult {
    let n = points.len();
    if n < 2 {
        return BcResult {
            dimension: 0.0,
            r_squared: 0.0,
        };
    }
    let precision = precision.min(MAX_PRECISION);
    let max_val = (1u64 << precision) - 1;

    // Per-axis bounding box and scale
    let mut mn = [f64::INFINITY; 3];
    let mut mx = [f64::NEG_INFINITY; 3];
    for p in points {
        for k in 0..3 {
            if p[k] < mn[k] {
                mn[k] = p[k];
            }
            if p[k] > mx[k] {
                mx[k] = p[k];
            }
        }
    }
    let mut scl = [1.0; 3];
    for k in 0..3 {
        let r = mx[k] - mn[k];
        scl[k] = if r < 1e-15 { 1.0 } else { r };
    }

    // Morton codes with per-axis normalization
    let mut codes: Vec<u64> = points
        .iter()
        .map(|p| {
            let nx = ((((p[0] - mn[0]) / scl[0]).clamp(0.0, 1.0)) * max_val as f64).round() as u64;
            let ny = ((((p[1] - mn[1]) / scl[1]).clamp(0.0, 1.0)) * max_val as f64).round() as u64;
            let nz = ((((p[2] - mn[2]) / scl[2]).clamp(0.0, 1.0)) * max_val as f64).round() as u64;
            morton_encode_3d(nx, ny, nz)
        })
        .collect();
    codes.sort_unstable();

    let mut log_scales = Vec::new();
    let mut log_counts = Vec::new();
    for level in 0..precision {
        let shift = 3 * level;
        let count = count_unique_masked(&codes, shift);
        if count > 0 && count < codes.len() {
            // eps "size" in normalized units (same as upstream)
            let eps_norm = (1u64 << level) as f64 / max_val as f64;
            log_scales.push((1.0 / eps_norm).ln());
            log_counts.push((count as f64).ln());
        }
    }

    // Same saturation truncation as upstream
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

    let (slope, r2) = linreg(&log_scales, &log_counts);
    BcResult {
        dimension: slope,
        r_squared: r2,
    }
}

fn linreg(x: &[f64], y: &[f64]) -> (f64, f64) {
    let n = x.len() as f64;
    if n < 2.0 {
        return (0.0, 0.0);
    }
    let sx: f64 = x.iter().sum();
    let sy: f64 = y.iter().sum();
    let sxx: f64 = x.iter().map(|v| v * v).sum();
    let sxy: f64 = x.iter().zip(y).map(|(a, b)| a * b).sum();
    let denom = n * sxx - sx * sx;
    if denom.abs() < 1e-15 {
        return (0.0, 0.0);
    }
    let slope = (n * sxy - sx * sy) / denom;
    let intercept = (sy - slope * sx) / n;
    let mean_y = sy / n;
    let mut ss_res = 0.0;
    let mut ss_tot = 0.0;
    for (xi, yi) in x.iter().zip(y) {
        let pred = intercept + slope * xi;
        ss_res += (yi - pred).powi(2);
        ss_tot += (yi - mean_y).powi(2);
    }
    let r2 = if ss_tot > 1e-15 {
        1.0 - ss_res / ss_tot
    } else {
        0.0
    };
    (slope, r2)
}

// ---------------------------------------------------------------------------
// Data generators (same as the previous diagnostic)
// ---------------------------------------------------------------------------

fn anisotropic_filament(n: usize, length: f64, sigma: f64, seed: u64) -> Vec<[f64; 3]> {
    let mut rng = Pcg64Mcg::seed_from_u64(seed);
    (0..n)
        .map(|_| {
            let x = rng.gen_range(0.0..length);
            let y = sigma * (0..12).map(|_| rng.gen_range(-0.5..0.5)).sum::<f64>();
            let z = sigma * (0..12).map(|_| rng.gen_range(-0.5..0.5)).sum::<f64>();
            [x, y, z]
        })
        .collect()
}

fn random_walk_3d(n: usize, step: f64, seed: u64) -> Vec<[f64; 3]> {
    let mut rng = Pcg64Mcg::seed_from_u64(seed);
    let mut pts = Vec::with_capacity(n);
    let mut x = 0.0f64;
    let mut y = 0.0f64;
    let mut z = 0.0f64;
    pts.push([x, y, z]);
    for _ in 1..n {
        let theta = rng.gen_range(0.0..std::f64::consts::TAU);
        let cos_phi = rng.gen_range(-1.0..1.0_f64);
        let sin_phi = (1.0 - cos_phi * cos_phi).sqrt();
        x += step * sin_phi * theta.cos();
        y += step * sin_phi * theta.sin();
        z += step * cos_phi;
        pts.push([x, y, z]);
    }
    pts
}

// Filled cube — controls that we don't break dense, isotropic objects
fn filled_cube(n_per_side: usize) -> Vec<[f64; 3]> {
    let mut pts = Vec::with_capacity(n_per_side.pow(3));
    for i in 0..n_per_side {
        for j in 0..n_per_side {
            for k in 0..n_per_side {
                pts.push([i as f64, j as f64, k as f64]);
            }
        }
    }
    pts
}

// Filled square plane — Df=2, isotropic
fn filled_plane(n_per_side: usize) -> Vec<[f64; 3]> {
    let mut pts = Vec::with_capacity(n_per_side * n_per_side);
    for i in 0..n_per_side {
        for j in 0..n_per_side {
            pts.push([i as f64, j as f64, 0.0]);
        }
    }
    pts
}

// ---------------------------------------------------------------------------
// Comparison harness
// ---------------------------------------------------------------------------

fn compare(label: &str, n: usize, df_theo: f64, pts: &[[f64; 3]], prec: u32) {
    let cur = box_counting_3d_morton(pts, prec);
    let var = box_counting_3d_peraxis(pts, prec);
    let dc = cur.dimension - df_theo;
    let dv = var.dimension - df_theo;
    let sc = if dc >= 0.0 { "+" } else { "" };
    let sv = if dv >= 0.0 { "+" } else { "" };
    println!(
        "{:<26} N={:>6} theo={:.4}  cur={:.4} (Δ{}{:.3} R²={:.3})  peraxis={:.4} (Δ{}{:.3} R²={:.3})",
        label, n, df_theo, cur.dimension, sc, dc, cur.r_squared, var.dimension, sv, dv, var.r_squared
    );
}

fn compare_seeded<F: Fn(u64) -> Vec<[f64; 3]>>(
    label: &str,
    df_theo: f64,
    gen: F,
    seeds: u64,
    prec: u32,
) {
    let mut cur_samples = Vec::new();
    let mut var_samples = Vec::new();
    let mut n_used = 0;
    for s in 0..seeds {
        let pts = gen(s);
        n_used = pts.len();
        cur_samples.push(box_counting_3d_morton(&pts, prec).dimension);
        var_samples.push(box_counting_3d_peraxis(&pts, prec).dimension);
    }
    let cur_mean: f64 = cur_samples.iter().sum::<f64>() / seeds as f64;
    let var_mean: f64 = var_samples.iter().sum::<f64>() / seeds as f64;
    let cur_std = (cur_samples.iter().map(|v| (v - cur_mean).powi(2)).sum::<f64>() / seeds as f64).sqrt();
    let var_std = (var_samples.iter().map(|v| (v - var_mean).powi(2)).sum::<f64>() / seeds as f64).sqrt();
    let dc = cur_mean - df_theo;
    let dv = var_mean - df_theo;
    let sc = if dc >= 0.0 { "+" } else { "" };
    let sv = if dv >= 0.0 { "+" } else { "" };
    println!(
        "{:<26} N={:>6} theo={:.4}  cur={:.4}±{:.3} (Δ{}{:.3})  peraxis={:.4}±{:.3} (Δ{}{:.3})",
        label, n_used, df_theo, cur_mean, cur_std, sc, dc, var_mean, var_std, sv, dv
    );
}

fn main() {
    println!("BOX-COUNTING: current isotropic-scale vs per-axis-scale variant");
    println!("===============================================================\n");

    // -----------------------------------------------------------------------
    // Battery A: Sierpinski 3D (Df=1.585) — non-anisotropic reference
    // -----------------------------------------------------------------------
    println!("=== Battery A: Sierpinski 3D (Df theo = 1.5850, isotropic) ===");
    println!("Sanity check: per-axis variant must not damage a balanced fractal.\n");
    let df_a = (3.0_f64).ln() / (2.0_f64).ln();
    for d in 4..=10 {
        let pts = fractals::sierpinski_triangle_3d(d);
        let prec = (d + 12).min(20);
        compare(&format!("sierpinski_d{}", d), pts.len(), df_a, &pts, prec);
    }

    // -----------------------------------------------------------------------
    // Battery B: anisotropic filaments (Df=1.0)
    // -----------------------------------------------------------------------
    println!("\n=== Battery B: Anisotropic filaments (Df theo = 1.0) ===");
    println!("This is where per-axis should help if the hypothesis holds.\n");
    let n = 2000;
    for &(l, sigma) in &[(10.0, 1.0), (50.0, 1.0), (200.0, 1.0), (1000.0, 1.0)] {
        let aspect = l / sigma;
        compare_seeded(
            &format!("filament a={:.0}", aspect),
            1.0,
            |s| anisotropic_filament(n, l, sigma, s),
            5,
            18,
        );
    }

    // -----------------------------------------------------------------------
    // Battery C: 3D random walks (Df=2.0)
    // -----------------------------------------------------------------------
    println!("\n=== Battery C: 3D random walks (Df theo = 2.0) ===");
    println!("Proxy for CC tunable behaviour at small/medium N.\n");
    for &n in &[100usize, 500, 2000, 8000, 32000] {
        compare_seeded(
            &format!("rw3d N={}", n),
            2.0,
            |s| random_walk_3d(n, 1.0, s),
            5,
            18,
        );
    }

    // -----------------------------------------------------------------------
    // Battery D: control — dense isotropic shapes (Df=2 plane, Df=3 cube)
    // -----------------------------------------------------------------------
    println!("\n=== Battery D: Dense isotropic controls (must not regress) ===\n");
    let pts = filled_plane(60);
    compare("filled_plane_60x60", pts.len(), 2.0, &pts, 18);
    let pts = filled_plane(120);
    compare("filled_plane_120x120", pts.len(), 2.0, &pts, 18);
    let pts = filled_cube(25);
    compare("filled_cube_25^3", pts.len(), 3.0, &pts, 18);
    let pts = filled_cube(40);
    compare("filled_cube_40^3", pts.len(), 3.0, &pts, 18);

    println!("\n=== Reading the table ===");
    println!("  cur     = current isotropic-scale BC (production code)");
    println!("  peraxis = experimental per-axis-scale BC (this variant)");
    println!("  Δ       = signed error vs theoretical Df");
    println!("\nA win for per-axis would look like:");
    println!("  - Battery B improves (smaller |Δ| at moderate aspect 10–50)");
    println!("  - Battery A unchanged (isotropic fractals don't care about normalization)");
    println!("  - Battery D unchanged (dense isotropic must NOT regress)");
}
