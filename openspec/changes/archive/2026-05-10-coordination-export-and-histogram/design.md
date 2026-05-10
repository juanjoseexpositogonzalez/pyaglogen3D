# Design: Coordination Export & Histogram

## Technical Approach

Extract a shared `compute_coordination_data()` service that replaces 4 inline coordination loops (2 in tasks.py, 2 in views.py) with a single vectorized implementation. Store enriched coordination data (`per_particle`, `distribution`, `mean`, `std`) in the existing `metrics` JSONField. Extend both CSV export endpoints with the new data.

## Architecture Decisions

### Decision: Contact Threshold Unification

| Option | Description | Tradeoff |
|--------|-------------|----------|
| **A — Unified `(r_i+r_j)*1.01`** | Match neighbor_graph's 1% tolerance everywhere | ~3-5% drift in historical mean/std for monodisperse |
| B — Dual threshold | Keep legacy 2.1*r for mean/std, unified for new fields | Two sources of truth, confusing for TFM student |
| C — Keep all 3 | Add `threshold_strategy` metadata to disambiguate | Maximum inconsistency |

**Choice**: Option A. **Rationale**: R3 spec preserves the *formula* (mean/std from per-particle counts), not the *value*. A one-time ~4% shift is acceptable — CHANGELOG documents it. Consistency across neighbor_graph, export, and metrics is critical for the end user. The `threshold_strategy` metadata field is still included for auditability.

### Decision: Service Location

**Choice**: `backend/apps/simulations/services/coordination.py` — follows existing `services/` pattern (projection.py, params.py).
**Alternative**: Inline in tasks.py. **Rejected**: views.py also needs the same logic (export_csv recomputes coordination via `_calculate_coordination_numbers`).

### Decision: Batch CSV Per-Particle Data

**Choice**: Exclude per-particle from batch CSV (aggregate columns only: `coord_mean`, `coord_std`, `coord_mode`, `coord_max`).
**Rationale**: R6 spec says per-particle expansion is MAY. A batch with 100 sims × 1000 particles = 100K rows would break spreadsheet usability. Deferred to future `?include_per_particle=true` param.

## Data Flow

```
run_simulation_task (tasks.py)
  └─ compute_coordination_data(coords, radii, tol=0.01)
       ├─ vectorized pairwise distance matrix (numpy)
       ├─ contact mask → per_particle + neighbors
       ├─ distribution histogram (from per_particle counts)
       └─ mean/std (from per_particle, single source of truth)
  └─ metrics["coordination"] = {mean, std, per_particle, distribution,
                                 threshold_strategy, tolerance}

SimulationViewSet.export_csv (views.py)
  ├─ existing PARTICLE DATA section: reads per_particle from metrics
  │   (replaces _calculate_coordination_numbers recomputation)
  ├─ NEW section: # COORDINATION PER-PARTICLE
  │   → particle_id, n_contacts, contact_neighbors
  └─ NEW section: # COORDINATION DISTRIBUTION
      → coordination, count (0..max inclusive)

ParametricStudyViewSet.export_csv (views.py)
  └─ header += [Coord_Mode, Coord_Max]  (mean/std already exist)
  └─ row += [mode, max] from metrics["coordination"]["distribution"]

neighbor_graph (views.py)
  └─ reads cached per_particle if available, else computes on-the-fly
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/apps/simulations/services/coordination.py` | Create | `CoordinationData` dataclass + `compute_coordination_data()` |
| `backend/apps/simulations/services/__init__.py` | Modify | Export new function |
| `backend/apps/simulations/tasks.py` | Modify | Replace 2 inline loops (~lines 811-824, 1079-1090) with service call; store enriched dict in metrics |
| `backend/apps/simulations/views.py` | Modify | (1) `export_csv`: append 2 new CSV sections, use cached data instead of `_calculate_coordination_numbers`, (2) `ParametricStudyViewSet.export_csv`: append 2 columns, (3) `neighbor_graph`: read cached `per_particle` when available |
| `backend/apps/simulations/tests/test_coordination.py` | Create | Unit tests for service function |
| `backend/apps/simulations/tests/test_export_coordination.py` | Create | Integration tests for CSV exports |

## Interfaces / Contracts

```python
# backend/apps/simulations/services/coordination.py
from dataclasses import dataclass

@dataclass
class ParticleCoordination:
    particle_id: int
    n_contacts: int
    contact_neighbors: list[int]

@dataclass
class CoordinationData:
    per_particle: list[ParticleCoordination]
    distribution: dict[int, int]       # coord_number → count (0..max, no gaps)
    mean: float
    std: float
    threshold_strategy: str            # "unified_r_sum_tol"
    tolerance: float                   # 0.01

def compute_coordination_data(
    coords: np.ndarray,    # (N, 3)
    radii: np.ndarray,     # (N,)
    tolerance: float = 0.01,
) -> CoordinationData:
    """Vectorized contact computation. O(N²) time/memory, chunked if N>3000."""
    ...
```

Serialization to `metrics["coordination"]`: dataclass → dict via `dataclasses.asdict()`. `distribution` keys serialized as strings (`"0"`, `"1"`, ...) since JSON keys must be strings.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `compute_coordination_data` — 1-particle, 2-touching, 2-apart, symmetry, sum invariant, polydisperse, perf N=1000 <2s | pytest, numpy fixtures |
| Integration | `tasks.py` — sim produces all 6 coordination fields; mean matches per_particle | Run minimal Df=1.7 sim via task |
| Integration | `export_csv` — parse CSV, assert new sections/headers, existing column order preserved | DRF test client, csv.reader |
| Edge | Failed/imported sim → empty coordination structure (R9) | Assert `{mean:0, std:0, per_particle:[], distribution:{}}` |

## Migration / Rollout

No DB migration. New fields persist in existing JSONField (`Simulation.metrics`). Legacy sims retain `{mean, std}` only — frontend treats `per_particle` and `distribution` as Optional. No historical backfill (out of scope).

**Rollback**: `git revert` on merge commit. No data loss — legacy shape is valid.

## Open Questions

- [x] Threshold strategy → resolved: Option A (unified 1.01)
- [ ] Chunked computation threshold (N>3000 vs N>5000) — decide during implementation based on memory profiling. Default: 3000.
