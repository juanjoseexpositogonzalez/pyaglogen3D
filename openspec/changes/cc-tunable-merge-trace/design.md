# Design: cc-tunable-merge-trace

> Cycle 14 / PYA-14 Phase 1.

## Architecture overview

```
Engine (Rust)              Python binding         Backend                  API
─────────────              ──────────────         ───────                  ───
MergeTraceEntry struct  →  Vec→PyList of   →  Simulation.result   →  drill-down
SimulationResult.        Dicts                JSONField (existing)    response
  merge_trace
       ↑
populated in
run_tunable_cc_internal
after each merge
```

No DB migration. No frontend changes. Trace flows engine → result dict →
JSONField → API as a new optional list.

## Components

### 1. Engine — `MergeTraceEntry` struct

File: `aglogen_core/engine/src/simulation/result.rs` (or sibling `merge_trace.rs`).

```rust
#[derive(Debug, Clone, Serialize)]
pub struct MergeTraceEntry {
    pub step: usize,
    pub n1: usize,
    pub n2: usize,
    pub required_distance: f64,
    pub actual_distance: f64,
    pub rg_after: f64,
    pub rg_target: f64,
    pub merge_type: String, // "tunable" | "ballistic"
    pub retries: usize,
    pub bounding_check_passed: bool,
}
```

`Default` impl returns sensible zeros. `Serialize` derive enables JSON
emission via PyO3.

### 2. Engine — `SimulationResult.merge_trace`

`SimulationResult` gains `pub merge_trace: Vec<MergeTraceEntry>`.
Default impl: `Vec::new()`. All non-CC algorithms keep the empty default.

### 3. Engine — `run_tunable_cc_internal` instrumentation

In `tunable_cc.rs`, after every successful tunable merge AND every
ballistic fallback merge, append a `MergeTraceEntry` to a local
`merge_trace: Vec<MergeTraceEntry>`. At end of `run_tunable_cc_internal`,
move the local vec into the `SimulationResult` being returned.

Helper points (line numbers approximate, post-frente-13):
- After successful tunable merge (~line 1044): record `merge_type="tunable"`, `bounding_check_passed=true`, `retries=k`.
- After successful ballistic merge (~line 1088): record `merge_type="ballistic"`, plus the bounding result that triggered fallback.

The `actual_distance` is measured via the merged cluster centroid distances. `rg_after` calls the existing `cluster.update_properties()` which already runs.

### 4. Python binding

File: `aglogen_core/python/src/lib.rs`.

Convert `Vec<MergeTraceEntry>` to `PyList<PyDict>` in the result builder. Each entry becomes:

```python
{
    "step": int,
    "n1": int,
    "n2": int,
    "required_distance": float,
    "actual_distance": float,
    "rg_after": float,
    "rg_target": float,
    "merge_type": str,
    "retries": int,
    "bounding_check_passed": bool,
}
```

Maturin rebuild into backend venv at end of P2.

### 5. Backend — persistence

`Simulation.result` is already a JSONField. The `merge_trace` list flows in transparently. NO migration.

`tasks.py::_run_simulation_task` already serialises the engine result dict to JSON when persisting; no change needed.

### 6. Backend — drill-down view

`apps/simulations/views.py::SimulationDetailView` (or equivalent) returns the entire `result` field. `merge_trace` rides along. No code change unless an explicit serializer field whitelist excludes it.

If serializer whitelists fields: add `merge_trace` to the list. Verify in P3.

### 7. Backwards compatibility

Legacy `Simulation.result` documents pre-frente-14 don't have `merge_trace`. The serializer emits `[]` (or omits the key). Frontend (this cycle: doesn't touch trace) is unaffected.

Engine results without merge_trace (impossible after this cycle, but defensive): the field is `Vec::new()` by Default, so always present.

## Testing strategy

| Layer | Tests |
| --- | --- |
| Engine | 5–8 cargo tests: trace length matches merge count, tunable vs ballistic discrimination, non-CC empty trace, fields populated correctly, retries reflect actual attempts |
| Python binding | 2–3 smoke tests: result dict has `merge_trace` key, list of dicts with correct fields |
| Backend | 2–3 pytest: Simulation.result persists trace, drill-down API returns trace, legacy result without trace still serialises |
| Cross-cutting | 1 integration test: simulate small CC tunable batch, fetch result, verify trace structure |

## Risks

- **Maturin rebuild step**: P2 must explicitly rebuild and verify the wheel reaches the backend venv. If not, P3 tests will fail with `KeyError: 'merge_trace'`.
- **Trace size for very large N**: ~80 bytes per entry × N merges. N=1000 → ~80 KB per sim. Acceptable for now; document in CHANGELOG.
- **Serializer field whitelisting**: if `SimulationDetailView` uses an explicit list of fields, `merge_trace` must be added.

## Open questions

None — orchestrator owns scope and tolerance.
