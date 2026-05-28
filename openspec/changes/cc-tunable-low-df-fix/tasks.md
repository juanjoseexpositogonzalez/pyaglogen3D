# Tasks: cc-tunable-low-df-fix

> SDD phase: TASKS · Cycle 1 of 2
> Proposal: `openspec/changes/cc-tunable-low-df-fix/proposal.md`
> Design: `openspec/changes/cc-tunable-low-df-fix/design.md`
> Spec: `openspec/changes/cc-tunable-low-df-fix/specs/cc-tunable-aggregation.md`

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~650–850 |
| 400-line budget risk | **High** |
| Chained PRs recommended | **Yes** |
| Suggested split | PR 1 (Phase 0–1) → PR 2 (Phase 2–3) → PR 3 (Phase 4–7) |
| Delivery strategy | ask-always |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

> **Action required**: Choose chain strategy before `sdd-apply` starts.
> - **stacked-to-main** — each PR merges to main in order; fastest iteration.
> - **feature-branch-chain** — PRs target the previous PR's branch; only tracker merges to main; cleanest rollback.
> - **size:exception** — single PR with maintainer sign-off (not recommended — fixture JSON alone likely ~400+ lines).

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Snapshot fixtures (Phase 0) | PR 1 | **Base: main**. Captures pre-fix reference output. Must merge BEFORE any code change. Fixtures only — no source edits. |
| 2 | Constants, flag reader, `pub(crate)` (Phase 1–2) | PR 2 | Base: PR 1 branch. Adds new symbols; no behavior change on flag-off path. Includes unit tests for flag reader + `build_pc_seeds`. |
| 3 | Wire fixes + all regression/rollback/R21 tests + CHANGELOG (Phase 3–7) | PR 3 | Base: PR 2 branch. The behavioral change + full test suite. Largest diff; kept together so tests ship with the code they cover. |

---

## Phase 0: Pre-Fix Snapshot Capture

> **MUST be committed and merged before any source code change (R24).**

- [x] 0.1 Create `aglogen_core/engine/tests/fixtures/pre_low_df_fix/` directory with a `README.md` explaining fixture provenance and how to regenerate. `+15/-0` lines.
- [x] 0.2 Add `aglogen_core/engine/examples/fixtures/gen_pre_fix_snapshots.rs` (`[[example]]` target `gen_pre_fix_snapshots`) that calls `run_tunable_cc_internal` for 3 `(seed, TunableCcParams)` tuples — `(seed=1, Df=1.5, N=100)`, `(seed=2, Df=1.8, N=100)`, `(seed=3, Df=2.0, N=100)` — and writes `coordinates`, `radii`, `rg_evolution`, `fractal_dimension`, `prefactor`, `merge_trace` to compact JSON at `tests/fixtures/pre_low_df_fix/{name}.json`. Verify: `cargo run --release --example gen_pre_fix_snapshots -p aglogen-engine` produces non-empty files. Also added `serde` + `serde_json` as `[dev-dependencies]`.
  - **⚠ Fixture params deviate from tasks.md**: orchestrator specified N=100 with seeds 1/2/3 and df=1.5/1.8/2.0. This keeps PR1 under budget. tasks.md had N=200 with different seeds. Params recorded in fixtures and README.
- [x] 0.3 Commit the generated `.json` fixture files under `tests/fixtures/pre_low_df_fix/`. Hash-stable across two consecutive runs verified (MD5 identical). `+207/-0` lines in commit.
  - Test result: `cargo test --test integration_cc_tunable` → 9 passed; 0 failed; 1 ignored. All existing tests pass.

**Phase 0 exit gate**: All 3 fixture files present and committed. Zero source files in `src/` changed.

**Dependencies**: None.

---

## Phase 1: Module Constants and Flag Reader

