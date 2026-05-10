<!-- Last sync: 2026-05-10 from change coordination-export-and-histogram -->

# Coordination Export Specification

## Purpose

Per-particle coordination data and distribution histogram computed at simulation time and persisted in `Simulation.metrics`. Provides the data layer for CSV/JSON exports and the future F2 graph visualization.

## Requirements

### Requirement: Per-Particle Coordination Structure

The system MUST compute and persist `Simulation.metrics.coordination.per_particle` for every successfully completed simulation. Each entry MUST contain `particle_id` (int), `n_contacts` (int), and `contact_neighbors` (list[int]).

#### Scenario: Per-particle list populated on completion

- GIVEN a simulation with `n_particles = N` completes successfully
- WHEN `Simulation.metrics.coordination` is read
- THEN `per_particle` MUST be a list of exactly N entries
- AND `particle_id` values are 0-indexed integers from 0 to N−1 (unique, no gaps)
- AND `n_contacts` for particle i equals `len(contact_neighbors[i])`
- AND `contact_neighbors` for particle i contains ONLY indices j where i and j are physically in contact

#### Scenario: Symmetry invariant

- GIVEN `per_particle` is populated for a simulation
- WHEN checking contact symmetry for any particle pair (i, j)
- THEN if j ∈ `contact_neighbors[i]`, then i MUST be in `contact_neighbors[j]`
- AND particle i MUST NOT appear in its own `contact_neighbors`

#### Scenario: Single-particle edge case

- GIVEN a simulation with `n_particles = 1`
- WHEN `per_particle` is read
- THEN the list contains exactly one entry: `{particle_id: 0, n_contacts: 0, contact_neighbors: []}`

#### Scenario: Simulation failure / metrics absent

- GIVEN a simulation that fails before metrics are computed
- WHEN `Simulation.metrics.coordination` is read
- THEN `per_particle` MUST be an empty list `[]` (not null, not missing)
- AND `distribution` MUST be an empty dict `{}` (not null, not missing)

---

### Requirement: Coordination Distribution Histogram

The system MUST compute and persist `Simulation.metrics.coordination.distribution` for every successfully completed simulation. Keys are stringified integer coordination numbers; values are counts.

#### Scenario: Distribution populated on completion

- GIVEN a simulation with `n_particles = N` completes successfully
- WHEN `Simulation.metrics.coordination.distribution` is read
- THEN `sum(distribution.values())` MUST equal N (sanity invariant)
- AND keys span the full integer range "0" through str(max_coordination) with no gaps (even if count = 0)

#### Scenario: Trivial single-particle distribution

- GIVEN a simulation with `n_particles = 1`
- WHEN `distribution` is read
- THEN `distribution = {"0": 1}`

#### Scenario: Zero-contact cluster (no contacts formed)

- GIVEN a simulation where no particles are in contact
- WHEN `distribution` is read
- THEN `distribution = {"0": N}`

---

### Requirement: Backward Compatibility — mean and std

The pre-existing fields `coordination.mean` and `coordination.std` MUST remain present after this change. Adding `per_particle` and `distribution` MUST NOT alter the value of `mean` or `std` for any seed/parameter combination.

#### Scenario: Regression against stored baseline

- GIVEN a stored baseline of `{mean, std}` values for a set of simulation seeds
- WHEN those simulations are rerun after the change
- THEN `mean` and `std` values MUST match the stored baseline within floating-point tolerance (< 1e-9)

#### Scenario: mean and std present for new sims

- GIVEN a new simulation completes
- WHEN `Simulation.metrics.coordination` is read
- THEN `mean`, `std`, `per_particle`, and `distribution` are ALL present

---

### Requirement: Contact Threshold Definition and Threshold Metadata

The contact threshold used for `per_particle` and `distribution` MUST be `dist <= (radius_i + radius_j) * (1 + tolerance)` where `tolerance = 0.01` (1%) — identical to the threshold used by the `neighbor_graph` endpoint (`views.py` line 1350).

The chosen threshold strategy for `mean` and `std` MUST be recorded in `metrics.coordination.threshold_strategy` as either `"legacy_2_1r"` or `"unified_r_sum_with_tolerance"`, and documented in CHANGELOG.

**Note**: Current code contains a discrepancy — `tasks.py` line 1085 uses `(radii[i] + radii[j]) * 1.05` (5% tolerance) while `neighbor_graph` uses 1% tolerance. Design MUST resolve this before implementation.

#### Scenario: Threshold metadata field present

- GIVEN any newly completed simulation
- WHEN `Simulation.metrics.coordination` is read
- THEN `threshold_strategy` MUST be present with value `"legacy_2_1r"` or `"unified_r_sum_with_tolerance"`

#### Scenario: per_particle threshold matches neighbor_graph

- GIVEN a simulation with known geometry
- WHEN `per_particle[i].contact_neighbors` is compared to the response of `GET neighbor-graph/`
- THEN both MUST return the identical contact set for every particle i

#### Scenario: Strategy A — legacy threshold for mean/std only

- GIVEN design chooses Strategy A
- WHEN `mean` and `std` are computed
- THEN they use the legacy threshold (`2.1 * radius` for monodisperse, or `(r_i + r_j) * 1.05` for polydisperse — **design decides**)
- AND `per_particle` / `distribution` use the unified 1% threshold
- AND `threshold_strategy = "legacy_2_1r"`

#### Scenario: Strategy B — unified threshold everywhere

- GIVEN design chooses Strategy B
- WHEN `mean`, `std`, `per_particle`, and `distribution` are computed
- THEN all four use `(radius_i + radius_j) * 1.01`
- AND `threshold_strategy = "unified_r_sum_with_tolerance"`

---

### Requirement: Performance Constraint

The additional computation for `per_particle` and `distribution` MUST NOT degrade simulation wall-clock time by more than 5% for N=1000 particles.

#### Scenario: Performance budget for N=1000

- GIVEN a simulation with N = 1000 particles
- WHEN per-particle coordination and histogram are computed alongside existing metrics
- THEN the additional time MUST be ≤ 5% of the baseline simulation runtime (measured without the new code)

#### Scenario: Metrics field size

- GIVEN any simulation
- WHEN `Simulation.metrics` is serialized to JSON
- THEN the total size MUST be under 1 MB (soft limit; document in CHANGELOG)

---

### Requirement: Imported Simulation Edge Case

For simulations with `algorithm = "imported"` where no contact info is available at import time, the behavior MUST be defined explicitly.

#### Scenario: Imported sim with coordinates available

- GIVEN a simulation imported with valid coordinate data
- WHEN metrics are computed (at import time or deferred)
- THEN the system SHOULD compute `per_particle` and `distribution` from coordinates using the unified threshold
- AND if coordinates are absent, `per_particle = []` and `distribution = {}` apply (same as failure case)
