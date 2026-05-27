//! Experimental diagnostic to characterize box-counting bias in 3D.
//!
//! Three independent batteries:
//!
//! A) **Sierpinski 3D** (Df = log(3)/log(2) ≈ 1.5850, PERFECT fractal): scan
//!    depth 4..=10 → N grows from 81 to 59049. Tests whether bias is purely
//!    a finite-N effect.
//!
//! B) **Synthetic anisotropic clusters** (filaments along x with thin
//!    transverse spread): tests whether the isotropic `compute_scale`
//!    (max(dx, dy, dz) used for ALL axes) inflates Df for elongated
//!    geometries — the bounding-box anisotropy hypothesis.
//!
//! C) **3D random-walk clusters** (loose proxy for CC tunable Df ≈ 1.5): N
//!    sweep at 100, 500, 2000, 8000. Each replicated with 5 RNG seeds.
//!
//! Run: `cargo run --release --example bc_bias_diagnosis -p aglogen-engine`

use aglogen_engine::fractal::box_counting_3d::box_counting_3d_morton;
use aglogen_engine::fractal::fractals;
use rand::{Rng, SeedableRng};
use rand_pcg::Pcg64Mcg;

fn fmt_row(label: &str, n: usize, df_theo: f64, df_meas: f64, r2: f64) {
    let delta = df_meas - df_theo;
    let sign = if delta >= 0.0 { "+" } else { "" };
    println!(
        "{:<28} N={:>6} theo={:.4} meas={:.4} delta={}{:.4} R²={:.4}",
        label, n, df_theo, df_meas, sign, delta, r2
    );
}

// ---------------------------------------------------------------------------
// A) Sierpinski 3D — perfect Df=1.585 fractal, depth sweep
// ---------------------------------------------------------------------------

fn battery_a_sierpinski() {
    println!("\n=== Battery A: Sierpinski 3D (Df theo = 1.5850) ===");
    println!("Tests pure finite-N convergence on a known fractal.\n");
    let df_theo = (3.0_f64).ln() / (2.0_f64).ln();
    for depth in 4..=10 {
        let pts = fractals::sierpinski_triangle_3d(depth);
        let n = pts.len();
        // precision scales with depth — give it room
        let precision = (depth + 12).min(20);
        let r = box_counting_3d_morton(&pts, precision);
        fmt_row(
            &format!("sierpinski_d{}", depth),
            n,
            df_theo,
            r.dimension,
            r.r_squared,
        );
    }
}

// ---------------------------------------------------------------------------
// B) Synthetic anisotropic linear cluster
// ---------------------------------------------------------------------------
//
// Generate a "filament" along x: N points where x ~ uniform(0, L),
// y ~ Normal(0, σ), z ~ Normal(0, σ). For σ << L this is essentially 1D.
// Theoretical Df → 1 for σ → 0 with N → ∞.

fn anisotropic_filament(n: usize, length: f64, sigma: f64, seed: u64) -> Vec<[f64; 3]> {
    let mut rng = Pcg64Mcg::seed_from_u64(seed);
    (0..n)
        .map(|_| {
            let x = rng.gen_range(0.0..length);
            // Two-pass Box-Muller approximation via central limit
            let y = sigma * (0..12).map(|_| rng.gen_range(-0.5..0.5)).sum::<f64>();
            let z = sigma * (0..12).map(|_| rng.gen_range(-0.5..0.5)).sum::<f64>();
            [x, y, z]
        })
        .collect()
}