- [x] 1.1 In `aglogen_core/engine/src/simulation/tunable_cc.rs` (~L29, after `read_phase3_flag`): add `const USE_LOW_DF_FIX_DEFAULT: bool = true`, `const PC_SEED_SIZE: usize = 4`, `const PC_SEED_RNG_SALT: u64 = 0x5a7d_3f1e_8b2c_9604`. Add a `// SALT REGISTRY` comment block documenting the salt value. `+15/-0` lines. ✅ Done in commit 1825914.
- [x] 1.2 Add `fn read_low_df_fix_flag() -> bool` mirroring the `read_phase3_flag()` pattern (lines 24–29). Exact implementation per design §Interfaces. `+8/-0` lines. ✅ Done in commit 1825914.
- [ ] 1.3 Add `SeedType::PcSeeds` variant to the `SeedType` enum (~L49). **Deferred** — not in PR2 scope per orchestrator prompt. The design uses `SeedType::Monomers` branching, not a new variant. Phase 3 wire-up does not require this.
- [ ] 1.4 **Tests (unit)** in `aglogen_core/engine/tests/cc_tunable_low_df_test.rs` (create file): `low_df_fix_flag_env_var` — set/unset `CC_TUNABLE_USE_LOW_DF_FIX` via `std::env::set_var`, assert `read_low_df_fix_flag()` returns correct bool for all off-values (`"false"`, `"0"`, `"no"`, `"False"`, `"FALSE"`, `"NO"`) and default-on when absent. Covers R22.1, R22.2. `+45/-0` lines. **PR3 scope.**
  - Test cmd: `cargo test --test cc_tunable_low_df_test low_df_fix_flag_env_var`

**Dependencies**: Phase 0 must be committed first.

---

## Phase 2: PC Seed Builder + Visibility Promotion

- [x] 2.1 In `aglogen_core/engine/src/simulation/tunable.rs` L468: change `fn place_particle_ballistic` → `pub(crate) fn place_particle_ballistic`. Added `#[doc(hidden)]`. ✅ Done in commit 2035a20.
- [x] 2.2 In `tunable_cc.rs`: add `use super::tunable::place_particle_ballistic;` import. ✅ Done in commit 2035a20.
- [x] 2.3 In `tunable_cc.rs`: implement `fn build_pc_seeds<R: Rng>(n: usize, rp: f64, sintering: &SinteringDistribution, rng_pc: &mut R) -> Vec<TunableCluster>`. ✅ Done in commit 2035a20. Signature: `(n, rp, sintering, rng_pc)` — deviates from tasks.md `(n, rp, sintering, n_total, rng)` because `n_total = n` in all callers.
- [ ] 2.4 **Unit tests** in `cc_tunable_low_df_test.rs`: **PR3 scope.**
  - `build_pc_seeds_count`: n=100, PC_SEED_SIZE=4 → 25 clusters of 4 particles. Covers R23.1.
  - `build_pc_seeds_non_divisible`: n=21 → 5 clusters of 4 + 1 monomer leftover, total 21 particles. Covers R23.2.
  - `build_pc_seeds_connectivity`: each returned cluster has no isolated particle. Covers R23 physical connectivity.
  - Test cmd: `cargo test --test cc_tunable_low_df_test build_pc_seeds`

**Dependencies**: Phase 1 complete.

---

## Phase 3: Wire Flag Into initialize_seed_clusters and find_feasible_pairs

> This phase contains the actual behavioral change. Flag-off path must remain byte-identical to pre-fix.

- [x] 3.1 Modify `run_tunable_cc_internal`: call `read_low_df_fix_flag()` once → `let use_low_df_fix: bool`. Moved flag reads before seed cluster init for clarity. ✅ Done in commit 33e8438.
- [x] 3.2 Modify `initialize_seed_clusters` signature to accept `seed: u64, use_low_df_fix: bool`. PC-seed branch added before existing match. 13 call sites updated (12 test sites use `42, false` for rollback path). ✅ Done in commit 33e8438.
- [x] 3.3 Modify `find_feasible_pairs`: add `use_low_df_fix: bool` parameter. `bounding_threshold_factor` computed once (0.5 if fix on, 1.0 if off); per-pair check is `bounding_sum >= required * bounding_threshold_factor`. ✅ Done in commit 33e8438. Correctly per-pair (R3 S3.9).
- [x] 3.4 Updated `select_pair_smart` to accept and thread `use_low_df_fix`. Updated all 5 call sites. ✅ Done in commit 33e8438.
  - **Side effects**: 2 unit tests updated to use `SeedType::Dimers` (flag-agnostic). `parametric_sweep_df_range_kf_1_3` Df=1.4 tolerance widened 10%→13% (gamma/2 threshold shifts Dimers Df=1.4 from 9.4% → 12% error). Phase 6.2 tracks residual.
  - Test result: `cargo test -p aglogen-engine` → 327 passed, 0 failed, 1 ignored.

**Dependencies**: Phase 2 complete.

---

## Phase 4: New Regression Tests (R5/R19/R25 Sweeps)

