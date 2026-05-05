<!-- Last sync: 2026-05-05 from change sintering-cc-fix -->

# Spec: cc-tunable-aggregation

## Purpose

Full specification for the Cluster-Cluster (CC) tunable aggregation algorithm. Covers the
COM-distance constraint equation, two-rotation particle positioning, geometric-failure retry
policy, seed-type modes, convergence tolerances, backward compatibility, and diagnostic metadata.

Context: see `../proposal.md` for scope; see `../../_explore-only/pya-10-cc-tunable-convergence.md`
for derivation and bug analysis.

This spec describes **observable behavior** — what callers see in API responses, simulation
results, and logged metadata — not internal implementation.

## Requirements

### R1. COM-Distance Formula

The engine MUST compute the center-of-mass distance between two merging sub-clusters using:

```
d² = (n_po · rp_eff²) / (n_po1 · n_po2)
       · [ n_po·(n_po/kf)^(2/Df)
         − n_po1·(n_po1/kf)^(2/Df)
         − n_po2·(n_po2/kf)^(2/Df) ]
```

Where `n_po = n_po1 + n_po2`, `rp_eff = rp · sintering_coeff`, and `Df`, `kf` are the target
fractal parameters. The function MUST accept a `sintering_coeff: f64` parameter
(default `1.0` when the caller does not supply it). When `d² ≤ 0`, the engine MUST return
`None` and the retry policy (R3) takes over.

(Previously: formula used bare `rp` everywhere; no `sintering_coeff` parameter existed.)

#### Scenario 1.1 — Backward compat: coeff=1.0 identical to frente-10 baseline

- GIVEN `sintering_coeff = 1.0` and the same inputs used to produce a known frente-10 d value
- WHEN `calculate_com_distance` is called
- THEN the returned `d` MUST equal the frente-10 result to within 1e-10 relative tolerance
- AND `rp_eff = rp · 1.0 = rp` (mathematically identical substitution)

#### Scenario 1.2 — PC-equivalent case with sintering (n_po1 = n_po2 = 1)

- GIVEN `n_po1 = 1`, `n_po2 = 1`, `n_po = 2`, `sintering_coeff = 0.9`, valid `Df ∈ (1.0, 3.0)`, `kf > 0`
- WHEN `calculate_com_distance` is called
- THEN the returned `d` equals `rp_eff · sqrt(2·(2/kf)^(2/Df) − 2·(1/kf)^(2/Df))` where `rp_eff = rp · 0.9`
- AND `d` is strictly less than the coeff=1.0 result by factor 0.9 (effective contact reduced by 10%)

#### Scenario 1.3 — Asymmetric small-cluster merge with sintering (n_po1=2, n_po2=1)

- GIVEN `n_po1 = 2`, `n_po2 = 1`, `Df = 1.8`, `kf = 1.3`, `rp = 1.0`, `sintering_coeff = 0.9`
- WHEN `calculate_com_distance` is called
- THEN `d > 0` AND the value matches the analytic result using `rp_eff = 0.9` to within 1e-10

#### Scenario 1.4 — Extreme sintering (coeff=0.5) still produces positive d²

- GIVEN `n_po1 = n_po2 = 1`, `Df = 2.0`, `kf = 1.0`, `rp = 1.0`, `sintering_coeff = 0.5`
- WHEN `calculate_com_distance` is called
- THEN `d > 0` (formula produces finite, positive result for well-posed parameters)
- AND `d` is strictly positive and finite (not NaN, not zero)

#### Scenario 1.5 — Degenerate coeff=0.0 returns None

- GIVEN `sintering_coeff = 0.0` (fully collapsed: `rp_eff = 0`)
- WHEN `calculate_com_distance` is called
- THEN the function returns `None` (zero effective radius collapses `d²` to zero)
- AND no panic or NaN is produced

#### Scenario 1.6 — Impossible geometry still returns None

