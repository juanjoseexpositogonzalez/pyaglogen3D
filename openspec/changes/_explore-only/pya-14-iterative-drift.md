# PYA-14 Exploration: CC Tunable Iterative Drift — Target Df Not Reached Even When Formula Works

**Date**: 2026-05-07  
**Status**: Complete  
**Severity**: HIGH — systematic bias when target Df < 1.8; formula correct per-step but global target not reached

---

## 1. Canonical Algorithm from Thesis

### Source

`aglogen3D/06AgloGen3D.tex`, Section 6.3.2 (`\subsection{Expresión para la distancia entre aglomerados que colisionan}`) and Section 6.3.4 (`\subsection{Algoritmo para la generación de aglomerados sintéticos. Caso \CC}`)

### Core Derivation (eq:leyPotenciasColisionI, line 262-270)

The thesis derives the merge constraint from the parallel-axis theorem applied to the radius of gyration. For two sub-clusters with `n₁` and `n₂` particles merging into a cluster of `n = n₁ + n₂`:

```
n·(Rg² − 3/5·rp²) = n₁·(Rg₁² − 3/5·rp²) + n₂·(Rg₂² − 3/5·rp²) + (n₁·n₂/n)·d²
```

where `d = |r_G2 − r_G1|` is the COM distance between the merging sub-clusters.

### Power Law Substitution

Substituting `Rg² = rp²·(N/kf)^(2/Df)` for each cluster and solving for d²:

```
d² = (n·rp²)/(n₁·n₂) · [ n·(n/kf)^(2/Df) − n₁·(n₁/kf)^(2/Df) − n₂·(n₂/kf)^(2/Df) ]    [★]
```

The 3/5 constants cancel because `n − n₁ − n₂ = 0`.

### The Critical Assumption

Equation [★] places `d` such that **IF** Rg₁ satisfies `n₁ = kf·(Rg₁/rp)^Df` **AND** Rg₂ satisfies `n₂ = kf·(Rg₂/rp)^Df`, **THEN** the merged Rg will satisfy `n = kf·(Rg/rp)^Df`.

This is a **per-step invariant**: if the power law holds for both inputs, it holds for the output. Mathematically, this is an **exact** identity — no approximation.

### CC Algorithm Pseudocode (thesis Section 6.3.4, line 400-498)

```
1. Start from pool AS of small clusters with approximately equal particles
2. WHILE pool has > 1 cluster:
   a. Select two clusters at random, assign impacted/impactor roles
   b. Place impacted COM at origin
   c. Calculate d = |r_G2 − r_G1| from equation [★]
   d. Place impactor COM on sphere of radius d (random direction)
   e. Check bounding-sphere reachability: |d_es1| + |d_es2| >= d
      → If NO: choose different pair, repeat
   f. Build candidate particle lists LA₁, LA₂
   g. Select particle pair M₁, M₂ satisfying triangle criterion
   h. Rotate impacted by (γ − γ*) around r_P1 × (r_G2 − r_G1)
   i. Rotate impactor by (λ − λ*) to bring M₂ into contact with M₁
   j. Check overlap against sublists LA2₁, LA2₂
      → If overlap: rotate impactor around r_P2*, retry
      → If still overlapping after N rotations: go to step (g)
   k. Merge clusters, update pool
3. Return final aggregate
```

### Key Thesis Properties

- **Hierarchical random pair-merge** (NOT sequential particle-by-particle)
- **Per-step constraint**: d enforces the power law at EACH merge step
- **Two rotations**: (γ−γ*) on impacted, (λ−λ*) on impactor
- **No final rescaling**: the thesis relies on the per-step invariant being sufficient

---

## 2. Current Rust Implementation (Post-Frentes 10 & 11)

### File: `pyaglogen3D/aglogen_core/engine/src/simulation/tunable_cc.rs`

### `calculate_com_distance` (lines 339-365) — CORRECT

```rust
let n1 = n_po1 as f64;
let n2 = n_po2 as f64;
let n = n1 + n2;
let e = 2.0 / df;

let t_total = n * (n / kf).powf(e);     // n·(n/kf)^(2/Df)
let t1      = n1 * (n1 / kf).powf(e);   // n₁·(n₁/kf)^(2/Df)
let t2      = n2 * (n2 / kf).powf(e);   // n₂·(n₂/kf)^(2/Df)

let d_sq = (n * rp_eff * rp_eff) / (n1 * n2) * (t_total - t1 - t2);
```

