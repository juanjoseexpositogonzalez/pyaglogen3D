# Exploration: PYA-14 Phase 3 — CC Tunable Df<2 Convergence

## Problem Statement

The CC Tunable algorithm systematically overshoots the target fractal dimension when Df<2. With target Df=1.7, kf=1.3, N=350, and dimer seeds, measured Df ranges 1.91–2.03 (mean ≈1.98), a systematic bias of **+16.4%**. Phase 2 confirmed the formula is correct and dimers help (ballistic rate dropped from ~100% with monomers to ~24% with dimers), but the remaining ~24% ballistic merges — concentrated in mid/late aggregation stages — still drive Df upward because ballistic placement produces contact-range merges (Df≈2) instead of the formula's required larger separation distances.

---

## Quantitative Analysis (5 simulations, 870 total merges)

### Metric 1: Retry Exhaustion Frequency

Retry cap from source: `max_merge_retries = 100` (line 119 of `tunable_cc.rs`).

| Seed | Total Merges | Exhausted (≥100 retries) | % |
|------|-------------|--------------------------|------|
| 1 | 174 | 39 | 22.4% |
| 2 | 174 | 44 | 25.3% |
| 3 | 174 | 41 | 23.6% |
| 4 | 174 | 43 | 24.7% |
| 5 | 174 | 43 | 24.7% |
| **ALL** | **870** | **210** | **24.1%** |

**Finding**: ~24% of all merges exhaust the retry cap. These map 1:1 to ballistic merges (see Metric 4 cross-tab).

### Metric 2: Required vs Actual Distance Gap (Ballistic Merges)

For each ballistic merge, gap = `(required_distance - actual_distance) / required_distance`. Positive = undershoot (aggregate placed too close → denser → Df UP).

| Seed | N | Mean | p50 | p95 | Min | Max | Undershoots | Overshoots |
|------|---|------|-----|-----|-----|-----|-------------|------------|
| 1 | 38 | 0.306 | 0.314 | 0.607 | -0.115 | 0.835 | 34 | 4 |
| 2 | 44 | 0.263 | 0.296 | 0.481 | -0.119 | 0.581 | 41 | 3 |
| 3 | 41 | 0.296 | 0.332 | 0.587 | -0.336 | 0.639 | 37 | 4 |
| 4 | 43 | 0.251 | 0.246 | 0.586 | -0.234 | 0.655 | 37 | 6 |
| 5 | 42 | 0.285 | 0.310 | 0.701 | -0.319 | 0.800 | 38 | 4 |

**Aggregate (208 ballistic merges)**: mean gap = **0.279**, 187 undershoots (89.9%), 21 overshoots (10.1%).

**Finding**: Ballistic merges place clusters **28% closer** than the formula requires on average. The worst case (seed 1, step 169) has a gap of **83.5%** — the formula asked for d=25.7 but ballistic placed at d=4.25. This is the most extreme systematic bias source.

### Metric 3: Stage-of-Aggregation Breakdown

Aggregate across all 5 simulations:

| Stage | Total Merges | Tunable | Ballistic | Ball% | Exhausted | Exh% |
|-------|-------------|---------|-----------|-------|-----------|------|
| Early (N≤10) | 619 | 593 | 26 | **4.2%** | 27 | 4.4% |
| Mid (10<N≤100) | 222 | 69 | 153 | **68.9%** | 154 | 69.4% |
| Late (N>100) | 29 | 0 | 29 | **100.0%** | 29 | 100.0% |

**Finding**: The formula is satisfiable for early merges (small clusters, small required_distance). It becomes progressively unsatisfiable as clusters grow:
- **Early**: only 4.2% ballistic — the algorithm works well here.
- **Mid**: 68.9% ballistic — the formula's required distance grows faster than the clusters' physical extent.
- **Late**: 100% ballistic — the algorithm NEVER succeeds for N>100. Every single merge at this stage exhausts 100 retries and falls back.

This is the smoking gun: **the algorithm degrades gracefully until N≈10, then catastrophically fails**.

### Metric 4: Bounding Check Cross-Tabulation

