# Design: CC Tunable Formula Fix

## Technical Approach

Fix the core COM-distance equation (3 bugs), add uniform-spherical two-rotation positioning, implement retry-then-ballistic fallback (100 attempts), and expose seed type modes (Monomers/Dimers/Trimers) end-to-end. Bottom-up: engine math → positioning → retry → seed types → backend API → frontend form → integration test.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Formula source | Derived from intermediate thesis steps + PC case cross-validation | Use thesis "simplified" eq directly | Thesis simplified eq has typo (missing `^(2/Df)` exponent). PC specialization confirms our derivation. |
| Two-rotation scheme | Uniform spherical (azimuth + arcsin elevation) for initial CoM direction | Keep single random direction | Single axis biases poles; thesis FZR requires uniform sphere. `theta = arcsin(uniform(-1,1))` is correct uniform solid-angle sampling. |
| Retry policy | New pair selection per retry (up to 100), then ballistic fallback | Retry same pair with different rotation only | Thesis says "choose different cluster pair" on failure. Retrying same pair is geometrically limited. |
| Seed type implementation | New enum `SeedType { Monomers, Dimers, Trimers }` replacing `SeedStrategy::TunablePc` | Keep existing `SeedStrategy::TunablePc { cluster_size }` | TunablePc depends on Python context (unusable in pure engine). Dimers/Trimers are deterministic, no external dependency. |
| Seed type API field | `seed_type` in `parameters` JSON (not a model column) | Add nullable model column | Parameters JSONField already holds all algorithm-specific config. Adding a model column is heavier than needed. |
| Trimer geometry | Linear (3 collinear touching monomers) | Triangular (equilateral, all touching) | Linear is simpler; triangular requires 2D calculation. Note for user: configurable later if needed. |

## Data Flow

```
Frontend (SimulationForm.tsx)
    │ seed_type in params JSON
    ▼
Backend (serializers.py validates → tasks.py)
    │ pass seed_type string to engine via PyO3
    ▼
Engine (tunable_cc.rs)
    │ 1. initialize_seed_clusters(seed_type)
    │ 2. WHILE clusters > 1:
    │    a. pick_pair()
    │    b. calculate_com_distance() ← FIXED FORMULA
    │    c. position: uniform-spherical direction + two-rotation
    │    d. overlap check → resolve_overlap_by_rotation
    │    e. FAIL? → retry_counter++ → pick NEW pair → goto (a)
    │    f. retries exhausted? → ballistic fallback (logged)
    │    g. merge clusters
    │ 3. compute Df/kf from Rg evolution
    ▼
SimulationResult (Df, kf, geometry)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `aglogen_core/engine/src/simulation/tunable_cc.rs:235-273` | Modify | Rewrite `calculate_com_distance` with correct formula |
| `aglogen_core/engine/src/simulation/tunable_cc.rs:452-523` | Modify | Two-rotation: uniform spherical sampling for merge direction |
| `aglogen_core/engine/src/simulation/tunable_cc.rs:29-38` | Modify | Replace `SeedStrategy` enum with `SeedType { Monomers, Dimers, Trimers }` |
| `aglogen_core/engine/src/simulation/tunable_cc.rs:46-74` | Modify | Add `max_merge_retries: usize` (default 100) to `TunableCcParams` |
| `aglogen_core/engine/src/simulation/tunable_cc.rs:630-651` | Modify | Rewrite `initialize_seed_clusters` for Dimers/Trimers |
| `aglogen_core/engine/src/simulation/tunable_cc.rs:690-807` | Modify | Main loop: add retry counter, new-pair retry logic, stats tracking |
| `frontend/src/components/forms/SimulationForm.tsx:1179-1243` | Modify | Replace `seed_cluster_size` input with `seed_type` dropdown |
| `backend/apps/simulations/serializers.py` | Modify | Validate `seed_type` in parameters for `tunable_cc` algorithm |

## Interfaces / Contracts

```rust
// Corrected formula — tunable_cc.rs
fn calculate_com_distance(
    n_po: usize, n_po1: usize, n_po2: usize,
    kf: f64, df: f64, rp: f64,
) -> Result<f64, ComDistanceError> {
    // d² = (n_po · rp²) / (n_po1 · n_po2)
    //    · [ n_po·(n_po/kf)^(2/Df) − n_po1·(n_po1/kf)^(2/Df) − n_po2·(n_po2/kf)^(2/Df) ]
    // Returns Err if d² < 0 (inconsistent params)
}

// Seed types
pub enum SeedType {
    Monomers,  // N monomers (current default behavior)
    Dimers,    // N/2 touching pairs (leftover monomer if N odd)
    Trimers,   // N/3 linear triplets (leftovers: monomer or dimer)
}

