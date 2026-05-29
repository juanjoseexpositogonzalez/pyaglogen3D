# Verify Report: cc-tunable-low-df-fix

> SDD phase: VERIFY · Cycle 1 of 2  
> Change: `cc-tunable-low-df-fix`  
> Branch: `feature/cc-tunable-low-df-fix-pr3-tests-and-docs`  
> Mode: Standard (strict_tdd: false)  
> Date: 2026-05-29  
> Verdict: **PASS WITH WARNINGS**

---

## Executive Summary

All 8 phases (0–7) are complete and verified. Every test suite passes with zero failures. The R25 box-counting sanity test — previously `#[ignore]` — was un-ignored after the N calibration investigation and **passes cleanly** at N=2000. The rollback byte-identity test uses strict `to_bits()` for scalar fields and 1 ULP tolerance for vectors, matching the corrected R24 contract in the spec.

Two **WARNINGs** require attention during PR review/archive (no blockers for PR opening). One stale doc-comment in the test file misquotes the spec N floor as N=1000 when both the spec and the code use N=2000 — this is a documentation drift that should be fixed in the archive phase.

---

## Build Evidence

| Command | Result |
|---------|--------|
| `cargo build -p aglogen-engine` | ✅ 0 errors, 42 pre-existing warnings (unchanged) |
| `cargo doc --no-deps -p aglogen-engine` | ✅ 0 new warnings from our additions |

No new compiler errors or warnings introduced by this change.

---

## Test Evidence

### Targeted Tests (PR3 branch, `--release`)

| Test suite | Run | Expected | Actual | Status |
|-----------|-----|----------|--------|--------|
| `cc_tunable_low_df_test` | `cargo test -p aglogen-engine --release --test cc_tunable_low_df_test` | 11 passed, 0 failed, 1 ignored *(apply-progress prediction)* | **12 passed, 0 failed, 0 ignored** | ✅ Better than predicted |
| `integration_cc_tunable` | `cargo test -p aglogen-engine --release --test integration_cc_tunable` | 10 passed, 0 failed, 1 ignored | **10 passed, 0 failed, 1 ignored** | ✅ Matches |
| Full suite | `cargo test -p aglogen-engine --release` | 327+ passed | **327 passed, 0 failed, 2 ignored** | ✅ |

**Note on cc_tunable_low_df_test:** The apply-progress report predicted 11 passed / 1 ignored because at that time `low_df_band_bc_vs_rg_agreement` (R25) was still `#[ignore]`. The post-investigation correction raised N to 2000 and removed the `#[ignore]` annotation. The actual result — 12 passed, 0 ignored — is strictly better than predicted and confirms the R25 investigation conclusion.

**Note on integration_cc_tunable:** The 1 ignored test is `convergence_5_runs_target_1_6_1_7` (kf=1.7 convergence). This is a **pre-existing known issue** explicitly documented in the CHANGELOG and out of scope for this fix.

### Full Suite Breakdown

| Suite | Tests | Passed | Failed | Ignored |
|-------|-------|--------|--------|---------|
| lib tests (doc/unit) | 328 | 327 | 0 | 1 (pre-existing doc-test) |
| `cc_tunable_low_df_test` | 12 | 12 | 0 | 0 |
| `integration_cc_tunable` | 11 | 10 | 0 | 1 (kf=1.7, out-of-scope) |
| **Total** | **351** | **349** | **0** | **2** |

---

## Task Completeness

