# Exploration: cc-tunable-df-fidelity

> SDD phase: EXPLORE  
> Change: `cc-tunable-df-fidelity`  
> Date: 2026-05-27  
> Status: complete — ready for proposal

---

## 1. MATLAB Reference Summary

### `distanciaClusters.m`

**Inputs:** `npo1`, `npo2`, `dpo` (mean diameter), `constante` (3/5 or 0), `kf`, `Df`  
**Outputs:** `gamma` — COM-COM distance  
**Core formula:**

```
npo = npo1 + npo2
gamma1 = npo^2 / (npo1*npo2) * dpo^2/4 * [ (npo/kf)^(2/Df) - constante ]
gamma2 = npo/npo2 * [ (npo1/kf)^(2/Df) - constante ]
gamma3 = npo/npo1 * [ (npo2/kf)^(2/Df) - constante ]
gamma = sqrt(gamma1 - gamma2 - gamma3)
```

**Key constants:** `constante = 3/5` (Lapuerta et al.; set by TuningCC line 152)  
**Note:** `dpo` here is the **diameter** (= 2*rp). The leading factor is `dpo^2/4 = rp^2`.

**Invoked from:** `TuningCC.m` line 208 as `distanciaClusters(npo1, npo2, dpo, constante, kf, Df)` where `dpo = radioImpactante + radioImpactado` (sum of mean radii).

---

### CRITICAL: MATLAB formula expanded

Substituting `constante = 3/5`, with `rp = dpo/2`:

```
gamma1 = npo^2/(npo1*npo2) * rp^2 * [ (npo/kf)^(2/Df) - 3/5 ]
gamma2 = npo/npo2         * rp^2 * [ (npo1/kf)^(2/Df) - 3/5 ]
gamma3 = npo/npo1         * rp^2 * [ (npo2/kf)^(2/Df) - 3/5 ]
gamma^2 = rp^2 * { npo^2/(npo1*npo2)*[(npo/kf)^(2/Df) - 3/5]
                 - npo/npo2         *[(npo1/kf)^(2/Df) - 3/5]
                 - npo/npo1         *[(npo2/kf)^(2/Df) - 3/5] }
```

Expanding the `3/5` terms:

```
−3/5 coefficient: rp^2 * 3/5 * [ npo^2/(npo1*npo2) − npo/npo2 − npo/npo1 ]
                = rp^2 * 3/5 * npo * [ npo/(npo1*npo2) − 1/npo2 − 1/npo1 ]
                = rp^2 * 3/5 * npo * [ (npo − npo1 − npo2) / (npo1*npo2) ]
                = rp^2 * 3/5 * npo * [ 0 / (npo1*npo2) ] = 0
```

The `3/5` constant **cancels exactly** in the MATLAB formula. So the MATLAB formula is:

```
gamma^2 = rp^2 * npo/(npo1*npo2) * [ npo*(npo/kf)^(2/Df)
                                     − npo1*(npo1/kf)^(2/Df)
                                     − npo2*(npo2/kf)^(2/Df) ]
```

This is **algebraically equivalent** to the Rust `calculate_com_distance` formula.

---

### `TuningCC.m`

**Inputs:** `nop` (N primaries), `dop` (diameters), `solape` (overlap factors), `kf`, `Df`, `semilla` (seed cluster size = 4 by default), `max_rotaciones` (25)  
**Outputs:** `clusters`, `referencias`, metadata  
**Core flow:**
1. Build `floor(nop/semilla)` seed clusters by calling `agloGen3D(semilla, mean(dop), mean(solape), 'PC')` — each seed is a **PC-generated cluster of `semilla` particles**
2. Leftover particles: if `restoPart > 1`, call `agloGen3D(restoPart, ..., 'CC')`, else monomer
3. While `numel(clusters) > 1`: randomly select pair → compute `gamma` via `distanciaClusters` → check bounding (`rEnvol_impactado + rEnvol_impactante >= gamma/2`) → position → rotate to contact → merge

