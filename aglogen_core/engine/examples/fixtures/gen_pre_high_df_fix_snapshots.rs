//! Pre-fix snapshot generator for cc-tunable-high-df-fix (R26.4 byte-identity).
//!
//! Runs `run_tunable_cc_internal` with three `(seed, Df, N)` configurations using the
//! **Cycle-1-only code path** (`CC_TUNABLE_USE_HIGH_DF_FIX=false`, `CC_TUNABLE_USE_LOW_DF_FIX`
//! left at default `true`) and serializes the results to JSON under
//! `tests/fixtures/pre_high_df_fix/`.
//!
//! These fixtures capture the Cycle-1-only algorithm output and are used by the
//! R26.4 / R27.6 byte-identity tests to prove that `CC_TUNABLE_USE_HIGH_DF_FIX=false`
//! produces bit-identical results after Cycle 2 is applied.
//!
//! ## Run
//!
//! ```bash
//! CC_TUNABLE_USE_HIGH_DF_FIX=false cargo run --release --example gen_pre_high_df_fix_snapshots -p aglogen-engine
//! ```
//!
//! ## WARNING
//!
//! The env var `CC_TUNABLE_USE_HIGH_DF_FIX=false` MUST be set before running.
//! Running without it (after Cycle 2 ships) captures the post-fix output and
//! silently invalidates the byte-identity tests.
//! See tests/fixtures/pre_high_df_fix/README.md for full regeneration instructions.

use serde::Serialize;
use std::fs;
use std::path::PathBuf;

use aglogen_engine::simulation::result::SimulationResult;
use aglogen_engine::simulation::tunable_cc::{run_tunable_cc_internal, SeedType, TunableCcParams};

/// Serializable projection of the fields required for R26.4 byte-identity verification.
///
/// Mirrors the Cycle 1 `SnapshotFixture` from `gen_pre_fix_snapshots.rs` exactly.
/// Do not add computed or derived fields — only the fields covered by R26.4 are included.
#[derive(Serialize)]
struct SnapshotFixture {
    /// Particle coordinates: Vec of [x, y, z] triples.
    coordinates: Vec<[f64; 3]>,
    /// Primary particle radii, one per particle.
    radii: Vec<f64>,
    /// Final measured fractal dimension (Rg-based power-law fit).
    fractal_dimension: f64,
    /// Final measured fractal prefactor.
    prefactor: f64,
    /// Per-merge diagnostic trace.
    merge_trace: Vec<MergeTraceFixture>,
    /// Metadata — not part of R26.4 but useful for debugging fixture provenance.
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

fn to_fixture(
    result: SimulationResult,
    seed: u64,
    target_df: f64,
    n_particles: usize,
) -> SnapshotFixture {
    SnapshotFixture {
        coordinates: result.coordinates,
        radii: result.radii,
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
        seed_type: SeedType::Dimers,
        ..TunableCcParams::default()
    }
}

fn main() {
    // Abort immediately if the caller forgot to set the flag-off guard.
    // This prevents accidentally regenerating fixtures with the Cycle 2 code path active.
    let high_df_flag_val = std::env::var("CC_TUNABLE_USE_HIGH_DF_FIX")
        .unwrap_or_else(|_| String::new());
    let high_df_is_off = matches!(
        high_df_flag_val.to_lowercase().as_str(),
        "false" | "0" | "no"
    );
    if !high_df_is_off {
        eprintln!(
            "ERROR: CC_TUNABLE_USE_HIGH_DF_FIX must be set to 'false' before running this generator.\n\
             Run: CC_TUNABLE_USE_HIGH_DF_FIX=false cargo run --release --example gen_pre_high_df_fix_snapshots -p aglogen-engine"
        );
        std::process::exit(1);
    }

    // Resolve output directory relative to CARGO_MANIFEST_DIR.
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
        .expect("CARGO_MANIFEST_DIR must be set — run via `cargo run --example`");
    let out_dir = PathBuf::from(&manifest_dir).join("tests/fixtures/pre_high_df_fix");

    fs::create_dir_all(&out_dir).expect("failed to create fixture directory");

    // Three (seed, Df) configurations matching R26.4 and the high-Df band.
    let runs: &[(u64, f64, &str)] = &[
        (1, 2.7, "seed1_df27.json"),
        (2, 2.9, "seed2_df29.json"),
        (3, 2.5, "seed3_df25.json"),
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

        // Compact JSON (no pretty-print). serde_json uses the Ryu algorithm for f64:
        // shortest round-trip representation — every value can be parsed back to the
        // exact same bit pattern (critical for R26.4 strict bit-equality assertions).
        let json = serde_json::to_string(&fixture)
            .expect("serialization must not fail for well-formed SimulationResult");

        let out_path = out_dir.join(filename);
        fs::write(&out_path, &json)
            .unwrap_or_else(|e| panic!("failed to write {}: {}", out_path.display(), e));

        println!("  Written {} ({} bytes)", filename, json.len());
    }

    println!("\nAll 3 fixtures written to {}", out_dir.display());
    println!(
        "Verify with: ls -la {}",
        out_dir.display()
    );
    println!("\nIMPORTANT: These fixtures encode the Cycle-1-only output.");
    println!("Do NOT commit them unless CC_TUNABLE_USE_HIGH_DF_FIX was explicitly 'false' during generation.");
}