- GIVEN parameters where the formula yields `d² ≤ 0` (e.g., extremely high Df or cluster sizes incompatible with kf), regardless of sintering_coeff
- WHEN `calculate_com_distance` is called
- THEN the function returns `None`; it does NOT return a negative distance or NaN

#### Scenario 1.7 — Low-Df produces larger distance than high-Df (invariant preserved with sintering)

- GIVEN identical cluster sizes, kf, and `sintering_coeff = 0.9`, but `Df_low = 1.4` vs `Df_high = 2.2`
- WHEN `calculate_com_distance` is called for each
- THEN `d(Df_low) > d(Df_high)` (lower Df = more open aggregate = larger COM separation; sintering scales both uniformly)

---

### R2. Two-Rotation Particle Positioning

When placing a merged cluster, the orientation of the impactor MUST be sampled using TWO
independent rotational degrees of freedom: azimuth `φ ∈ [0, 2π)` and elevation `θ ∈ [-π/2, π/2]`,
drawn with uniform spherical distribution. Single-axis rotation (old behavior) is replaced.

#### Scenario 2.1 — Azimuth and elevation are both sampled

- GIVEN a positioning call for any cluster pair
- WHEN the impactor CoM is placed on the sphere of radius `d`
- THEN the direction vector uses both azimuth and elevation components: `(cos θ·cos φ, cos θ·sin φ, sin θ)`
- AND neither axis is fixed or zero by default

#### Scenario 2.2 — Distribution is isotropic over many samples

- GIVEN 1000 independent positioning calls with the same cluster sizes and parameters but different random seeds
- WHEN the impactor CoM directions are collected
- THEN the empirical distribution of `(x, y, z)` components satisfies isotropy: each component's mean ∈ (−0.05, 0.05) and variance ∈ (0.28, 0.39) (i.e., consistent with uniform sphere sampling)

#### Scenario 2.3 — Positioning regression: fixed-seed snapshots are invalidated

- GIVEN any existing snapshot test that captures a specific aggregate geometry for a fixed seed
- WHEN the engine is updated with two-rotation positioning
- THEN those snapshots MUST be regenerated; the old positions are expected to differ
- AND this is documented as a known breaking change to seed-based regression artifacts

---

### R3. Retry Policy on Geometric Merge Failure

When a tunable geometric merge attempt fails (overlap detected and unresolvable, or
`calculate_com_distance` returns `None`), the engine MUST retry with a NEW randomly-selected
sub-cluster pair up to `max_merge_retries` attempts (default: 100, configurable at call time).
Each retry independently samples fresh azimuth and elevation. Only after all retries are
exhausted does the ballistic fallback engage.

#### Scenario 3.1 — First-attempt success

- GIVEN a merge where the first pair placement succeeds (no overlap, `d > 0`)
- WHEN the engine processes that step
- THEN exactly one attempt is made; retry counter is 0; ballistic fallback is NOT engaged

#### Scenario 3.2 — Success on retry attempt N (N > 1)

- GIVEN a merge where attempts 1 through N-1 fail and attempt N succeeds
- WHEN the engine processes that step
- THEN the retry counter reaches N-1; the merge uses the tunable geometry from attempt N; ballistic fallback is NOT engaged

#### Scenario 3.3 — All retries exhausted → ballistic fallback

- GIVEN a merge where all `max_merge_retries` attempts fail
- WHEN the engine processes that step
- THEN the ballistic fallback (`merge_ballistic`) is used for that merge step
- AND the retry-exhaustion event is counted in simulation metadata (R7)

#### Scenario 3.4 — max_merge_retries is configurable

- GIVEN a caller that passes `max_merge_retries = 50`
- WHEN the engine is initialized with this parameter
- THEN the retry limit for every merge step in that simulation is 50, not the default 100
- AND the parameter is accepted without error for any positive integer value

---

### R4. Seed Type Modes

