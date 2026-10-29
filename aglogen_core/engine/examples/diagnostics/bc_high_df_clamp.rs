//! Probe the high-Df ceiling behaviour.
//!
//! Goal: see whether BC actually CAN return Df > 2 on objects that
//! demonstrably have Df > 2. If the algorithm clamps at 2, we'll see it
//! across multiple distinct constructions.
//!
//! Tests:
//! - Menger sponge (Df = log20/log3 ≈ 2.7268): true fractal, known answer
//! - Filled cube (Df = 3): trivial control
//! - Hollow cube surface (Df = 2): trivial control
//! - 3D Sierpinski tetrahedron at increasing depth (Df = 2): control
//! - "Fat" random fractal: 3D fBm-like cloud with controlled Df > 2
//!
//! Run: `cargo run --release --example bc_high_df_clamp -p aglogen-engine`

use aglogen_engine::fractal::box_counting_3d::box_counting_3d_morton;
use aglogen_engine::fractal::fractals;
use rand::{Rng, SeedableRng};
use rand_pcg::Pcg64Mcg;

fn report(label: &str, n: usize, df_theo: f64, pts: &[[f64; 3]], prec: u32) {
    let r = box_counting_3d_morton(pts, prec);
    let d = r.dimension - df_theo;
    let s = if d >= 0.0 { "+" } else { "" };
    println!(
        "{:<32} N={:>7} theo={:.4} meas={:.4} Δ={}{:.4} R²={:.4} | log_scales={} linstart={}",
        label, n, df_theo, r.dimension, s, d, r.r_squared, r.log_scales.len(), r.linear_region_start
    );
}

// ---------------------------------------------------------------------------
// 3D fractional Brownian-like dense cloud (Df > 2 by construction)
// ---------------------------------------------------------------------------
//
// Place N points by mass-fractal construction: at each iteration, pick a
// random existing point and place a new one at uniformly random distance r
// where P(r) ~ r^{Df-1}. This produces a cluster whose mass-radius scaling
// gives Df by design. With Df = 2.5, BC should also measure ~2.5 (within
// finite-N noise) if BC is unbiased.

fn mass_fractal(n: usize, df: f64, seed: u64) -> Vec<[f64; 3]> {
    let mut rng = Pcg64Mcg::seed_from_u64(seed);
    let mut pts = Vec::with_capacity(n);
    pts.push([0.0, 0.0, 0.0]);
    for _ in 1..n {
        let parent = pts[rng.gen_range(0..pts.len())];
        // Sample r from P(r) ~ r^{Df-1} on [0, R_max]
        // Inverse CDF: r = R_max * u^{1/Df}
        let r = 1.0_f64 * rng.gen_range(0.0..1.0_f64).powf(1.0 / df);
        // Random direction on unit sphere
        let theta = rng.gen_range(0.0..std::f64::consts::TAU);
        let cos_phi = rng.gen_range(-1.0..1.0_f64);
        let sin_phi = (1.0 - cos_phi * cos_phi).sqrt();
        pts.push([
            parent[0] + r * sin_phi * theta.cos(),
            parent[1] + r * sin_phi * theta.sin(),
            parent[2] + r * cos_phi,
        ]);
    }
    pts
}

// Filled cube
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

// Hollow cube surface (only outer shell)
fn hollow_cube(n_per_side: usize) -> Vec<[f64; 3]> {
    let mut pts = Vec::new();
    let l = n_per_side - 1;
    for i in 0..n_per_side {
        for j in 0..n_per_side {
            for k in 0..n_per_side {
                let on_surface = i == 0 || i == l || j == 0 || j == l || k == 0 || k == l;
                if on_surface {
                    pts.push([i as f64, j as f64, k as f64]);
                }
            }
        }
    }
    pts
}

// Cantor "fat dust" — 3D Cantor with k slices kept out of 3 per axis.
// Df = log(k^3) / log(3) = 3 log(k) / log(3)
// k=2 → Df = 3*log2/log3 ≈ 1.893 (the classic "cantor dust")
// k=3 → Df = 3 (filled cube)
// We use deterministic cantor dust from existing module for the validated case.

fn main() {
    println!("HIGH-Df CEILING DIAGNOSIS");
    println!("=========================\n");

    // -----------------------------------------------------------------------
    // Battery 1: known constructions with Df = 2, 3, and the high-Df fractals
    // -----------------------------------------------------------------------

    println!("=== Battery 1: known geometries ===\n");

    // Filled cube — control, Df=3
    let pts = filled_cube(40);
    report("filled_cube_40^3", pts.len(), 3.0, &pts, 18);
    let pts = filled_cube(60);
    report("filled_cube_60^3", pts.len(), 3.0, &pts, 18);

    // Hollow cube — control, Df=2 surface
    let pts = hollow_cube(40);
    report("hollow_cube_40^3", pts.len(), 2.0, &pts, 18);
    let pts = hollow_cube(60);
    report("hollow_cube_60^3", pts.len(), 2.0, &pts, 18);

    // Menger sponge — true fractal Df=2.7268
    let df_menger = (20.0_f64).ln() / (3.0_f64).ln();
    for d in 3..=5 {
        let pts = fractals::menger_sponge(d);
        report(&format!("menger_sponge_d{}", d), pts.len(), df_menger, &pts, 18);
    }

    // Cantor dust 3D — true fractal Df = log8/log3 ≈ 1.893
    let df_cantor = (8.0_f64).ln() / (3.0_f64).ln();
    for d in 3..=6 {
        let pts = fractals::cantor_dust_3d(d);
        report(&format!("cantor_dust_d{}", d), pts.len(), df_cantor, &pts, 18);
    }

    // -----------------------------------------------------------------------
    // Battery 2: tunable mass-fractal sweep
    // -----------------------------------------------------------------------

    println!("\n=== Battery 2: mass-fractal construction (Df by design) ===\n");

    for &df_target in &[1.5_f64, 1.8, 2.0, 2.2, 2.5, 2.7, 2.9] {
        let mut samples = Vec::new();
        for seed in 0..5 {
            let pts = mass_fractal(10_000, df_target, seed);
            let r = box_counting_3d_morton(&pts, 18);
            samples.push(r.dimension);
        }
        let m = samples.iter().sum::<f64>() / 5.0;
        let s = (samples.iter().map(|v| (v - m).powi(2)).sum::<f64>() / 5.0).sqrt();
        let d = m - df_target;
        let sign = if d >= 0.0 { "+" } else { "" };
        let flag = if d.abs() > 0.30 { " ⚠" } else { "" };
        println!(
            "mass_fractal target={:.2}  N={:>5}  meas={:.4} ± {:.3}  Δ={}{:.3}{}",
            df_target, 10_000, m, s, sign, d, flag
        );
    }

    println!("\n=== Reading the table ===");
    println!("If menger_sponge measures < 2.4 on N>100k → algorithm CANNOT exceed 2.");
    println!("If mass_fractal stops growing past target=2.0 → confirms the ceiling.");
    println!("If filled_cube reads 3.0 but Menger reads ~2 → ceiling is structural,");
    println!("  not just a saturation-truncation artifact (since a filled cube reaches 3).");
}
