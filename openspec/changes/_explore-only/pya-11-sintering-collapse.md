# PYA-11 Exploration: CC Tunable + Sintering Produces "Single Sphere"

**Date**: 2026-05-04  
**Status**: Complete  
**Severity**: HIGH — sintering systematically defeats tunable merge geometry; aggregate quality degrades to pure-ballistic at any sintering_coeff < 1.0 combined with high Df

---

## 1. Sintering Algorithm in Code

### Architecture: Contact-Distance Coefficient, NOT Post-Processing Merge

**Critical correction to the orchestrator's hypothesis**: there is NO cascading-merge sintering loop in this codebase. Sintering is implemented as a **contact-distance coefficient** applied DURING particle aggregation, not as a post-processing fusion step.

### Entry Point

**File**: `aglogen_core/engine/src/simulation/sintering.rs`  
**Struct**: `SinteringDistribution` (enum: Fixed/Uniform/Normal)  
**Key function**:

```rust
// sintering.rs:90-92
pub fn sintered_contact_distance(r1: f64, r2: f64, sintering_coeff: f64) -> f64 {
    sintering_coeff * (r1 + r2)
}
```

When `sintering_coeff < 1.0`, particles are placed closer together (overlapping). Example: `sintering_coeff=0.9` → two particles of radius 1 have contact distance 1.8 instead of 2.0 (10% overlap).

### Pseudocode of How Sintering is Used in CC Tunable

```
for each merge step:
    1. sintering_coeff = params.sintering.sample(rng)   // tunable_cc.rs:863
    2. Calculate required CoM distance d from Df/kf/N    // tunable_cc.rs:888
       (sintering NOT factored into d — this is the target geometry)
    3. Position clusters at d apart, bring contact pair to sintered_contact_distance
    4. CHECK: has_intercluster_contact(c1, c2, sintering_coeff)  // contact at sintered dist
    5. CHECK: !check_overlap(c1, c2, sintering_coeff)            // no overlap below sintered dist
    6. If both pass → merge. Otherwise retry/ballistic.
```

### Where Sintering Coefficient is Used (complete list)

| Location | Function | Usage |
|----------|----------|-------|
| `tunable_cc.rs:863` | Main loop | Sample sintering_coeff per merge step |
| `tunable_cc.rs:377-381` | `check_overlap` bounding check | `sintered_contact_distance(bounding_r1, bounding_r2, coeff)` |
| `tunable_cc.rs:390` | `check_overlap` particle pairs | overlap if `d < sintered_contact(r1, r2, coeff) - 1e-6` |
| `tunable_cc.rs:419-432` | `has_intercluster_contact` | contact if `d ≤ sintered_contact(r1, r2, coeff) + tolerance` |
| `tunable_cc.rs:560` | `position_clusters_for_contact` | contact_dist for particle placement |
| `tunable_cc.rs:627` | `resolve_overlap_by_rotation` | overlap check uses sintering |
| `tunable_cc.rs:676` | `merge_ballistic` | snap window: `[0.9 * sintered_dist, 1.01 * sintered_dist]` |
| `tunable_cc.rs:696` | `merge_ballistic` | final overlap check uses sintering |

### What `calculate_com_distance` Does NOT Use

```rust
// tunable_cc.rs:315-338 — NO sintering parameter
fn calculate_com_distance(
    n_po1: usize,
    n_po2: usize,
    rp: f64,        // mean primary radius
    df: f64,        // target Df
    kf: f64,        // target kf
) -> Option<f64> {
    // d² = (n * rp²) / (n1 * n2) * (t_total - t1 - t2)
    // Purely geometric — sintering is NOT a factor
}
```

**This is geometrically correct** — the CoM distance should depend on the target fractal parameters, not on the overlap level. The overlap level only affects WHERE particles physically touch, not the aggregate's fractal structure.

---

## 2. Sintering Algorithm in Thesis (MATLAB Reference)

### Source

`matlab_reference/agloGen3D.m`, `matlab_reference/calcularChoque.m`, `matlab_reference/hacerCriba.m`, `matlab_reference/TuningCC.m`

### Convention Inversion

The thesis/MATLAB uses `delta ≥ 1.0` where `contact_dist = (r1 + r2) / delta`. The Rust engine uses `coeff ≤ 1.0` where `contact_dist = coeff * (r1 + r2)`. These are equivalent: `coeff = 1/delta`.

| MATLAB delta | Rust coeff | Physical meaning |
|---|---|---|
| 1.0 | 1.0 | Touching, no overlap |
| 1.1 | 0.91 | ~9% overlap |
| 1.3 | 0.77 | ~23% overlap |

### MATLAB Collision Detection (calcularChoque.m:32)

```matlab
c = norm(impactante - impactado(1,1:3))^2 - ((impactado(1,4) + diamImpactante/2) / delta)^2;
```

Contact distance is `(r1 + r2) / delta`. Same math, inverted convention.

### MATLAB CC Tunable CoM Distance (TuningCC.m:208, distanciaClusters.m)

