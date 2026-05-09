<!-- Last sync: 2026-05-09 from changes cc-tunable-merge-trace (Phase 1 of PYA-14) + pya-14-phase2-seed-type-fix (Phase 2) -->

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

---

### R11. `target_kf` Parametric Input

Modifies **the implicit `target_kf` scalar contract assumed by R1, R5, R6, and R10** of this spec.

The algorithm MUST accept `target_kf` as either:

| Mode | Type | Meaning |
|------|------|---------|
| `Fixed(v)` | scalar `f64` | Deterministic — identical to current behaviour |
| `Normal { mean, std }` | two `f64` | Gaussian sample truncated to [μ − 3σ, μ + 3σ] (see R13) |
| `Uniform { min, max }` | two `f64` | Uniform sample over `[min, max]` |

Default: `Fixed` wrapping the existing scalar value. The sampled value MUST be drawn **once at
run start** using the simulation's seeded RNG. It is stored as `target_kf_used: Option<f64>` in
the result (Some for CC-tunable; None for algorithms that don't use `kf`).

Validation MUST reject: `std ≤ 0` for Normal; `max ≤ min` for Uniform; any non-positive value.

(Previously: `target_kf` was a bare `f64` scalar read once at line 869 of `tunable_cc.rs`;
no distribution config or sampling existed.)

#### Scenario 11.1 — Fixed mode: identical to current behaviour (regression)

- GIVEN `target_kf = Fixed(1.3)`, seed `42`, `N=100`, `Df=1.8`
- WHEN the simulation runs
- THEN `result.target_kf_used = Some(1.3)` and aggregate Df/kf match the pre-cycle baseline for seed 42
- AND no statistical variance is introduced

#### Scenario 11.2 — Normal mode: sampled value within ±3σ

- GIVEN `target_kf = Normal { mean: 1.3, std: 0.1 }`, seed `42`
- WHEN the simulation runs
- THEN `result.target_kf_used = Some(v)` where `v ∈ [1.0, 1.6]` (μ ± 3σ)
- AND the physics uses `v` as the effective `kf` for all merge steps

#### Scenario 11.3 — Uniform mode: sampled value within bounds

- GIVEN `target_kf = Uniform { min: 1.1, max: 1.5 }`, seed `7`
- WHEN the simulation runs
- THEN `result.target_kf_used = Some(v)` where `v ∈ [1.1, 1.5]`

#### Scenario 11.4 — Fixed seed → reproducible sample

- GIVEN `target_kf = Normal { mean: 1.3, std: 0.1 }`, same seed used twice
- WHEN both simulations run independently
- THEN both `result.target_kf_used` are equal (deterministic sampling from seeded RNG)

#### Scenario 11.5 — Validation: non-positive std rejected

- GIVEN `target_kf = Normal { mean: 1.3, std: -0.1 }` or `std: 0.0`
- WHEN the simulation is submitted (backend serializer or engine param validation)
- THEN an error is returned describing the invalid parameter; no simulation is started

#### Scenario 11.6 — Validation: Uniform with max ≤ min rejected

- GIVEN `target_kf = Uniform { min: 1.5, max: 1.1 }` or `min == max`
- WHEN submitted
- THEN validation rejects with a descriptive error; no simulation is started

---

### R12. `dpo` Parametric Input (CC-Tunable Only)

The CC-tunable algorithm MUST accept a `dpo_distribution` parameter governing how engine-level
`radius_min`/`radius_max` are sampled:

| Mode | Type | Meaning |
|------|------|---------|
| `Fixed(v)` | scalar `f64` | Deterministic — applies `radius_min = v`, `radius_max = v` (monodisperse) |
| `Normal { mean, std }` | two `f64` | Gaussian sample truncated to [μ − 3σ, μ + 3σ]; same value for min and max |
| `Uniform { min, max }` | two `f64` | Uniform sample; result used as both `radius_min` and `radius_max` |

Default: `Fixed` wrapping the existing scalar `radius_min` value. The sampled value MUST be
drawn **once at run start** using the seeded RNG. It is stored as `dpo_used: f64` in the result.

Validation MUST reject: `mean ≤ 0`, `std ≤ 0` for Normal; `min ≤ 0`, `max ≤ min` for Uniform.
The constraint `dpo > 0` MUST be enforced for all modes since `radius_min` must be positive.

Scope: this distribution applies **exclusively** to `TunableCcParams`. Other algorithm structs
(`DlaParams`, `BallisticParams`, etc.) are unchanged in this cycle.

#### Scenario 12.1 — Fixed mode: identical to current behaviour (regression)

- GIVEN `dpo_distribution = Fixed(1.0)`, seed `42`, `N=100`
- WHEN the simulation runs
- THEN `result.dpo_used = 1.0` and the aggregate matches the pre-cycle baseline for seed 42

#### Scenario 12.2 — Normal mode: sampled dpo within ±3σ

- GIVEN `dpo_distribution = Normal { mean: 1.0, std: 0.05 }`, seed `42`
- WHEN the simulation runs
- THEN `result.dpo_used ∈ [0.85, 1.15]` (μ ± 3σ)
- AND the physics uses this sampled value as the effective `radius_min/max`

#### Scenario 12.3 — Uniform mode: sampled value within [min, max]

- GIVEN `dpo_distribution = Uniform { min: 0.8, max: 1.2 }`, seed `7`
- WHEN the simulation runs
- THEN `result.dpo_used ∈ [0.8, 1.2]`

#### Scenario 12.4 — Validation: non-positive mean or std rejected

- GIVEN `dpo_distribution = Normal { mean: -1.0, std: 0.1 }` or `mean: 0.0`
- WHEN submitted
- THEN validation rejects with a descriptive error

#### Scenario 12.5 — Validation: non-positive Uniform bounds rejected

- GIVEN `dpo_distribution = Uniform { min: -0.5, max: 0.5 }` or `min: 0.0, max: 1.0` where min ≤ 0
- WHEN submitted
- THEN validation rejects; no simulation is started

---

### R13. Truncated Normal Sampling

When `Normal { mean: μ, std: σ }` is specified for any parametric input, the system MUST
sample from a **truncated Normal** distribution bounded to `[μ − 3σ, μ + 3σ]`:

1. Draw a candidate from `Normal(μ, σ)` using the seeded RNG.
2. If the candidate falls outside `[μ − 3σ, μ + 3σ]`, reject it and re-draw.
3. Repeat up to **10 re-draw attempts** total.
4. If all 10 attempts fall outside the bounds, return **μ** (the mean) as the final value.

The RNG state advances for each drawn candidate (rejected or accepted), ensuring reproducibility.

#### Scenario 13.1 — Sample within bounds on first draw

- GIVEN `Normal { mean: 1.3, std: 0.1 }`, seed that produces a within-bounds first draw
- WHEN sampling is performed
- THEN the returned value `v ∈ [1.0, 1.6]` with no re-draws

#### Scenario 13.2 — No sample escapes the ±3σ bound across many draws

- GIVEN `Normal { mean: 1.3, std: 0.1 }` and 1000 independent seeds
- WHEN each seed samples once
- THEN all 1000 sampled values are in `[1.0, 1.6]`
- AND no value equals exactly 1.3 from a guaranteed fallback (statistically implausible)

#### Scenario 13.3 — Fallback to mean after 10 failed attempts

- GIVEN a degenerate case where the first 10 draws all fall outside ±3σ (can be forced in unit tests)
- WHEN sampling is performed
- THEN the returned value is exactly μ
- AND no panic or error is raised

#### Scenario 13.4 — Reproducibility: same seed → same sample

- GIVEN `Normal { mean: 1.3, std: 0.1 }` and seed `42` used twice, independently
- WHEN sampling is performed in each run
- THEN both runs return the same value

---

### R14. Result Fields `dpo_used` and `target_kf_used`

The `SimulationResult` returned by the CC-tunable algorithm MUST include:

| Field | Type | Populated |
|-------|------|-----------|
| `dpo_used` | `f64` | Always; equals the sampled or fixed dpo value used in that run |
| `target_kf_used` | `Option<f64>` | `Some(v)` for CC-tunable; `None` for algorithms without kf |

Both fields MUST be serialized in the API response payload and included in CSV exports.

#### Scenario 14.1 — Fixed mode: `dpo_used` equals the configured value

- GIVEN `dpo_distribution = Fixed(1.0)` and any seed
- WHEN the simulation completes
- THEN `result.dpo_used == 1.0` exactly

#### Scenario 14.2 — Normal mode: `dpo_used` equals the actual sampled value

- GIVEN `dpo_distribution = Normal { mean: 1.0, std: 0.05 }`, seed `42`
- WHEN the simulation completes
- THEN `result.dpo_used` equals the value drawn from the distribution (not the mean)
- AND `result.dpo_used ∈ [0.85, 1.15]`

#### Scenario 14.3 — `target_kf_used` is None for non-kf algorithms

- GIVEN any algorithm that is NOT CC-tunable (e.g., DLA, Ballistic)
- WHEN the simulation completes
- THEN `result.target_kf_used == None`
- AND the API response serializes this field as `null`

#### Scenario 14.4 — Both fields present in API response and CSV

- GIVEN a completed CC-tunable simulation
- WHEN the API result is fetched OR CSV is exported
- THEN `dpo_used` and `target_kf_used` appear in the payload/row
- AND neither field is absent or null (for CC-tunable runs, `target_kf_used` is non-null)

---

### R15. Python Binding Backward Compatibility

The `run_tunable_cc` Python binding MUST accept 10 new optional keyword arguments for
distribution configuration (5 per parameter):

| Param | Args |
|-------|------|
| `dpo` | `dpo_mode: str`, `dpo_value: f64`, `dpo_mean: f64`, `dpo_std: f64`, `dpo_min: f64`, `dpo_max: f64` |
| `kf` | `kf_mode: str`, `kf_value: f64`, `kf_mean: f64`, `kf_std: f64`, `kf_min: f64`, `kf_max: f64` |

When any of these kwargs are absent, the binding MUST fall back to the existing scalar
`radius_min` / `target_kf` positional arguments (Fixed mode). Existing callers are unaffected.

Valid `mode` strings: `"fixed"` (default), `"normal"`, `"uniform"`.

#### Scenario 15.1 — Legacy caller: no new kwargs → Fixed fallback works

- GIVEN a Python call to `run_tunable_cc(radius_min=1.0, target_kf=1.3, ...)`  without any `dpo_*` or `kf_*` kwargs
- WHEN the call executes
- THEN `result.dpo_used == 1.0` and `result.target_kf_used == Some(1.3)`
- AND behavior is bit-for-bit identical to the pre-cycle version for the same seed

#### Scenario 15.2 — New kwargs: Normal mode via Python

- GIVEN `run_tunable_cc(..., dpo_mode="normal", dpo_mean=1.0, dpo_std=0.05, kf_mode="fixed", kf_value=1.3)`
- WHEN the call executes
- THEN `result.dpo_used ∈ [0.85, 1.15]` and `result.target_kf_used == Some(1.3)`

#### Scenario 15.3 — Invalid mode string rejected

- GIVEN `dpo_mode="gaussian"` (not a valid mode string)
- WHEN the call executes
- THEN a `ValueError` or equivalent is raised before any simulation logic runs

#### Scenario 15.4 — Uniform mode via Python

- GIVEN `run_tunable_cc(..., kf_mode="uniform", kf_min=1.1, kf_max=1.5)`
- WHEN the call executes
- THEN `result.target_kf_used = Some(v)` where `v ∈ [1.1, 1.5]`

---

### R16 (MODIFIED — Cycle 14 / PYA-14 Phase 1+2) — Per-step merge diagnostic trace

The CC tunable algorithm (`run_tunable_cc_internal`) MUST emit a
`merge_trace` field on `SimulationResult`. The trace is a list of
`MergeTraceEntry` records, one per successful merge step (tunable OR
ballistic fallback). Non-CC algorithms emit an empty list.

#### `MergeTraceEntry` structure

| Field | Type | Description |
| --- | --- | --- |
| `step` | usize | 0-indexed merge counter (0 = first merge, N-2 = last). |
| `n1` | usize | Particle count of the impacted sub-cluster at merge time. |
| `n2` | usize | Particle count of the impactor sub-cluster at merge time. |
| `required_distance` | f64 | COM-COM distance computed by `calculate_com_distance` for the candidate fragment pair using the canonical CC formula. MUST be populated for BOTH tunable and ballistic entries; MUST NOT be hardcoded to `0.0`. |
| `actual_distance` | f64 | Measured COM-COM distance after positioning + contact resolution. |
| `rg_after` | f64 | Measured radius of gyration of the merged cluster. |
| `rg_target` | f64 | Target Rg for the merged cluster: `rp · ((n1 + n2) / kf)^(1/Df)`. |
| `merge_type` | string | `"tunable"` if `calculate_com_distance` produced a valid d AND `can_clusters_connect` passed; `"ballistic"` if the algorithm fell back to `merge_ballistic`. |
| `retries` | usize | Number of placement attempts (rotations / pair re-picks) before this merge succeeded. |
| `bounding_check_passed` | bool | `true` when `bounding_radius1 + bounding_radius2 >= required_distance` at first attempt; `false` when the algorithm had to fall back. |

#### Scenarios

**Scenario R16.1 — Trace length matches merge count**

- GIVEN a CC tunable simulation with N particles seeded as monomers
- WHEN the simulation completes
- THEN `result.merge_trace.len() == N - 1`

**Scenario R16.2 — Tunable merges discriminated**

- GIVEN a CC tunable run where every merge succeeds via the formula
- WHEN the simulation completes
- THEN every entry in `result.merge_trace` has `merge_type == "tunable"` and `bounding_check_passed == true`

**Scenario R16.3 — Ballistic fallback flagged**

- GIVEN a CC tunable run where some merges fall back to ballistic (e.g. low Df target)
- WHEN the simulation completes
- THEN at least one entry has `merge_type == "ballistic"` AND that entry has `bounding_check_passed == false`

**Scenario R16.4 — Required vs actual distance**

- GIVEN a successful tunable merge
- WHEN the entry is recorded
- THEN `actual_distance` is within ±10% of `required_distance` (the contact-resolution tolerance)

**Scenario R16.5 — Rg comparison**

- GIVEN a successful merge
- WHEN the entry is recorded
- THEN `rg_after > 0` AND `rg_target > 0` AND both reflect the cluster after `update_properties()`

**Scenario R16.6 — Non-CC algorithm produces empty trace**

- GIVEN a ballistic-only or DLA simulation
- WHEN the simulation completes
- THEN `result.merge_trace == []`

**Scenario R16.7 — Trace persists through binding to result dict**

- GIVEN a CC tunable simulation invoked via the Python binding
- WHEN the result dict is built
- THEN `result["merge_trace"]` is a list of dicts with the 10 fields above (correct keys and primitive types)

**Scenario R16.8 — Backwards compat for legacy results**

- GIVEN a legacy `Simulation.result` JSON document stored before this cycle
- WHEN the API serialises the result
- THEN the response treats missing `merge_trace` as `[]` (or omits the key); existing clients are unaffected

**Scenario R16.9 — Retries reflect actual attempts**

- GIVEN a tunable merge that requires multiple particle-pair selection attempts before producing a valid placement
- WHEN the entry is recorded
- THEN `retries` equals the number of attempts that occurred before the final placement

**Scenario R16.10 — No behaviour change at coeff=1.0 / default config**

- GIVEN identical seed and parameters before and after this cycle
- WHEN both simulations run with default sintering and default distributions
- THEN the final aggregate's particle positions are bitwise-identical (the trace is purely additive observation)

**Scenario R16.11 — Ballistic entry populates required_distance from CC formula**

- GIVEN a merge step that exhausted all retries and fell back to `merge_ballistic`
- WHEN the `MergeTraceEntry` is recorded
- THEN `required_distance` MUST equal the value returned by `calculate_com_distance(n1, n2, rp, df, kf, sintering_coeff)` called for that candidate pair BEFORE the ballistic merge executes
- AND `merge_type == "ballistic"`

**Scenario R16.12 — Degenerate distance sets required_distance to 0.0 with warning**

- GIVEN a ballistic fallback merge where `calculate_com_distance` returns `None` (e.g., negative argument under sqrt due to degenerate cluster sizes or parameters)
- WHEN the `MergeTraceEntry` is recorded
- THEN `required_distance` is set to `0.0`
- AND a tracing/log warning is emitted identifying the degenerate pair (n1, n2, step)
- AND no panic or error is raised; the ballistic merge proceeds normally

#### Backwards compatibility

- `merge_trace` is additive on `SimulationResult` and on the result dict / JSONField. Default value: empty list.
- Pre-cycle 14 results stored without the field deserialise gracefully (treated as `[]`).
- No DB migration. No frontend changes.

---

### R17 — Seed Type Parameter Routing

The simulation API MUST accept `seed_type` as a value inside the `parameters` JSON object (nested) and route it to the engine, in addition to the existing top-level field.

The system MUST resolve `seed_type` using the following precedence:

1. If `parameters.seed_type` is present → use that value (nested wins).
2. Else if top-level `seed_type` is present → use that value (legacy fallback).
3. Else → default to `"monomers"`.

The persisted `Simulation.seed_type` field MUST reflect the value actually sent to the engine, NOT the DRF serializer default. After persistence, `parameters` SHOULD NOT contain a `seed_type` key (it is lifted via `pop()`).

Valid values: `"monomers"`, `"dimers"`, `"trimers"`. Any other value MUST be rejected with a 400 error before creating a simulation record.

#### Scenario R17.1 — Nested seed_type wins over absent top-level

- GIVEN a POST with `parameters.seed_type = "dimers"` and no top-level `seed_type`
- WHEN the serializer processes the request
- THEN the engine receives `seed_type = "dimers"`
- AND `Simulation.seed_type == "dimers"` in the DB
- AND `parameters` does not contain a `seed_type` key after persistence

#### Scenario R17.2 — Legacy top-level seed_type used when nested absent

- GIVEN a POST with top-level `seed_type = "trimers"` and no `parameters.seed_type`
- WHEN the serializer processes the request
- THEN the engine receives `seed_type = "trimers"`
- AND `Simulation.seed_type == "trimers"` in the DB

#### Scenario R17.3 — Nested wins when both top-level and nested present

- GIVEN a POST with `parameters.seed_type = "dimers"` AND top-level `seed_type = "monomers"`
- WHEN the serializer processes the request
- THEN the engine receives `seed_type = "dimers"` (nested wins)
- AND `Simulation.seed_type == "dimers"` in the DB

#### Scenario R17.4 — Default to monomers when neither present

- GIVEN a POST with no `seed_type` at top-level and no `parameters.seed_type`
- WHEN the serializer processes the request
- THEN the engine receives `seed_type = "monomers"`
- AND `Simulation.seed_type == "monomers"` in the DB

#### Scenario R17.5 — Invalid nested value rejected with 400

- GIVEN a POST with `parameters.seed_type = "foo"`
- WHEN the serializer validates the request
- THEN a 400 response is returned with a descriptive validation error
- AND no `Simulation` record is created