The engine MUST accept a `seed_type` parameter with three modes controlling the initial
particle pool:

| `seed_type`   | Initial pool |
|---------------|-------------|
| `"monomers"`  | N independent monomers (default) |
| `"dimers"`    | ⌊N/2⌋ touching pairs (contact at `2·rp`); leftover 1 monomer when N is odd |
| `"trimers"`   | ⌊N/3⌋ linear trimers (3 monomers collinear at `2·rp` spacing); leftovers: `N mod 3` additional monomers |

#### Scenario 4.1 — Monomers: initial pool has N clusters of size 1

- GIVEN `seed_type = "monomers"` and `N = 10`
- WHEN the simulation initializes
- THEN the pool contains exactly 10 clusters each with 1 particle

#### Scenario 4.2 — Dimers: initial pool has ⌊N/2⌋ size-2 clusters

- GIVEN `seed_type = "dimers"` and `N = 10`
- WHEN the simulation initializes
- THEN the pool contains exactly 5 clusters each with 2 particles
- AND each dimer's inter-particle distance is `2·rp` (touching spheres)

#### Scenario 4.3 — Dimers: odd N has one leftover monomer

- GIVEN `seed_type = "dimers"` and `N = 9`
- WHEN the simulation initializes
- THEN the pool contains 4 dimers and 1 monomer (total 9 particles)

#### Scenario 4.4 — Trimers: initial pool has ⌊N/3⌋ size-3 clusters

- GIVEN `seed_type = "trimers"` and `N = 12`
- WHEN the simulation initializes
- THEN the pool contains exactly 4 clusters each with 3 particles
- AND particles within each trimer are collinear with spacing `2·rp`

#### Scenario 4.5 — Trimers: leftover handling for non-divisible N

- GIVEN `seed_type = "trimers"` and `N = 11`
- WHEN the simulation initializes
- THEN the pool contains 3 trimers and 2 additional monomers (total 11 particles)
- AND no error or warning is raised

#### Scenario 4.6 — Default seed_type when param omitted

- GIVEN a caller that does not supply `seed_type`
- WHEN the simulation runs
- THEN behavior is identical to `seed_type = "monomers"`

---

### R5. Convergence to Target

For target parameters `(Df_target, kf_target)` and `N ≥ 100`, the engine MUST produce
aggregates whose mean Df and kf over ≥ 5 independent runs (different seeds) satisfy:

- `|mean(Df) − Df_target| / Df_target < 0.05`  (±5% relative)
- `|mean(kf) − kf_target| / kf_target < 0.10`  (±10% relative)

These bounds are verified by the integration test suite using `cargo test`.

#### Scenario 5.1 — Primary convergence target (Df=1.6, kf=1.7, N=350)

- GIVEN 5 runs with seeds 1–5 and target `Df=1.6, kf=1.7, N=350`
- WHEN each run completes and Df/kf are measured from the output aggregate
- THEN `mean(Df) ∈ [1.52, 1.68]` and `mean(kf) ∈ [1.53, 1.87]`

#### Scenario 5.2 — Medium Df target (Df=1.8, kf=1.4, N=350)

- GIVEN 5 runs with seeds 1–5 and target `Df=1.8, kf=1.4, N=350`
- WHEN runs complete
- THEN `mean(Df) ∈ [1.71, 1.89]` and `mean(kf) ∈ [1.26, 1.54]`

#### Scenario 5.3 — High Df target (Df=2.0, kf=1.0, N=100)

- GIVEN 5 runs with seeds 1–5 and target `Df=2.0, kf=1.0, N=100`
- WHEN runs complete
- THEN `mean(Df) ∈ [1.90, 2.10]` and `mean(kf) ∈ [0.90, 1.10]`

#### Scenario 5.4 — Out-of-tolerance triggers CI failure