```matlab
gamma = distanciaClusters(npo1, npo2, dpo, constante, kf, Df);
% dpo = radioImpactante + radioImpactado (mean radii sum — NOT sintered)
```

**Key observation**: The MATLAB CC tunable also does NOT apply sintering to the CoM distance formula. Sintering affects only the collision detection (`calcularChoque`, `hacerCriba`), not the target geometry.

### MATLAB Sintering Sieve (hacerCriba.m:49)

```matlab
sumaRadios(m, n) = (impactante(m,5) + impactado(n,5)) / delta;
```

Used for pre-screening which particle pairs CAN collide. The sieve uses sintered (reduced) distances.

### Pseudocode (MATLAB CC Tunable)

```
while clusters > 1:
    pick two clusters randomly
    compute gamma = CoM distance from fractal law (NO sintering)
    check bounding sphere reachability
    select candidate particles from both clusters
    rotate impacted cluster (one rotation)
    rotate impactor to bring contact pair together
    verify no overlaps considering sintering
    if OK → merge, else → retry with new pair
```

---

## 3. Diff: Code vs Thesis/MATLAB

### What's IDENTICAL
1. ✅ CoM distance formula does NOT include sintering — correct in both
2. ✅ Sintering applies only to physical contact/overlap checks
3. ✅ Both use bounding sphere reachability check
4. ✅ Both select candidate particles and rotate to achieve contact

### What's DIFFERENT (Root Cause)

**THE BUG: Contradictory constraints between CoM distance and sintered contact check.**

In MATLAB, the contact check is LOOSE — it uses the collision equation directly (`calcularChoque`), which finds where a ballistic trajectory intersects the sintered sphere. The particle IS placed at the sintered distance naturally.

In Rust, there are TWO contradictory requirements enforced simultaneously:

1. `position_clusters_for_contact` (tunable_cc.rs:567): Places cluster2 CoM at `required_distance` from cluster1 CoM  
2. `position_clusters_for_contact` (tunable_cc.rs:579): Tries to place the contact particle at `sintered_contact_distance`  
3. `has_intercluster_contact` (tunable_cc.rs:432-435): Validates contact at sintered distance

**For monomer-monomer merges, constraints 1 and 2 are INCOMPATIBLE:**

- For monomers, CoM = particle center
- `required_distance` for Df=2, kf=1, two monomers = 2.0 (from `calculate_com_distance`)
- So particles are placed 2.0 apart
- `sintered_contact_distance(1, 1, 0.9)` = 1.8
- `has_intercluster_contact` checks: `2.0 ≤ 1.8 + tolerance` → **FALSE**
- **Tunable merge ALWAYS fails for monomer-monomer at Df=2 + any sintering < 1.0**

For multi-particle clusters, the contact particle CAN be placed at sintered distance while maintaining the CoM distance (because particle != CoM). But for compact clusters (Df=2), the internal particle layout causes overlap violations that `check_overlap` catches.

### Numerical Proof (Df=2, kf=1, sintering=0.9)

| Merge | n1 | n2 | CoM dist (d) | Sintered contact | Monomer? | Tunable works? |
|-------|----|----|-------------|-----------------|----------|---------------|
| 1st | 1 | 1 | 2.00 | 1.80 | Yes | ❌ d > contact |
| 2nd | 2 | 1 | 2.45 | 1.80 | Partial | ❌ likely overlap |
| 3rd | 3 | 1 | 2.83 | 1.80 | Partial | ❌ likely overlap |
| 10th | 9 | 1 | 6.32 | 1.80 | No | Marginal |
| 50th | 50 | 50 | 14.14 | 1.80 | No | Maybe ✅ |

---

## 4. Root Cause

### Primary Cause: Tunable-Sintering Geometry Mismatch

**`tunable_cc.rs:567` + `tunable_cc.rs:932-935`**

The tunable merge positioning places cluster CoMs at the fractal-law distance, then checks for physical contact at the sintered distance. For monomers and small clusters, these are contradictory: the fractal distance is LARGER than the sintered contact distance, making the contact check fail.

This forces ALL early merges (monomer + monomer, small cluster + monomer) to fall back to ballistic. Ballistic merges ignore the fractal CoM distance and just stick particles wherever they touch at sintered distance. This produces a morphology UNRELATED to the target Df/kf.

### Secondary Cause: Ballistic Cascade in Compact Regime

Once the aggregate grows through pure-ballistic merges into a compact ball (because ballistic CC at sintered distances produces Df ≈ 2.0–2.5), further merges become harder because:
1. Tunable still fails (same geometry mismatch)
2. Ballistic fails because almost every approach causes internal overlaps (the cluster is already dense, and the sintered overlap threshold `sintered_contact - 1e-6` is tight)

If ballistic also fails, the iteration counter increments without merging. After `n_particles * 1000` iterations, the loop exits with multiple unmerged clusters.

### Result: `clusters.remove(0)` Returns a Small Cluster