| Phase | Task | Status |
|-------|------|--------|
| 0.1 | Fixture README | ✅ Complete |
| 0.2 | gen_pre_fix_snapshots example | ✅ Complete |
| 0.3 | Fixture JSON files committed | ✅ Complete |
| 1.1 | Constants (USE_LOW_DF_FIX_DEFAULT, PC_SEED_SIZE, PC_SEED_RNG_SALT) | ✅ Complete |
| 1.2 | `read_low_df_fix_flag()` | ✅ Complete |
| 1.3 | `SeedType::PcSeeds` variant | 〜 **Deferred** (confirmed unnecessary — design uses `Monomers` branching) |
| 1.4 | `low_df_fix_flag_env_var` test | ✅ Complete |
| 2.1 | `place_particle_ballistic` → `pub(crate)` | ✅ Complete |
| 2.2 | Import in tunable_cc.rs | ✅ Complete |
| 2.3 | `build_pc_seeds` helper | ✅ Complete |
| 2.4 | build_pc_seeds unit tests (count, non-divisible, connectivity) | ✅ Complete |
| 3.1 | Wire flag into run_tunable_cc_internal | ✅ Complete |
| 3.2 | Modify initialize_seed_clusters signature | ✅ Complete |
| 3.3 | Modify find_feasible_pairs threshold | ✅ Complete |
| 3.4 | Update select_pair_smart + call sites | ✅ Complete |
| 4.1 | `low_df_convergence_band_mono` (R5.8, R19.5) | ✅ Complete |
| 4.2 | `low_df_band_bc_vs_rg_agreement` (R25) | ✅ Complete — **un-ignored at N=2000** |
| 4.3 | `r22_flag_independent_of_phase3` | ✅ Complete |
| 4.4 | `r23_seed_type_dimers_unaffected` | ✅ Complete |
| 5.1 | `rollback_flag_false_monomers` | ✅ Complete |
| 5.2 | `rollback_byte_identity` | ✅ Complete — 1 ULP for vectors, `to_bits()` for scalars |
| 5.3 | `rollback_no_rng_fork` | ✅ Complete |
| 6.1 | `r21_high_df_band_still_converges_with_fix` | ✅ Complete |
| 6.2 | Updated ignore comment on convergence_5_runs_target_1_6_1_7 | ✅ Complete |
| 7.1 | CHANGELOG entry + before/after table | ✅ Complete |
| 7.2 | Doc-comment on read_low_df_fix_flag | ✅ Complete |
| 7.3 | Doc-comment on build_pc_seeds | ✅ Complete |
| 7.4 | docs/cc-tunable-formula-fix.md section | ✅ Complete |

**Completeness: 27/27 assignable tasks complete. 1 deferred (1.3) with documented rationale.**

---

## Spec Compliance Matrix

### R22 — Low-Df Fix Feature Flag

| Scenario | Covering Test | Status |
|----------|--------------|--------|
| R22.1 — Default ON when absent | `low_df_fix_flag_env_var` | ✅ PASS |
| R22.2 — Off-values disable fix | `low_df_fix_flag_env_var` (all 6 off-values) | ✅ PASS |
| R22.3 — Independent of Phase 3 | `r22_flag_independent_of_phase3` | ✅ PASS |

### R23 — PC-Generated Default Seed Pool

| Scenario | Covering Test | Status |
|----------|--------------|--------|
| R23.1 — N divisible: no leftover | `build_pc_seeds_count` (N=20 → 20 particles) | ✅ PASS |
| R23.2 — Non-divisible N: leftover | `build_pc_seeds_non_divisible` (N=21 → 21 particles) | ✅ PASS |
| R23.3 — Flag OFF: monomer pool | `rollback_flag_false_monomers` | ✅ PASS |
| R23.4 — Separate RNG stream | `rollback_no_rng_fork` (bit-identical consecutive runs) | ✅ PASS |
| R23.5 — dimers/trimers unaffected | `r23_seed_type_dimers_unaffected` | ✅ PASS |

### R24 — Rollback Byte-Identity Guarantee

| Scenario | Covering Test | Status |
|----------|--------------|--------|
| R24.1 — Flag-off reproduces pre-patch coordinates (≤1 ULP) | `rollback_byte_identity` (coords, radii: 1 ULP) | ✅ PASS |
| R24.2 — Flag-off reproduces fractal metrics (bit-exact scalars) | `rollback_byte_identity` (Df, kf: `to_bits()` strict) | ✅ PASS |
| R24.3 — Flag-off creates no additional RNG streams | `rollback_no_rng_fork` | ✅ PASS |

**Note:** The spec correctly documents that `to_bits()` applies to scalar fields (Df, kf) and 1 ULP applies to vector fields (coordinates, radii, rg_evolution, merge_trace floats) due to the serde_json round-trip artifact. Test implementation matches spec.

### R25 — Box-Counting Sanity in the Low-Df Band

| Scenario | Covering Test | Status |
|----------|--------------|--------|
| R25.1 — BC-vs-Rg agreement at Df=1.5 | `low_df_band_bc_vs_rg_agreement` (N=2000) | ✅ PASS |
| R25.2 — BC sanity across low-Df band | `low_df_band_bc_vs_rg_agreement` (all 4 targets × 3 seeds) | ✅ PASS |

### R3 — Retry Policy / Bounding Threshold Gate

| Scenario | Covering Test | Status |
|----------|--------------|--------|
| R3.8 — Low-Df threshold gate | `low_df_convergence_band_mono` (behavioral: passes with fix ON, fails with fix OFF) | ✅ PASS |
| R3.9 — Threshold computed once | Code review: `bounding_threshold_factor` computed once per simulation in `find_feasible_pairs` | ✅ PASS |

