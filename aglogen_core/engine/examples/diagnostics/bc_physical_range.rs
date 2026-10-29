//! Test physically-constrained eps range vs full eps range.
//!
//! HYPOTHESIS:
//! The current BC algorithm scans eps from `~1/max_val` (sub-voxel) to
//! `~scale` (whole bounding box) — but only the middle region is the
//! "linear scaling regime" where Df = -d log N / d log eps holds.
//!
//! The robust regression tries to detect this region automatically, but with
//! few points and noisy boundaries it can include levels where:
//!   - eps << particle radius → counts plateau (sub-voxel oversampling)
//!   - eps ~ Rg → counts saturate (whole cluster in 1 box)
//!   - eps in (particle, Rg) → TRUE linear regime
//!
//! This variant restricts the regression to eps in [2*rp, Rg/2] in PHYSICAL
//! units, computed from the data itself: rp ≈ nearest-neighbour distance / 2,
//! Rg = sqrt(mean((p - mean(p))^2)).
//!
//! Run: `cargo run --release --example bc_physical_range -p aglogen-engine`

use aglogen_engine::fractal::box_counting_3d::{
    box_counting_3d_morton, count_unique_masked, morton_encode_3d,
};
use aglogen_engine::fractal::fractals;
use rand::{Rng, SeedableRng};
use rand_pcg::Pcg64Mcg;

const MAX_PRECISION: u32 = 21;

#[derive(Debug, Clone)]
struct BcResult {
    dimension: f64,
    r_squared: f64,
    n_levels_used: usize,
}

// ---------------------------------------------------------------------------
// Compute Rg and a rough rp from the point cloud
// ---------------------------------------------------------------------------

fn radius_of_gyration(points: &[[f64; 3]]) -> f64 {
    let n = points.len() as f64;
    let mut cx = 0.0;
    let mut cy = 0.0;
    let mut cz = 0.0;
    for p in points {
        cx += p[0];
        cy += p[1];
        cz += p[2];
    }
    cx /= n;
    cy /= n;
    cz /= n;
    let mut s = 0.0;
    for p in points {
        s += (p[0] - cx).powi(2) + (p[1] - cy).powi(2) + (p[2] - cz).powi(2);
    }
    (s / n).sqrt()
}

/// Estimate effective particle radius from minimum pairwise distance.
/// For real CC clusters where particles touch, this ≈ 2*rp.
/// Uses a sample of pairs to keep it O(k*N) instead of O(N²).
fn estimate_min_spacing(points: &[[f64; 3]]) -> f64 {
    let n = points.len();
    if n < 2 {
        return 1.0;
    }
    let mut rng = Pcg64Mcg::seed_from_u64(42);
    let sample = (50.min(n)).max(2);
    let mut min_d = f64::INFINITY;
    for _ in 0..sample {
        let i = rng.gen_range(0..n);
        // Find nearest neighbour of point i (full scan, single point only)
        let mut local_min = f64::INFINITY;
        for j in 0..n {
            if j == i {
                continue;
            }
            let d = ((points[i][0] - points[j][0]).powi(2)
                + (points[i][1] - points[j][1]).powi(2)
                + (points[i][2] - points[j][2]).powi(2))
            .sqrt();
            if d < local_min {
                local_min = d;
            }
        }
        if local_min < min_d {
            min_d = local_min;
        }
    }
    min_d
}

// ---------------------------------------------------------------------------
// BC with physically-constrained eps range
// ---------------------------------------------------------------------------

