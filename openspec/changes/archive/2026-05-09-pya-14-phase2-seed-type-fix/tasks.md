# Tasks: PYA-14 Phase 2 — seed_type fix + ballistic required_distance

**Change**: pya-14-phase2-seed-type-fix  
**Project**: pyaglogen3D  
**Approach**: Strict TDD — test-first, fail, implement, pass for each task

---

## Phase A: Bug A — Serializer seed_type lift

**Objective**: Fix Bug A - DRF serializer ignores nested seed_type; all dimers/trimers ran as monomers.

- [x] **A1**: Add failing test `test_create_lifts_nested_seed_type_to_model_field` in `backend/apps/simulations/tests/test_seed_type.py` — submit payload with `parameters.seed_type = "dimers"`, assert `Simulation.seed_type == "dimers"` AND `Simulation.parameters` does NOT contain key `seed_type`
- [x] **A2**: Add failing test `test_create_top_level_seed_type_still_works_legacy` — submit payload with top-level `seed_type = "trimers"` (no nested), assert `Simulation.seed_type == "trimers"` preserved
- [x] **A3**: Add failing test `test_create_nested_wins_over_top_level` — both present: nested = "dimers", top-level = "monomers", assert `Simulation.seed_type == "dimers"` (nested wins)
- [x] **A4**: Add failing test `test_create_defaults_to_monomers_when_neither_present` — submit payload with neither nested nor top-level seed_type, assert default behavior unchanged (monomers)
- [x] **A5**: Add failing test `test_create_invalid_nested_seed_type_returns_400` — nested = "foo", assert ValidationError, no simulation created
- [x] **A6**: Run all 5 tests, confirm they FAIL (TDD: red phase) — 3 failed, 2 passed (expected)
- [x] **A7**: Implement fix in `backend/apps/simulations/serializers.py` `create()` method (after L141): lift via `params.pop("seed_type")` with validation + inline R17 comment
- [x] **A8**: Run all 5 tests, confirm they PASS (TDD: green phase) — 5/5 passed
- [x] **A9**: Run full backend test suite, confirm no regressions — 257/257 simulations passed; 928 total passed

**Dependencies**: A1-A5 sequential for test creation, A6 runs all 5, A7-A8 sequential implement-pass

---

## Phase B: Bug B — Ballistic required_distance

**Objective**: Fix Bug B - ballistic fallback hardcodes required_distance: 0.0 instead of computing via calculate_com_distance

- [x] **B1**: Add failing test `ballistic_fallback_populates_required_distance` in `aglogen_core/engine/tests/integration_cc_tunable.rs` — run a tunable_cc simulation with parameters that force at least one ballistic fallback (e.g., target_df=1.7, n_particles=350, seed=monomers), assert at least one `merge_trace` entry with `merge_type=="ballistic"` has `required_distance > 0.0` and matches `calculate_com_distance` output
- [x] **B2**: Add failing test `ballistic_fallback_handles_degenerate_distance` — construct synthetic case where `calculate_com_distance` returns `None` (e.g., target_df very low for 1+1 monomers), assert entry still produced with `required_distance == 0.0` and no panic
- [x] **B3**: Run both tests, confirm they FAIL (TDD: red phase)
- [x] **B4**: Implement fix in `aglogen_core/engine/src/simulation/tunable_cc.rs` ballistic fallback branch (~line 1098 per exploration): call `calculate_com_distance` with in-scope `n1, n2, df, kf, rp, sintering_coeff`, `unwrap_or_else` to `0.0` with `tracing::warn!` log on `None`. Store in `required_distance` field of the `MergeTraceEntry`
- [x] **B5**: Run both tests, confirm they PASS (TDD: green phase)
- [x] **B6**: Run full engine test suite, confirm no regressions

**Dependencies**: B1-B2 sequential for test creation, B3 runs both, B4-B5 sequential implement-pass, B1-B6 can run in parallel with Phase A

---

## Phase C: Integration & docs

**Objective**: Document changes and verify end-to-end integration

- [x] **C1**: Update `CHANGELOG.md` with PYA-14 Phase 2 entry: list both bugs, breaking-change-style warning that historical dimers/trimers simulations actually ran as monomers (users should re-run if they care about that data)
- [x] **C2**: Run full test suite (engine + python binding + backend + frontend) end-to-end via project's standard test command. Confirm all green

**Dependencies**: C1 can run after A9+B6 complete (both bugs fixed), C2 requires A9+B6 complete

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| A | A1-A9 | Bug A: Serializer seed_type lift (5 tests + impl) |
| B | B1-B6 | Bug B: Ballistic required_distance (2 tests + impl) |
| C | C1-C2 | Integration & documentation |

**Total tasks**: 17  
**Commit estimate**: ~10-12 commits (tests separate from impl where logical, plus CHANGELOG)

**Next recommended**: `sdd-apply` — start with Phase A tests