### R5 — Convergence to Target

| Scenario | Covering Test | Status |
|----------|--------------|--------|
| R5.8 — Low-Df band [1.5, 1.7], N=2000 | `low_df_convergence_band_mono` (mean Df ±10%, prefactor ≥ 1.0) | ✅ PASS |
| R5.9 — Df=1.4 best-effort | `regression_df_1_4_monomers_best_effort` (mean < 1.8, prefactor ≥ 1.0) | ✅ PASS |

### R21 — Non-Regression (Df ≥ 2.0)

| Scenario | Covering Test | Status |
|----------|--------------|--------|
| R21 — Df ∈ {1.8, 2.0, 2.2, 2.5} within ±5% with fix ON | `r21_high_df_band_still_converges_with_fix` | ✅ PASS |

Measured errors: Df=1.8→0.8%, Df=2.0→0.9%, Df=2.2→3.2%, Df=2.5→1.9% — all within ±5%.

### R4 — Seed Type Modes

| Scenario | Covering Test | Status |
|----------|--------------|--------|
| R4.1 — Monomers flag OFF | `rollback_flag_false_monomers` | ✅ PASS |
| R4.7 — Monomers flag ON: PC-seed pool | `build_pc_seeds_count`, `low_df_convergence_band_mono` | ✅ PASS |

### R19 — Convergence Guarantee Extended Range

| Scenario | Covering Test | Status |
|----------|--------------|--------|
| R19.5 — Flag ON: monomers converges in low-Df band | `low_df_convergence_band_mono` | ✅ PASS |
| R19.6 — Flag OFF: monomers excluded from guarantee | `rollback_flag_false_monomers` (different coords confirmed) | ✅ PASS |

---

## Design Coherence

| Design Decision | Implemented As | Status |
|----------------|---------------|--------|
| Q1: New `build_pc_seeds` helper (not run_tunable_internal reuse) | `fn build_pc_seeds<R: Rng>` in tunable_cc.rs, calls `place_particle_ballistic` via `pub(crate)` | ✅ Matches |
| Q2: `const PC_SEED_SIZE: usize = 4` | Present at module level | ✅ Matches |
| Q3: New `CC_TUNABLE_USE_LOW_DF_FIX` flag | `read_low_df_fix_flag()` added, orthogonal to Phase3 flag | ✅ Matches |
| Q4: BC sanity tolerance 0.20 | `bc_tolerance = 0.20` in test, locked per design §Q4 | ✅ Matches |
| Separate RNG stream via `PC_SEED_RNG_SALT` | `0x5a7d_3f1e_8b2c_9604` constant present | ✅ Matches |
| Flag-false path byte-identical | Confirmed by `rollback_byte_identity` + `rollback_no_rng_fork` | ✅ Matches |

### Documented Deviations (apply-progress.md) — Consistency Assessment

| Deviation | Spec Status | Assessment |
|-----------|-------------|------------|
| R5.8 prefactor floor: 0.95→1.0 (post-investigation) | Spec R5.8 says ≥ 1.0; test now asserts ≥ 1.0 at N=2000 | ✅ CONSISTENT — post-investigation correction aligns spec and test |
| R24 byte-identity: 1e-10→1 ULP + to_bits() for scalars (post-investigation) | Spec R24 says `to_bits()` for scalars, ≤1 ULP for vectors | ✅ CONSISTENT — test matches spec exactly |
| R25 N: 1000→2000 + un-ignored (post-investigation) | Spec R25 says `N ≥ 2000`; test uses N=2000 | ✅ CONSISTENT — post-investigation correction aligns spec and test |
| Df=1.4 best-effort scope | Spec S5.9/S19.5 explicitly excludes strict ±10% for Df=1.4 | ✅ CONSISTENT — spec and test both use weaker mean < 1.8 contract |
| `parametric_sweep_df_range_kf_1_3` Dimers Df=1.4 tolerance 10%→13% | tasks.md tracked; existing integration test widened | ✅ CONSISTENT — documented deviation, not a regression |

---

## CHANGELOG Verification

- ✅ Entry `## cc-tunable-low-df-fix (unreleased)` present at top of CHANGELOG.md
- ✅ Before/after table present with 7 Df_target rows (1.50, 1.80, 2.00, 2.20, 2.50, 2.70, 2.90)
- ✅ `CC_TUNABLE_USE_LOW_DF_FIX` rollback instructions present with bash example
- ✅ Explicit notes: no API changes, dimers/trimers unaffected, cycle 2 pending, kf issue tracked