// Config with retry
pub struct TunableCcParams {
    pub n_particles: usize,
    pub target_df: f64,
    pub target_kf: f64,
    pub radius_min: f64,
    pub radius_max: f64,
    pub seed_type: SeedType,         // replaces seed_strategy
    pub max_merge_retries: usize,    // default 100
    pub max_rotation_attempts: usize,
    pub max_particle_selection_attempts: usize,
    pub sintering: SinteringDistribution,
}
```

```python
# Backend: validated choices for parameters.seed_type
SEED_TYPE_CHOICES = ["monomers", "dimers", "trimers"]
# Default: "monomers" if absent in request
```

## Formula Derivation

From thesis Rg² identity for merged aggregate:

```
n_po·(Rg0² − 3/5·rp²) = n_po1·(Rg1² − 3/5·rp²) + n_po2·(Rg2² − 3/5·rp²) + (n_po1·n_po2/n_po)·d²
```

Substitute `Rgi² = (ni/kf)^(2/Df) · rp²`, solve for d²:

```
d² = (n_po·rp²)/(n_po1·n_po2) · [
    n_po·((n_po/kf)^(2/Df) − 3/5)
  − n_po1·((n_po1/kf)^(2/Df) − 3/5)
  − n_po2·((n_po2/kf)^(2/Df) − 3/5)
]
```

Since `n_po = n_po1 + n_po2`, the `−3/5` constants cancel:

```
d² = (n_po·rp²)/(n_po1·n_po2) · [
    n_po·(n_po/kf)^(2/Df)
  − n_po1·(n_po1/kf)^(2/Df)
  − n_po2·(n_po2/kf)^(2/Df)
]
```

**Cross-validation**: Set n_po2=1 (PC case). Then n_po=n_po1+1 and the expression reduces to the working `tunable.rs` gamma formula. This confirms the derivation.

**Thesis typo**: eq:leyPotenciasColisionSimplificada drops `^(2/Df)` exponent and conflates cluster terms. The PC specialization (eq:leyPotenciascasoPC) is correct in the thesis, confirming the CC form is a typesetting error.

## Two-Rotation Rationale

The current code (`position_clusters_for_contact`, line 478) uses `random_point_on_sphere` — which IS uniform spherical. However the thesis specifies TWO rotations: (1) rotate impacted to align M1 toward gap zone, (2) rotate impactor for contact. The current code only rotates the impactor.

Fix: After placing impactor CoM on the sphere at distance d, apply a SECOND random rotation to the impacted cluster (around its CoM) before selecting contact particles. This doubles the geometric freedom for finding valid configurations, reducing ballistic fallback rate.

Uniform spherical direction sampling (already correct in helper): `phi = U(0,2π)`, `theta = arcsin(U(-1,1))`, converts to `(cos θ cos φ, cos θ sin φ, sin θ)`.

## Backward Compatibility Matrix

| Layer | Legacy behavior | New behavior |
|-------|----------------|-------------|
| Engine | Wrong formula, single rotation, no retry, `SeedStrategy` enum | Correct formula, two-rotation, retry-100-then-ballistic, `SeedType` enum |
| API | `parameters.seed_cluster_size` (numeric, optional) | `parameters.seed_type` (string, default "monomers") |
| Frontend | "Seed Cluster Size" numeric input | "Seed Type" dropdown (Monomers/Dimers/Trimers) |
| DB | Existing rows have `seed_cluster_size` in params JSON | Old field ignored; new `seed_type` defaults to monomers |

**Breaking**: `seed_cluster_size` is deprecated. Existing simulations with this field still stored in JSON but ignored by engine. No DB migration needed (params is JSONField).

## Migration Strategy

- **DB**: No schema migration required. `parameters` is a JSONField; `seed_type` is simply a new key with default `"monomers"`.
- **Engine API**: Additive — `SeedType` defaults to `Monomers`. Old `SeedStrategy::TunablePc` variant removed (was already non-functional without Python context).
- **Frontend**: Replace `seed_cluster_size` input with `seed_type` dropdown. Existing saved forms will show "Monomers" (default).

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Engine unit | Formula correctness: n_po2=1 case matches PC gamma | `#[test]` comparing `calculate_com_distance(n+1, n, 1, ...)` to PC formula output |
| Engine unit | Uniform spherical: histogram of 10k samples, chi² test on bins | `#[test]` statistical test |
| Engine unit | Retry counter: mock scenario where first pair always fails | `#[test]` verify fallback triggers after N retries |
| Engine unit | Seed types: assert N/2 dimers for even N, correct geometry | `#[test]` for each SeedType variant |
| Backend | Serializer validates `seed_type` choices + default | `pytest` parametrized test |
| Backend | API POST with `seed_type`, assert response + task dispatch | `pytest` integration |
| Frontend | Dropdown renders 3 options, default "Monomers" | `vitest` + testing-library |
| Frontend | Form submits `seed_type` in params payload | `vitest` mock API call |
| Integration (P6) | 5 seeded runs: target Df=1.6, kf=1.7, N=350 | `#[test] #[ignore]` — assert |mean(Df)−1.6|/1.6 < 0.05, |mean(kf)−1.7|/1.7 < 0.10 |

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Formula not in printed thesis | Confusion for future readers | Code comment with full derivation + PC cross-validation proof |
| Two-rotation breaks reproducibility of fixed-seed tests | Existing snapshot tests fail | Document explicitly; update affected tests in same PR |
| Retry policy adds runtime for extreme params | Slow simulations | 100 retries is O(ms) each; typical cases retry <5 times. Bench if >1s added. |
| `SeedType::Trimers` with N<3 | Edge case panic | Graceful fallback: N=1→monomer, N=2→dimer. Test this edge case. |
| Removing `SeedStrategy::TunablePc` variant | Compile error if referenced elsewhere | Grep for usage; it's only in `initialize_seed_clusters` and falls back to Monomers already. |

## Open Questions

None — all decisions locked per proposal and exploration findings.