fn battery_b_anisotropy() {
    println!("\n=== Battery B: Anisotropic filaments (true Df → 1.0) ===");
    println!("Tests the isotropic-bounding-box hypothesis: as length/sigma grows,");
    println!("the cluster gets more elongated, so if `compute_scale = max(dx,dy,dz)`");
    println!("biases Df upward, the bias should INCREASE with aspect ratio.\n");

    let n = 2000; // fixed N to isolate anisotropy effect
    for &(length, sigma) in &[
        (10.0, 1.0),   // aspect 10:1
        (50.0, 1.0),   // aspect 50:1
        (200.0, 1.0),  // aspect 200:1
        (1000.0, 1.0), // aspect 1000:1
    ] {
        let mut samples = Vec::new();
        for seed in 0..5 {
            let pts = anisotropic_filament(n, length, sigma, seed);
            let r = box_counting_3d_morton(&pts, 18);
            samples.push((r.dimension, r.r_squared));
        }
        let mean_df = samples.iter().map(|s| s.0).sum::<f64>() / 5.0;
        let mean_r2 = samples.iter().map(|s| s.1).sum::<f64>() / 5.0;
        let std_df = (samples
            .iter()
            .map(|s| (s.0 - mean_df).powi(2))
            .sum::<f64>()
            / 5.0)
            .sqrt();
        println!(
            "filament L={:>6.0} σ={:.1} aspect={:>5.0}  N={}  meas_Df={:.4} ± {:.4}  R²={:.4}",
            length,
            sigma,
            length / sigma,
            n,
            mean_df,
            std_df,
            mean_r2
        );
    }
}

// ---------------------------------------------------------------------------
// C) Random walk in 3D (loose CC-tunable surrogate, theoretical Df ≈ 2)
// ---------------------------------------------------------------------------
//
// A 3D self-avoiding random walk does NOT have Df=1.5 in the wild; a Brownian
// walk has Df=2. But for this experiment we only need to see how BC scales
// with N for a non-pathological 3D structure. The interesting quantity is
// whether the measured Df converges as N grows.

fn random_walk_3d(n: usize, step: f64, seed: u64) -> Vec<[f64; 3]> {
    let mut rng = Pcg64Mcg::seed_from_u64(seed);
    let mut pts = Vec::with_capacity(n);
    let mut x = 0.0f64;
    let mut y = 0.0f64;
    let mut z = 0.0f64;
    pts.push([x, y, z]);
    for _ in 1..n {
        // unit-vector step on sphere
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

fn battery_c_rw3d() {
    println!("\n=== Battery C: 3D random walks (Brownian, theoretical Df = 2.0) ===");
    println!("Tests N convergence for a non-pathological 3D structure.");
    println!("This is a proxy for CC-tunable behaviour at N=100..8000.\n");

    let df_theo = 2.0;
    for &n in &[100usize, 500, 2000, 8000, 32000] {
        let mut samples = Vec::new();
        for seed in 0..5 {
            let pts = random_walk_3d(n, 1.0, seed);
            let r = box_counting_3d_morton(&pts, 18);
            samples.push((r.dimension, r.r_squared));
        }
        let mean_df = samples.iter().map(|s| s.0).sum::<f64>() / 5.0;
        let mean_r2 = samples.iter().map(|s| s.1).sum::<f64>() / 5.0;
        let std_df = (samples
            .iter()
            .map(|s| (s.0 - mean_df).powi(2))
            .sum::<f64>()
            / 5.0)
            .sqrt();
        let delta = mean_df - df_theo;
        let sign = if delta >= 0.0 { "+" } else { "" };
        println!(
            "rw3d              N={:>6}  meas_Df={:.4} ± {:.4}  delta={}{:.4}  R²={:.4}",
            n, mean_df, std_df, sign, delta, mean_r2
        );
    }
}

fn main() {
    println!("BOX-COUNTING BIAS DIAGNOSIS");
    println!("===========================");
    println!("Three independent batteries to disentangle:");
    println!("  - finite-N statistical noise");
    println!("  - isotropic-bounding-box bias on elongated clusters");
    println!("  - high-Df saturation behaviour");

    battery_a_sierpinski();
    battery_b_anisotropy();
    battery_c_rw3d();

    println!("\n=== Interpretation guide ===");
    println!("If A converges to 1.585 with depth → BC is fundamentally fine; small-N noise");
    println!("  dominates at low N.");
    println!("If B shows delta GROWING with aspect ratio → bounding-box anisotropy IS a bug.");
    println!("If B shows delta stable across aspects → anisotropy is NOT the cause; look");
    println!("  elsewhere (saturation truncation, robust regression).");
    println!("If C converges to 2.0 with N → algorithm scales correctly; N=100 is just noisy.");
    println!("If C does NOT converge → there is a systematic bias independent of N.");
}
