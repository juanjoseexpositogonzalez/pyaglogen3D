# Delta for cc-tunable-aggregation

<!-- Change: sintering-cc-fix | Cycle 11 / PYA-11 | Authored: 2026-05-05 -->
<!-- Modifies: openspec/specs/cc-tunable-aggregation.md (frente 10, 7 requirements) -->

## MODIFIED Requirements

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

## ADDED Requirements

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