**Key constants:** `semilla = 4` (from TuningCC line 155), `constante = 3/5` (line 152), `max_rotaciones = 25` (line 151)

---

### `kfDfAgglo3D.m` (PC branch)

**Inputs:** `nop`, `dpo`, `solape`, `kf`, `Df`, `metodo='PC'`  
**Core:** Delegates to `TuningPC(nop, dpo, solape, kf, Df, semilla=2, max_rotaciones=25)`  
**Note:** Only the 'PC' case is filled in; 'CC' case is an empty `switch` body (line 98-100). The reference implementation for CC is entirely `TuningCC.m`.

---

### `calculateRadiusOfGyration.m`

**Inputs:** `part` (particle matrix with x,y,z,r), `i`, `cG` (center of gravity)  
**Formula:**

```
ri   = sum_over_particles( (pos_i - cG)^2 )        [squared distances from CoG]
Ip   = sum( 3/5 * r_i^5 + r_i^3 * ri )
mp   = sum( r_i^3 )
Rg   = sqrt(Ip / mp)
```

This is **identical** to the Rust `calculate_radius_of_gyration` in `metrics.rs`. ✓ MATCH

---

### `posicionarCluster.m`

Translates cluster coordinates to place geometric center at a point (subtract center from all particle coords). Used for alignment before contact.

---

### `calcularDfAglomerados.m`

Post-processing only: runs a **box-counting** algorithm (`box_count`) to compute Df from a saved particle file. Uses `fit_frac` for log-log regression. This is the **measurement** path, not the generation path. The sim-reported Df is from this route in MATLAB.

---

### `demoTuningAgglomerates.m`

Example script: `kf ∈ {1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0}`, `Df ∈ {1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75}`. Calls `kfDfAgglo3D(nop, dpo, delta, kf, Df, 'PC')`. This confirms MATLAB validation uses the PC variant.

---

## 2. Rust Implementation Summary

### Control flow of `run_tunable_cc_internal`

1. **Sample distributions** (line 900–910): sample `dpo_used` from `dpo_distribution`, `target_kf_used` from `target_kf_distribution`. Override `radius_min = radius_max = dpo_used` (monodisperse per run).
2. **Initialize pool** (line 917): `initialize_seed_clusters` → `SeedType::Monomers` (default) → `build_monomers(n, params, rng)`. Each seed is a **single-sphere cluster at the origin**.
3. **Spread** (line 920–925): translate each cluster by random direction × spread factor.
4. **Main loop** (line 953): while `clusters.len() > 1` and `iterations < n*1000`:
   - Sample sintering coeff
   - **Phase 3 branch** (default, `USE_PHASE3_ALGORITHM_DEFAULT = true`):
     - `select_pair_smart` → O(k²) scan for feasible pairs
     - If feasible: attempt placement with retries (up to `max_merge_retries = 100`)
       - `get_candidate_particles` → `select_contact_particles` → `position_clusters_for_contact` → check contact + overlap → `resolve_overlap_by_rotation`
     - If retries exhausted: `march_inward_merge` (adaptive) → ballistic fallback
     - If `AllInfeasible`: `march_inward_merge` first → ballistic fallback
5. **Track evolution** (line 1461–1466): after each successful merge, record `largest_cluster.radius_of_gyration` + `largest_cluster.n_particles()`.
6. **Compute Df/kf** (line 1486–1487): `calculate_fractal_dimension_from_evolution(n_values, rg_evolution, rp)` — log-log regression of `ln(Rg/rp)` vs `ln(N)`.
7. Return `SimulationResult { fractal_dimension, prefactor, ... }`.

---

### COM-COM distance formula comparison

**MATLAB** `distanciaClusters.m`:
```
gamma^2 = rp^2 * npo/(npo1*npo2)
        * [ npo*(npo/kf)^(2/Df) - npo1*(npo1/kf)^(2/Df) - npo2*(npo2/kf)^(2/Df) ]
```
(after the 3/5 constant cancels algebraically — see Section 1 analysis)