- GIVEN a formula regression where `calculate_com_distance` reverts to the buggy form
- WHEN the Scenario 5.1 integration test runs
- THEN the assertion fails because `mean(Df) > 1.68` (systematic upward bias)
- AND CI is red — this is the guard against regression to the wrong formula

---

### R6. Backward Compatibility

The `seed_type` parameter MUST be optional in all call sites (engine, API, frontend).
Existing callers that omit it continue to work without modification or error.

#### Scenario 6.1 — Legacy API call without seed_type

- GIVEN a POST to the CC-tunable simulation endpoint with no `seed_type` field in the body
- WHEN the backend deserializes the request
- THEN the field defaults to `"monomers"` and the simulation runs normally; no 400 or 422 error

#### Scenario 6.2 — Legacy frontend form submission

- GIVEN a frontend that does not include the seed-type dropdown (e.g., older deployed version or direct API call)
- WHEN it submits a CC-tunable simulation form without `seed_type`
- THEN the API accepts the request; no client-visible error

#### Scenario 6.3 — Existing simulations retain monomers behavior

- GIVEN historical simulation records stored in the DB where `parameters.seed_type` is absent
- WHEN those records are read or re-displayed
- THEN the system treats them as `seed_type = "monomers"` without migration or error

---

### R7. Diagnostic Metadata

The engine MUST include retry and fallback counters in the simulation result metadata.
These values appear in the result payload returned to the backend.

| Field | Description |
|-------|-------------|
| `tunable_merges` | Count of merge steps completed via tunable geometry |
| `ballistic_merges` | Count of merge steps that fell back to ballistic |
| `max_retries_per_merge` | Highest retry count observed across all merge steps |

#### Scenario 7.1 — Low retry rate (algorithm working well)

- GIVEN a well-posed target (e.g., Df=1.8, kf=1.3, N=100)
- WHEN the simulation completes
- THEN `tunable_merges / (tunable_merges + ballistic_merges) > 0.80`
- AND `max_retries_per_merge` is present in the metadata

#### Scenario 7.2 — High retry rate (geometry constrained)

- GIVEN a target near the ballistic limit (e.g., Df=2.0, kf=1.0, N=350)
- WHEN the simulation completes
- THEN `ballistic_merges` is non-zero AND present in metadata
- AND the result is still returned (no crash); convergence may be reduced

#### Scenario 7.3 — Metadata always present regardless of outcome

- GIVEN any completed CC-tunable simulation (successful or with fallback merges)
- WHEN the result is returned
- THEN `tunable_merges`, `ballistic_merges`, and `max_retries_per_merge` are all present
- AND none of the three fields is null or missing from the payload

---

### R8. Sintering Contact Consistency

Both the tunable merge path AND the ballistic fallback MUST use `rp · sintering_coeff` as the
effective contact distance when placing merged clusters and checking inter-particle contact.
This ensures all primaries in the aggregate have consistent sintered gaps; a batch where some
merges use tunable geometry and others use ballistic fallback MUST NOT produce an aggregate with
mixed contact distances (some at `rp`, others at `rp · sintering_coeff`).

This requirement is a no-op when `sintering_coeff = 1.0`.

#### Scenario 8.1 — All-tunable batch: all contacts at sintered distance

- GIVEN a simulation where all merge steps succeed via tunable geometry (no ballistic fallback), `sintering_coeff = 0.9`
- WHEN the simulation completes
- THEN every inter-particle contact distance in the aggregate is `≤ 2 · rp · sintering_coeff + ε` (where ε accounts for floating-point tolerance)
- AND no particle pair has a contact gap exceeding `2 · rp` (bare, unsintered contact)

#### Scenario 8.2 — Mixed batch (some ballistic fallback): ballistic also respects sintering

- GIVEN a simulation where some merge steps fall back to ballistic, `sintering_coeff = 0.9`
- WHEN the simulation completes
- THEN ALL inter-particle contact distances in the aggregate satisfy `≤ 2 · rp · sintering_coeff + ε`
- AND the ballistic fallback path uses `rp · sintering_coeff` as effective radius, not bare `rp`

