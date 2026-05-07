# CC Tunable Merge Trace (PYA-14 Phase 1)

Per-step diagnostic instrumentation for the CC tunable algorithm.

## Why

The CC tunable algorithm drifts at low Df targets (Df < 1.8). Exploration
(frente 14 explore) confirmed that the per-step fractal-law formula is correct —
the drift comes from excessive ballistic fallback when tunable placement fails.

Before fixing the algorithm (Phase 2), we instrument every merge step so the fix
can be evidence-based. This trace answers: at which step does tunable placement
start failing? How often? Does the aggregate's Rg track the target?

## The 10 trace fields

Each entry in `merge_trace` corresponds to one merge step (monomer or
sub-cluster joining the aggregate):

| Field | Type | Meaning |
|---|---|---|
| `step` | int | 0-indexed merge counter |
| `n1` | int | Particle count in cluster 1 at merge time |
| `n2` | int | Particle count in cluster 2 at merge time |
| `required_distance` | float | Target COM-COM distance from `calculate_com_distance` |
| `actual_distance` | float | Measured COM-COM distance after positioning |
| `rg_after` | float | Measured Rg of the merged cluster |
| `rg_target` | float | Target Rg: `rp · ((n1+n2)/kf)^(1/Df)` |
| `merge_type` | string | `"tunable"` or `"ballistic"` |
| `retries` | int | Placement attempts before success |
| `bounding_check_passed` | bool | Whether the first-attempt bounding sphere check passed |

## Where it lives

The trace is stored in `Simulation.metrics["merge_trace"]` — a JSONField that
already existed. No database migration required.

The drill-down API (`GET /api/v1/projects/{pk}/simulations/{pk}/`) returns
`metrics` as-is, so `merge_trace` is exposed transparently when present.

The trace is NOT included in CSV exports (deferred to a follow-up cycle).

## Storage size

Each trace entry serialises to ~80 bytes of JSON. For a simulation with N
monomers, the trace has N−1 entries:

- N = 100 → ~8 KB
- N = 1,000 → ~80 KB
- N = 10,000 → ~800 KB

Acceptable for current use cases. For very large N, consider truncation or
sampling in a future cycle.

## Backward compatibility

- Legacy simulations (created before this change) have no `merge_trace` key
  in `metrics`. API consumers should treat a missing key as an empty list.
- Non-CC algorithms (ballistic, DLA, CCA, fracval, gcca, box_rfa, voxel)
  always produce an empty `merge_trace` list.
- The engine's `SimulationResult.merge_trace` field defaults to `Vec::new()`,
  so the field is always present in new results (never `None`).

## Phase 2 preview

PYA-14 Phase 2 (separate cycle) will use this trace data to implement the
algorithmic fix. The trace enables choosing between two candidate approaches
with evidence:

- **Path B — adaptive d**: adjust `calculate_com_distance` dynamically based
  on Rg drift (using `rg_after` vs `rg_target` from the trace).
- **Path D — smart pair selection**: pick sub-cluster pairs that minimise
  ballistic fallback (using `merge_type` distribution from the trace).

## How to consume programmatically

```python
import requests

# Fetch a completed simulation
resp = requests.get(
    f"https://your-server/api/v1/projects/{project_id}/simulations/{sim_id}/",
    headers={"Authorization": f"Token {token}"},
)
sim = resp.json()
trace = sim["metrics"].get("merge_trace", [])

if not trace:
    print("No merge trace (legacy or non-CC simulation)")
else:
    total = len(trace)
    ballistic = sum(1 for e in trace if e["merge_type"] == "ballistic")
    print(f"Total merges: {total}, ballistic fallback: {ballistic} ({100*ballistic/total:.1f}%)")

    # Rg drift analysis: compare rg_after vs rg_target per step
    for entry in trace:
        drift = abs(entry["rg_after"] - entry["rg_target"]) / entry["rg_target"]
        if drift > 0.1:
            print(f"  Step {entry['step']}: Rg drift {drift:.1%} (type={entry['merge_type']})")
```