This matches equation [★] exactly. The frente 10 bugs are all fixed. ✓

Cross-validated: when n₂=1, this reduces to the PC gamma formula in `tunable.rs:132-146`. ✓

### Main Loop Pseudocode (lines 875-1103)

```
1. Initialize pool with seed clusters (Monomers/Dimers/Trimers per seed_type)
2. Spread clusters to avoid initial overlaps
3. WHILE clusters.len() > 1:
   FOR attempt in 0..max_merge_retries:
     a. Pick random pair (NEW pair each retry)
     b. Assign impacted (larger) / impactor (smaller)
     c. Calculate required_distance via calculate_com_distance(n₁, n₂, rp, df, kf, sintering)
     d. Check bounding sphere reachability
     e. Build candidate lists la₁, la₂
     f. FOR up to max_particle_selection_attempts:
        i.   Select contact pair (m₁, m₂) with triangle criterion
        ii.  position_clusters_for_contact: 
             - Rotate cluster1 randomly around its COM (rotation 1)
             - Place cluster2 COM at required_distance along random direction
             - Rotate cluster2 to bring m₂ into contact with m₁
        iii. Verify contact + no overlap
     g. If tunable succeeded: merge, record tunable_merges++, break
   If all retries failed: ballistic fallback, ballistic_merges++
4. Compute Df/kf from rg_evolution via log-log regression
```

### `position_clusters_for_contact` (lines 569-631)

Two-rotation scheme (fixed in frente 10):
1. **Rotation 1**: Random rotation of cluster1 (impacted) around its COM
2. **Placement**: cluster2 COM at `required_distance` along random spherical direction
3. **Rotation 2**: Rotate cluster2 to bring particle m₂ into contact with p₁

Contact verification: `|final_dist - contact_dist| < contact_dist * 0.1` (10% tolerance, line 630)

---

## 3. Structural Diff: Thesis vs Rust

### What Matches (Post-Frentes 10 & 11)

| Aspect | Thesis | Rust | Match? |
|--------|--------|------|--------|
| COM distance formula | eq [★] | `calculate_com_distance` | ✅ Exact |
| Per-step invariant | Applies [★] at each merge | Same | ✅ |
| Random pair selection | Random from pool | Random with retry policy | ✅ |
| Two-rotation positioning | γ−γ* then λ−λ* | Random rotation + directed rotation | ✅ Equivalent |
| Bounding sphere check | d_es1 + d_es2 >= d | `can_clusters_connect` | ✅ |
| Triangle criterion | eq:criterioTriangularMonomeros | `select_contact_particles` | ✅ |
| Overlap resolution | Rotate around r_P2* | `resolve_overlap_by_rotation` | ✅ |
| Sintering in COM formula | NOT in thesis | `rp_eff = rp * sintering_coeff` | ⚠️ Extension |
| Final rescaling | NOT in thesis | NOT in code | ✅ (neither has it) |

### What Differs

1. **Ballistic fallback**: The thesis says "choose another pair" on failure. The Rust code retries with new pairs for `max_merge_retries` (100), then falls back to ballistic. This is a reasonable engineering policy that the thesis doesn't address.

2. **Seed cluster initialization**: Thesis says "small clusters with approximately equal particles". Rust supports Monomers/Dimers/Trimers (frente 10 R4 spec).

3. **Sintering integration into COM formula**: `rp_eff = rp * sintering_coeff` scales the COM distance. Thesis doesn't cover sintering in the tunable algorithm (frente 11 extension).

**Bottom line**: The Rust code is structurally faithful to the thesis algorithm. There is NO missing step.

---

## 4. Mathematical Analysis: Does the Per-Step Invariant Imply the Global Target?

### The Invariant

At every merge step, `calculate_com_distance` computes `d` such that:

> If cluster₁ satisfies `n₁ = kf·(Rg₁/rp)^Df` and cluster₂ satisfies `n₂ = kf·(Rg₂/rp)^Df`, then the merged cluster satisfies `n = kf·(Rg/rp)^Df`.

### Inductive Argument

**Base case**: Each monomer has `Rg = rp·√(3/5)`. The power law gives `Rg_target = rp·(1/kf)^(1/Df)`. These are NOT equal in general. For kf=1.7, Df=1.6: `Rg_target = rp·(1/1.7)^(1/1.6) = rp·0.688`, while `Rg_monomer = rp·0.775`.