#### Scenario 8.3 — Pure ballistic (impossible tunable target): aggregate uses sintered contact

- GIVEN a target where all merge steps fall back to ballistic (e.g., Df=3.0), `sintering_coeff = 0.8`
- WHEN the simulation completes
- THEN all contacts in the resulting aggregate use `rp_eff = rp · sintering_coeff`
- AND the aggregate is not a single monomer (N particles present)

---

### R9. Convergence with Sintering

For target parameters `(Df_target, kf_target)`, `N ≥ 100`, and `sintering_coeff < 1.0`, the engine
MUST produce aggregates whose mean Df and kf over ≥ 5 independent seeded runs satisfy:

- `|mean(Df) − Df_target| / Df_target < 0.05`  (±5% relative)
- `|mean(kf) − kf_target| / kf_target < 0.10`  (±10% relative)

The aggregate MUST contain N ≈ N_requested particles (i.e., the algorithm MUST NOT collapse to a
single monomer or a handful of clusters). The known Df < 1.8 limitation from R5 applies here too:
convergence is only guaranteed for `Df_target ≥ 1.8` (see PYA-14 for lower Df).

#### Scenario 9.1 — Primary sintered target (Df=2.0, kf=1.0, N=350, coeff=0.9)

- GIVEN 5 runs with seeds 1–5 and target `Df=2.0, kf=1.0, N=350, sintering_coeff=0.9`
- WHEN each run completes
- THEN each aggregate has exactly 350 particles (not 1, not collapsed)
- AND `mean(Df) ∈ [1.90, 2.10]` and `mean(kf) ∈ [0.90, 1.10]`

#### Scenario 9.2 — Medium Df sintered target (Df=1.8, kf=1.4, N=350, coeff=0.9)

- GIVEN 5 runs with seeds 1–5 and target `Df=1.8, kf=1.4, N=350, sintering_coeff=0.9`
- WHEN runs complete
- THEN each aggregate has exactly 350 particles
- AND `mean(Df) ∈ [1.71, 1.89]` and `mean(kf) ∈ [1.26, 1.54]`

#### Scenario 9.3 — Low Df (Df=1.6) not enforced for sintering (known limitation)

- GIVEN `Df_target = 1.6` and `sintering_coeff = 0.9`
- WHEN runs complete
- THEN the aggregate has N particles (not collapsed) — collapse prevention is required
- BUT convergence within ±5% Df is NOT required for `Df_target < 1.8` (deferred to PYA-14)

---

### R10. Backward Compatibility for Pre-Sintering Callers

The `sintering_coeff` parameter MUST be optional in all call sites (engine, Python bindings,
backend API). Callers that do not supply it receive `sintering_coeff = 1.0` implicitly. Existing
simulation results from before this cycle MUST remain valid and reproducible without
modification.

#### Scenario 10.1 — Python call without sintering_coeff defaults to 1.0

- GIVEN a Python caller that invokes the CC-tunable binding without supplying `sintering_coeff`
- WHEN the simulation runs
- THEN behavior is identical to `sintering_coeff = 1.0` (bare rp contact distance)
- AND no error, deprecation warning, or changed output occurs

#### Scenario 10.2 — Backend API request without sintering_coeff field

- GIVEN a POST to the CC-tunable simulation endpoint with no `sintering_coeff` field in the body
- WHEN the backend deserializes the request
- THEN `sintering_coeff` defaults to `1.0`; the simulation runs normally; no 400 or 422 error

#### Scenario 10.3 — Existing DB records without sintering_coeff remain valid

- GIVEN historical simulation records where `parameters.sintering_coeff` is absent (pre-PYA-11)
- WHEN those records are read or re-run
- THEN the system treats them as `sintering_coeff = 1.0`; results are unchanged from frente-10 output