**Rust** `calculate_com_distance` (lines 353–378):
```rust
let t_total = n * (n / kf).powf(e);      // n * (n/kf)^(2/Df)
let t1 = n1 * (n1 / kf).powf(e);
let t2 = n2 * (n2 / kf).powf(e);
let d_sq = (n * rp_eff * rp_eff) / (n1 * n2) * (t_total - t1 - t2);
```

**Verdict: MATCH.** The formulas are algebraically equivalent. The Rust comment at lines 322–342 even documents the thesis typo and confirms the current formula is correct.

---

### `use_phase3` flag

- **Const default:** `USE_PHASE3_ALGORITHM_DEFAULT = true` (line 22)
- **Env var:** `CC_TUNABLE_USE_PHASE3_ALGORITHM` (read by `read_phase3_flag()` at runtime, line 24–29)
- **What it switches:**
  - `true` → smart pair selection (O(k²) feasibility pre-screen) + march-inward adaptive fallback
  - `false` → Phase 2: random pair + retry loop (max 100 attempts) + ballistic fallback

---

### How `fractal_dimension` ends up in `SimulationResult`

Path: `run_tunable_cc_internal` → after merge loop, calls `calculate_fractal_dimension_from_evolution(n_values, rg_evolution, rp)` (line 1486–1487) → log-log OLS regression on the evolution data collected **during simulation** (one point per merge step = growth of the *largest cluster only*) → `fractal_dimension = slope` of `ln(N) vs ln(Rg/rp)`.

`n_values[i]` = particle count of the **largest cluster** after merge step i  
`rg_evolution[i]` = `radius_of_gyration` of the **largest cluster** after merge step i

---

### How `prefactor` (kf) ends up in `SimulationResult`

Same path: `calculate_fractal_dimension_from_evolution` returns `(df, kf, r2)`.  
`kf = exp(intercept)` where `intercept` is the y-intercept of the OLS line in `ln(N) = Df*ln(Rg/rp) + ln(kf)` space.  
`prefactor = actual_kf` (line 1514).

---

## 3. Side-by-Side Comparison: MATLAB vs Rust

| Dimension | MATLAB (`TuningCC.m`) | Rust (`tunable_cc.rs`) | Verdict |
|---|---|---|---|
| **Pool initialization** | `floor(N/semilla)` clusters of `semilla=4` primaries each, generated by `agloGen3D('PC')` | `N` monomer clusters (each = 1 sphere at origin) | **DIVERGE** — MATLAB starts with pre-built PC clusters of size 4; Rust default is monomers |
| **Pair selection** | Random via `sorteoClusteres(clusters, 'CC')` — re-draws until a fruitful collision; no feasibility pre-screen | Phase 3: O(k²) feasibility pre-screen, then random pick among feasible pairs | DIVERGE (heuristically; Phase 3 is better) |
| **COM distance formula** | `sqrt(rp^2 * n/(n1*n2) * [n*(n/kf)^e - n1*(n1/kf)^e - n2*(n2/kf)^e])` | Identical (verified algebraically) | **MATCH** |
| **Bounding check** | `(rEnvol_impactado + rEnvol_impactante) >= gamma/2` — uses `gamma/2` threshold | `bounding_radius_1 + bounding_radius_2 >= required_distance` — uses full `gamma` | **DIVERGE** — MATLAB uses `gamma/2`; Rust uses `gamma` |
| **Positioning / rotation** | Quaternion rotation to bring specific particles into contact; deterministic geometry | Two-rotation (Rodrigues): random direction, rotate cluster1, rotate cluster2 to contact | DIVERGE (approach differs, both valid) |
| **Contact resolution** | Quaternion-based rotation of impactor around contact axis; up to `max_rotaciones=25` | `resolve_overlap_by_rotation` with random angle sampling, up to `max_rotation_attempts=50` | Compatible |
| **Rg measurement** | `calculateRadiusOfGyration`: `sqrt(sum(3/5*r^5 + r^3*d^2) / sum(r^3))` | `calculate_radius_of_gyration`: identical formula | **MATCH** |
| **kf measurement** | Post-hoc box-counting via `calcularDfAglomerados.m` (external measurement) | Rg-evolution log-log OLS regression during merge loop (internal, from largest cluster only) | **DIVERGE** — MATLAB uses box-counting on the final aggregate; Rust uses Rg-scaling fit on the growth trajectory |
| **Df output** | Box-counting from final geometry | Rg-scaling OLS from growth trajectory (largest cluster only) | **DIVERGE** — fundamentally different measurement methods |
| **Rg evolution data** | N/A (not tracked during merge) | Tracks **largest cluster** Rg after each merge | DIVERGE — Rust evolution is sparse (only largest cluster, not all clusters) |