**THIS IS THE KEY**: The per-step invariant computes d assuming each input sub-cluster already satisfies the power law. But seed monomers DON'T satisfy the power law — their actual Rg (from physical geometry, 3/5 correction) differs from the target Rg (from power law kf·(Rg/rp)^Df = N).

### Trace for N=10, target Df=1.6, kf=1.7, rp=1.0

**Step 1**: Merge two monomers (n₁=1, n₂=1) → n=2
- Formula assumes Rg₁ = rp·(1/1.7)^(1/1.6) = 0.688
- Actual Rg₁ of monomer = √(3/5) = 0.775
- d computed from formula: d² = (2·1)/(1·1) · [2·(2/1.7)^(1.25) − 1·(1/1.7)^(1.25) − 1·(1/1.7)^(1.25)]
  = 2 · [2·1.252 − 2·0.688] = 2 · [2.504 − 1.376] = 2 · 1.128 = 2.256
  d = 1.502
- After placement: actual Rg of the merged dimer (2 particles at d=1.502 apart) is computed from the physical geometry, NOT from the formula assumption.
- The code computes `cluster.update_properties()` → `calculate_radius_of_gyration` which uses the ACTUAL particle positions.

**Step 2**: Merge the dimer (n₁=2) with another monomer (n₂=1) → n=3
- Formula assumes Rg₁ = rp·(2/1.7)^(1/1.6) = 1.161 (from power law for n₁=2)
- Actual Rg₁ of the dimer = computed from step 1's physical positions ≈ some other value
- **MISMATCH**: The formula's d uses the TARGET Rg for the dimer, but the dimer's ACTUAL Rg (from its physical position) is different because step 1's monomer base case didn't satisfy the power law.

### The Drift Mechanism

This is NOT positioning error — it's a fundamental mathematical property:

1. The formula computes d assuming BOTH sub-clusters satisfy `N = kf·(Rg/rp)^Df`
2. The formula places clusters at that d
3. The code then computes ACTUAL Rg from physical particle positions
4. The actual Rg ≠ target Rg because the sub-clusters' actual Rg ≠ target Rg
5. The error propagates and accumulates with each merge

### But Wait — Does This Actually Drift?

Let me re-examine. The parallel-axis theorem says:

```
n·Rg² = n₁·Rg₁² + n₂·Rg₂² + (n₁·n₂/n)·d²
```

This is an EXACT geometric identity — it holds regardless of what Rg₁ and Rg₂ are. The question is: when the code places COMs at distance d (computed from ASSUMED Rg₁, Rg₂ via power law), what is the ACTUAL Rg of the merged cluster?

The formula solves: `d² = (n·rp²)/(n₁·n₂) · [n·(n/kf)^(2/Df) − n₁·(n₁/kf)^(2/Df) − n₂·(n₂/kf)^(2/Df)]`

But the actual Rg of the merged cluster is determined by:
```
Rg²_actual = (1/n) · [n₁·Rg₁²_actual + n₂·Rg₂²_actual + (n₁·n₂/n)·d²]
```

For this to equal the target `Rg²_target = rp²·(n/kf)^(2/Df)`, we need:
```
n·rp²·(n/kf)^(2/Df) = n₁·Rg₁²_actual + n₂·Rg₂²_actual + (n₁·n₂/n)·d²
```

But the formula assumes:
```
n₁·Rg₁²_target + n₂·Rg₂²_target + (n₁·n₂/n)·d² = n·rp²·(n/kf)^(2/Df)
```

Where `Rg_i²_target = rp²·(n_i/kf)^(2/Df)`. The error is:

```
ΔRg² = (n₁/n)·(Rg₁²_actual − Rg₁²_target) + (n₂/n)·(Rg₂²_actual − Rg₂²_target)
```

This is a **weighted average of the sub-cluster Rg errors**. The error propagates but does NOT amplify — each merge averages the errors from both sub-clusters, weighted by particle count.

### Error Behavior

If each sub-cluster has Rg error `ε_i = Rg_i²_actual − Rg_i²_target`:
- After merge: `ε_merged = (n₁·ε₁ + n₂·ε₂)/n`
- This is a CONTRACTION (weighted average of errors, no amplification)
- Initial errors from monomer base case: `ε_monomer = Rg_monomer² − Rg_target(1)² = 3/5 − (1/kf)^(2/Df)`

