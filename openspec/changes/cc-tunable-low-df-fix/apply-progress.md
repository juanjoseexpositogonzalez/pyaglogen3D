# Apply Progress: cc-tunable-low-df-fix

> SDD artifact — apply phase record.

---

## Phase Completed: 0 (PR1 Slice — Snapshot Capture)

**Branch**: `feature/cc-tunable-low-df-fix-pr1-snapshots`
**Parent/PR target**: `feature/cc-tunable-low-df-fix` (tracker branch)
**Commit SHA**: `0a0041b`
**Branch pushed**: Yes (`git push -u origin feature/cc-tunable-low-df-fix-pr1-snapshots`)
**Mode**: Standard (strict_tdd: false)
**PR budget**: size:exception acknowledged for PR1 (fixtures are non-code artifacts)

---

## Files Created

| File | Action | Lines | Notes |
|------|--------|-------|-------|
| `aglogen_core/engine/Cargo.toml` | Modified | +5/-0 | Added `serde` + `serde_json` to `[dev-dependencies]`; added `[[example]]` entry for `gen_pre_fix_snapshots` |
| `aglogen_core/engine/examples/fixtures/gen_pre_fix_snapshots.rs` | Created | +128/-0 | Fixture generator binary; runs 3 configs and writes compact JSON |
| `aglogen_core/engine/tests/fixtures/pre_low_df_fix/README.md` | Created | +45/-0 | Fixture provenance, regeneration instructions, WARNING about post-fix modification |
| `aglogen_core/engine/tests/fixtures/pre_low_df-fix/seed1_df15.json` | Created | ~359 | seed=1, df=1.5, N=100; 45977 bytes |
| `aglogen_core/engine/tests/fixtures/pre_low_df-fix/seed2_df18.json` | Created | ~265 | seed=2, df=1.8, N=100; 33906 bytes |
| `aglogen_core/engine/tests/fixtures/pre_low_df-fix/seed3_df20.json` | Created | ~264 | seed=3, df=2.0, N=100; 33834 bytes |
| `aglogen_core/Cargo.lock` | Modified | auto | Lock file updated for serde/serde_json |

**Total commit diff**: 7 files changed, 287 insertions(+)

---

## Fixture Content Summary

| File | seed | target_df | coordinates.len() | merge_trace.len() | fractal_dimension | prefactor |
|------|------|-----------|-------------------|-------------------|-------------------|-----------|
| seed1_df15.json | 1 | 1.5 | 100 | 157 | 1.745374 | 1.020018 |
| seed2_df18.json | 2 | 1.8 | 100 | 99 | 1.788168 | 1.320844 |
| seed3_df20.json | 3 | 2.0 | 100 | 99 | 2.008708 | 1.287823 |

All fixtures contain: `coordinates`, `radii`, `rg_evolution`, `fractal_dimension`, `prefactor`, `merge_trace`, `seed`, `target_df`, `n_particles`.

---

## Verification Commands Run + Results

```
$ cargo build --example gen_pre_fix_snapshots -p aglogen-engine
→ Finished dev profile. 42 pre-existing warnings, 0 errors.

$ cargo run --release --example gen_pre_fix_snapshots -p aglogen-engine
→ All 3 fixtures written. seed1_df15.json (45977 bytes), seed2_df18.json (33906 bytes), seed3_df20.json (33834 bytes).

$ cargo run --release --example gen_pre_fix_snapshots -p aglogen-engine  # second run
→ MD5 hashes identical to first run. Determinism confirmed.

$ cargo test --test integration_cc_tunable -p aglogen-engine
→ 9 passed; 0 failed; 1 ignored. All existing tests pass. No source changes.
```

---

## Deviations from tasks.md

| Item | tasks.md spec | Actual | Reason |
|------|---------------|--------|--------|
| Fixture seeds/params | seed=1/Df=1.6/N=200, seed=42/Df=1.5/N=200, seed=99/Df=1.7/N=100 | seed=1/Df=1.5/N=100, seed=2/Df=1.8/N=100, seed=3/Df=2.0/N=100 | Orchestrator prompt is authoritative; N=100 keeps PR1 closer to budget |
| Generator location | `tests/fixtures/generate_snapshots.rs` | `examples/fixtures/gen_pre_fix_snapshots.rs` | `[[example]]` pattern matches existing project convention; test-integration files are for test runners, not generators |
| serde dev-dep | Not mentioned | Added `serde` + `serde_json` to dev-deps | Required for JSON serialization of the mirror struct |

---

## Phase 0 Exit Gate Check

- [x] All 3 fixture files present under `tests/fixtures/pre_low_df_fix/`
- [x] Zero source files in `src/` changed
- [x] Fixtures hash-stable across two consecutive generator runs
- [x] Existing integration tests pass (9/9 non-ignored)

---

## Remaining Phases

- [ ] Phase 1: Module Constants and Flag Reader (PR2)
- [ ] Phase 2: PC Seed Builder + Visibility Promotion (PR2)
- [ ] Phase 3: Wire Flag Into initialize_seed_clusters and find_feasible_pairs (PR2)
- [ ] Phase 4: New Regression Tests (PR3)
- [ ] Phase 5: Rollback Byte-Identity Tests (PR3)
- [ ] Phase 6: R21 Non-Regression Sweep (PR3)
- [ ] Phase 7: CHANGELOG + Docs (PR3)
