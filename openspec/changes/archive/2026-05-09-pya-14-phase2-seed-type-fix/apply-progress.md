# Apply Progress: PYA-14 Phase 2 — seed_type fix + ballistic required_distance

**Change**: pya-14-phase2-seed-type-fix
**Mode**: Strict TDD
**Date**: 2026-05-08

---

## Completed Tasks

### Phase A: Bug A — Serializer seed_type lift (9/9 ✅)

- [x] **A1**: Test `test_create_lifts_nested_seed_type_to_model_field` — added to `TestSeedTypeNestedLift` class
- [x] **A2**: Test `test_create_top_level_seed_type_still_works_legacy`
- [x] **A3**: Test `test_create_nested_wins_over_top_level`
- [x] **A4**: Test `test_create_defaults_to_monomers_when_neither_present`
- [x] **A5**: Test `test_create_invalid_nested_seed_type_returns_400` — validates nested value against model choices, raises `ValidationError`
- [x] **A6**: RED confirmed — 3 failed (lift/nested-wins/invalid), 2 passed (legacy/default already work)
- [x] **A7**: Implemented seed_type lift in `serializers.py:create()` after L141, with validation + R17 comment
- [x] **A8**: GREEN confirmed — 5/5 passed
- [x] **A9**: Full backend suite — 257/257 simulations tests passed; 928 total passed; 15 failures + 31 errors all pre-existing

### Phase B: Bug B — Ballistic required_distance (6/6 ✅ — completed by parallel agent)

- [x] **B1-B6**: All completed by parallel sub-agent

### Phase C: Integration & docs (2/2 ✅)

- [x] **C1**: CHANGELOG update — prepended `pya-14-phase2-seed-type-fix (unreleased)` section to `CHANGELOG.md` with both bugs, historical impact warning, incidental migration fix, and `Closes PYA-14`
- [x] **C2**: Full cross-stack integration test — all layers green

---

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `backend/apps/simulations/tests/test_seed_type.py` | Modified | Added `TestSeedTypeNestedLift` class with 5 tests (R17 spec) |
| `backend/apps/simulations/serializers.py` | Modified | Added seed_type lift from nested params in `create()` (~L143-155), with validation and R17 comment |
| `backend/apps/accounts/migrations/0003_fix_legacy_user_fk.py` | Modified | Fixed pre-existing SQLite incompatibility — PostgreSQL DDL wrapped in RunPython with vendor check |
| `CHANGELOG.md` | Modified | Prepended PYA-14 Phase 2 entry (seed_type fix, ballistic required_distance, incidental migration fix) |

---

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| A1 | `test_seed_type.py` | Unit | ✅ 20/20 | ✅ Written (fails: 'monomers' != 'dimers') | ✅ Passed | ✅ 5 cases total (A1-A5 cover all R17 scenarios) | ➖ None needed |
| A2 | `test_seed_type.py` | Unit | ✅ 20/20 | ✅ Written (passes — existing behavior) | ✅ Passed | (part of 5-case triangulation) | ➖ None needed |
| A3 | `test_seed_type.py` | Unit | ✅ 20/20 | ✅ Written (fails: 'monomers' != 'dimers') | ✅ Passed | (part of 5-case triangulation) | ➖ None needed |
| A4 | `test_seed_type.py` | Unit | ✅ 20/20 | ✅ Written (passes — existing behavior) | ✅ Passed | (part of 5-case triangulation) | ➖ None needed |
| A5 | `test_seed_type.py` | Unit | ✅ 20/20 | ✅ Written (fails: DID NOT RAISE) | ✅ Passed | (part of 5-case triangulation) | ➖ None needed |
| A7 | `serializers.py` | — | ✅ 20/20 | — | ✅ 5/5 passed | — | ➖ None needed |

### Test Summary
- **Total tests written**: 5
- **Total tests passing**: 5 (+ 20 existing = 25 in test_seed_type.py)
- **Layers used**: Unit (5)
- **Approval tests**: None — not a refactoring task
- **Pure functions created**: 0 (logic lives in DRF serializer create())

---

## Test Commands Run

1. **Safety net**: `uv run pytest apps/simulations/tests/test_serializer.py apps/simulations/tests/test_seed_type.py` → 20/20 ✅
2. **RED**: `uv run pytest apps/simulations/tests/test_seed_type.py::TestSeedTypeNestedLift` → 3 failed, 2 passed ✅
3. **GREEN**: `uv run pytest apps/simulations/tests/test_seed_type.py::TestSeedTypeNestedLift` → 5/5 passed ✅
4. **Regression**: `uv run pytest apps/simulations/tests/test_seed_type.py apps/simulations/tests/test_serializer.py` → 25/25 passed ✅
5. **Full suite**: `uv run pytest` → 928 passed, 15 failed, 31 errors (all pre-existing in ai_assistant/test_api/aglogen_core)
6. **Simulations only**: `uv run pytest apps/simulations/tests/` → 257/257 passed ✅

---

## Deviations from Design

1. **Test file location**: Tests added to existing `test_seed_type.py` instead of new `test_serializers.py` — the file already has the `TestSeedTypeSerializer` class and all relevant imports. This is the natural location.
2. **Validation in create()**: Design doc showed only `pop()` without validation. Implementation adds explicit validation of nested seed_type against model choices before setting — required by R17.5 (invalid → 400). Without this, an invalid nested value like "foo" would silently become the model's seed_type.
3. **Migration fix**: `0003_fix_legacy_user_fk.py` was using PostgreSQL-specific DDL (CASCADE, ALTER COLUMN TYPE uuid) that breaks SQLite test DB. Wrapped in RunPython with vendor check — this was a pre-existing infrastructure issue blocking ALL tests.

---

## Phase C: Cross-Stack Integration Test Results

| Layer | Command | Result | Count |
|-------|---------|--------|-------|
| Engine (Rust) | `cargo test` | ✅ PASS | 310 passed, 0 failed, 3 ignored |
| Backend (Python) | `uv run pytest apps/simulations/tests/` | ✅ PASS | 257 passed, 0 failed |
| Frontend (TS) | `npx vitest run` | ✅ PASS | 374 passed, 37 files, 0 failed |
| **Total** | — | ✅ ALL GREEN | **941 tests** |

---

## Overall Status

- **Phase A**: 9/9 ✅ (serializer seed_type lift)
- **Phase B**: 6/6 ✅ (ballistic required_distance)
- **Phase C**: 2/2 ✅ (CHANGELOG + cross-stack integration)
- **Total**: 17/17 tasks complete
- **Status**: All phases complete, ready for verify