fn box_counting_3d_physical(
    points: &[[f64; 3]],
    precision: u32,
    eps_min_phys: f64,
    eps_max_phys: f64,
) -> BcResult {
    let n = points.len();
    if n < 2 {
        return BcResult {
            dimension: 0.0,
            r_squared: 0.0,
            n_levels_used: 0,
        };
    }
    let precision = precision.min(MAX_PRECISION);
    let max_val = (1u64 << precision) - 1;

    // Bounding box → uniform scale (same as current upstream)
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
    let scale = (mx[0] - mn[0]).max((mx[1] - mn[1]).max(mx[2] - mn[2])).max(1e-15);

    // Morton codes (uniform scale, same as upstream)
    let mut codes: Vec<u64> = points
        .iter()
        .map(|p| {
            let nx = ((((p[0] - mn[0]) / scale).clamp(0.0, 1.0)) * max_val as f64).round() as u64;
            let ny = ((((p[1] - mn[1]) / scale).clamp(0.0, 1.0)) * max_val as f64).round() as u64;
            let nz = ((((p[2] - mn[2]) / scale).clamp(0.0, 1.0)) * max_val as f64).round() as u64;
            morton_encode_3d(nx, ny, nz)
        })
        .collect();
    codes.sort_unstable();

    let mut log_scales = Vec::new();
    let mut log_counts = Vec::new();

    for level in 0..precision {
        let shift = 3 * level;
        let count = count_unique_masked(&codes, shift);
        if count == 0 || count >= codes.len() {
            continue;
        }
        // eps in PHYSICAL units: scale * 2^level / max_val
        let eps_phys = scale * (1u64 << level) as f64 / max_val as f64;
        if eps_phys < eps_min_phys || eps_phys > eps_max_phys {
            continue;
        }
        log_scales.push((1.0 / eps_phys).ln());
        log_counts.push((count as f64).ln());
    }

    let n_levels = log_scales.len();
    if n_levels < 3 {
        // Not enough levels in the physical range — fall back to all
        return BcResult {
            dimension: 0.0,
            r_squared: 0.0,
            n_levels_used: n_levels,
        };
    }

    let (slope, r2) = linreg(&log_scales, &log_counts);
    BcResult {
        dimension: slope,
        r_squared: r2,
        n_levels_used: n_levels,
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
// Data generators
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

fn report_one(label: &str, n: usize, df_theo: f64, pts: &[[f64; 3]], prec: u32) {
    let cur = box_counting_3d_morton(pts, prec);
    let rg = radius_of_gyration(pts);
    let min_d = estimate_min_spacing(pts);
    // Physical range: from 2× the minimum interparticle spacing
    // up to Rg (half-cluster scale, where saturation begins).
    let eps_min = 2.0 * min_d;
    let eps_max = rg;
    let phys = box_counting_3d_physical(pts, prec, eps_min, eps_max);

    let dc = cur.dimension - df_theo;
    let dp = phys.dimension - df_theo;
    let sc = if dc >= 0.0 { "+" } else { "" };
    let sp = if dp >= 0.0 { "+" } else { "" };
    println!(
        "{:<26} N={:>6} theo={:.4}  cur={:.4} (Δ{}{:.3} R²={:.3})  phys={:.4} (Δ{}{:.3} R²={:.3} L={})",
        label, n, df_theo, cur.dimension, sc, dc, cur.r_squared,
        phys.dimension, sp, dp, phys.r_squared, phys.n_levels_used
    );
}

fn report_seeded<F: Fn(u64) -> Vec<[f64; 3]>>(
    label: &str,
    df_theo: f64,
    gen: F,
    seeds: u64,
    prec: u32,
) {
    let mut cur_s = Vec::new();
    let mut phys_s = Vec::new();
    let mut levels_s = Vec::new();
    let mut n_used = 0;
    for s in 0..seeds {
        let pts = gen(s);
        n_used = pts.len();
        cur_s.push(box_counting_3d_morton(&pts, prec).dimension);
        let rg = radius_of_gyration(&pts);
        let md = estimate_min_spacing(&pts);
        let ph = box_counting_3d_physical(&pts, prec, 2.0 * md, rg);
        phys_s.push(ph.dimension);
        levels_s.push(ph.n_levels_used);
    }
    let cm = cur_s.iter().sum::<f64>() / seeds as f64;
    let pm = phys_s.iter().sum::<f64>() / seeds as f64;
    let cs = (cur_s.iter().map(|v| (v - cm).powi(2)).sum::<f64>() / seeds as f64).sqrt();
    let ps = (phys_s.iter().map(|v| (v - pm).powi(2)).sum::<f64>() / seeds as f64).sqrt();
    let mean_levels = levels_s.iter().sum::<usize>() as f64 / seeds as f64;
    let dc = cm - df_theo;
    let dp = pm - df_theo;
    let sc = if dc >= 0.0 { "+" } else { "" };
    let sp = if dp >= 0.0 { "+" } else { "" };
    println!(
        "{:<26} N={:>6} theo={:.4}  cur={:.4}±{:.3} (Δ{}{:.3})  phys={:.4}±{:.3} (Δ{}{:.3}) L̄={:.1}",
        label, n_used, df_theo, cm, cs, sc, dc, pm, ps, sp, dp, mean_levels
    );
}

fn main() {
    println!("BC: current full-range vs physically-constrained eps in [2*min_d, Rg]");
    println!("========================================================================\n");

    // Battery A
    println!("=== Battery A: Sierpinski 3D (Df theo = 1.5850) ===\n");
    let df_a = (3.0_f64).ln() / (2.0_f64).ln();
    for d in 4..=10 {
        let pts = fractals::sierpinski_triangle_3d(d);
        let prec = (d + 12).min(20);
        report_one(&format!("sierpinski_d{}", d), pts.len(), df_a, &pts, prec);
    }

    // Battery B
    println!("\n=== Battery B: Anisotropic filaments (Df theo = 1.0) ===\n");
    let n = 2000;
    for &(l, sigma) in &[(10.0, 1.0), (50.0, 1.0), (200.0, 1.0), (1000.0, 1.0)] {
        let aspect = l / sigma;
        report_seeded(
            &format!("filament a={:.0}", aspect),
            1.0,
            |s| anisotropic_filament(n, l, sigma, s),
            5,
            18,
        );
    }

    // Battery C
    println!("\n=== Battery C: 3D random walks (Df theo = 2.0) ===\n");
    for &n in &[100usize, 500, 2000, 8000, 32000] {
        report_seeded(
            &format!("rw3d N={}", n),
            2.0,
            |s| random_walk_3d(n, 1.0, s),
            5,
            18,
        );
    }

    // Battery D
    println!("\n=== Battery D: Dense isotropic controls (must not regress) ===\n");
    let pts = filled_plane(60);
    report_one("filled_plane_60x60", pts.len(), 2.0, &pts, 18);
    let pts = filled_plane(120);
    report_one("filled_plane_120x120", pts.len(), 2.0, &pts, 18);
    let pts = filled_cube(25);
    report_one("filled_cube_25^3", pts.len(), 3.0, &pts, 18);
    let pts = filled_cube(40);
    report_one("filled_cube_40^3", pts.len(), 3.0, &pts, 18);

    println!("\n=== Reading the table ===");
    println!("  L  = number of eps levels INSIDE the [2*min_d, Rg] physical window");
    println!("       (need >=3 for a valid regression; below that, phys returns 0)");
    println!("\nWin criteria:");
    println!("  - Battery B improves at aspect 10-50 (the realistic case)");
    println!("  - Battery C: rw3d converges faster towards Df=2");
    println!("  - Battery A: Sierpinski stays at least as good as current");
    println!("  - Battery D: dense controls unchanged");
}
