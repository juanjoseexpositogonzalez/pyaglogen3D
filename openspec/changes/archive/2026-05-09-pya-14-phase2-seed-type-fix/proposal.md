# Proposal: PYA-14 Phase 2 — seed_type fix + ballistic required_distance

## Intent

Phase 1 of PYA-14 shipped `merge_trace` instrumentation (archived 2026-05-07). Analyzing Phase 1 data revealed **Bug A**: the DRF serializer silently ignores `seed_type` sent nested inside `parameters` by the frontend — every "dimers" or "trimers" simulation actually ran as monomers. This invalidates all prior seed-type comparisons. **Bug B** was discovered in the same analysis: the ballistic fallback hardcodes `required_distance: 0.0` instead of computing the power-law target. Both must be fixed before the PYA-14 algorithmic question (Df convergence for non-monomer seeds) can be empirically evaluated.

## Scope

### In Scope
- **Bug A**: Lift `params["seed_type"]` to `validated_data["seed_type"]` in serializer `create()` (~3 lines). Nested wins when both top-level and nested are present.
- **Bug B**: Call `calculate_com_distance` for the ballistic pair in `tunable_cc.rs` and populate `required_distance` (~5 lines). Fall back to `0.0` if `None`.
- New serializer test for nested `seed_type` path
- New Rust test asserting ballistic `required_distance > 0`
- Spec clarification on R16 for ballistic `required_distance`

### Out of Scope
- Changes to the CC tunable algorithm math/formula/iterative drift (Phase 3)
- Frontend changes (backend lift is sufficient)
- Historical data migration or flagging
- UI rendering of merge_trace data

## Capabilities

### New Capabilities
None

### Modified Capabilities
- `cc-tunable-aggregation`: Clarify R16 — `required_distance` MUST be populated for BOTH tunable and ballistic merge entries (not hardcoded to 0.0 for ballistic). No new requirements; this is a spec-level clarification of existing intent.

## Approach

Bug A: In `serializers.py:create()`, after existing distribution lifts (~line 114), check `params["seed_type"]` and `pop()` it into `validated_data["seed_type"]`. Add comment documenting nested-wins precedence.

Bug B: In `tunable_cc.rs` ballistic fallback block (~line 1098), call `calculate_com_distance(n1, n2, rp, df, kf, sintering_coeff)` for the candidate pair BEFORE merge. Store result via `unwrap_or(0.0)`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/apps/simulations/serializers.py` | Modified | `create()` — seed_type lift from nested params |
| `aglogen_core/engine/src/simulation/tunable_cc.rs` | Modified | Ballistic fallback — populate `required_distance` |
| `backend/apps/simulations/tests/test_seed_type.py` | Modified | New nested-params test |
| `aglogen_core/engine/tests/integration_cc_tunable.rs` | Modified | Ballistic `required_distance` assertion |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| R1: `params.pop("seed_type")` breaks downstream reader | Low | Grep confirms no code reads `parameters["seed_type"]` — task layer uses model field |
| R2: Top-level vs nested priority ambiguity | Low | Locked: nested wins. Add code comment documenting precedence |
| R3: `calculate_com_distance` returns `None` for degenerate ballistic pair | Low | `unwrap_or(0.0)` + log via existing tracing |
| R4: Historical data invalidation | Info | Cannot retroactively fix; users re-run affected simulations. Document in release notes |

## Rollback Plan

Revert the two commits (serializer lift + Rust ballistic fix). No DB migration involved. Existing simulations unaffected — changes are additive behavior corrections.

## Dependencies

- Phase 1 `merge_trace` must be merged and deployed (already archived 2026-05-07)

## Success Criteria

- [ ] Nested `seed_type=dimers` via API creates simulation with `seed_type="dimers"` in DB
- [ ] Ballistic merge_trace entries have `required_distance > 0` (non-degenerate pairs)
- [ ] All existing tests pass (pytest + cargo test)
- [ ] Empirical re-run: Df=1.7 N=350 seed=dimers shows different Df distribution vs monomers (±10% tolerance)
