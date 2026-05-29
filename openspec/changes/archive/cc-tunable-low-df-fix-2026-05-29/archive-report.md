# Archive Report: cc-tunable-low-df-fix

> SDD phase: ARCHIVE · Cycle 1 of 2 (Cycle 2 deferred to future session)
> Date: 2026-05-29
> Merged to: `openspec/specs/cc-tunable-aggregation.md`
> Commits merged: PR #60, #61, #62 → tracker; PR #63 (tracker → main)

---

## Archive Summary

**Change**: `cc-tunable-low-df-fix`  
**Status**: ✅ COMPLETE & VERIFIED  
**Archive folder**: `openspec/changes/archive/cc-tunable-low-df-fix-2026-05-29/`  
**Canonical spec updated**: `openspec/specs/cc-tunable-aggregation.md`

---

## Specs Synced

| Domain | Requirement | Action | Details |
|--------|-------------|--------|---------|
| cc-tunable-aggregation | R3 | MODIFIED | Retry Policy — bounding-sum threshold gated by R22 (gamma/2 when fix ON) |
| cc-tunable-aggregation | R4 | MODIFIED | Seed Type Modes — monomers pool changes per R23 when fix ON |
| cc-tunable-aggregation | R5 | MODIFIED | Convergence to Target — low-Df band [1.5, 1.7] convergence guarantee added; Df=1.4 best-effort added |
| cc-tunable-aggregation | R19 | MODIFIED | Convergence Guarantee — extends monomers convergence to low-Df band when flag ON |
| cc-tunable-aggregation | R22 | ADDED | Low-Df Fix Feature Flag — new flag `CC_TUNABLE_USE_LOW_DF_FIX` (default true) |
| cc-tunable-aggregation | R23 | ADDED | PC-Generated Default Seed Pool — replaces monomer pool with PC-seeded clusters when fix ON |
| cc-tunable-aggregation | R24 | ADDED | Rollback Byte-Identity Guarantee — flag OFF reproduces pre-fix behavior exactly |
| cc-tunable-aggregation | R25 | ADDED | Box-Counting Sanity — BC-vs-Rg agreement in low-Df band within ±0.20 tolerance |

---

## Implementation Completeness

All 27 assignable tasks from tasks.md are **COMPLETE**:

- ✅ Phase 0 (Snapshot capture): 3 fixture files committed
- ✅ Phase 1 (Constants + flag reader): all constants and read_low_df_fix_flag() implemented
- ✅ Phase 2 (PC seed builder): build_pc_seeds helper + pub(crate) promotion of place_particle_ballistic
- ✅ Phase 3 (Wire flag): flag threaded through initialize_seed_clusters and find_feasible_pairs
- ✅ Phase 4 (Regression tests): low-Df convergence, BC sanity, Phase 3 independence tests
- ✅ Phase 5 (Rollback tests): byte-identity verification with 1 ULP tolerance
- ✅ Phase 6 (R21 non-regression): high-Df band (Df ≥ 1.8) still converges within ±5%
- ✅ Phase 7 (Docs + CHANGELOG): before/after table, doc-comments, extended docs

**Deferred**: Phase 1.3 (SeedType::PcSeeds variant) — not needed; design uses Monomers branching

---

## Test Results (Final)

| Test Suite | Result |
|-----------|--------|
| `cargo test -p aglogen-engine --release --test cc_tunable_low_df_test` | ✅ 12 passed, 0 failed, 0 ignored |
| `cargo test -p aglogen-engine --release --test integration_cc_tunable` | ✅ 10 passed, 0 failed, 1 ignored (kf=1.7, separate issue) |
| Full engine test suite | ✅ 349 passed, 0 failed, 2 ignored (pre-existing) |

**Verdict**: PASS — all coverage gates met, zero functional regressions

---

## Spec Compliance Summary

All requirements passed verification:

- **R22** (Feature flag): Default true, off-values work, orthogonal to Phase3
- **R23** (PC seed pool): Correct cluster counts, separate RNG stream, dimers/trimers unaffected
- **R24** (Rollback): Flag OFF produces byte-identical in-memory results; 1 ULP JSON round-trip tolerance documented
- **R25** (BC sanity): All 12 (Df_target, seed) combos satisfy BC_Df agreement within ±0.20 at N=2000
- **R3** (Modified threshold): gamma/2 gate active when R22 flag ON; computed once per simulation
- **R4** (Modified seed types): PC seed pool replaces monomers when flag ON; dimers/trimers unaffected
- **R5** (Modified convergence): Low-Df band [1.5, 1.7] converges within ±10%; Df=1.4 best-effort
- **R19** (Modified guarantee): Monomers convergence extended to low-Df when flag ON

---

## Known Issues & Deferred Items

1. **kf=1.7 convergence** (out of scope): test `convergence_5_runs_target_1_6_1_7` remains ignored; separate root cause
2. **Cycle 2 deferred**: `cc-tunable-high-df-fix` addresses Df ≥ 2.5 ceiling; to be scheduled in future session
3. **Historical DB records**: Old stored results (flag OFF behavior) remain valid; new runs use flag ON by default

---

## Rollback & Recovery

If needed, set environment variable to revert:

```bash
export CC_TUNABLE_USE_LOW_DF_FIX=false
# Runs will produce pre-fix behavior (monomer pool, full gamma threshold)
# Old simulation records in DB unaffected
```

The byte-identity guarantee (R24) ensures no data loss and seamless rollback.

---

## Next Steps

1. ✅ Cycle 1 complete (this archive)
2. 🔄 Cycle 2 (`cc-tunable-high-df-fix`) — deferred, separate proposal required
3. 🔄 Production deployment — recommend canary on low-Df jobs first

---

## Artifacts in Archive

- `proposal.md` — Change intent, scope, approach
- `design.md` — Technical design, Q&A resolutions, data flow
- `specs/cc-tunable-aggregation.md` — Delta spec (requirements R3, R4, R5, R19 modified; R22-R25 added)
- `tasks.md` — Implementation task breakdown (27/27 complete)
- `apply-progress.md` — Phase-by-phase implementation record
- `verify-report.md` — Test evidence and spec compliance matrix
- `archive-report.md` — This document

---

**End of Archive Report**