---

## 4. Hypotheses Ranked by Likelihood

### A. Df_target ≤ 1.7 → sim reports Df ≈ 2.7

**H_A1 (Most likely): Rg-evolution tracks WRONG cluster throughout — "largest cluster" jumps cause trajectory bias**

At low Df, the CC algorithm should produce long-range, open, tenuous structures. But the pool starts as N monomers vs MATLAB's seed clusters of 4. With monomers, early merges produce many small equal-sized clusters. When two small clusters merge to form the momentarily-largest, its Rg is tiny (monomer or dimer scale). The `rg_evolution` vector therefore starts with small Rg at low N, then jumps when a large cluster is suddenly formed. This **artificial compression** of the `(N, Rg)` relationship inflates the measured slope (= Df).

**Key code:** line 1462–1464 — the `max_by_key(|c| c.n_particles())` only tracks the momentary largest, which changes identity every merge step. No continuity guarantee. Early in the sim, many clusters have the same size (all monomers or all dimers), so the "largest" is arbitrary.

---

**H_A2 (Likely): Pool initialized as monomers instead of PC sub-clusters (seed_type mismatch)**

MATLAB `TuningCC.m` starts with `floor(N/4)` PC-generated 4-particle sub-clusters as seeds. This means the smallest unit participating in the CC merge loop is a pre-structured fragment with intrinsic Rg ≈ `rp*(4/kf)^(1/Df)`. Rust default (`SeedType::Monomers`) starts with N individual particles — the algorithm's first N/2 merges are essentially ballistic (monomer+monomer), producing compact dimers with Rg ≈ sqrt(1+3/5)*rp ≈ 1.26*rp, much smaller than a PC fragment.

These "unstructured" early merges generate data points in the Rg-evolution with too-small Rg for their N value, biasing the regression slope upward (measured Df > target Df).

**Key code:** `build_monomers` line 808–815 vs MATLAB `agloGen3D(semilla=4, ..., 'PC')` line 160.

---

**H_A3 (Contributing factor): Bounding check `>= gamma` rejects too many feasible pairs, forcing ballistic at low Df**

MATLAB checks `(rEnvol1 + rEnvol2) >= gamma/2`, which is far more permissive than Rust's `>= gamma`. For low Df (tenuous structures), `gamma` is large relative to bounding radii. The Rust check rejects a pair as infeasible when the pair could have been used with MATLAB's half-gamma rule. Phase 3's march-inward partially compensates, but the bounding check in `find_feasible_pairs` still uses `bounding_sum >= required` (= `>= gamma`, line 1959), meaning pairs that MATLAB would accept get marked infeasible and fall through to the adaptive/ballistic path.

Ballistic merges produce contact at the minimum physical distance, which for a large+large merge is much smaller than the low-Df target distance. This generates a data point with too-small Rg for the N, pushing the slope up (Df up).