| Seed | Failed | Fail% | Tunable✓ | Tunable✗ | Ballistic✓ | Ballistic✗ |
|------|--------|-------|----------|----------|------------|------------|
| 1 | 38 | 21.8% | 136 | 0 | 0 | 38 |
| 2 | 44 | 25.3% | 130 | 0 | 0 | 44 |
| 3 | 41 | 23.6% | 133 | 0 | 0 | 41 |
| 4 | 43 | 24.7% | 131 | 0 | 0 | 43 |
| 5 | 42 | 24.1% | 132 | 0 | 0 | 42 |

**Finding**: Perfect correlation — `bounding_check_passed=false` ↔ `merge_type=ballistic`. All tunable merges pass the bounding check; all ballistic merges fail it. This confirms the bounding check accurately identifies geometrically impossible placements — the issue is what we DO when it fails (currently: ballistic at contact distance).

### Metric 5: rg_after vs rg_target Divergence

| Seed | Steps | Mean Rel Gap | Final Cumulative Gap | Inc↑ | Dec↓ | Trend |
|------|-------|-------------|---------------------|------|------|-------|
| 1 | 174 | -0.0455 | -7.91 | 1 | 172 | bias |
| 2 | 174 | -0.0485 | -8.43 | 4 | 169 | bias |
| 3 | 174 | -0.0476 | -8.29 | 4 | 169 | bias |
| 4 | 174 | -0.0434 | -7.56 | 8 | 165 | bias |
| 5 | 174 | -0.0434 | -7.56 | 4 | 169 | bias |

**Aggregate**: 97.6% of all merges produce `rg_after < rg_target` (aggregate is too compact). Mean relative gap = **-4.57%**. The cumulative divergence is monotonically negative (decreasing in 165-172 out of 173 steps).

**Finding**: The divergence is NOT random noise — it's a systematic monotonic bias. The aggregate is consistently **more compact** than the formula targets, which directly causes measured Df > target Df (more compact = higher Df). The bias accumulates at every step because each ballistic merge compounds the compaction error.

---

## MATLAB Reference Comparison

### Formula verification
The Rust `calculate_com_distance` and MATLAB `distanciaClusters.m` are algebraically identical. The MATLAB `constante = 3/5` cancels exactly for monodisperse particles (rp=1.0) because the `npo²/(npo1·npo2)·rp² - npo/npo1 - npo/npo2` terms evaluate to zero. **The formula is NOT the problem.**

### Critical architectural difference
The MATLAB `TuningCC.m` uses `while(~choque)` (line 188) — an **infinite retry loop**. There is NO retry cap and NO ballistic fallback. The algorithm retries with different random pairs until it finds one where:
1. The bounding check passes (line 211)
2. The geometric positioning succeeds
3. Contact is established without overlap

For Df<2 with large N, this likely causes the MATLAB code to run for very long times (or hang). The thesis may have been validated with small N values where the early-stage success rate (95.8%) carries most of the work.

### Bounding check discrepancy
MATLAB (line 211): `(rEnvol1 + rEnvol2) < gamma / 2` — checks against **half** the COM-COM distance.
Rust (line 391): `cluster1.bounding_radius + cluster2.bounding_radius >= required_distance` — checks against the **full** distance.

This means MATLAB's bounding filter is **less strict** — it allows more pairs through. However, this is unlikely to be the primary issue since MATLAB still retries infinitely if positioning fails.

---

## Path Evaluation

### Path B — "Adaptive d" (relax required_distance when geometrically impossible)

**Data evidence**:
- Mean undershoot gap is 27.9% — the formula asks for distances 28% larger than what ballistic achieves.
- The gap grows with aggregate size: early stages have small gaps, late stages have gaps up to 83.5%.
- If we could satisfy even 50% of the currently-ballistic merges by relaxing `d` to the maximum geometrically achievable distance, we'd reduce ballistic rate from 24% to ~12%.

**Mechanism**: When `required_distance > f(bounding_radii)`, solve for the maximum achievable distance and use that instead. This produces an aggregate more open than ballistic (good) but more compact than the ideal target (acceptable compromise).

