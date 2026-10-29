# PYA-10 Exploration: CC Tunable Algorithm Does Not Converge to Target Df/kf

**Date**: 2026-05-04  
**Status**: Complete  
**Severity**: SHOWSTOPPER — wrong distance equation in `calculate_com_distance`

---

## 1. Thesis Algorithm (Canonical)

### Source
`~/code/aglogen3D/06AgloGen3D.tex`, Section 6.3.2 "Expresión para la distancia entre aglomerados que colisionan" and Section 6.3.4 "Algoritmo para la generación de aglomerados sintéticos. Caso CC"

### Core Equation (eq:leyPotenciasColisionI, line 265)

The thesis derives the constraint equation from the radius of gyration of a merged aggregate:

```
n_po * (rg0² - 3/5*rp²) = n_po1*(rg1² - 3/5*rp²) + n_po2*(rg2² - 3/5*rp²) + (n_po1*n_po2/n_po)*(d²)
```

Where `d = |r_G2 - r_G1|` is the distance between centers of mass of the two merging clusters.

### Power Law Substitution

Substituting the fractal power law `rg_i² = (n_i/kf)^(2/Df) * rp²` and solving for `d²`:

```
d² = (n_po/(n_po1*n_po2)) * rp² * {
    n_po * [(n_po/kf)^(2/Df) - 3/5] 
  - n_po1 * [(n_po1/kf)^(2/Df) - 3/5] 
  - n_po2 * [(n_po2/kf)^(2/Df) - 3/5]
}
```

**Critical simplification**: Since `n_po = n_po1 + n_po2`, the `3/5` constants CANCEL algebraically:

```
-3/5*n_po + 3/5*n_po1 + 3/5*n_po2 = -3/5*(n_po - n_po1 - n_po2) = 0
```

### Correct Final Formula (eq:leyPotenciasColisionSimplificada, CORRECTED)

```
d² = (n_po * rp²) / (n_po1 * n_po2) * [
    n_po * (n_po/kf)^(2/Df) 
  - n_po1 * (n_po1/kf)^(2/Df) 
  - n_po2 * (n_po2/kf)^(2/Df)
]
```

### Thesis Typographical Issue

The thesis equation `eq:leyPotenciasColisionSimplificada` (line 296-300) appears to have a typesetting error. It writes:

```latex
(r_G2 - r_G1)² = [(n_po/kf)^(2/Df) - 3/5] - n_po*rp² * (n_po1/kf) * [1/n_po2 + 1/n_po1]
```

Problems with the thesis's "simplified" form:
1. Missing the leading factor `n_po*rp²/(n_po1*n_po2)` 
2. The `(n_po1/kf)` in the second term should be `(n_po1/kf)^(2/Df)` (exponent dropped)
3. Uses only `n_po1` where BOTH `n_po1` and `n_po2` cluster-specific terms should appear

**Cross-validation**: The PC specialization (`eq:leyPotenciascasoPC`, line 309) is written correctly WITH the `^(2/Df)` exponents, confirming the simplified CC form has a typo.

### CC Algorithm Pseudocode (from thesis, Section 6.3.4)

```
1. Initialize pool AS with small clusters (monomers or pre-built)
2. WHILE pool has > 1 cluster:
   a. Select two clusters at random (impacted, impactor)
   b. Place impacted at origin (CoM = 0)
   c. Calculate d = |r_G2 - r_G1| from the constraint equation above
   d. Place impactor CoM on sphere of radius d (random direction)
   e. Check connectivity: can bounding spheres overlap? (|d_es1| + |d_es2| >= d)
      - If NO: choose different cluster pair, repeat
   f. Build candidate particle lists LA1, LA2 (particles near the gap)
   g. Select particle pair M1, M2 satisfying triangle criterion
   h. Rotate impacted cluster (gamma - gamma*) to bring M1 toward contact
   i. Rotate impactor cluster (lambda - lambda*) to bring M2 into contact with M1
   j. Check overlap with subset LA2_1, LA2_2
      - If overlap: rotate impactor around contact axis, retry
      - If still overlapping after N rotations: go to step (g) with new pair
   k. Merge clusters, update pool
3. Return final aggregate
```