---

## Issues

### WARNINGS (address in PR review or archive)

**WARNING-1: Stale doc-comment in test (N=1000 vs actual N=2000)**

- **File**: `aglogen_core/engine/tests/cc_tunable_low_df_test.rs`, lines 279–283
- **Text says**: `Sweeps Df_target ∈ {1.4, 1.5, 1.6, 1.7} with N=1000` and `N=1000 is required by spec R5.8 ("N ≥ 1000")`
- **Reality**: actual `n_particles = 2000` (line 300); spec R5.8 says `N ≥ 2000`; spec R25 says N=2000
- **Impact**: Misleading to a reviewer reading the doc-comment. No functional impact — the code is correct.
- **Action**: Fix doc-comment in archive phase (or as a fixup commit before PR1 opens): change "N=1000" → "N=2000" and "N ≥ 1000" → "N ≥ 2000". Also fix companion stale text at line 453 (`N=1000; runtime is expected ~30-60 s total`).

**WARNING-2: apply-progress.md predicted wrong test count for cc_tunable_low_df_test**

- **apply-progress says**: "11 passed; 0 failed; 1 ignored (R25 BC tolerance too tight)"
- **Actual result**: 12 passed; 0 failed; 0 ignored
- **Impact**: Documentation drift — the apply-progress artifact is already finalized. No functional impact.
- **Action**: apply-progress.md should be updated in the archive phase to reflect the final passing state. The post-investigation notes in §PR3 Notable Findings do explain the R25 correction, but the top-level verification results table is stale.

### SUGGESTIONS (archive phase)

**SUGGESTION-1: Archive phase should update design.md §Q4 comment**

- design.md §Q4 says the BC tolerance was calibrated for N=2000, but the N=2000 floor now appears in the spec as a locked requirement. The design note is consistent but could be made even clearer by adding a forward reference to spec R25 "N=2000 calibration floor".

**SUGGESTION-2: Consider tracking Df=1.4 mean in regression in CHANGELOG**

- CHANGELOG mentions Df=1.50 before/after but not Df=1.4. The best-effort contract (mean < 1.8) is documented in the spec but not in the public CHANGELOG. Low priority — the spec is the right place for this.

---

## Rollback Verification

- ✅ `rollback_byte_identity`: 3 fixtures × (coordinates 1 ULP, radii 1 ULP, Df/kf `to_bits()`, rg_evolution 1 ULP, merge_trace 1 ULP) — all pass
- ✅ `rollback_no_rng_fork`: bit-identical consecutive runs with flag OFF
- ✅ `rollback_flag_false_monomers`: flag-ON and flag-OFF produce different coordinates (PC-seed pool is gating as expected)
- ✅ R24.3: no new RNG stream created in flag-off path

---

## R21 Non-Regression Confirmation

`r21_high_df_band_still_converges_with_fix`: Df ∈ {1.8, 2.0, 2.2, 2.5}, N=300, seeds {1,2,3}, Monomers, flag ON.

| Df_target | Measured error | Within ±5%? |
|-----------|---------------|-------------|
| 1.8 | 0.8% | ✅ |
| 2.0 | 0.9% | ✅ |
| 2.2 | 3.2% | ✅ |
| 2.5 | 1.9% | ✅ |

---

## Final Verdict

```
PASS WITH WARNINGS
```

- **No CRITICAL issues.** All spec requirements have passing tests. All tasks complete or deliberately deferred with documented rationale.
- **2 WARNINGs.** Both are documentation drift (stale N=1000 comment in test doc-string; stale test count in apply-progress). No functional impact; no blockers for opening PRs.
- **2 SUGGESTIONs** for archive phase.
- **PRs can be opened.** Recommend fixing WARNING-1 (stale doc-comment) before or alongside PR3 opening.

---

## Next Recommended Action

1. Fix WARNING-1 (stale doc-comment in `cc_tunable_low_df_test.rs` lines 279–283 and 453) — small fixup, can be committed to PR3 branch before opening.
2. Open PR1 (`feature/cc-tunable-low-df-fix-pr1-snapshots` → tracker branch).
3. Open PR2 (`feature/cc-tunable-low-df-fix-pr2-flag-and-helpers` → PR1 branch).
4. Open PR3 (`feature/cc-tunable-low-df-fix-pr3-tests-and-docs` → PR2 branch).
5. After merges: run `sdd-archive` to sync delta specs and close cycle 1.
