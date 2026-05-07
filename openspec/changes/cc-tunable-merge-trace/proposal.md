# Proposal: cc-tunable-merge-trace

> Cycle 14 / PYA-14 Phase 1 — Per-step merge diagnostic trace for CC tunable

## Why

Frente 10 fixed the per-step COM-distance formula. Frente 11 fixed sintering. Yet for low-Df targets (Df < 1.8), the algorithm still drifts: empirical 5-run integration test at target=(Df=1.6, kf=1.7, N=350, seed=Dimers) yields mean Df ≈ 1.96 despite 78% of merges using the correct tunable formula.

The PYA-14 explore (engram `pyaglogen3D/explore/pya-14-iterative-drift`, filesystem `_explore-only/pya-14-iterative-drift.md`) confirmed:

- The per-step invariant in the formula is **mathematically sound**.
- The drift comes from **ballistic fallback in late-game merges** when `bounding_radius < required_distance` causes `can_clusters_connect` to reject.
- Ballistic merges produce Df ≈ 1.8–2.1, contaminating the final aggregate.

Before implementing a fix (Path B "adaptive d" or Path D "adaptive d + smart pair selection"), we need **per-merge evidence** to decide which path is right and to validate the fix later.

This cycle is Phase 1: instrument the merge loop. **No behaviour changes**. Only adds visibility.

## What changes

### In scope

- **Engine** — new struct `MergeTraceEntry` in `aglogen_core/engine/src/simulation/result.rs` (or sibling). Fields: `step`, `n1`, `n2`, `required_distance`, `actual_distance`, `rg_after`, `rg_target`, `merge_type` ("tunable" | "ballistic"), `retries`, `bounding_check_passed`.
- **Engine** — `SimulationResult` gains `merge_trace: Vec<MergeTraceEntry>`. Populated by `run_tunable_cc_internal` after every successful merge (tunable or ballistic). Empty `Vec` for non-CC algorithms.
- **Python binding** — surface `merge_trace` in the result dict (list of dicts). Maturin rebuild required.
- **Backend** — persist `merge_trace` in the existing `Simulation.result` JSONField (no migration). Drill-down API includes it when present.
- **NO frontend rendering** in this cycle. The data is consumed programmatically or via CSV export in a follow-up cycle.

### Not in scope (deferred)

- **Implementing the fix** (Path B or D). That's Phase 2, a separate cycle informed by the trace data collected here.
- **Frontend visualisation** of the trace.
- **Trace columns in CSV export**. Defer until the fix is in.
- **Closing Jira PYA-14**. PYA-14 stays open; this cycle is Phase 1.

## Capabilities affected

- **MODIFIED — `cc-tunable-aggregation`**: R-DELTA — `SimulationResult` gains `merge_trace`. Per-merge diagnostic data documented.

## Phases

4 short phases, ~1–2 days total.

1. **P1 — Engine**: `MergeTraceEntry` struct + `merge_trace: Vec<MergeTraceEntry>` field on `SimulationResult` + populate in `run_tunable_cc_internal` after each tunable AND ballistic merge. Cargo tests assert: trace has N-1 entries for N seeded clusters, fields populated correctly per merge type, non-CC algorithms produce empty trace.
2. **P2 — Python binding**: surface `merge_trace` in the result dict (PyList of PyDicts). Maturin rebuild into backend venv.
3. **P3 — Backend**: persist `merge_trace` in the `Simulation.result` JSONField (no migration). Drill-down view returns trace when present (optional field).
4. **P4 — Tests integration + docs + CHANGELOG**: cross-cutting test asserting trace propagates engine→binding→DB→API. Docs explain the fields. CHANGELOG entry. NO Jira close.

## Risks

- **Backward compat**: `merge_trace` is a new optional field. Legacy results stored without it must continue to work. Mitigation: field defaults to empty list; serializer emits `[]` when absent.
- **Storage size**: ~80 bytes per merge entry; N=1000 → ~80 KB per simulation. Acceptable but document.
- **Maturin rebuild dependency**: P2 must rebuild the wheel into the backend venv before P3 tests run.
- **No fix yet**: this cycle does NOT make Df < 1.8 converge. The trace is groundwork for the next cycle.

## Estimated magnitude

1–2 days. Smaller than any prior cycle. Read-only modifications mostly: data exposure, no algorithmic changes.
