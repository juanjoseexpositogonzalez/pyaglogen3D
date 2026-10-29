# Exploration: PYA-13 — Bisection UX: Error Categorization & Graceful Degradation

> Explore-only, 2026-05-05. READ-ONLY investigation for UX/categorization cycle.

---

## 1. Current Bisection Code

### Location & Signature

`aglogen_core/engine/src/fractal/fraktal/bisection.rs:98`

```rust
pub fn solve<F>(&self, objective_fn: F, df_min: f64, df_max: f64) -> BisectionResult
where F: Fn(f64) -> (f64, f64)  // (function_value, kf)
```

### Pseudocode

```
Phase 1 — Bracket search:
  step through Df from df_min by 0.05 until df_max
  evaluate objective_fn at each step
  if sign(f_a) != sign(f_b) → found bracket, go to Phase 2
  if no bracket found → call fallback_optimization (golden section on |f|)

Phase 2 — Bisection refinement:
  classic bisection on [dfa, dfb] until |dfa-dfb| < 1e-5 or 100 iterations
  evaluate final point → return BisectionResult

Convergence check:
  converged = final_value.abs() < 0.1  (CONVERGENCE_THRESHOLD)
```

### `BisectionResult` struct (bisection.rs:51)

```rust
pub struct BisectionResult {
    pub df: f64,            // Found Df (0.0 if not found)
    pub kf: f64,            // Prefactor at solution
    pub iterations: usize,  // Iterations performed
    pub function_value: f64,// Final residual (≈0 for good solution)
    pub converged: bool,    // function_value.abs() < 0.1
}
```

---

## 2. Current Failure Handling — What's Discarded

### At `bisection.rs` level

The solver ALREADY computes and returns: `iterations`, `function_value` (residual), `kf`, `df`. Even on failure (`converged = false`), these hold the best-guess values. **Nothing is discarded at this level.**

### At `granulated_2012.rs:296` level

```rust
if result.df == 0.0 || !result.converged || result.kf <= 0.0 {
    break; // Try next initial estimate — DISCARDS result.{function_value, iterations, kf, df}
}
```

The outer loop tries multiple `npo_initial` estimates. If ALL fail, the function returns (line 324-338):

```rust
FraktalResult {
    status: if df_result == 0.0 { FraktalStatus::DfOutOfRange } else { FraktalStatus::NoConvergence },
    ..Default::default()  // df=0.0, kf=0.0, iterations=NOT surfaced
}
```

**Discarded information on failure:**
- `BisectionResult.function_value` (best residual achieved)
- `BisectionResult.iterations` (convergence progress)
- `BisectionResult.df` (best Df estimate, even if not converged)
- `BisectionResult.kf` (kf at that point — may be negative)
- Whether failure was "no sign change" vs "golden section minimum > threshold"

### At `batch.rs:323` level

```rust
ref status => BatchImageResult {
    fractal_dimension: None, prefactor: None, rg_nm: None,
    error: Some(status.message()),  // Just the string "Bisection method failed to converge"
}
```

**All diagnostic data is lost** — only the human-readable error message propagates.

### At frontend level

`FraktalBatchImageDetail.tsx:365-406`: When `data.error` is truthy, shows a red "Analysis Error" card with the raw error text + basic diagnostic info (dpo_used, azimuth, elevation, px/100nm). No failure categorization, no residual, no partial results.

---

## 3. Mapping to 3 Error Categories

### `no_sign_change`

**Detection point:** `bisection.rs:132` — the variable `found_bracket` is false at end of Phase 1.

```rust
if !found_bracket {
    return self.fallback_optimization(...);  // ← enters golden section
}
```

The golden section can ALSO fail to converge (`fun_value.abs() >= 0.1`). When `found_bracket = false` AND golden section's minimum > threshold → this is a **no_sign_change** failure.

**Meaning:** The FRAKTAL equation has no zero crossing in [1.0, 3.0]. The projection geometry is physically incompatible with the model at this viewing angle.

