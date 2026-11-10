//! Issue #275: the scaling axis must come from the recorded particle counts.
//!
//! The estimator fits `ln N = ln kf + Df·ln(Rg/rp)` over one point per successful
//! merge. The largest cluster's size after merge `i` is **not** `i`: merges join
//! clusters of unequal size, so the counts jump. Until #275 the counts never left
//! the engine, so the detail screen rebuilt them as
//! `n_i = (i+1)·round(N/len)` and drew a regression line that contradicted the
//! record's own `fractal_dimension` — measured gap up to 0.60 in Df
//! (`examples/diagnostics/scaling_axis_audit.rs`).
//!
//! These tests pin the contract that makes that impossible:
//!
//! 1. a non-empty `rg_evolution` ships counts of the same length, strictly
//!    increasing, ending at the run's particle count;
//! 2. refitting over the shipped counts reproduces `fractal_dimension`, i.e. the
//!    numbers a client plots are the numbers the engine measured;
//! 3. `box_rfa` records an evolution whose points are refinement levels sized by a
//!    count of occupied boxes, not of particles, so it ships the evolution and no
//!    counts; a client can tell "there is no particle-count axis" from "here is the
//!    axis" and says so instead of inventing one.

use aglogen_engine::simulation::ballistic::{run_ballistic_internal, BallisticParams};
use aglogen_engine::simulation::box_rfa::{run_box_rfa_internal, BoxRfaParams};
use aglogen_engine::simulation::cca::{run_cca_internal, CcaParams};
use aglogen_engine::simulation::dla::{run_dla_internal, DlaParams};
use aglogen_engine::simulation::tunable_cc::{run_tunable_cc_internal, SeedType, TunableCcParams};

/// The engine's estimator, reproduced over the counts the result ships.
///
/// Mirrors `calculate_fractal_dimension_from_evolution`: filter `n > 1` and
/// `rg > rp·0.1`, then unweighted OLS of `ln N` on `ln(Rg/rp)`.
fn refit(result: &aglogen_engine::simulation::result::SimulationResult, rp: f64) -> f64 {
    let mut xs = Vec::new();
    let mut ys = Vec::new();
    for (rg, n) in result.rg_evolution.iter().zip(result.rg_evolution_n.iter()) {
        if *n <= 1 || *rg <= rp * 0.1 {
            continue;
        }
        xs.push((rg / rp).ln());
        ys.push((*n as f64).ln());
    }
    assert!(xs.len() >= 3, "refit needs at least three points");
    let n = xs.len() as f64;
    let sx: f64 = xs.iter().sum();
    let sy: f64 = ys.iter().sum();
    let sxx: f64 = xs.iter().map(|v| v * v).sum();
    let sxy: f64 = xs.iter().zip(&ys).map(|(a, b)| a * b).sum();
    (n * sxy - sx * sy) / (n * sxx - sx * sx)
}

fn tunable(
    n_particles: usize,
    target_df: f64,
    seed: u64,
) -> aglogen_engine::simulation::result::SimulationResult {
    run_tunable_cc_internal(
        TunableCcParams {
            n_particles,
            target_df,
            target_kf: 1.3,
            radius_min: 1.0,
            radius_max: 1.0,
            seed_type: SeedType::Monomers,
            ..Default::default()
        },
        seed,
        None,
    )
}

#[test]
fn counts_ship_with_the_evolution_they_describe() {
    let result = tunable(100, 2.7, 1);

    assert!(
        !result.rg_evolution.is_empty(),
        "this run must record an evolution, or the test proves nothing"
    );
    assert_eq!(
        result.rg_evolution_n.len(),
        result.rg_evolution.len(),
        "one count per Rg point, or a client cannot pair them"
    );
    // Non-decreasing, not strictly increasing: a merge elsewhere in the aggregate
    // does not grow the largest cluster, and the point is recorded anyway. Those
    // repeated counts are real, and they are the reason the fabricated axis
    // `(i+1)·step` drifts so far: at these settings 24 points carry only 7-10
    // distinct counts.
    assert!(
        result.rg_evolution_n.windows(2).all(|w| w[1] >= w[0]),
        "a merge never shrinks the largest cluster: {:?}",
        result.rg_evolution_n
    );
    let mut distinct = result.rg_evolution_n.clone();
    distinct.sort_unstable();
    distinct.dedup();
    assert!(
        distinct.len() < result.rg_evolution_n.len(),
        "this run must contain repeated counts, or the axis is the index in disguise"
    );
    assert_eq!(
        *result.rg_evolution_n.last().unwrap(),
        result.coordinates.len(),
        "the last recorded point is the whole aggregate"
    );
}

#[test]
fn refitting_the_shipped_counts_reproduces_the_recorded_df() {
    // The whole point of #275: what a client can plot equals what the engine says.
    // Before the counts shipped, this equality was impossible to check and the
    // screen showed a number 0.3 away from the header.
    for &(n_particles, target_df, seed) in
        &[(100_usize, 2.7_f64, 1_u64), (100, 2.9, 2), (500, 2.5, 3)]
    {
        let result = tunable(n_particles, target_df, seed);
        let rp = result
            .dpo_used
            .expect("cc-tunable samples the primary particle size");

        let df = refit(&result, rp);
        assert!(
            (df - result.fractal_dimension).abs() < 1e-9,
            "N={} Df_target={} seed={}: refit {df} vs recorded {}",
            n_particles,
            target_df,
            seed,
            result.fractal_dimension
        );
    }
}

#[test]
fn box_counting_ships_its_evolution_without_particle_counts() {
    // `box_rfa` builds one point per refinement level (box_rfa.rs step 2), and the
    // size of a level is a count of occupied boxes. Shipping those numbers as
    // `rg_evolution_n` would put box counts on an axis labelled with particle
    // counts — a second lie in place of the one #275 removed. So the evolution
    // travels alone, and a client announces the rebuilt axis.
    let result = run_box_rfa_internal(
        BoxRfaParams {
            target_df: 2.5,
            n_levels: 4,
            particle_radius: 1.0,
            ..Default::default()
        },
        7,
    );

    assert!(
        !result.rg_evolution.is_empty(),
        "box_rfa records one point per refinement level, so the evolution is not empty"
    );
    assert!(
        result.rg_evolution_n.is_empty(),
        "box counts are not particle counts: {:?}",
        result.rg_evolution_n
    );
}

#[test]
fn every_merge_based_algorithm_ships_a_pair_that_can_be_zipped() {
    // The invariant a consumer may rely on, asserted over the four families that
    // record a merge: the arrays agree in length, never decrease, and end on the
    // whole aggregate. `box_rfa` is the documented exception above.
    let results = [
        ("tunable", tunable(100, 2.7, 1)),
        ("cca", run_cca_internal(CcaParams::default(), 2)),
        ("dla", run_dla_internal(DlaParams::default(), 3)),
        ("ballistic", run_ballistic_internal(BallisticParams::default(), 4)),
    ];

    for (name, result) in results {
        assert!(!result.rg_evolution.is_empty(), "{name}: no evolution recorded");
        assert_eq!(
            result.rg_evolution_n.len(),
            result.rg_evolution.len(),
            "{name}: one count per Rg point"
        );
        assert!(
            result.rg_evolution_n.windows(2).all(|w| w[1] >= w[0]),
            "{name}: a merge never shrinks the largest cluster"
        );
        assert_eq!(
            *result.rg_evolution_n.last().unwrap(),
            result.coordinates.len(),
            "{name}: the last point is the whole aggregate"
        );
    }
}
