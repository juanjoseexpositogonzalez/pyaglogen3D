//! Scan whether the R5.8 `prefactor >= 1.0` constraint holds at N=1000 vs N=2000.

use aglogen_engine::simulation::tunable_cc::{run_tunable_cc_internal, TunableCcParams};

fn main() {
    println!("R5.8 prefactor floor scan (Monomers, flag default ON, low-Df band)");
    println!("===================================================================\n");
    let df_targets = [1.4_f64, 1.5, 1.6, 1.7];
    let seeds = [1u64, 2, 3];
    for &n in &[1000usize, 2000] {
        println!("--- N={} ---", n);
        let mut min_pf = f64::INFINITY;
        let mut below_1 = 0;
        let mut total = 0;
        for &df in &df_targets {
            for &seed in &seeds {
                let p = TunableCcParams {
                    n_particles: n,
                    target_df: df,
                    target_kf: 1.3,
                    radius_min: 1.0,
                    radius_max: 1.0,
                    ..Default::default()
                };
                let r = run_tunable_cc_internal(p, seed, None);
                let pf = r.prefactor;
                println!(
                    "  Df={:.1} seed={} Df_real={:.4} prefactor={:.4}{}",
                    df, seed, r.fractal_dimension, pf,
                    if pf < 1.0 { "  ← BELOW 1.0" } else { "" }
                );
                if pf < min_pf {
                    min_pf = pf;
                }
                if pf < 1.0 {
                    below_1 += 1;
                }
                total += 1;
            }
        }
        println!("  min_pf={:.4}, below_1={}/{}\n", min_pf, below_1, total);
    }
}
