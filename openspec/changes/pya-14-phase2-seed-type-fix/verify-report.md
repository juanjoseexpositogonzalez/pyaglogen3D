# Verification Report: pya-14-phase2-seed-type-fix

**Mode**: Strict TDD  
**Date**: 2026-05-09  
**Project**: pyaglogen3D

---

## Summary

Implementation matches spec. All 17 tasks complete. Tests pass (engine 310, backend 257, frontend 374). Two deviations documented and acceptable. One suggestion flagged.

---

## R16 Coverage (ballistic required_distance)

| Scenario | Test | Status |
|----------|------|--------|
| R16.11: Ballistic entry populates required_distance | `ballistic_fallback_populates_required_distance` (integration_cc_tunable.rs:415) | ✅ PASS |
| R16.12: Degenerate distance → 0.0, no panic | `ballistic_fallback_handles_degenerate_distance` (integration_cc_tunable.rs:478) | ✅ PASS |

**R16 verification**: Code at tunable_cc.rs:1126-1135 correctly calls `calculate_com_distance` for ballistic fallbacks, uses `unwrap_or_else` to fall back to `0.0` with diagnostic output.

---

## R17 Coverage (seed_type routing)

| Scenario | Test | Status |
|----------|------|--------|
| R17.1: Nested wins over absent top-level | `test_create_lifts_nested_seed_type_to_model_field` | ✅ PASS |
| R17.2: Legacy top-level works | `test_create_top_level_seed_type_still_works_legacy` | ✅ PASS |
| R17.3: Nested wins when both present | `test_create_nested_wins_over_top_level` | ✅ PASS |
| R17.4: Default to monomers | `test_create_defaults_to_monomers_when_neither_present` | ✅ PASS |
| R17.5: Invalid nested → 400 | `test_create_invalid_nested_seed_type_returns_400` | ✅ PASS |

**R17 verification**: Code at serializers.py:147-159 correctly lifts nested `seed_type` with validation, uses `pop()` to avoid duplicate in JSON blob.

---

## Findings

### CRITICAL
None.

### WARNING
None.

### SUGGESTION
1. **Migration fix out-of-scope**: `0003_fix_legacy_user_fk.py` SQLite compatibility fix (lines wrapped in vendor check) was incidental to this change. Verify it doesn't introduce PostgreSQL regressions in production. No action required for this verify — flag for awareness only.

---

## Known Deviations (Evaluated)

| Deviation | Status | Rationale |
|-----------|--------|------------|
| `eprintln!` instead of `tracing::warn!` | ✅ ACCEPT | Engine has no `tracing` dependency. Deviation documented in apply-progress. |
| Tests in existing `test_seed_type.py` | ✅ ACCEPT | File already contained relevant test class; natural location. |
| Validation added in `create()` (vs. design's `pop()` only) | ✅ ACCEPT | Required by R17.5 — invalid nested values must return 400, not silently default. |

---

## Test Execution Results

| Layer | Command | Result | Count |
|-------|---------|--------|-------|
| Engine | `cargo test` | ✅ PASS | 310 passed |
| Backend | `uv run pytest apps/simulations/tests/` | ✅ PASS | 257 passed |
| Frontend | `npx vitest run` | ✅ PASS | 374 passed |

**Total**: 941 tests passed.

---

## Sign-off

**Status**: GREEN

All requirements implemented, all tests passing, deviations documented and acceptable. Change ready for archive.