For kf=1.7, Df=1.6: `ε_monomer = 0.600 − 0.474 = +0.126` (monomer is WIDER than target)

This positive error propagates through all merges, making the aggregate systematically WIDER than target. But a wider aggregate means LOWER Df. And the empirical data shows Df ≈ 2.0 (HIGHER than target 1.6).

**CONTRADICTION**: The base-case error predicts Df should be BELOW target, but empirical data shows it ABOVE target. So the monomer base-case drift is NOT the dominant mechanism.

### Revised Analysis: What's Actually Happening

The key observation from the empirical data: **78% tunable merges with seed=Dimers, yet Df=1.96**. The formula IS computing d values. But the CODE's Rg is calculated from ACTUAL particle positions via `calculate_radius_of_gyration`, which includes the 3/5·rp² intra-particle term.

The issue is that `calculate_radius_of_gyration` (metrics.rs:44-69) computes:

```rust
ip += (3.0 / 5.0) * r5 + r3 * d * d;   // 3/5·r⁵ + r³·d²
mp += r3;                                 // r³
Rg = sqrt(ip/mp)                          // √(3/5·r² + (1/n)Σd²)  [for monodisperse]
```

This is the FULL Rg including the intra-particle 3/5·rp² term. But this is used only for REPORTING (the `rg_evolution` tracking), NOT in the COM distance formula. The formula uses the TARGET power law, not the measured Rg. So the code is self-consistent in that regard.

**Wait** — re-reading the code: `cluster.update_properties()` at line 244 calls `calculate_radius_of_gyration` to set `self.radius_of_gyration`. But this measured Rg is NEVER fed back into `calculate_com_distance`. The formula always uses `rp`, `df`, `kf`, `n₁`, `n₂` — all targets/counts, never measured Rg.

### Root Cause: The Formula IS Correct, But the Geometry Fails

The formula computes the correct d. But the positioning step (`position_clusters_for_contact`) places particles at that d **with physical contact constraints**. The contact requirement means the actual particle positions don't perfectly match the assumed geometry. Specifically:

1. The formula assumes COMs are exactly d apart
2. `position_clusters_for_contact` places COMs at d, then rotates to achieve physical contact
3. The rotation to achieve contact can move particles, slightly changing the effective Rg
4. The 10% tolerance on contact verification (line 630: `(final_dist - contact_dist).abs() < contact_dist * 0.1`) allows significant positioning error

But the empirical observation suggests the drift is ~25% (from 1.6 to 2.0), far larger than positioning tolerance could explain.

### The REAL Root Cause: Hierarchical Merge Topology

The critical insight is that the formula's per-step invariant holds ONLY if the merge produces a cluster whose internal geometry matches the power law. But the actual geometry is constrained by:

1. **Physical contact**: Particles must touch (or overlap with sintering)
2. **No internal overlap**: New placement can't overlap existing particles
3. **Discrete geometry**: Particles are spheres, not a continuum

For **low Df** (target=1.6), the formula demands LONG COM distances (open, chain-like structures). But physical contact constraints prevent placing clusters far apart while still touching — the `can_clusters_connect` check at line 968 rejects pairs where `bounding_radius₁ + bounding_radius₂ < required_distance`.

For a compact cluster (which the growing aggregate inevitably becomes due to random merge topology), the bounding radius grows slower than the required COM distance for low Df. This causes:
- Early merges: small clusters → bounding radius sufficient → tunable works
- Late merges: large clusters → bounding radius too small → tunable fails → ballistic fallback

**Ballistic fallback produces Df ≈ 1.8–2.1**, pulling the overall Df upward.

### Why Dimers Help But Don't Solve It

Dimers start with n₁=n₂=2 (symmetric merges). Symmetric merges produce moderate COM distances (compared to asymmetric 1+N merges). The bounding sphere check passes more often → 78% tunable. But the late-game merges (e.g., 175+175 at N=350) still hit bounding sphere failures → ballistic fallback → Df drifts to ~2.0.

---

## 5. Diagnostic Data Analysis

### Current Diagnostics (SimulationResult, result.rs:7-41)

Available: `tunable_merges`, `ballistic_merges`, `max_retries_per_merge`, `rg_evolution`

Missing: **Per-step trace** — the current code tracks `rg_evolution` (line 1099) but only records the LARGEST cluster's Rg. There is no record of:
- Per-merge d (computed COM distance)
- Per-merge pair sizes (n₁, n₂)
- Per-merge actual vs target Rg
- Whether each merge was tunable or ballistic
- The bounding radius check pass/fail rate

