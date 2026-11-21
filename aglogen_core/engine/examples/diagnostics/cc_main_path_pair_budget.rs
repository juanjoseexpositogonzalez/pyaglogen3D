//! Phase 0 JD-RA-001 calibration: `cargo run --release -p aglogen-engine --example cc_main_path_pair_budget`
use aglogen_engine::simulation::tunable_cc::{run_tunable_cc_internal, SeedType, TunableCcParams};
fn main() {
    println!("requested_particles,seed_type,df_target,seed,particles,operations_used,budget_exhausted");
    for (n_particles, seed_type, df_targets) in [
        (500, SeedType::Dimers, &[2.5, 2.7, 2.9][..]),
        (2000, SeedType::Monomers, &[1.4, 1.5, 1.6, 1.7][..]),
    ] {
        for &df_target in df_targets {
            for seed in [1, 2, 3] {
                let result = run_tunable_cc_internal(
                    TunableCcParams {
                        n_particles,
                        target_df: df_target,
                        target_kf: 1.3,
                        seed_type,
                        operation_budget: None,
                        ..Default::default()
                    },
                    seed,
                    None,
                ).expect("diagnostic configuration should run");
                println!(
                    "{n_particles},{seed_type:?},{df_target},{seed},{},{},{}",
                    result.coordinates.len(), result.operations_used, result.budget_exhausted
                );
            }
        }
    }
}
