# Design: PYA-14 Phase 2 — seed_type fix + ballistic required_distance

## Technical Approach

Two surgical bug fixes. Bug A: lift `seed_type` from nested `parameters` dict to model-level field in the DRF serializer's `create()`. Bug B: call the existing `calculate_com_distance` for ballistic fallback merges instead of hardcoding `required_distance: 0.0`. Both are parity-fixes — making code do what the spec already required.

## Architecture Decisions

| Decision | Alternatives | Rationale |
|----------|-------------|-----------|
| Nested `seed_type` wins over top-level | (a) top-level wins, (b) reject ambiguity with 400 | Frontend always sends nested (SimulationForm.tsx:711). Nested-wins preserves backward compat for scripted callers using top-level. Matches R17 contract. |
| `pop()` seed_type from params dict | (a) copy without pop, leaving duplicate | Avoids stale duplicate in JSON. Exploration grep confirmed no downstream reader of `parameters["seed_type"]`. |
| `unwrap_or_else` with `tracing::warn!` for None distance | (a) fail/skip the merge, (b) silently use 0.0 | Ballistic is the fallback of last resort — failing it would stall aggregation. Silent 0.0 loses observability. Warn + 0.0 balances both. |
| Insert seed_type lift AFTER line 141 (schema version stamp) | (a) before distribution lifts (~104), (b) in validate() | After line 141, `params` is already a copied dict with schema version stamped — single insertion point, no second copy needed. |

## Data Flow

### Bug A — seed_type lift

```
Frontend POST {parameters: {seed_type: "dimers", ...}}
    │
    ▼
SimulationSerializer.create()
    │ params = validated_data["parameters"]  (dict copy at L127)
    │ ... schema version stamp ...
    │ NEW: if "seed_type" in params → pop → validated_data["seed_type"]
    │ validated_data["parameters"] = params  (without seed_type)
    ▼
Model.save()  →  seed_type="dimers" on DB column
```

### Bug B — ballistic required_distance

```
Tunable merge loop (L928)
    │ retries exhausted → ballistic fallback (L1080)
    │ pick fresh pair → impacted(n1), impactor(n2)
    │
    │ NEW: required = calculate_com_distance(n1, n2, rp, df, kf, sintering_coeff)
    │         .unwrap_or_else(|| { warn!(...); 0.0 })
    │
    │ MergeTraceEntry { required_distance: required, ... }
    ▼
merge_trace.push(entry)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/apps/simulations/serializers.py` | Modify | `create()` L141: insert seed_type lift from params → validated_data |
| `aglogen_core/engine/src/simulation/tunable_cc.rs` | Modify | L1122-1128: replace hardcoded `0.0` with `calculate_com_distance` call |
| `backend/apps/simulations/tests/test_seed_type.py` | Modify | Add 5 tests: nested lift, top-level compat, nested-wins, default, invalid |
| `aglogen_core/engine/tests/integration_cc_tunable.rs` | Modify | Add 2 tests: ballistic required_distance > 0, degenerate None → 0.0 |

## Interfaces / Contracts

No new interfaces. Existing contracts tightened:

- **R17 (seed_type)**: nested `parameters.seed_type` is canonical source; top-level is legacy fallback.
- **R16 (required_distance)**: MUST be populated for both tunable AND ballistic entries. Ballistic entries use `calculate_com_distance` result (or 0.0 for degenerate inputs).

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit (Python) | seed_type lift in serializer create() | 5 cases: nested, top-level, both, neither, invalid. Mock or use serializer directly. |
| Unit (Rust) | ballistic required_distance | 2 cases: realistic pair → distance > 0; degenerate → 0.0, no panic. Run via `run_tunable_cc_internal` with forced ballistic fallback (low max_retries + constrained geometry). |

**Strict TDD**: Write failing test → confirm red → minimal fix → confirm green → refactor.

## Exact Code Changes

### Bug A — serializers.py:create() (after L141)

```python
        # PYA-14 Phase 2: lift seed_type from nested parameters.
        # Frontend sends seed_type inside parameters; legacy callers use
        # top-level field. Nested wins (R17 contract). pop() to avoid
        # stale duplicate in the JSON blob.
        if isinstance(params, dict) and "seed_type" in params:
            validated_data["seed_type"] = params.pop("seed_type")
            validated_data["parameters"] = params
```

Insert inside the existing `if isinstance(params, dict):` block at L126, after L141 (`validated_data["parameters"] = params`). The block already has a `params` copy.

### Bug B — tunable_cc.rs L1122-1128

Replace:
```rust
// required_distance is 0.0 for ballistic merges (no power-law target).
```
With:
```rust
// R16: Compute what tunable path would have targeted for this pair.
let required_distance = calculate_com_distance(
    ballistic_n1, ballistic_n2, rp, df, kf, sintering_coeff,
).unwrap_or_else(|| {
    tracing::warn!(
        n1 = ballistic_n1, n2 = ballistic_n2,
        "calculate_com_distance returned None for ballistic fallback"
    );
    0.0
});
```
And update the `MergeTraceEntry` to use `required_distance` (the variable) instead of the literal `0.0`.

## Migration / Rollout

No DB migration. `seed_type` column already exists with default `"monomers"`. Deploy backend + engine together (maturin binding rebuild). No frontend change needed.

## Validation Plan (post-merge)

Empirical run: target_df=1.7, target_kf=1.3, n_particles=350, seed_type=dimers, sintering off. Accept if output Df within ±10% of target (1.53–1.87). Reject → open Phase 3.

## Risks

| Risk | Level | Mitigation |
|------|-------|------------|
| R1: `pop` removes seed_type from params JSON | Low | Grep confirmed no downstream reader. Test coverage. |
| R2: Nested-wins precedence | Low | Documented in code comment + R17 spec. |
| R3: `calculate_com_distance` returns None | Low | `unwrap_or_else` + warn. Test covers degenerate case. |
| R4: Historical data invalidation | Info | Documented in CHANGELOG. Not a code concern. |

## Open Questions

None — all decisions resolved in exploration and proposal.