**`tunable_cc.rs:1037-1041`**

When the algorithm times out, `clusters[0]` is returned. Depending on when the algorithm got stuck, this could be:
- A single monomer (if no merges succeeded for cluster[0])
- A small cluster (if some merges happened)

The `rg_evolution` would be empty or very short → `radius_of_gyration = 0.0` (from `lib.rs:352-356`).

### Why This Only Manifests with Sintering

Without sintering (`sintering_coeff = 1.0`), `sintered_contact_distance = r1 + r2 = 2.0`. For Df=2, kf=1, two monomers: CoM distance = 2.0 = contact distance. **They exactly touch.** `has_intercluster_contact` passes (within tolerance). The tunable merge succeeds.

With sintering < 1.0, there's a GAP between CoM distance (2.0) and sintered contact distance (< 2.0). The particles are placed too far apart for sintered contact → merge fails.

---

## 5. Recommended Fix Path

### Approach: Adjust CoM Distance for Sintering

The `calculate_com_distance` returns the correct FRACTAL distance (where CoMs should be for target Df/kf). But the contact validation uses sintered distance. The fix should adjust the PLACEMENT to ensure physical contact at sintered distance while keeping the fractal CoM distance as the structural target.

### Option A: Scale CoM Distance by Sintering (Simple, Approximate)

Multiply `required_distance` by `sintering_coeff` before positioning. This brings particles closer, matching the sintered contact distance.

- **Pros**: Single-line fix, simple to understand
- **Cons**: Changes the fractal geometry — the resulting Df/kf will be slightly off because CoM distance no longer matches the fractal law exactly
- **Effort**: Low

### Option B: Decouple CoM Positioning from Contact Validation (Correct, Complex)

Keep the fractal CoM distance for positioning, but allow the contact pair to be placed at a different point than where the CoM constraint places them. For multi-particle clusters this already works. For monomers, this requires introducing a "virtual contact" concept where the contact is validated at the actual particle distance, not the sintered distance.

- **Pros**: Preserves fractal geometry, correct physics
- **Cons**: More complex, needs careful thought about what "contact" means for sintered monomers
- **Effort**: Medium

### Option C: Sintering as Post-Positioning Adjustment (Canonical)

After a successful tunable merge (at non-sintered distance), apply sintering by MOVING the contact pair closer by `(1 - sintering_coeff) * (r1 + r2)`. This maintains the fractal CoM distance as a structural constraint while applying sintering as a secondary physical effect.

- **Pros**: Clean separation of concerns, matches thesis intent
- **Cons**: Changes the final CoM distance slightly (but this is what sintering IS — it compacts the aggregate)
- **Effort**: Medium

### Recommendation

**Option C** — single SDD cycle. Sintering should be applied as a compaction step after the fractal-geometric merge succeeds, not as a constraint on the merge itself.

### Scope Estimate

- 1 SDD cycle (proposal → spec → design → implement → verify)
- Affected files: `tunable_cc.rs` (primary), `sintering.rs` (minor if any)
- ~50-100 lines changed
- Testing: add dedicated test for `tunable_cc + sintering_coeff=0.9 + Df=2` to verify N particles returned and reasonable metrics

---

## 6. Open Questions for User

1. **What sintering_coeff was used?** The bug severity depends on the coefficient. At 0.9, the gap is 10% which makes all monomer merges fail. At 0.99, the gap is only 1% which might pass within tolerances.

2. **What N was used?** For very large N, some later merges (cluster-cluster, not monomer) might succeed via tunable, producing a partial result.

3. **Is the "1 particle" literal or visual?** The Jira says `n_particles = 1`. If the engine literally returns 1 particle, the algorithm timed out after 0 successful merges. If it returns N particles all clumped together, the user saw a blob in the 3D viewer.

4. **Should sintering affect the fractal target?** In the thesis, sintering (delta/aplastamiento) is applied to the physical contacts. The fractal law describes the ideal geometry. Should a sintered aggregate with target Df=2 have Df=2 in the sintered coordinates, or Df=2 in the "unsintered" (touching) coordinates?

5. **Should `calculate_com_distance` take sintering into account?** i.e., should the mean primary-particle radius `rp` in the formula be the "apparent" radius after sintering (e.g., `rp * sintering_coeff`)?

---

## Summary

| Aspect | Finding |
|--------|---------|
| **Orchestrator hypothesis** | ❌ WRONG — there is no cascading-merge sintering loop |
| **Actual sintering architecture** | Contact-distance coefficient during aggregation |
| **Root cause** | Geometry mismatch: CoM distance (fractal law) > sintered contact distance |
| **Scope** | `tunable_cc.rs:567,932-935` — positioning + contact validation |
| **Why only with sintering** | Without sintering, CoM distance = contact distance (exact match) |
| **Deterministic?** | YES for monomer pairs with Df≥2 + any sintering_coeff < 1.0 |
| **Recommended fix** | Post-positioning sintering adjustment (Option C) |
| **Effort** | Medium — 1 SDD cycle |
