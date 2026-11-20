//! Phase 0 measurement for issue #310: CC-tunable time-budget evidence.
//!
//! This intentionally measures the current engine without changing it. Each
//! configuration runs in its own worker thread and has a 30-second watchdog.
//! Timed-out workers are detached: they may continue until this one-shot
//! diagnostic process exits, but the table always records their timeout and
//! continues to the next configuration.
//!
//! Run:
//! `PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1 cargo run --release -p aglogen-engine --example cc_time_budget`

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use aglogen_engine::simulation::tunable_cc::{run_tunable_cc_internal, SeedType, TunableCcParams};

const WATCHDOG: Duration = Duration::from_secs(30);
const PARTICLE_COUNTS: [usize; 4] = [20, 100, 500, 1000];
const ROTATION_ATTEMPTS: [usize; 3] = [50, 1000, 10_000];
const SEEDS: [u64; 2] = [310_001, 310_002];
const DETERMINISM_N: usize = 100;
const DETERMINISM_ATTEMPTS: usize = 50;
const DETERMINISM_SEED: u64 = 310_999;

#[derive(Clone, Copy)]
struct Measurement {
    n_particles: usize,
    max_rotation_attempts: usize,
    seed: u64,
    seconds: f64,
}

enum WorkerOutcome {
    Completed {
        seconds: f64,
        particles: usize,
        fingerprint: String,
    },
    Failed {
        seconds: f64,
        reason: String,
    },
}

fn params(n_particles: usize, max_rotation_attempts: usize) -> TunableCcParams {
    // R27.4-compatible setup: dimers, fixed kf 1.3, and monodisperse radius 1.0.
    TunableCcParams {
        n_particles,
        target_df: 2.7,
        target_kf: 1.3,
        radius_min: 1.0,
        radius_max: 1.0,
        seed_type: SeedType::Dimers,
        max_rotation_attempts,
        ..Default::default()
    }
}

fn fingerprint_result(result: &aglogen_engine::simulation::result::SimulationResult) -> String {
    // `execution_time_ms` is deliberately excluded: it records wall-clock time,
    // not simulated state. Every other public result field is encoded by bits so
    // the comparison detects even a one-bit difference in deterministic output.
    let mut fingerprint = String::new();

    for coordinate in &result.coordinates {
        for value in coordinate {
            let _ = write!(fingerprint, "{:016x},", value.to_bits());
        }
        fingerprint.push(';');
    }
    fingerprint.push('|');
    for radius in &result.radii {
        let _ = write!(fingerprint, "{:016x},", radius.to_bits());
    }
    fingerprint.push('|');
    for value in &result.rg_evolution {
        let _ = write!(fingerprint, "{:016x},", value.to_bits());
    }
    let _ = write!(
        fingerprint,
        "|{:?}|{:016x}|{:016x}|{:016x}|{:016x}|{:016x}|{:016x}|{}|{:016x}|{:016x}|{:016x}|",
        result.rg_evolution_n,
        result.fractal_dimension.to_bits(),
        result.fractal_dimension_std.to_bits(),
        result.prefactor.to_bits(),
        result.porosity.to_bits(),
        result.coordination_mean.to_bits(),
        result.coordination_std.to_bits(),
        result.seed,
        result.anisotropy.to_bits(),
        result.asphericity.to_bits(),
        result.acylindricity.to_bits(),
    );
    for moment in result.principal_moments {
        let _ = write!(fingerprint, "{:016x},", moment.to_bits());
    }
    fingerprint.push('|');
    for axis in result.principal_axes {
        for value in axis {
            let _ = write!(fingerprint, "{:016x},", value.to_bits());
        }
        fingerprint.push(';');
    }
    let _ = write!(
        fingerprint,
        "|{}|{}|{}|{}|{}|",
        result.tunable_merges,
        result.ballistic_merges,
        result.adaptive_merges,
        result.no_feasible_pair_events,
        result.max_retries_per_merge,
    );
    match result.dpo_used {
        Some(value) => {
            let _ = write!(fingerprint, "some:{:016x}|", value.to_bits());
        }
        None => fingerprint.push_str("none|"),
    }
    match result.target_kf_used {
        Some(value) => {
            let _ = write!(fingerprint, "some:{:016x}|", value.to_bits());
        }
        None => fingerprint.push_str("none|"),
    }
    for entry in &result.merge_trace {
        let _ = write!(
            fingerprint,
            "{}:{}:{}:{:016x}:{:016x}:{:016x}:{:016x}:{}:{}:{}:",
            entry.step,
            entry.n1,
            entry.n2,
            entry.required_distance.to_bits(),
            entry.actual_distance.to_bits(),
            entry.rg_after.to_bits(),
            entry.rg_target.to_bits(),
            entry.merge_type,
            entry.retries,
            entry.bounding_check_passed,
        );
        match entry.overshoot_pct {
            Some(value) => {
                let _ = write!(fingerprint, "some:{:016x};", value.to_bits());
            }
            None => fingerprint.push_str("none;"),
        }
    }

    fingerprint
}