### Key Properties
- **Hierarchical**: Random pairwise merging (NOT sequential particle-by-particle)
- **Constraint at every step**: Distance `d` enforces the power law at EACH merge
- **Two rotations**: First rotation (gamma) aligns impacted, second (lambda) achieves contact
- **No iteration on Df/kf**: The algorithm trusts the constraint equation — if the formula is correct, the aggregate satisfies the power law by construction

---

## 2. Rust Implementation

### File
`pyaglogen3D/aglogen_core/engine/src/simulation/tunable_cc.rs`

### Function Signature (line 655)
```rust
pub fn run_tunable_cc_internal(
    params: TunableCcParams,  // target_df, target_kf, n_particles, seed_strategy, sintering, ...
    seed: u64,
    _py: Option<()>,
) -> SimulationResult
```

### Algorithm Structure (pseudocode from code)
```
1. Initialize N monomers (SeedStrategy::Monomers), spread randomly
2. WHILE clusters.len() > 1:
   a. Select two random clusters (line 694-696)
   b. Assign impacted (larger) / impactor (smaller) roles (line 699-704)
   c. Calculate required_distance via calculate_com_distance() (line 715)
   d. Check if clusters can connect (bounding sphere check, line 723)
   e. Build candidate particle lists la1, la2 (line 728-729)
   f. For up to max_particle_selection_attempts (25):
      i.  Select contact particle pair (m1, m2) via select_contact_particles()
      ii. Position impactor at required_distance with m1-m2 contact
      iii. Verify: has_intercluster_contact AND no overlap
      iv. If overlap: resolve_overlap_by_rotation (50 attempts)
   g. If ALL tunable attempts fail: fallback to merge_ballistic() (line 782-786)
   h. Merge clusters, update pool
3. Compute output Df/kf from Rg evolution via power-law fit (line 823-824)
```

### The Distance Formula (lines 235-273)
```rust
fn calculate_com_distance(
    n_po: usize, n_po1: usize, n_po2: usize,
    kf: f64, df: f64, rp: f64,
) -> Option<f64> {
    let constante = 3.0 / 5.0;
    let term1 = (n_po_f / kf).powf(2.0 / df) - constante;
    let term2_factor = (n_po1_f / kf).powf(2.0 / df);
    let term2 = n_po_f * term2_factor * (1.0 / n_po2_f + 1.0 / n_po1_f);
    let distance_sq = rp.powi(2) * term1 - rp.powi(2) * term2;
    // ...
    Some(distance_sq.sqrt())
}
```

**What the code actually computes:**
```
distance_sq = rp² * [(n_po/kf)^(2/Df) - 3/5] 
            - rp² * n_po * (n_po1/kf)^(2/Df) * (1/n_po2 + 1/n_po1)
```

Expanding:
```
= rp² * (n_po/kf)^(2/Df) 
- rp² * 3/5 
- rp² * (n_po1/kf)^(2/Df) * n_po² / (n_po1*n_po2)
```

---

## 3. Diff: Thesis vs. Rust Implementation

### SHOWSTOPPER: Wrong distance equation (`calculate_com_distance`)

| Aspect | Correct (derived from thesis) | Rust Code (WRONG) |
|--------|-------------------------------|-------------------|
| Leading factor | `n_po*rp² / (n_po1*n_po2)` | `rp²` (missing factor) |
| First term | `n_po * (n_po/kf)^(2/Df)` | `(n_po/kf)^(2/Df) - 3/5` (spurious 3/5) |
| Cluster 1 term | `n_po1 * (n_po1/kf)^(2/Df)` | `n_po * (n_po1/kf)^(2/Df) * n_po/n_po2` |
| Cluster 2 term | `n_po2 * (n_po2/kf)^(2/Df)` | Same as cluster 1 term (WRONG — uses n_po1 for both!) |

**Three bugs in one function:**

1. **Missing leading factor `n_po/(n_po1*n_po2)`** — The entire expression should be multiplied by this. Without it, the distance is SYSTEMATICALLY underestimated for asymmetric merges and overestimated for symmetric ones.

