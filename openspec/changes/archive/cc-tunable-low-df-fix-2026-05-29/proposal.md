# Proposal: cc-tunable-low-df-fix

> SDD phase: PROPOSAL · Cycle 1 of 2 (Cycle 2 = `cc-tunable-high-df-fix`)
> Jira: TBD (PYA-NN — to be assigned)
> Prior exploration: `openspec/changes/cc-tunable-df-fidelity/explore.md`
> Empirical evidence: Engram topic `cc-tunable-bug-study-2026-05` (#705)

## Intent

The CC-tunable generator silently produces structurally wrong aggregates whenever the user asks for `Df_target ≤ 1.7`. The UI reports the failure transparently: for `Df_target=1.5` it shows `Df=2.74` and `kf<1` (the latter is physically impossible — real aggregates always have `kf≥1`).

Production diagnostics (`examples/diagnostics/rg_evolution_tail.rs`, N=2000, 3 seeds, Phase 3 active by default) prove the cluster is NOT fractal: the second half of the (N, Rg) growth trajectory does not follow a power law (`tail 30% → Df=-7.25, kf=3.4e19`). The full-trajectory OLS hides the explosion by averaging it against the ballistic-like early merges.

Why five prior cycles in this area missed it: they each fixed one piece — the formula (`cc-tunable-formula-fix`), the trace (`cc-tunable-merge-trace`), Phase 3 mechanics (`pya-14-phase3-df-convergence`), seed-type routing (`pya-14-phase2-seed-type-fix`). None questioned the **combination** of strict bounding-check + monomer-only pool + Rg-trajectory estimator, which conspires only in the low-Df band.

## Scope

### In Scope
- Restore convergence (`|mean(Df) − Df_target| / Df_target ≤ 10%`) for `Df_target ∈ [1.4, 1.7]` with `N ≥ 100`, `seeds ≥ 3`.
- Eliminate `kf<1` outputs in the low-Df band.
- Add seed-pinned regression tests that exercise `Df_target ∈ {1.4, 1.5, 1.6, 1.7}`.
- CHANGELOG comparison table showing `before/after` Df+kf for representative `Df_target` values.

### Out of Scope
- `Df_target ≥ 2.5` ceiling at ~2.4 (different root cause, deferred to `cc-tunable-high-df-fix`).
- Box-counting (`calcularDfAglomerados`) parity — measurement, not generation.
- Refactoring `MergeTraceEntry` schema beyond what the fix needs.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `cc-tunable-aggregation`: R3 (bounding check threshold), R4/R6 (default seed pool composition), R5/R19 (convergence guarantee extended to `Df_target ∈ [1.4, 1.7]`).

## Approach

**Recommended: combined fix (a + b)** — both root causes are independent failure points; fixing only one leaves the other active and the bug will reappear under different parameter combinations.

### (a) Loosen the bounding-check threshold to MATLAB's `gamma/2` rule
- File: `aglogen_core/engine/src/simulation/tunable_cc.rs` lines 405 and 1959
- Today: `bounding_sum >= required_distance` (full `gamma`)
- MATLAB: `(rEnvol1 + rEnvol2) >= gamma/2` (more permissive — accepts pairs Rust rejects)
- Effect: more low-Df pairs pass feasibility → fewer fall through to ballistic fallback.

### (b) Replace monomer-only default seed pool with PC-generated seed clusters
- File: same module, `initialize_seed_clusters` (line ~917) + `build_monomers` (line ~808)
- Today: N independent monomers; the first ~N/2 merges have `n1=n2=1`, geometrically incapable of enforcing any Df > 1.0.
- MATLAB: `floor(N/4)` PC-generated 4-particle seeds via `agloGen3D('PC')`.
- Effect: every merge starts with a sub-cluster that already has measurable Rg → tunable formula has feasible targets from step 0.

### Approaches considered and rejected
| Option | Why rejected |
|---|---|
| (a) only | Leaves monomer-pool bias in the trajectory estimator; kf<1 persists. |
| (b) only | Leaves stricter-than-MATLAB feasibility screen; ballistic fallback rate stays elevated. |
| (d) Reformulate `calculate_com_distance` for low Df | Formula is algebraically correct (verified in explore.md §1; archived 2026-05-04). Reformulating would re-break the working `Df ∈ [1.8, 2.2]` band. |

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `aglogen_core/engine/src/simulation/tunable_cc.rs` | Modified | Bounding threshold (lines 405, 1959); seed pool init (~917, ~808) |
| `aglogen_core/engine/src/simulation/seed_clusters.rs` (new or extend existing) | New/Modified | PC-seeded cluster builder for the default path |
| `aglogen_core/engine/tests/cc_tunable_low_df_test.rs` | New | Parametric sweep for `Df_target ∈ [1.4, 1.7]` |
| `examples/diagnostics/rg_evolution_tail.rs` | Read-only | Reused as before/after evidence in CHANGELOG |
| `CHANGELOG.md` | Modified | Comparison table |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Historical reproducibility broken: all CC-tunable runs will produce different `fractal_dimension`/`kf` values (this is the POINT of the fix — old outputs were wrong) | High | CHANGELOG with before/after table; seed-pinned regression tests; explicit user-facing note in release notes |
| Loosening the bounding check leaks into `Df_target ≥ 1.8` band and regresses R21 (Df ≥ 2.0 ±5%) | Medium | R21 non-regression test MUST pass; sweep `Df ∈ {1.8, 2.0, 2.2, 2.5}` before merging |
| PC-seed generation adds non-trivial cost to simulation startup | Low | PC seeds are O(seed_size · log seed_size) per seed and run once; profile before merging |

## Rollback Plan

Gate both changes behind the existing `CC_TUNABLE_USE_PHASE3_ALGORITHM` flag mechanism (or introduce a sibling `CC_TUNABLE_USE_LOW_DF_FIX` flag if needed for finer rollback). Setting flag to `false` reverts to current monomer-pool + strict-bounding behavior. Old runs in the DB are not migrated; new runs use the new defaults.

## Dependencies

- Prior cycle archived: `cc-tunable-formula-fix` (formula already correct).
- Required reading: `openspec/changes/cc-tunable-df-fidelity/explore.md` + Engram #705.
- Will be followed by: `cc-tunable-high-df-fix` (separate proposal, addresses `Df_target ≥ 2.5` cap).

## Success Criteria

- [ ] `mean(Df_measured) / Df_target ∈ [0.90, 1.10]` for `Df_target ∈ {1.4, 1.5, 1.6, 1.7}` over ≥ 3 seeds.
- [ ] No run in the low-Df band reports `kf < 1.0`.
- [ ] `rg_evolution` tail (last 50% of merges) yields a positive Df within ±15% of `Df_target` for the same band.
- [ ] R21 non-regression: `Df_target ∈ {2.0, 2.5}` still converges within existing ±5% tolerance.
- [ ] CHANGELOG contains a before/after Df+kf table.

## Open Questions for Design Phase

1. Does the PC seed builder reuse the existing `TuningPC` Rust path, or do we need a new lightweight `build_pc_seed(size=4)` helper? (Affects scope.)
2. Should the seed size be a parameter (`seed_size: usize = 4`) or hardcoded to MATLAB's 4? (4 by default is safe; exposing it is a future option.)
3. Do we route the new behavior through `CC_TUNABLE_USE_PHASE3_ALGORITHM` or introduce a separate flag for finer rollback? (Recommend separate to avoid coupling.)
4. Box-counting vs Rg-scaling Df: the fix targets Rg-scaling agreement; do we also want to add an internal BC pass as a sanity check in the regression test? (Optional, adds test value but not required.)