fn run_with_watchdog(
    n_particles: usize,
    max_rotation_attempts: usize,
    seed: u64,
) -> Result<WorkerOutcome, String> {
    let (sender, receiver) = mpsc::channel();
    let worker_params = params(n_particles, max_rotation_attempts);
    let worker_name = format!("cc-budget-n{n_particles}-r{max_rotation_attempts}-s{seed}");

    match thread::Builder::new().name(worker_name).spawn(move || {
        let started = Instant::now();
        let outcome = match run_tunable_cc_internal(worker_params, seed, None) {
            Ok(result) => WorkerOutcome::Completed {
                seconds: started.elapsed().as_secs_f64(),
                particles: result.coordinates.len(),
                fingerprint: fingerprint_result(&result),
            },
            Err(reason) => WorkerOutcome::Failed {
                seconds: started.elapsed().as_secs_f64(),
                reason,
            },
        };
        let _ = sender.send(outcome);
    }) {
        Ok(handle) => {
            // Dropping the handle detaches this one-shot measurement worker.
            drop(handle);
        }
        Err(error) => return Err(format!("could not start worker: {error}")),
    }

    match receiver.recv_timeout(WATCHDOG) {
        Ok(outcome) => Ok(outcome),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(format!("> {}s (aborted)", WATCHDOG.as_secs())),
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("worker disconnected before reporting a result".to_string())
        }
    }
}

fn per_merge(seconds: f64, n_particles: usize) -> f64 {
    seconds / (n_particles.saturating_sub(1).max(1) as f64)
}

fn print_stability_assessment(measurements: &[Measurement]) {
    println!("\n=== Cost per estimated merge (S2) ===");
    println!("Estimate: elapsed_seconds / (n - 1). The engine exposes no merge counter.");
    println!("This is an estimate of merges required to reduce n particles to one cluster,");
    println!("not a newly inferred engine metric.\n");

    let mut by_attempts: BTreeMap<usize, BTreeMap<usize, Vec<f64>>> = BTreeMap::new();
    for measurement in measurements {
        by_attempts
            .entry(measurement.max_rotation_attempts)
            .or_default()
            .entry(measurement.n_particles)
            .or_default()
            .push(per_merge(measurement.seconds, measurement.n_particles));
    }

    let mut observed_growth = Vec::new();
    for (attempts, by_n) in by_attempts {
        println!("max_rotation_attempts={attempts}:");
        let mut means = BTreeMap::new();
        for n_particles in PARTICLE_COUNTS {
            match by_n.get(&n_particles) {
                Some(values) => {
                    let mean = values.iter().sum::<f64>() / values.len() as f64;
                    println!(
                        "  n={n_particles:>4}: {mean:.6} s/merge ({} completed seed(s))",
                        values.len()
                    );
                    means.insert(n_particles, mean);
                }
                None => println!("  n={n_particles:>4}: no completed seed within watchdog"),
            }
        }
        if let (Some(small), Some(large)) = (means.get(&20), means.get(&1000)) {
            observed_growth.push((attempts, *small, *large, large / small));
        }
    }

    if observed_growth.is_empty() {
        println!(
            "\nConclusion: incomplete endpoints prevent a stable-vs-growing conclusion across n."
        );
    } else {
        println!("\nEndpoint comparisons (n=20 to n=1000):");
        for (attempts, small, large, ratio) in &observed_growth {
            println!("  attempts={attempts}: {small:.6} -> {large:.6} s/merge ({ratio:.1}x)");
        }
        if observed_growth.iter().all(|(_, _, _, ratio)| *ratio <= 2.0) {
            println!("Conclusion: the completed endpoint measurements are roughly stable in n (within 2x). ");
        } else {
            println!(
                "Conclusion: cost per estimated merge grows with n; it is not roughly stable."
            );
        }
    }
}

fn print_closing_block(measurements: &[Measurement], completed_ceiling: usize) {
    println!("\n=== Closing evidence for the four open decisions ===");
    match measurements.iter().max_by_key(|measurement| measurement.n_particles) {
        Some(largest) => println!(
            "The largest completed configuration by particle count was n={}, max_rotation_attempts={}, seed={} ({:.3}s).",
            largest.n_particles, largest.max_rotation_attempts, largest.seed, largest.seconds
        ),
        None => println!("No configuration completed inside the watchdog."),
    }

    if completed_ceiling == SEEDS.len() {
        println!(
            "The current ceiling (10,000 attempts) with n=1000 completed for both measured seeds inside {}s, so it is reachable in this worker-process measurement.",
            WATCHDOG.as_secs()
        );
    } else {
        println!(
            "The current ceiling (10,000 attempts) with n=1000 completed for {completed_ceiling}/{} measured seeds inside {}s; this diagnostic does not demonstrate that it is reachable reliably in a worker process.",
            SEEDS.len(),
            WATCHDOG.as_secs()
        );
    }

    println!("The table makes the runtime risk and operation-cost trend easy to see.");
    println!("It cannot choose whether a deadline returns partial output or an error, the numeric deadline or operation budget, or Celery's exact limits: those remain judgement calls.");
    println!("A clock-based-cut divergence cannot be measured without implementing that cut.");
    println!("Therefore a per-operation budget is the only proposed cut type that preserves identical results for identical seeds; choosing it remains a product and engineering decision.");
}