### Where Diagnostic Hook Would Fit

**Best location**: Inside the main loop at lines 931-1103, after line 1044 (successful tunable merge) and after line 1088 (successful ballistic merge):

```
// After merge:
trace_log.push(MergeTrace {
    step: merge_count,
    n1, n2,
    required_distance,     // from calculate_com_distance
    actual_com_distance,   // measured after positioning
    rg_after,              // measured Rg of merged cluster
    rg_target,             // rp * (n/kf)^(1/Df)
    merge_type: Tunable|Ballistic,
    retries: retries_this_merge,
});
```

This trace would definitively show WHERE the drift occurs (early vs late merges, asymmetric vs symmetric, tunable vs ballistic).

---

## 6. Fix Path Analysis

### Path A: Global Post-Hoc Rescaling

After the merge loop completes, measure the actual Df and rescale all particle positions to match the target.

**Mechanism**: Compute scaling factor `s = (Rg_target / Rg_actual)` and multiply all inter-particle distances from COM by `s`.

**Pros**:
- Simple: ~20 lines of code
- Guaranteed to hit target Df for the final aggregate
- Non-invasive: doesn't change the merge algorithm

**Cons**:
- **Breaks physical contacts**: After rescaling, particles that were touching may separate or overlap
- **Requires re-validating connectivity**: The aggregate might become disconnected
- **Kf coupling**: Rescaling Rg affects both Df AND kf — can't independently adjust both
- **Physically meaningless**: The resulting aggregate has the right Df but its internal structure doesn't reflect the growth process

**Feasibility**: LOW — contact-breaking is a showstopper for realistic aggregates

### Path B: Per-Step Invariant Change (Adaptive d)

Instead of computing d from the TARGET power law, compute d from the ACTUAL measured Rg of the sub-clusters.

**Mechanism**: At each merge, measure Rg₁_actual and Rg₂_actual, then solve:
```
d² = (n/n₁·n₂) · [n·Rg_target² − n₁·Rg₁²_actual − n₂·Rg₂²_actual]
```

This compensates for accumulated errors by adjusting d to CORRECT the merged Rg toward the target.

**Pros**:
- Mathematically exact: the merged Rg will match the target if d is achievable
- Preserves the per-merge constraint structure
- Adapts to any seed type or merge topology
- The sub-cluster Rg measurement is already computed (`cluster.radius_of_gyration`)

**Cons**:
- d may be LARGER than the current formula predicts (when sub-clusters are too compact), making the bounding sphere check fail MORE often → more ballistic fallback
- d may become negative (when sub-clusters are already wider than target), requiring clamping or fallback
- Changes the mathematical meaning of d: no longer a pure power-law distance but a corrective distance
- Needs careful handling of the sintering term

**Feasibility**: MEDIUM — the adaptive formula could improve convergence but might increase ballistic fallback rate for pathological cases

### Path C: Algorithm Restructuring (FZR-canonical Particle Insertion)

Filippov, Zachariah, Rosner (2000) use particle-by-particle insertion (PC-like), not hierarchical pair-merge. Replace the CC merge loop with sequential particle insertion using the tunable PC algorithm, which is already implemented and working in `tunable.rs`.

**Mechanism**: Use the existing Tunable PC code path for ALL aggregates, ignoring the CC merge topology.

**Pros**:
- PC already works (tunable.rs is validated)
- Particle-by-particle insertion avoids the bounding-sphere problem (single particle always fits)
- FZR 2000 is the canonical reference

**Cons**:
- **NOT CC**: The CC merge topology produces different morphologies than PC. PC produces more radially symmetric, denser structures. CC produces more branched, realistic structures.
- **Defeats the purpose**: Users who select CC mode want CC-like morphology
- **Already available**: Users can already choose Tunable PC

**Feasibility**: LOW — this doesn't solve the problem, it sidesteps it

### Path D: Hybrid — Adaptive d + Configurable Retry Budget (DISCOVERED)

Combine Path B (adaptive d) with an increased retry budget and a smarter pair-selection strategy:

1. Use the adaptive d formula (actual Rg, not target)
2. When adaptive d > bounding reach, prefer merging smaller/more compatible clusters (not random)
3. Increase max_merge_retries for late-game merges (large clusters)
4. Track per-step convergence error; if error exceeds threshold, switch to preferential pair selection