**Where to detect cleanly:** Modify `BisectionSolver::solve` to return a richer result enum that distinguishes "no bracket found, best from optimization" vs "bracket found, refinement converged/didn't converge".

### `kf_negative`

**Detection point:** `granulated_2012.rs:296`:

```rust
if result.df == 0.0 || !result.converged || result.kf <= 0.0 {
    break;
}
```

The `result.kf <= 0.0` check explicitly catches this. Additionally, lines 279-290 pre-compute where `kf` is positive and restrict the search range accordingly.

**Is kf_negative possible?** YES. The kf polynomial (`akf*Df² + bkf*Df + ckf`) is a parabola that can and DOES go negative in the Df range ~1.3-1.8 (confirmed by the comment at line 275: "The kf polynomial often goes negative in the middle"). The search range is restricted to where kf > 0 (typically Df > 1.85), but if the bisection converges to a point where the polynomial dips, or if the polynomial is negative across the entire range for certain npo/delta combinations, kf_negative occurs.

**Where to detect cleanly:** Already detected at `granulated_2012.rs:296`. Need to surface the `result.kf` value when it triggers.

### `iteration_limit`

**Detection point:** `bisection.rs:141` — the while loop condition `iterations < self.max_iterations` (100).

Currently, if max iterations hit, the loop exits normally and `converged` is checked via `function_value.abs() < CONVERGENCE_THRESHOLD`. So `iteration_limit` is actually conflated with "converged but residual too large". 

In practice, with tolerance 1e-5 and 100 iterations, bisection always converges in ~17 iterations (log2(2.0/1e-5) ≈ 17.6). The iteration limit is effectively unreachable for the pure bisection path. It CAN be reached in `fallback_optimization` with a very flat objective.

**Where to detect cleanly:** Compare `iterations == max_iterations` in the return path. If true AND `!converged` → iteration_limit. This is the RAREST category.

---

## 4. Quality Score Heuristic — Residual Scale Analysis

### Successful convergence

For successful images, `BisectionResult.function_value` (the residual) is typically < 0.1 (the `CONVERGENCE_THRESHOLD`). The equation being solved is:

```
f(Df) = kf × (dp/dpo)^Df − (Ap/Apo)^zp
```

Both sides have magnitude O(1) to O(100) depending on npo (kf is typically 1-8, and `(dp/dpo)^Df` is typically 10-1000 for large aggregates). The residual is an ABSOLUTE difference of these terms.

### Scale interpretation

- `|residual| < 0.1` → **converged** (current threshold, conservative)
- `|residual| ∈ [0.1, 1.0]` → **approximate**: Df is close but not exact. The function was NEAR zero. The aggregate projection is borderline for the model.
- `|residual| ∈ [1.0, 5.0]` → **poor**: Best-effort Df but significant mismatch. The equation is not solvable at this geometry but the minimum was found.
- `|residual| > 5.0` → **excluded**: The function is far from zero everywhere. Geometry is incompatible.

### Proposed thresholds

| Residual | Category | Badge | Df usable? |
|----------|----------|-------|-----------|
| < 0.1 | converged | 🟢 Green | Yes (exact) |
| 0.1 – 1.0 | approximate | 🟡 Yellow | Yes (with warning) |
| > 1.0 | excluded | ⚪ Gray | No |
| — (kf<0) | failed | 🔴 Red | No |

**Note:** The `1.0` threshold for approximate→excluded is a PROPOSAL. The user should validate empirically with the ~30 failing images: compute their best residuals and see the distribution. If most cluster around 0.5-2.0, the threshold of 1.0 splits them nicely.

### MATLAB precedent

The MATLAB code (`buscafractal2012.m:93`) stores `fun_aprox` — the residual from the golden-section fallback. It returns the Df without any error. MATLAB never rejects an approximate result. This supports the "approximate" UX: if the residual is small, the Df IS usable.

