//! Verify that two in-memory runs with `CC_TUNABLE_USE_LOW_DF_FIX=false` are
//! bit-identical SimulationResult — bypassing any JSON serialization.
//!
//! If two in-memory runs ARE bit-identical → the R24 violation reported by
//! the PR3 subagent comes from serde_json round-trip ULP loss, NOT from the
//! algorithm itself. In that case the fix is: change R24 tests to compare
//! two in-memory runs (one fresh, one from re-running the generator), not
//! against a JSON fixture.
//!
//! If two in-memory runs DIFFER → there's a real reproducibility bug.
//!
//! Run: `cargo run --release --example r24_in_memory_check -p aglogen-engine`

use aglogen_engine::simulation::tunable_cc::{run_tunable_cc_internal, TunableCcParams};

fn main() {
    std::env::set_var("CC_TUNABLE_USE_LOW_DF_FIX", "false");

    println!("R24 IN-MEMORY byte-identity check");
    println!("=================================");
    println!("Env: CC_TUNABLE_USE_LOW_DF_FIX={:?}\n", std::env::var("CC_TUNABLE_USE_LOW_DF_FIX").ok());

    // Same 3 fixtures as the SDD R24 tests.
    for &(seed, df, n) in &[(1u64, 1.5_f64, 100usize), (2, 1.8, 100), (3, 2.0, 100)] {
        let params_a = TunableCcParams {
            n_particles: n,
            target_df: df,
            target_kf: 1.3,
            radius_min: 1.0,
            radius_max: 1.0,
            ..Default::default()
        };
        let params_b = params_a.clone();

        let r_a = run_tunable_cc_internal(params_a, seed, None);
        let r_b = run_tunable_cc_internal(params_b, seed, None);

        let coords_match = r_a.coordinates.len() == r_b.coordinates.len()
            && r_a
                .coordinates
                .iter()
                .zip(r_b.coordinates.iter())
                .all(|(a, b)| a[0].to_bits() == b[0].to_bits()
                    && a[1].to_bits() == b[1].to_bits()
                    && a[2].to_bits() == b[2].to_bits());

        let df_match = r_a.fractal_dimension.to_bits() == r_b.fractal_dimension.to_bits();
        let kf_match = r_a.prefactor.to_bits() == r_b.prefactor.to_bits();
        let rg_match = r_a.rg_evolution.len() == r_b.rg_evolution.len()
            && r_a
                .rg_evolution
                .iter()
                .zip(r_b.rg_evolution.iter())
                .all(|(a, b)| a.to_bits() == b.to_bits());

        println!(
            "seed={} df={:.1} N={}:  coords={}  Df={}  kf={}  rg_evolution={}",
            seed,
            df,
            n,
            if coords_match { "MATCH" } else { "DIFFER" },
            if df_match { "MATCH" } else { "DIFFER" },
            if kf_match { "MATCH" } else { "DIFFER" },
            if rg_match { "MATCH" } else { "DIFFER" }
        );

        // If something differs, show first divergence
        if !coords_match {
            for (i, (a, b)) in r_a.coordinates.iter().zip(r_b.coordinates.iter()).enumerate() {
                for axis in 0..3 {
                    if a[axis].to_bits() != b[axis].to_bits() {
                        println!(
                            "  first coord divergence: i={} axis={}  a={:.20e} ({:#018x})  b={:.20e} ({:#018x})",
                            i, axis, a[axis], a[axis].to_bits(), b[axis], b[axis].to_bits()
                        );
                        break;
                    }
                }
                if a.iter().zip(b.iter()).any(|(x, y)| x.to_bits() != y.to_bits()) {
                    break;
                }
            }
        }
    }

    std::env::remove_var("CC_TUNABLE_USE_LOW_DF_FIX");

    println!("\n=== Interpretation ===");
    println!("All MATCH → algorithm is deterministic with flag OFF (good).");
    println!("            R24 violation must be from JSON round-trip in tests.");
    println!("Any DIFFER → real reproducibility bug. Investigate immediately.");
}