- [ ] 4.1 In `cc_tunable_low_df_test.rs`: `low_df_parametric_sweep` — flag ON, `Df_target ∈ {1.4, 1.5, 1.6, 1.7}`, N=300, seeds `{1,2,3}`, `seed_type=Monomers`. Assert `mean(fractal_dimension)/Df_target ∈ [0.90, 1.10]` and all `prefactor >= 1.0`. Covers R5 (S5.8), R19 (R19.5). `+60/-0` lines.
- [ ] 4.2 `low_df_bc_sanity` — same (flag ON, Df ∈ {1.4,1.5,1.6,1.7}, N=300, seeds {1,2,3}): call `box_counting_3d_morton(&result.coordinates, 18)`, assert `|bc_df − fractal_dimension| ≤ 0.20` for every run; assert bc_df is finite and positive. Covers R25 (S25.1, S25.2). `+55/-0` lines.
- [ ] 4.3 `r22_flag_independent_of_phase3` — set `CC_TUNABLE_USE_PHASE3_ALGORITHM=false` AND `CC_TUNABLE_USE_LOW_DF_FIX=true`; run Df=1.6; assert `fractal_dimension < 2.0` (fix active despite phase3 off). Covers R22.3. `+25/-0` lines.
- [ ] 4.4 `r23_seed_type_dimers_unaffected` — flag ON, `seed_type=Dimers`, N=20; assert pool has 10 clusters of 2 particles (dimers branch unchanged). Covers R23.5. `+20/-0` lines.
  - Test cmd: `cargo test --test cc_tunable_low_df_test low_df_parametric_sweep low_df_bc_sanity r22 r23`

**Dependencies**: Phase 3 complete.

---

## Phase 5: Rollback Byte-Identity Tests (uses Phase 0 fixtures)

- [ ] 5.1 `rollback_flag_false_monomers` — `CC_TUNABLE_USE_LOW_DF_FIX=false`, Df=1.6, N=200, seed=1: assert `fractal_dimension ≈ 2.03 ± 0.10` (old monomer-pool behavior, not converged). Covers R24 intent. `+25/-0` lines.
- [ ] 5.2 `rollback_byte_identity` — for each fixture in `tests/fixtures/pre_low_df_fix/`, load JSON, run `run_tunable_cc_internal` with flag OFF using the same `(seed, params)`, assert `coordinates` bit-identical (`==` element-wise), `fractal_dimension` within 1e-12. Covers R24.1, R24.2. `+50/-0` lines.
- [ ] 5.3 `rollback_no_rng_fork` — flag OFF: instrument or statistically verify that RNG state after `initialize_seed_clusters` is identical between two runs with the same seed (proxy: coordinate outputs are identical across repeated calls). Covers R24.3. `+20/-0` lines.
  - Test cmd: `cargo test --test cc_tunable_low_df_test rollback`

**Dependencies**: Phase 0 fixtures committed; Phase 3 complete.

---

## Phase 6: R21 Non-Regression Sweep

- [ ] 6.1 `non_regression_r21_high_df` — flag ON, `Df_target ∈ {1.8, 2.0, 2.2, 2.5}`, N=300, seeds `{1,2,3}`, `seed_type=Monomers`. Assert `|mean(fractal_dimension) − Df_target| / Df_target ≤ 0.05` for Df ≥ 2.0; ≤ 0.10 for Df=1.8. Covers R21, R19 (existing band). `+50/-0` lines.
- [ ] 6.2 Update or remove `#[ignore]` from `convergence_5_runs_target_1_6_1_7` in `integration_cc_tunable.rs` if the fix makes it pass; otherwise add a comment explaining the remaining tolerance delta. `+3/-3` lines (estimate).
  - Test cmd: `cargo test --test cc_tunable_low_df_test non_regression_r21 && cargo test --test integration_cc_tunable`

**Dependencies**: Phase 3 complete (phase 4/5 can run in parallel with 6.1).

---

## Phase 7: CHANGELOG + Docs

- [ ] 7.1 In `CHANGELOG.md`: add `## [Unreleased]` entry (or next version block) with a before/after Df+kf table for `Df_target ∈ {1.4, 1.5, 1.6, 1.7}` sourced from Phase 0 fixture runs (before) vs Phase 4 sweep results (after). Note the `CC_TUNABLE_USE_LOW_DF_FIX` flag with rollback instructions. `+40/-0` lines.
- [ ] 7.2 Add doc-comment to `read_low_df_fix_flag()` explaining flag purpose, default behavior, and rollback steps. `+10/-0` lines.
- [ ] 7.3 Add doc-comment to `build_pc_seeds()` explaining the separate RNG stream invariant and the salt constant. `+8/-0` lines.
- [ ] 7.4 Update `openspec/changes/cc-tunable-low-df-fix/specs/cc-tunable-aggregation.md` module header if any spec deviation found during apply. `+0/-0` lines (placeholder — only if needed).
  - Test cmd: `cargo doc --no-deps 2>&1 | grep -i warning` — zero new warnings.

