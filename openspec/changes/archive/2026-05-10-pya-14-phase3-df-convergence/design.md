# Design: PYA-14 Phase 3 — Df Convergence (Smart Pair Selection + Adaptive Fallback)

## Phase 0: gamma vs gamma/2 Verdict

### Evidence

| Source | Check | Citation |
|--------|-------|----------|
| MATLAB `TuningCC.m` line 211 | `rEnvol1 + rEnvol2 >= gamma/2` | `rEnvol` measured from geometric center |
| Rust `tunable_cc.rs` line 391 | `bounding_radius1 + bounding_radius2 >= required_distance` (= gamma) | `bounding_radius` measured from center of mass |
| Thesis `.tex` | NOT available in repo (file not found) | Cannot cite equation number |

### Analysis

The bounding check guards the question: "Can these two clusters physically touch when their COMs are placed at distance gamma apart?"

- **Rust (strict geometric necessary condition)**: For two spheres of radius R₁, R₂ separated by distance d, overlap requires `R₁ + R₂ >= d`. Since Rust measures bounding radius from COM and gamma IS the COM-COM distance, `bounding_radius1 + bounding_radius2 >= gamma` is the correct **necessary** condition. The Rust check is geometrically sound.

- **MATLAB (lenient heuristic)**: `gamma/2` is NOT the correct necessary condition — it allows pairs whose bounding spheres cannot overlap. MATLAB compensates with its **infinite retry loop** (`while(~choque)` line 188). Infeasible pairs passing this lenient check simply retry forever until a different pair is randomly selected.

- **Reference frame difference**: MATLAB `rEnvol` is from geometric center; Rust `bounding_radius` is from center of mass. For small clusters these differ minimally; for large asymmetric clusters the difference grows but doesn't change the correctness argument.

### Verdict: Rust is CORRECT. Leave as-is. ⚠️ GAMMA VERDICT LOCKED — DO NOT MODIFY `can_clusters_connect`.

The Rust bounding check is the mathematically correct necessary condition for COM-to-COM placement. MATLAB's `gamma/2` is an overly lenient heuristic that relies on infinite retries to compensate for passing geometrically impossible pairs. Since our Phase 3 algorithm introduces smart pair selection (which depends on accurate feasibility classification), the Rust strict check is essential. Changing to `gamma/2` would pollute the feasible set with actually-infeasible pairs, defeating Path D's purpose.

**Action**: No change to `can_clusters_connect`. The convergence problem is NOT the bounding check — it's the random pair selection exhausting retries on infeasible pairs when feasible ones exist elsewhere in the pool.

---

## Technical Approach

Add smart pair selection (Path D) + adaptive distance fallback (Path B) to the CC tunable merge loop, gated by feature flag R20. The feasibility pre-screen uses the existing `can_clusters_connect` check to partition the pool into feasible/infeasible pairs before the retry loop.

## Architecture Decisions

| Decision | Alternatives | Rationale |
|----------|-------------|-----------|
| Enum-tagged `MergeTraceEntry` with `merge_type: String` (add "adaptive") + optional `overshoot_pct` | Separate `TraceEvent` vec | Less schema churn; existing consumers already handle unknown fields; `merge_type` is already a String discriminator |
| Feature flag via env var parsed at sim start (not compile-time const) | `#[cfg(feature)]` compile flag | R20.3 requires no-recompile toggle; env var wins |
| O(k²) exhaustive scan for feasible pairs | Sampling subset | k≤350 → 61k pairs max → <1ms/step in Rust. Profile later; sampling is a fallback if >2x slowdown |
| `find_feasible_pairs` returns `Vec<PairCandidate>` with pre-computed distances | Return indices only | Avoids recomputing `calculate_com_distance` twice for the same pair |

## Data Flow

```
merge_step(pool)
  ├─ [flag=true] find_feasible_pairs(pool) → Vec<PairCandidate>
  │     ├─ feasible_set non-empty → pick random from set → retry loop → tunable merge
  │     │     └─ retries exhausted → adaptive fallback (max_achievable)
  │     └─ feasible_set empty → emit no_feasible_pair event → adaptive fallback
  └─ [flag=false] legacy random pair + retry + ballistic (Phase 2 path unchanged)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `aglogen_core/engine/src/simulation/result.rs` | Modify | Add `overshoot_pct: Option<f64>` to `MergeTraceEntry`; add `adaptive_merges: usize` + `no_feasible_pair_events: usize` to `SimulationResult` |
| `aglogen_core/engine/src/simulation/tunable_cc.rs` | Modify | Add `find_feasible_pairs`, `compute_max_achievable`, `select_pair_smart`; refactor merge loop with flag branch; add env var parsing |
| `aglogen_core/engine/src/lib.rs` (or binding) | Modify | Expose new metadata fields to Python |
| `aglogen_core/engine/tests/integration_cc_tunable.rs` | Modify | Add Phase 3 unit + integration tests |

## Interfaces / Contracts

```rust
struct PairCandidate {
    idx1: usize,
    idx2: usize,
    required_distance: f64,
    bounding_sum: f64, // cached: bounding_r1 + bounding_r2
}

enum SmartPairResult {
    Feasible(PairCandidate),
    AllInfeasible { max_achievable_pair: PairCandidate },
}

// Extended MergeTraceEntry (additive, non-breaking)
pub struct MergeTraceEntry {
    // ... existing fields ...
    pub overshoot_pct: Option<f64>, // NEW: only set for merge_type="adaptive"
}
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | `find_feasible_pairs` correctness | Synthetic pools with known geometry; assert correct partition |
| Unit | `compute_max_achievable` | Edge cases: overlapping clusters, single-particle clusters |
| Unit | Adaptive merge overshoot contract | Assert `actual >= required`, `overshoot_pct >= 0.0` |
| Integration | Parametric sweep Df∈{1.4–2.5} | 3 seeds × 6 Df values, assert within tolerance tiers |
| Integration | Feature flag off = Phase 2 behavior | Snapshot comparison: same seed produces identical trace |
| E2E | `scripts/validate_pya14.py` | GREEN for Df=1.7, N=350 |

## Migration / Rollout

- **No DB migration**: engine output is JSONField (schema-flexible)
- **Frontend safe**: no hardcoded `merge_type` enum checks on trace entries (verified via grep)
- **Feature flag**: `CC_TUNABLE_USE_PHASE3_ALGORITHM` env var, default `true`, set `false` to rollback without redeploy
- **Maturin rebuild required**: same process as previous PYA-14 deploys

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| O(k²) scan too slow for large pools | Low | Profile; sampling fallback if >2x |
| Overshoot biases Df DOWN | Medium | Parametric sweep catches; add damping factor if observed |
| gamma/2 verdict challenged by thesis | Low | Evidence documented above; MATLAB's leniency is compensated by infinite retries |

## Open Questions

- None (gamma/2 resolved, all blockers cleared)
