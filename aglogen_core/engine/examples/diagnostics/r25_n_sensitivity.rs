//! Quick R25 BC-vs-Rg delta scan at N=1000 vs N=2000 vs N=4000.
//!
//! Tells us empirically how much the BC bias shrinks with N, so we can
//! decide whether the R25 test should run at higher N to fit within the
//! 0.20 tolerance we locked in design.md.

use aglogen_engine::fractal::box_counting_3d::box_counting_3d_morton;
use aglogen_engine::simulation::tunable_cc::{run_tunable_cc_internal, TunableCcParams};

fn main() {
    println!("R25 N-sensitivity scan (Monomers, flag default ON)");
    println!("===================================================\n");

    let df_targets = [1.4_f64, 1.5, 1.6, 1.7];
    let seeds = [1u64, 2, 3];

    for &n in &[1000usize, 2000, 4000] {
        let mut max_delta = 0.0_f64;
        let mut fail_count_020 = 0;
        let mut fail_count_025 = 0;
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
                let bc = box_counting_3d_morton(&r.coordinates, 18);
                let delta = (bc.dimension - r.fractal_dimension).abs();
                if delta > max_delta {
                    max_delta = delta;
                }
                if delta > 0.20 {
                    fail_count_020 += 1;
                }
                if delta > 0.25 {
                    fail_count_025 += 1;
                }
                total += 1;
            }
        }
        println!(
            "N={:<5} max_delta={:.4}  fails@0.20: {}/{}  fails@0.25: {}/{}",
            n, max_delta, fail_count_020, total, fail_count_025, total
        );
    }
}