**Pros**:
- Corrects the drift at each step
- Maintains CC merge topology
- The retry budget already exists (just needs tuning)
- Pair selection strategy can use the existing pool without structural changes

**Cons**:
- More complex than B alone
- Preferential pair selection changes the randomness of the CC process
- Needs new heuristic for "compatible" pairs

**Feasibility**: MEDIUM-HIGH

### Path E: Per-Step Trace First, Then Fix (DISCOVERED — RECOMMENDED)

Before implementing any fix, add the per-step diagnostic trace described in Section 5. Run the instrumented code with the user's parameters (Df=1.6, kf=1.7, N=350, seed=Dimers) and analyze:

1. At which merge steps does the Rg error grow?
2. Is the error from tunable merges or ballistic fallback merges?
3. What is the bounding-sphere failure rate for late-game merges?
4. Does the error correlate with merge asymmetry (n₁ >> n₂)?

This data will determine whether Path B (adaptive d) or Path D (adaptive d + smart pairing) is the right fix.

**Pros**:
- Evidence-based decision instead of hypothesis-based
- Low risk (instrumentation doesn't change behavior)
- Fast to implement (~30 lines)

**Cons**:
- Adds one extra step before the actual fix
- Requires running test simulations to collect data

**Feasibility**: HIGH

---

## 7. Recommendation

**Recommended fix path: E then B/D.**

### Rationale

1. **The formula is correct** — frente 10 fixed the 3 bugs. No formula changes needed.
2. **The per-step invariant is mathematically sound** — IF sub-cluster Rgs match the power law, the merged Rg will too.
3. **The actual problem is that sub-cluster Rgs DON'T match the power law** due to: (a) monomer base-case mismatch, (b) accumulated positioning tolerances, (c) ballistic fallback merges injecting uncontrolled Df.
4. **We don't yet know which factor dominates** — (a), (b), or (c). The trace data from Path E will answer this.
5. **Path B (adaptive d) is the most likely fix**, but we need the trace data to confirm it won't make the bounding-sphere problem worse.

### Concrete Next Steps

1. **PYA-14 Phase 1** (sdd-propose): Add per-step merge trace to `run_tunable_cc_internal`. ~30 lines, no behavior change. Surface the trace via `SimulationResult` or a separate diagnostic struct.
2. **PYA-14 Phase 2** (after trace analysis): Implement adaptive d formula and re-measure convergence. If bounding-sphere failures increase, add preferential pair selection (Path D).

---

## 8. Open Questions

1. **Trace data priority**: Should we instrument first (Path E) or go straight to the fix (Path B)? The instrumentation is low-risk and gives evidence, but adds one development cycle.

2. **Seed type interaction**: The empirical data shows Dimers (78% tunable) still drift. Should the adaptive d formula also change how seeds are initialized? (e.g., should seed dimers/trimers be placed at power-law-consistent distances?)

3. **Acceptable tolerance**: For low Df targets (1.4–1.8), what's the acceptable error band? ±5%? ±10%? This determines how aggressively the adaptive formula needs to correct.

4. **FZR 2000 reference**: The code and thesis don't explicitly cite FZR's particle-insertion variant vs the pair-merge variant. The thesis algorithm is pair-merge (CC), while FZR 2000 is more commonly associated with particle-insertion (PC). Should we verify against a specific FZR equation? The thesis's derivation appears self-contained and correct.

---

## 9. Findings Summary

| # | Severity | Finding | Evidence |
|---|----------|---------|----------|
| 1 | HIGH | Per-step formula correct but global Df not reached due to accumulated Rg mismatch | Mathematical analysis + empirical data (78% tunable, Df=1.96) |
| 2 | MEDIUM | Monomer base case doesn't satisfy power law (Rg_monomer ≠ Rg_target for N=1) | Rg_mono=0.775rp vs Rg_target=0.688rp at kf=1.7, Df=1.6 |
| 3 | MEDIUM | Ballistic fallback merges inject uncontrolled Df (~1.8-2.1) | PYA-10 P6 integration tests: 22-80% ballistic depending on seed |
| 4 | LOW | 10% positioning tolerance in contact verification may add noise | tunable_cc.rs:630 |
| 5 | INFO | No per-step diagnostic trace exists to determine dominant drift source | result.rs lacks per-merge data |