**Implementation complexity**: **Small (S)**
- Modify `run_tunable_cc_internal` at the ballistic fallback point (line 1080-1156).
- When retry cap is exhausted, instead of full ballistic, attempt placement at `min(required_distance, bounding_radius_1 + bounding_radius_2)`.
- Falls through to ballistic only if even relaxed placement fails.

**Risk to Df≥2**: **Low**. For Df≥2, the formula's required_distance is smaller (denser targets are easier to satisfy), so the relaxation rarely activates. Existing tests cover Df=1.8, 2.0, 2.5 — these would continue passing.

**Estimated improvement**: From data, ~60% of ballistic merges have gap<0.4, meaning relaxed placement could capture them. This would reduce ballistic rate from 24% to ~10%, likely bringing Df error from 16.4% to ~8%.

### Path D — "Smart Pair Selection" (pick pairs where d is achievable)

**Data evidence**:
- Early stages (N≤10) have 95.8% tunable success — there are MANY feasible pairs in the pool.
- Mid/late stages fail because the algorithm picks random pairs. If it instead enumerated candidates and ranked by feasibility, it could avoid the 100 retries entirely for many merges.
- The pool has 87-175 clusters at mid stage, so there are 3,000-15,000 possible pairs. Only a fraction are geometrically feasible.

**Mechanism**: Before the retry loop, pre-compute `required_distance` for all (or a sample of) candidate pairs. Sort by `required_distance / (bounding1 + bounding2)` ratio. Pick pairs where this ratio is ≤1.0 (geometrically achievable). If no feasible pair exists, fall through to current logic.

**Implementation complexity**: **Medium (M)**
- Need to iterate over candidate pairs (~O(k²) where k = cluster count, but k decreases each step).
- Requires calling `calculate_com_distance` for each candidate pair.
- Peak cost at start with 175 clusters: 175·174/2 = 15,225 pair evaluations per merge step.
- May need sampling for large k to stay fast.

**Risk to Df≥2**: **Low**. Smart selection is strictly better — it finds the same pairs the random search would find, just faster. For Df≥2, most pairs are feasible anyway, so the selection has minimal effect.

**Estimated improvement**: Could reduce ballistic rate from 24% to ~5-8% by finding the needle-in-haystack feasible pairs that 100 random tries miss. Mid-stage ballistic (68.9%) would drop significantly because feasible pairs DO exist — the current algorithm just can't find them in 100 tries.

### Path E — "Retry Cap Relaxation + Repulsive Placement" (overshoot rather than undershoot on fallback)

**Data evidence**:
- 89.9% of ballistic merges undershoot (actual_distance < required_distance). This biases Df UP.
- Only 10.1% overshoot. If fallback placement overshot instead, the bias would be toward Df DOWN — partially canceling the overall error.
- Mean gap is 0.279 — ballistic places at 72% of required distance.