---

## 5. DB Migration Plan

### New fields on `FraktalBatchImage`

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `failure_reason` | CharField(32), null=True | NULL | `no_sign_change`, `kf_negative`, `iteration_limit`, NULL if success |
| `bisection_iterations` | IntegerField, null=True | NULL | Iterations performed (always populated) |
| `bisection_residual` | FloatField, null=True | NULL | Best |f(Df)| achieved |
| `df_estimate` | FloatField, null=True | NULL | Best Df even when not converged |
| `quality_score` | CharField(16), null=True | NULL | `converged`, `approximate`, `excluded`, `failed` |

### Migration approach

- ALL fields are `null=True, blank=True` → zero-impact on existing rows (legacy rows will have NULL for all new fields).
- No backfill needed — new fields populate only for new analyses.
- Existing `error` TextField remains (backward compatible), but `failure_reason` + `quality_score` provide structured access.
- Migration is additive (no column removal, no NOT NULL constraints).

### Data flow

```
Engine (BisectionResult) → PyO3 binding (new fields in dict) → Django service → FraktalBatchImage
```

The PyO3 binding (`python/src/lib.rs:1492-1499`) needs to expose the new fields. The batch result dict gains: `failure_reason`, `bisection_iterations`, `bisection_residual`, `df_estimate`, `quality_score`.

---

## 6. Frontend Rendering Plan

### Components affected

| Component | Change |
|-----------|--------|
| `FraktalBatchImageDetail.tsx` | Replace single error card with categorized badge + diagnostic panel |
| `FraktalBatchResultsView.tsx` | Add quality badge column (colored dot), tooltip with category |
| `FraktalBatchDistributions.tsx` | Include "approximate" images in histogram (with separate color/series) |
| `lib/api.ts` (types) | Extend `FraktalBatchImageDetail` + `FraktalBatchImageResult` interfaces |

### Badge rendering (all views)

```
🟢 Converged — standard row, full metrics
🟡 Approximate — yellow badge, show df_estimate + residual, include in histogram (separate series)
⚪ Excluded — gray badge, show failure_reason, exclude from stats
🔴 Failed — red badge (kf_negative or other hard error), exclude from stats
```

### Current error UX (for reference)

- `FraktalBatchResultsView`: Row title attribute with `img.error` text. Generic "Some images failed to analyze" alert at bottom.
- `FraktalBatchImageDetail`: Red "Analysis Error" card with error text + dpo/angles diagnostic panel.
- `FraktalBatchDistributions`: Failed images are implicitly excluded (their `fractal_dimension` is null, so `extract()` returns null → filtered out).

---

## 7. Open Questions for User

1. **Approximate threshold (residual 0.1–1.0 vs other range)?** The proposed 1.0 boundary between approximate/excluded needs empirical validation. Suggestion: re-run the ~30 failing images with a modified engine that surfaces residuals, then plot the distribution to find the natural split.

2. **Should approximate Df values be included in batch mean/std?** If yes, they shift statistics. If no, the batch summary only reflects "converged" images (same as today). Proposed: include in histogram (yellow series) but EXCLUDE from summary statistics by default, with a toggle.

3. **CSV export: include df_estimate for approximate/excluded rows?** Currently exported columns: `fractal_dimension` (null on failure). Should the CSV add `df_estimate`, `quality_score`, `failure_reason`, `bisection_residual` columns?

4. **Should the engine ALSO expand the search range to [1.0, 3.0]?** The prior exploration (PYA-9) noted MATLAB searches the full range. Expanding it could convert some "no_sign_change" failures into "approximate" successes with kf > 0 solutions in the lower Df region. This is algorithmic work (borderline for this UX cycle). Decision: do it here or defer to a separate issue?

5. **Histogram behavior for the "approximate" category.** Show as: (a) separate colored bars in same chart, (b) dashed overlay, or (c) toggled on/off? The current chart uses Plotly — all options are technically feasible.