2. **Asymmetric cluster terms conflated** — The code uses `(n_po1/kf)^(2/Df)` for BOTH sub-clusters. The correct formula needs `(n_po1/kf)^(2/Df)` for cluster 1 and `(n_po2/kf)^(2/Df)` for cluster 2. Since impacted is always the LARGER cluster (n_po1 >= n_po2), using n_po1 for both makes term2 TOO LARGE → computed distance is too small → aggregate is too compact → Df biases HIGH.

3. **Spurious 3/5 constant** — The code subtracts `3/5` from term1 but doesn't have it in term2. In the correct derivation, the 3/5 terms cancel algebraically (since n_po = n_po1 + n_po2). The code's asymmetric 3/5 handling introduces an additional (smaller) bias.

### Impact Analysis

For the user's case (target Df=1.6, kf=1.7, N=350):

- With **wrong formula**, the `calculate_com_distance` returns a **shorter distance** than required. This makes merged clusters more compact, biasing Df upward.
- When the distance is too short, `can_clusters_connect` is more likely to pass (since bounding spheres already overlap), but the geometric constraint is WRONG.
- When the formula gives negative `distance_sq` (which happens more often with the wrong formula for low target Df), the fallback approximation (line 260-268) kicks in, or ballistic merge happens — both produce Df ≈ 1.8–2.1.
- Net effect: **systematic upward bias on Df** (+22% observed) and **downward bias on kf** (-19% observed) — exactly what the user reports.

### LIKELY CAUSE OF BIAS: Ballistic Fallback Dominance

When `calculate_com_distance` returns `None` (distance_sq <= 0) or the positioning fails (lines 727-778), the code falls through to `merge_ballistic` (line 782). This is a RANDOM contact merge with NO constraint enforcement — it produces whatever Df the random geometry gives (typically ~1.8-2.1 for 3D ballistic CC).

Given the wrong formula, this fallback is triggered MORE OFTEN for low target Df values (like 1.6), because the formula yields negative distance_sq or geometrically impossible configurations.

### LIKELY CAUSE OF BIAS: Single Rotation vs. Two-Step Rotation

The thesis algorithm has TWO geometric rotations:
1. Rotate impacted cluster by `(gamma - gamma*)` to align M1 toward contact zone
2. Rotate impactor by `(lambda - lambda*)` to bring M2 into contact with M1

The Rust code at `position_clusters_for_contact` (line 452-523) does:
1. Place impactor CoM at required_distance in random direction (line 482-484)
2. Rotate impactor to bring m2 toward m1 (line 506-518)

**Missing**: The thesis's first rotation of the IMPACTED cluster. The code only places and rotates the impactor. This is a simplification that reduces the algorithm's ability to find valid configurations, pushing more attempts to the ballistic fallback.

### COSMETIC: Variable Naming

- Code uses `impacted` / `impactor` consistently with thesis
- `constante = 3.0 / 5.0` matches thesis "Lapuerta constant"
- Monomer initialization matches thesis "conjunto AS"

---

## 4. Recommended Fix Path

### Approach: Single SDD Cycle (Medium Effort)

The fix is surgically targeted — the core bug is in ONE FUNCTION (`calculate_com_distance`). However, the positioning logic (`position_clusters_for_contact`) should also be improved.

**Tasks:**
1. **Rewrite `calculate_com_distance`** with the correct formula:
   ```
   d² = (n_po * rp²) / (n_po1 * n_po2) * [
       n_po * (n_po/kf)^(2/Df) 
     - n_po1 * (n_po1/kf)^(2/Df) 
     - n_po2 * (n_po2/kf)^(2/Df)
   ]
   ```
2. **Add unit tests** comparing calculated distances to known analytic values (e.g., symmetric merge: n_po1 = n_po2 = N/2)
3. **Improve positioning** to match thesis two-rotation scheme (or at minimum, verify the single-rotation version converges)
4. **Reduce ballistic fallback** — track tunable_merges vs fallback_merges ratio; should be >80% tunable for well-posed parameters
5. **Integration test**: Run with user's config (Df=1.6, kf=1.7, N=350) × 5 seeds, assert mean Df within ±5% of target

**Estimated scope**: 2-3 tasks, ~1 session

---

## 5. Open Questions for User