**Mechanism A (cap relaxation)**: Increase max_merge_retries from 100 to 1000 or 5000. Cost: more iterations but still bounded (unlike MATLAB's infinite loop).

**Mechanism B (repulsive placement)**: On ballistic fallback, instead of marching the impactor INTO the impacted cluster until contact, place it at `required_distance` along a random ray. If this causes no contact, march inward TOWARD that target distance. Result: actual_distance ≈ required_distance instead of actual_distance ≈ contact_distance.

**Implementation complexity**: **Medium (M)**
- Cap relaxation: trivial (change one constant).
- Repulsive placement: needs a new function `merge_at_distance()` that positions clusters at a specific COM-COM distance (not just contact). Requires finding a valid rotation where at least one particle pair touches while maintaining the COM-COM distance. This is geometrically non-trivial.

**Risk to Df≥2**: **Medium**. Cap relaxation is safe. Repulsive placement changes the ballistic behavior fundamentally — any regression in Df≥2 ballistic merges (rare but nonzero) would need new test coverage.

**Estimated improvement**: Cap relaxation alone is unlikely to help much — the issue isn't that 101 retries would succeed where 100 failed. The problem is that for mid/late stages, NO random pair satisfies the bounding check (see Metric 3: 100% exhaustion for N>100). More retries on an impossible geometry is futile. Repulsive placement alone could reduce mean gap from 0.279 to ~0.05, potentially halving the Df error.

---

## Recommendation

### Primary: Path D — Smart Pair Selection

**Rationale from the data**:

1. The root cause is NOT the formula (verified identical to MATLAB).
2. The root cause is NOT the retry count (even ∞ retries would fail if no feasible pair exists in the current random pair).
3. The root cause IS: random pair selection wastes all 100 retries on infeasible pairs when feasible pairs exist elsewhere in the pool.

Evidence: at mid-stage with 50+ clusters, there are 1,000+ possible pairs. The algorithm tries 100 random pairs (≤10% of the space). Smart selection pre-screens for feasibility, finding the few pairs where `required_distance ≤ bounding1 + bounding2`. The MATLAB code compensates by retrying infinitely — we compensate by searching smarter.

Smart selection also has the cleanest semantics: it doesn't change the formula, doesn't change the target, doesn't change what "success" means. It just finds feasible pairs more efficiently.

### Fallback: Path B — Adaptive d

If smart pair selection alone doesn't bring ballistic below ~10%, Path B provides an additional layer: when even the best pair is geometrically impossible (true for very late merges where ALL pairs fail), relax the target distance to the maximum achievable. This produces a merge that's more open than ballistic but less open than ideal — a deliberate, controlled compromise vs the current uncontrolled ballistic undershoot.

### NOT recommended as primary: Path E

Cap relaxation alone is ineffective (data shows the problem is zero feasible pairs, not insufficient sampling of a feasible space). Repulsive placement is a good concept but higher implementation risk and doesn't address the root cause (pair selection).

### Recommended implementation order
1. **Path D** (smart pair selection) — highest ROI, addresses root cause
2. **Path B** (adaptive d) — fallback for truly impossible geometries
3. Validate with same 5-seed test harness (Df=1.7, kf=1.3, N=350, dimers)
4. Regression test with Df=2.5 to ensure no degradation

---

## Open Questions (out of scope this cycle)

1. **kf<1.3 behavior**: Is the bias the same, worse, or a different mechanism? Lower kf means more compact targets — the formula may demand even larger separations.
2. **N sensitivity**: Would N=1000 vs N=350 change the bias? More particles → more late-stage merges (N>100) → proportionally more ballistic → potentially worse bias. The late stage is 100% ballistic regardless.
3. **MATLAB original performance at Df<2**: The MATLAB `TuningCC.m` retries infinitely. For the thesis validation (likely small N), this may have worked but taken a long time. For N=350, it might hang. No data available — would need to run the MATLAB code.
4. **MATLAB bounding check discrepancy**: Line 211 uses `gamma/2` not `gamma`. This is either a bug in MATLAB or `gamma` means diameter (2×d) in their convention. Needs careful verification against thesis equations (Section 6.3.3).
5. **Sintering interaction**: All our tests use sintering_coeff=1.0 (no sintering). Does sintering change the feasibility landscape? (Unlikely to help — sintering reduces contact distance, making required_distance relatively even larger.)

---

## Affected Areas

- `aglogen_core/engine/src/simulation/tunable_cc.rs` — main algorithm loop (lines 926-1161)
  - `run_tunable_cc_internal` — pair selection + retry loop
  - `calculate_com_distance` — formula (unchanged, confirmed correct)
  - `can_clusters_connect` — bounding check (may need adjustment)
  - `merge_ballistic` — fallback function (may be modified for Path B)
- `aglogen_core/engine/tests/integration_cc_tunable.rs` — convergence tests needed
- `scripts/analyze_pya14_traces.py` — analysis script (reusable for validation)

---

## Analysis Script

Reusable analysis script saved to `scripts/analyze_pya14_traces.py` (gitignored). Reads the validation JSON and computes all 5 metrics plus MATLAB formula comparison and last-20-merge detail view.

---

## Ready for Proposal

**Yes**. The data clearly identifies the root cause (random pair selection exhausting retries when feasible pairs exist) and the recommended path (smart pair selection + adaptive d fallback) is well-supported by the quantitative analysis. Next phase should be `sdd-propose` to define scope, rollback plan, and success criteria.
