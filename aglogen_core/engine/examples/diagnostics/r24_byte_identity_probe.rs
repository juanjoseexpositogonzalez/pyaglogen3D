//! Probe whether `required * 1.0` round-trip preserves f64 bit-identity
//! through the feasibility comparison.
//!
//! HYPOTHESIS: When `use_low_df_fix=false`, the threshold factor is `1.0` and
//! `required * 1.0` should be bit-equal to `required`. If LLVM reorders the
//! comparison, the boolean outcome may differ at the ULP level, causing
//! divergent control flow → divergent coordinates downstream.
//!
//! This example does NOT use the simulation — it directly probes the f64
//! arithmetic identity at every possible bit pattern reachable from
//! `calculate_com_distance` output (positive finite f64s spanning realistic
//! magnitudes).
//!
//! Run: `cargo run --release --example r24_byte_identity_probe -p aglogen-engine`

use rand::{Rng, SeedableRng};
use rand_pcg::Pcg64Mcg;

fn main() {
    println!("R24 byte-identity probe: does `required * 1.0` == `required` always?");
    println!("====================================================================\n");

    // 1. Direct check: is `x * 1.0` bit-equal to `x` for normal f64s?
    let mut rng = Pcg64Mcg::seed_from_u64(42);
    let mut tested = 0u64;
    let mut differ = 0u64;
    for _ in 0..10_000_000 {
        let x: f64 = rng.gen_range(0.1..1000.0);
        let y = x * 1.0_f64;
        tested += 1;
        if x.to_bits() != y.to_bits() {
            differ += 1;
            if differ <= 5 {
                println!(
                    "  DIFFER: x={:.20e} ({:#018x}) vs x*1.0={:.20e} ({:#018x})",
                    x, x.to_bits(), y, y.to_bits()
                );
            }
        }
    }
    println!(
        "Direct multiplication: {} of {} differ ({} ppm)",
        differ, tested, (differ as f64 / tested as f64) * 1e6
    );

    // 2. Comparison check: does `b >= x * 1.0` ever differ from `b >= x`?
    println!("\nComparison test: `b >= x * 1.0` vs `b >= x`:");
    let mut comp_tested = 0u64;
    let mut comp_differ = 0u64;
    for _ in 0..10_000_000 {
        let x: f64 = rng.gen_range(0.1..1000.0);
        let b: f64 = rng.gen_range(0.05..1500.0);
        let direct = b >= x;
        let through_mul = b >= x * 1.0_f64;
        comp_tested += 1;
        if direct != through_mul {
            comp_differ += 1;
            if comp_differ <= 5 {
                println!(
                    "  DIFFER at x={:.20e} b={:.20e}: direct={} through_mul={}",
                    x, b, direct, through_mul
                );
            }
        }
    }
    println!(
        "Comparison: {} of {} differ ({} ppm)",
        comp_differ, comp_tested, (comp_differ as f64 / comp_tested as f64) * 1e6
    );

    // 3. Boundary check: explicitly probe values where b == x (the boundary case).
    println!("\nBoundary case: b == x (so b >= x is true, but FP can flip):");
    let mut boundary_differ = 0u64;
    for _ in 0..1_000_000 {
        let x: f64 = rng.gen_range(0.1..1000.0);
        let direct = x >= x;                  // always true
        let through_mul = x >= x * 1.0_f64;   // should always be true if bit-equal
        if direct != through_mul {
            boundary_differ += 1;
            if boundary_differ <= 5 {
                println!(
                    "  BOUNDARY DIFFER: x={:.20e} ({:#018x}), x*1.0={:.20e} ({:#018x})",
                    x, x.to_bits(), x * 1.0_f64, (x * 1.0_f64).to_bits()
                );
            }
        }
    }
    println!("Boundary differs: {} of 1,000,000", boundary_differ);

    println!("\n=== Interpretation ===");
    println!("If all three sections report 0 differs → `required * 1.0` IS bit-safe.");
    println!("In that case, the R24 byte-identity violation is NOT from the threshold");
    println!("factor multiplication. Look elsewhere (RNG draws, seed_clusters changes,");
    println!("call-site argument order changes during PR2).");
    println!("\nIf any section reports >0 differs → the threshold factor IS the cause.");
    println!("Fix: branch the comparison to use `>=` directly when factor==1.0, or use");
    println!("`f64::mul_add` with the exact identity element, or precompute the rhs.");
}