fn main() {
    let total_started = Instant::now();
    let mut measurements = Vec::new();
    let mut completed_ceiling = 0;

    println!("CC-TUNABLE TIME-BUDGET PHASE 0 DIAGNOSTIC (#310)");
    println!("================================================");
    println!("Setup: target_df=2.7, target_kf=1.3, dimers, monodisperse radius=1.0.");
    println!(
        "Watchdog: {} seconds per configuration.\n",
        WATCHDOG.as_secs()
    );
    println!(
        "{:>5} | {:>8} | {:>7} | {:>12} | {:>11} | result",
        "n", "attempts", "seed", "wall time", "s/merge"
    );
    println!("{}", "-".repeat(84));

    // Measure the cheap ceilings first. If a later high-cost worker times out,
    // its detached work cannot distort the completed low-cost measurements.
    for max_rotation_attempts in ROTATION_ATTEMPTS {
        for n_particles in PARTICLE_COUNTS {
            for seed in SEEDS {
                match run_with_watchdog(n_particles, max_rotation_attempts, seed) {
                    Ok(WorkerOutcome::Completed {
                        seconds,
                        particles,
                        fingerprint: _,
                    }) => {
                        println!(
                            "{n_particles:>5} | {max_rotation_attempts:>8} | {seed:>7} | {seconds:>10.3}s | {:>9.6} | ok; particles={particles}",
                            per_merge(seconds, n_particles)
                        );
                        measurements.push(Measurement {
                            n_particles,
                            max_rotation_attempts,
                            seed,
                            seconds,
                        });
                        if n_particles == 1000 && max_rotation_attempts == 10_000 {
                            completed_ceiling += 1;
                        }
                    }
                    Ok(WorkerOutcome::Failed { seconds, reason }) => println!(
                        "{n_particles:>5} | {max_rotation_attempts:>8} | {seed:>7} | {seconds:>10.3}s | {:>9} | failed: {reason}",
                        "-"
                    ),
                    Err(reason) => println!(
                        "{n_particles:>5} | {max_rotation_attempts:>8} | {seed:>7} | {:>12} | {:>9} | {reason}",
                        format!("> {}s", WATCHDOG.as_secs()),
                        "-"
                    ),
                }
            }
        }
    }

    println!("\n=== Same-seed determinism check (S3) ===");
    println!(
        "Running n={DETERMINISM_N}, max_rotation_attempts={DETERMINISM_ATTEMPTS}, seed={DETERMINISM_SEED} twice."
    );
    let first = run_with_watchdog(DETERMINISM_N, DETERMINISM_ATTEMPTS, DETERMINISM_SEED);
    let second = run_with_watchdog(DETERMINISM_N, DETERMINISM_ATTEMPTS, DETERMINISM_SEED);
    match (first, second) {
        (
            Ok(WorkerOutcome::Completed {
                fingerprint: first_fingerprint,
                ..
            }),
            Ok(WorkerOutcome::Completed {
                fingerprint: second_fingerprint,
                ..
            }),
        ) if first_fingerprint == second_fingerprint => println!(
            "PASS: identical simulated result content (all public result fields except wall-clock execution_time_ms)."
        ),
        (Ok(WorkerOutcome::Completed { .. }), Ok(WorkerOutcome::Completed { .. })) => println!(
            "FAIL: same seed and configuration produced different simulated result content."
        ),
        (first, second) => println!(
            "INCONCLUSIVE: the repeated runs did not both complete: first={}, second={}",
            outcome_description(first),
            outcome_description(second)
        ),
    }
    println!("Clock-cut divergence is not measured: implementing a clock cut is out of scope for this Phase 0 diagnostic.");

    print_stability_assessment(&measurements);
    print_closing_block(&measurements, completed_ceiling);
    println!(
        "\nTotal diagnostic wall time: {:.3}s",
        total_started.elapsed().as_secs_f64()
    );
}

fn outcome_description(outcome: Result<WorkerOutcome, String>) -> String {
    match outcome {
        Ok(WorkerOutcome::Completed { .. }) => "completed".to_string(),
        Ok(WorkerOutcome::Failed { reason, .. }) => format!("failed: {reason}"),
        Err(reason) => reason,
    }
}