1. **Thesis eq:leyPotenciasColisionSimplificada**: The printed equation appears to have a typographic error (missing `^(2/Df)` exponent on `(n_po1/kf)` term). Can you confirm the correct form is as I derived above from the intermediate steps? (The PC specialization in the same thesis DOES have the correct exponents, so I'm confident the CC "simplified" form is a typo.)

2. **Two-rotation scheme**: The thesis describes rotating BOTH clusters (impacted by gamma-gamma*, impactor by lambda-lambda*). The Rust code only rotates the impactor. Was this an intentional simplification for performance, or an oversight? For correctness, we need at least the constraint equation to be correct — the positioning can be approximate as long as the CoM distance is right.

3. **Seed clusters**: The thesis says "se parte de un conjunto de agregados pequeño" — should the initial pool contain small pre-built clusters (e.g., dimers/trimers from Tunable PC) rather than all monomers? Starting with all monomers means early merges (2+2=4 particles) have very few geometric options.

4. **Ballistic fallback policy**: When the tunable positioning fails, the current code falls back to ballistic merge. The thesis doesn't explicitly describe a fallback — it says to retry with a new cluster pair. Should we: (a) retry with a different random direction, (b) pick a different cluster pair from the pool, or (c) accept ballistic as-is but track how often it triggers?

---

## 6. Test Plan

### After Fix Verification

1. **Unit test: `calculate_com_distance` correctness**
   - Symmetric case: n_po1 = n_po2 = 50, target Df=1.8, kf=1.3 → verify distance > 0 and matches manual calculation
   - PC-equivalent case: n_po2 = 1 → verify matches `tunable.rs` gamma formula
   - Low Df case: Df=1.4 → verify distance is LARGER (more open aggregate)

2. **Integration test: Convergence to target**
   - Config: Df=1.6, kf=1.7, N=350, 5 seeds
   - Assert: mean(Df_out) within [1.52, 1.68] (±5% of target)
   - Assert: mean(kf_out) within [1.62, 1.79] (±5% of target)
   - Assert: std(Df_out) < 0.15 (statistical scatter for N=350)

3. **Integration test: Various Df targets**
   - Df=1.4, 1.6, 1.8, 2.0, 2.2 with kf=1.3, N=200
   - All should converge within ±10% of target
   - Plot actual vs target should be y=x ± scatter

4. **Regression: Fallback ratio**
   - Track `_tunable_merges` vs `_fallback_merges` (already in code but prefixed with `_`)
   - After fix, tunable_merges/(tunable_merges + fallback_merges) > 0.8 for reasonable params

5. **Cross-reference with FZR paper (Filippov et al. 2000)**
   - Table 1 of FZR paper has reference Df/kf values for known configurations
   - Verify code produces consistent results with published data

---

## 7. Summary of Findings

| # | Severity | Finding | File:Line |
|---|----------|---------|-----------|
| 1 | **SHOWSTOPPER** | Wrong distance formula: missing leading factor, asymmetric clusters conflated, spurious 3/5 | `tunable_cc.rs:251-255` |
| 2 | **Likely cause** | Ballistic fallback dominates when formula gives impossible geometries | `tunable_cc.rs:782-787` |
| 3 | **Contributing** | Single rotation (impactor only) vs thesis's two-rotation scheme | `tunable_cc.rs:452-523` |
| 4 | **Cosmetic** | `_tunable_merges` / `_fallback_merges` tracked but unused (diagnostic opportunity) | `tunable_cc.rs:683-684` |

---

## 8. Statistical Analysis

For the user's reported results (target Df=1.6, kf=1.7, N=350):

| Metric | Target | Observed Mean | Bias | Expected (N=350) |
|--------|--------|---------------|------|-------------------|
| Df | 1.6 | 1.95 | +22% | Should be within ±5% |
| kf | 1.7 | 1.38 | -19% | Should be within ±10% |

The bias is SYSTEMATIC (not statistical noise):
- σ(Df) ≈ 0.10 across 3 runs → coefficient of variation ~5%
- σ(kf) ≈ 0.13 across 3 runs → coefficient of variation ~9%
- For N=350, statistical fluctuations in Df from a correct algorithm should be ±3-5% max

The observed Df ≈ 1.95 is consistent with **ballistic CC** (no constraint enforcement), where Df typically falls in [1.8, 2.1]. This confirms the hypothesis that the distance formula is wrong and the algorithm degrades to mostly-ballistic behavior.