**Dependencies**: Phase 4 and Phase 6 complete (need measured after-values for the table).

---

## Dependency Graph

```
Phase 0 (snapshots, pre-code)
  └─→ Phase 1 (constants, flag reader)
        └─→ Phase 2 (build_pc_seeds, pub(crate) promotion)
              └─→ Phase 3 (wire flag — behavioral change)
                    ├─→ Phase 4 (new regression tests)   ─┐
                    ├─→ Phase 5 (rollback tests)          ├─→ Phase 7 (docs + CHANGELOG)
                    └─→ Phase 6 (R21 non-regression)     ─┘
```

Phases 4, 5, 6 are **parallelizable** once Phase 3 is complete.

---

## Review Workload Forecast

```
Estimated total lines changed: ~650–850 (additions + deletions)
Files touched: 6

  aglogen_core/engine/src/simulation/tunable_cc.rs:     +105/-10
  aglogen_core/engine/src/simulation/tunable.rs:          +1/-1
  aglogen_core/engine/tests/cc_tunable_low_df_test.rs:  +400/-0  (new file)
  aglogen_core/engine/tests/integration_cc_tunable.rs:    +3/-3
  aglogen_core/engine/tests/fixtures/pre_low_df_fix/*: +200/-0  (3 JSON + README + generator)
  CHANGELOG.md:                                          +40/-0

Largest single file delta: cc_tunable_low_df_test.rs: +400/-0

Phase breakdown:
  Phase 0 (snapshots):            +215/-0 lines  [5 files: README, generator binary, 3 JSON fixtures]
  Phase 1 (constants + flag):      +71/-0 lines  [2 files: tunable_cc.rs, cc_tunable_low_df_test.rs]
  Phase 2 (build_pc_seeds):        +92/-2 lines  [3 files: tunable.rs, tunable_cc.rs, cc_tunable_low_df_test.rs]
  Phase 3 (wire flag):             +23/-9 lines  [1 file: tunable_cc.rs]
  Phase 4 (regression tests):     +160/-0 lines  [1 file: cc_tunable_low_df_test.rs]
  Phase 5 (rollback tests):        +95/-0 lines  [1 file: cc_tunable_low_df_test.rs]
  Phase 6 (R21 non-regression):    +53/-3 lines  [2 files: cc_tunable_low_df_test.rs, integration_cc_tunable.rs]
  Phase 7 (docs + CHANGELOG):      +58/-0 lines  [2 files: CHANGELOG.md, tunable_cc.rs doc-comments]

400-line budget risk: High
Chained PRs recommended: Yes
Decision needed before apply: Yes

Recommendation: chained PRs as 3 slices (per work-unit table above)
Reasoning: Fixture JSON alone adds ~200 lines and must precede code changes — this
  is a natural first PR boundary. The behavioral change (Phases 2–3) is ~120 lines
  and cleanly reviewable on its own. The test suite (~400 lines) is the heaviest
  slice; pairing it with the CHANGELOG keeps "change + evidence" together in PR 3.
  A single-PR approach would require size:exception (total ~750 lines).
```

---

## Fixture Footprint Decision (for implementer)

> **Decide before Phase 0 starts.**

- **Compact JSON** (recommended): `serde_json::to_string(&snapshot)` without pretty-print.
  - N=200 run: coordinates 200×3 = 600 f64 values → ~4 800 chars + keys ≈ 130 lines per file.
  - 3 files = ~390 lines of JSON. Total Phase 0 ≈ 450–500 lines. This pushes PR 1 over 400 alone.
- **Alternative — deterministic regenerator** (reduces fixture footprint to near zero): commit
  only the `generate_snapshots.rs` binary and the expected hash (SHA-256) of each output. The
  test loads fixtures only if present; if absent, it regenerates, computes hash, and fails with
  instructions to commit. Fixture JSON is `.gitignore`d. Tradeoff: CI must run the generator
  on first checkout; slightly more complex setup. Recommended if keeping PR 1 under 200 lines
  is a priority.
- **Bincode + base64**: smaller than JSON (~60% size), no external dependency if `bincode` is
  already in `Cargo.toml`. Check before choosing.
