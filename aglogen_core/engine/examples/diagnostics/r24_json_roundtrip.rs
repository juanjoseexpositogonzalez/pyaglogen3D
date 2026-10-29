//! Verify whether serde_json round-trip preserves f64 bit-identity for the
//! actual coordinate values produced by the CC-tunable simulator.
//!
//! Run: `cargo run --release --example r24_json_roundtrip -p aglogen-engine`

use aglogen_engine::simulation::tunable_cc::{run_tunable_cc_internal, TunableCcParams};

fn main() {
    std::env::set_var("CC_TUNABLE_USE_LOW_DF_FIX", "false");

    println!("Round-trip f64 through serde_json: bit-preserving?");
    println!("===================================================\n");

    let params = TunableCcParams {
        n_particles: 100,
        target_df: 1.5,
        target_kf: 1.3,
        radius_min: 1.0,
        radius_max: 1.0,
        ..Default::default()
    };
    let r = run_tunable_cc_internal(params, 1, None);

    // Round-trip coordinates through serde_json
    let json_str = serde_json::to_string(&r.coordinates).unwrap();
    let restored: Vec<[f64; 3]> = serde_json::from_str(&json_str).unwrap();

    let mut total = 0;
    let mut diffs = 0;
    let mut max_ulp = 0i64;
    for (a, b) in r.coordinates.iter().zip(restored.iter()) {
        for axis in 0..3 {
            total += 1;
            let ab = a[axis].to_bits() as i64;
            let bb = b[axis].to_bits() as i64;
            let ulp = (ab - bb).abs();
            if ulp != 0 {
                diffs += 1;
                if ulp > max_ulp {
                    max_ulp = ulp;
                }
                if diffs <= 3 {
                    println!(
                        "  DIFF: a={:.20e} ({:#018x}) vs b={:.20e} ({:#018x}) ulp_diff={}",
                        a[axis], a[axis].to_bits(), b[axis], b[axis].to_bits(), ulp
                    );
                }
            }
        }
    }
    println!(
        "\nCoordinates: {} of {} differ; max ulp diff = {}",
        diffs, total, max_ulp
    );

    // Round-trip Df, kf
    for &val in &[r.fractal_dimension, r.prefactor] {
        let s = serde_json::to_string(&val).unwrap();
        let back: f64 = serde_json::from_str(&s).unwrap();
        let same = val.to_bits() == back.to_bits();
        println!(
            "scalar {:.20e}: round-trip {} (json='{}')",
            val,
            if same { "PRESERVED" } else { "LOST BITS" },
            s
        );
    }

    std::env::remove_var("CC_TUNABLE_USE_LOW_DF_FIX");

    println!("\n=== Interpretation ===");
    println!("If coordinates DIFFER → serde_json lossy. Move fixtures to bincode.");
    println!("If coordinates MATCH → R24 test issue is elsewhere (env var leakage,");
    println!("                       params reconstruction from fixture, etc).");
}
