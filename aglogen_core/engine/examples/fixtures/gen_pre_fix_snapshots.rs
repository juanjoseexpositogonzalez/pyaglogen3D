//! Pre-fix snapshot generator for cc-tunable-low-df-fix (R24 byte-identity).
//!
//! Runs `run_tunable_cc_internal` with three `(seed, TunableCcParams)` configurations
//! and serializes the results to JSON under `tests/fixtures/pre_low_df_fix/`.
//!
//! These fixtures capture the **current (pre-fix) algorithm output** and are used by
//! the R24 byte-identity tests to prove that `CC_TUNABLE_USE_LOW_DF_FIX=false` produces
//! bit-identical results after the fix is applied.
//!
//! Run:
//! ```bash
//! cargo run --release --example gen_pre_fix_snapshots -p aglogen-engine
//! ```
//!
//! WARNING: Do NOT run this after applying the cc-tunable-low-df-fix changes unless
//! `CC_TUNABLE_USE_LOW_DF_FIX=false` is set. See README.md in the fixtures directory.

use serde::Serialize;
use std::fs;
use std::path::PathBuf;

use aglogen_engine::simulation::tunable_cc::{run_tunable_cc_internal, TunableCcParams};
use aglogen_engine::simulation::result::SimulationResult;

/// Serializable mirror of the fields required for R24 byte-identity verification.
///
/// This is intentionally a thin projection of `SimulationResult` — only the fields
/// that are covered by R24 are included. Do not add computed or derived fields.
#[derive(Serialize)]
struct SnapshotFixture {
    /// Particle coordinates: Vec of [x, y, z] triples.
    coordinates: Vec<[f64; 3]>,
    /// Primary particle radii, one per particle.
    radii: Vec<f64>,
    /// Radius-of-gyration sampled at each merge step.
    rg_evolution: Vec<f64>,
    /// Final measured fractal dimension (Rg-based power-law fit).
    fractal_dimension: f64,
    /// Final measured fractal prefactor.
    prefactor: f64,
    /// Per-merge diagnostic trace.
    merge_trace: Vec<MergeTraceFixture>,
    // Metadata — not part of R24 but useful for debugging fixture provenance.
    seed: u64,
    target_df: f64,
    n_particles: usize,
}

/// Serializable mirror of `MergeTraceEntry`.
#[derive(Serialize)]
struct MergeTraceFixture {
    step: usize,
    n1: usize,
    n2: usize,
    required_distance: f64,
    actual_distance: f64,
    rg_after: f64,
    rg_target: f64,
    merge_type: String,
    retries: usize,
    bounding_check_passed: bool,
    overshoot_pct: Option<f64>,
}

fn to_fixture(result: SimulationResult, seed: u64, target_df: f64, n_particles: usize) -> SnapshotFixture {
    SnapshotFixture {
        coordinates: result.coordinates,
        radii: result.radii,
        rg_evolution: result.rg_evolution,
        fractal_dimension: result.fractal_dimension,
        prefactor: result.prefactor,
        merge_trace: result
            .merge_trace
            .into_iter()
            .map(|e| MergeTraceFixture {
                step: e.step,
                n1: e.n1,
                n2: e.n2,
                required_distance: e.required_distance,
                actual_distance: e.actual_distance,
                rg_after: e.rg_after,
                rg_target: e.rg_target,
                merge_type: e.merge_type,
                retries: e.retries,
                bounding_check_passed: e.bounding_check_passed,
                overshoot_pct: e.overshoot_pct,
            })
            .collect(),
        seed,
        target_df,
        n_particles,
    }
}

fn params_for(target_df: f64) -> TunableCcParams {
    TunableCcParams {
        n_particles: 100,
        target_df,
        target_kf: 1.3,
        radius_min: 1.0,
        radius_max: 1.0,
        ..TunableCcParams::default()
    }
}

fn main() {
    // Resolve output directory relative to CARGO_MANIFEST_DIR so the generator
    // works regardless of the working directory from which it is invoked.
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
        .expect("CARGO_MANIFEST_DIR must be set — run via `cargo run --example`");
    let out_dir = PathBuf::from(&manifest_dir)
        .join("tests/fixtures/pre_low_df_fix");

    fs::create_dir_all(&out_dir).expect("failed to create fixture directory");

    let runs: &[(u64, f64, &str)] = &[
        (1, 1.5, "seed1_df15.json"),
        (2, 1.8, "seed2_df18.json"),
        (3, 2.0, "seed3_df20.json"),
    ];

    for &(seed, target_df, filename) in runs {
        let params = params_for(target_df);
        let n_particles = params.n_particles;

        println!(
            "Running seed={} target_df={} n_particles={}...",
            seed, target_df, n_particles
        );

        let result = run_tunable_cc_internal(params, seed, None);

        println!(
            "  fractal_dimension={:.6} prefactor={:.6} coordinates.len()={} merge_trace.len()={}",
            result.fractal_dimension,
            result.prefactor,
            result.coordinates.len(),
            result.merge_trace.len(),
        );

        let fixture = to_fixture(result, seed, target_df, n_particles);

        // Compact JSON (no pretty-print) to keep fixture file size manageable.
        // serde_json uses the Ryu algorithm for f64: shortest round-trip representation,
        // meaning every value can be parsed back to the exact same bit pattern.
        let json = serde_json::to_string(&fixture)
            .expect("serialization must not fail for well-formed SimulationResult");

        let out_path = out_dir.join(filename);
        fs::write(&out_path, &json)
            .unwrap_or_else(|e| panic!("failed to write {}: {}", out_path.display(), e));

        println!("  Written {} ({} bytes)", filename, json.len());
    }

    println!("\nAll 3 fixtures written to {}", out_dir.display());
    println!("Verify: ls -la {}", out_dir.display());
}