**Key code:** `find_feasible_pairs` line 1959 (`bounding_sum >= required` vs MATLAB's `>= gamma/2`).

---

### B. Df_target ≥ 2.5 → sim caps near Df ≈ 2.4

**H_B1 (Most likely): march-inward `d_start` cap artificially limits COM distance for large Df targets**

In `march_inward_merge` (line 1783–1902), `d_start` is capped at `max_achievable * 2.0`:
```rust
let d_start = max_achievable.max(target_distance).min(max_achievable * 2.0);
```
For high-Df aggregates, `calculate_com_distance` returns a **small** `required_distance` (because dense structures need clusters to be close together — larger N needs closer placement to achieve high Df). But `max_achievable = bounding_r1 + bounding_r2` grows throughout the simulation as clusters accumulate mass.

For large clusters late in the sim, `max_achievable` may be 2–5× bigger than `required_distance`. The cap `min(max_achievable * 2.0)` therefore has no effect here — this hypothesis needs re-examination.

**Alternative for H_B1:** For high Df (Df > 2.5), `calculate_com_distance` is invoked with large `n` values. The formula `(n/kf)^(2/Df)` for Df=2.9 gives exponent 2/2.9=0.69. Numerically: n=2000, kf=1.3 → `(1538)^0.69 ≈ 96`. The bracket `n*96 - n1*(...) - n2*(...)` may be near zero or negative for certain n1,n2 splits, returning `None` from `calculate_com_distance` and forcing march-inward/ballistic. This would appear as a cap.

**Key code:** `calculate_com_distance` line 372 — `d_sq <= 0.0` → returns `None`, forcing ballistic.

---

**H_B2 (Likely): For high Df, required_distance < 2*rp (overlap would be needed) → no feasible pair, always ballistic**

For Df=2.9, kf=1.3, two monomers: `d² = (2*rp²)/(1*1) * [2*(2/1.3)^(2/2.9) - 1*(1/1.3)^(2/2.9) - 1*(1/1.3)^(2/2.9)]`.
With `e = 2/2.9 ≈ 0.69`: `(2/1.3)^0.69 ≈ 1.39`, `(1/1.3)^0.69 ≈ 0.85`.
`d² = 2*rp² * [2*1.39 - 2*0.85] = 2*rp² * [2.78 - 1.70] = 2.16*rp²`, so `d ≈ 1.47*rp`.
But minimum physical contact is `d = 2*rp` for equal spheres. So `required_distance < contact_dist` → the formula produces a geometrically impossible target for high-Df, which the code catches (`d_sq > 0` but `d < 2*rp` still passes through `calculate_com_distance`). The result is that `find_feasible_pairs` returns feasible but `position_clusters_for_contact` cannot satisfy the geometry, leading to retry exhaustion and fallistic.

Actually wait — if `d_sq > 0` and `d > 0`, `calculate_com_distance` returns `Some(d)`. But if `d < 2*rp`, no two spheres can be placed at that COM distance without overlapping. This would cascade into: feasible=true (bounding check passes), but every placement attempt fails, exhausting retries → adaptive/ballistic always. The effective Df is ballistic Df (≈2.0–2.2), capping the measured Df well below 2.9.

**Key code:** `calculate_com_distance` line 374 — returns `Some(d)` even when `d < 2*rp` (no physical contact check). The geometry failure only surfaces in `position_clusters_for_contact`/`has_intercluster_contact`.

---

**H_B3 (Contributing): Rg-evolution regression uses largest-cluster-only tracking; at high Df the Rg grows very slowly → regression slope compresses toward 2.0–2.3**

For high-Df (dense) structures, the Rg/N relationship flattens relative to theory. The tracking of only the largest cluster during a CC aggregation means the regression misses the early growth phase when many small clusters with diverse sizes contribute. This biases the estimate toward the ballistic regime Df ≈ 2.0–2.2, preventing measured Df from exceeding ≈2.4 even if the geometry is correct.

**Key code:** line 1462 — `max_by_key(|c| c.n_particles())` only captures one cluster per step, losing information about other simultaneous growth trajectories.

---

### C. kf < 1 reported

**H_C1 (Most likely): Rg-evolution intercept sign error for cases where regression fit is poor**

`kf = exp(intercept)` (line 1576) where `intercept` is from `ln(N) = Df * ln(Rg/rp) + ln(kf)`. If the actual data has many ballistic-merged early points with Rg < rp * kf^(1/Df), the intercept becomes negative → `exp(intercept) < 1.0` → kf < 1.

This is **not a formula bug** — it reflects genuine structural mismatch: the aggregate was built too densely (ballistic early merges give small Rg for small N), making the fit extrapolate to kf < 1 at unit N.

**Key code:** line 1576, and the broader issue is that monomers-as-seeds leads to a biased regression dataset.

---

**H_C2 (Secondary): The Rg-evolution filter `rg > rp * 0.1` passes single-sphere entries with Rg = sqrt(3/5)*rp ≈ 0.775*rp, which are valid data points but compress the regression toward low kf**

For monomer seeds, the very first merges have `n=1` (filtered out by `n > 1`) but `n=2` pairs have `Rg ≈ 1.26*rp` while N=2 should have `Rg_target = rp*(2/kf)^(1/Df)`. For kf=1.3, Df=1.5: `Rg_target = rp*(1.54)^(0.667) ≈ 1.33*rp`. So a dimer's Rg is close to correct but slightly low, pulling intercept slightly negative. Repeated for hundreds of early merges this biases kf downward.

**Key code:** line 1551 filter `n > 1`, then accumulation of low-Rg dimer/trimer points in `data`.

---

## 5. Open Questions

1. **What is `use_phase3` in the production deployment?** The env var `CC_TUNABLE_USE_PHASE3_ALGORITHM` defaults to `true` in Rust code, but if the backend or container sets it to `false`, Phase 2 (random pair, no march-inward) runs instead. This changes the failure profile dramatically.

2. **What `seed_type` does the frontend send by default?** The frontend may or may not be sending `seed_type=monomers` explicitly. If bug #634 (batch creates, views.py) still affects single-sim paths, every run regardless of UI selection runs as Monomers. Need to verify `backend/apps/simulations/views.py:1784-1792`.

3. **What is `rp` (radius) used in the production API calls?** The `radius_min/radius_max` defaults in `TunableCcParams` are 1.0. If the frontend passes `dpo=1` (normalized), the formula is self-consistent. If it passes `dpo=25` (nm) but `rp` is used as 1.0 internally due to a unit mismatch, the `(rg/rp)` ratio in the Rg-evolution regression would be off by 25×, completely destroying the kf estimate.

4. **Are ballistic and adaptive merges counted separately in the production result that users see?** The UI shows `fractal_dimension` from the result but likely doesn't expose `tunable_merges` vs `ballistic_merges`. Without that breakdown, we cannot confirm whether the Df cap is caused by formula failures or measurement bias.

5. **How many Rg-evolution points are actually collected for N=2000?** `rg_evolution` has one entry per successful merge of the *largest* cluster. For N=2000 with CC, a fully binary merge tree has 1999 merges, but only a fraction involve the largest cluster. We need to know the typical `rg_evolution.len()` for N=2000 to assess regression quality.

6. **Does the Rust implementation call `agloGen3D('PC')` for seed generation anywhere?** In the current code, `SeedType::Dimers` creates touching pairs and `SeedType::Trimers` creates collinear triples, but neither uses the TuningPC algorithm. MATLAB's CC seeding uses `agloGen3D('PC')` with semilla=4, producing fractal-dimensioned seeds. No equivalent exists in Rust.

---

## 6. Risk Surface

Files / modules that any fix WILL touch, ranked by blast radius:

| Rank | File | Blast Radius | Why |
|---|---|---|---|
| 1 | `aglogen_core/engine/src/simulation/tunable_cc.rs` | **High** | Contains `calculate_com_distance`, `run_tunable_cc_internal`, `find_feasible_pairs`, `march_inward_merge`, Rg-evolution tracking, `calculate_fractal_dimension_from_evolution` — essentially all algorithmic logic |
| 2 | `aglogen_core/engine/src/simulation/metrics.rs` | **Medium** | `calculate_fractal_dimension` and `calculate_radius_of_gyration` are shared; any change to measurement convention affects all algorithms |
| 3 | `aglogen_core/engine/src/simulation/result.rs` | **Low-Medium** | `SimulationResult` shape; adding new fields requires Python binding rebuild |
| 4 | Python bindings (`aglogen_core/src/lib.rs` or equivalent) | **Medium** | Any new fields in `SimulationResult` require pyo3 exposure + maturin rebuild |
| 5 | `backend/apps/simulations/serializers.py` | **Low** | May need to route new measurement fields; also the `seed_type` bug #634 fix site |
| 6 | Integration tests in `aglogen_core/engine/tests/` | **Low** | Parametric sweep tests will need updating if Df output changes |

---

## 7. Summary of Key Findings

### The formulas match
`calculate_com_distance` in Rust is algebraically identical to `distanciaClusters.m` in MATLAB after accounting for the 3/5 constant cancellation. This has already been fixed (archived 2026-05-04). The formula is **not** the current problem.

### The measurement method diverges fundamentally
MATLAB measures Df via **box-counting on the final 3D geometry** (`calcularDfAglomerados.m`). Rust measures Df via **Rg-scaling regression on the largest-cluster growth trajectory** during simulation. These are different estimators. Rg-scaling is more prone to bias when:
- Early merges are not geometrically tunable (monomer+monomer = ballistic-like)
- The tracked "largest cluster" changes identity frequently

### The seeding strategy diverges
MATLAB: seeds are `agloGen3D('PC')` clusters of 4 particles (fractal-dimensioned sub-structures).  
Rust default (`SeedType::Monomers`): N individual spheres at the origin.  
This means the first ~N/2 Rust merge steps operate on monomers where `calculate_com_distance` for n1=n2=1 with low Df produces a very small target distance (smaller than 2*rp at high Df), and for low Df an unusually large distance that ballistic fallback cannot achieve.

### The bounding check has a MATLAB/Rust discrepancy
MATLAB: `(rEnvol1 + rEnvol2) >= gamma/2` (more permissive — allows larger target distances).  
Rust: `bounding_r1 + bounding_r2 >= required_distance` (stricter — `>= gamma`).  
For large clusters with small bounding radii relative to the required distance, the Rust check fails more often → more ballistic.

### The Rg-evolution regression is the primary measurement suspect
`calculate_fractal_dimension_from_evolution` performs a single OLS fit on `(ln(Rg/rp), ln(N))` pairs, where each pair is the instantaneous state of the largest cluster. This is a **biased estimator** because:
1. Early datapoints (small N, small Rg) are dominated by non-tunable merges
2. The fit does not weight by data quality
3. Late-stage merges with large N contribute the same weight as early monomer merges

### The smoking gun: kf < 1 and Df ≈ 2.7 for target Df = 1.5
kf < 1 is physically impossible for a real soot aggregate (it would imply the aggregate is more compact than a single sphere). The Rg-evolution regression producing kf < 1 proves that early-merge data points have `N_actual < kf*(Rg/rp)^Df` — i.e., the actual aggregate is denser than the power law predicts, which is exactly what happens when the first N/2 merges are non-tunable (ballistic contacts at distances << `required_distance`). These anomalous early points dominate the regression and flip the intercept negative → kf < 1.

### Ready for Proposal
Yes. The exploration identifies three fixable root causes, ranked:
1. **Rg-evolution measurement bias** (most impactful, affects all Df bands): adopt a better Df estimator that filters out non-tunable early merges or uses only late-stage data
2. **Seed type mismatch** (affects Df < 1.7 band): default seed type should be Dimers or provide proper PC seeds
3. **Bounding check** (affects both bands): MATLAB uses `gamma/2` not `gamma` — the feasibility screen is too strict
