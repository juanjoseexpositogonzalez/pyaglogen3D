# Smoke Test Plan: pya-14-phase3-df-convergence

## Pre-conditions

- Deploy backend + engine (maturin rebuild required — same as previous PYA-14 phases)
- No DB migration needed (engine output goes into existing JSONField `metrics`)
- Ensure `CC_TUNABLE_USE_PHASE3_ALGORITHM` is NOT set (defaults to `true`)

---

## Step 1: Validation run (default target)

**Action**: Run 5 simulations with:
- `algorithm=tunable_cc`, `target_df=1.7`, `target_kf=1.3`, `n_particles=350`, `seed_type=dimers`
- Use 5 different seeds (1–5)

**Method**: Via API `POST /api/v1/projects/{pk}/simulations/` or via UI "New Simulation" form.

**Expected**:
- All 5 simulations complete successfully (`status=completed`)
- Each simulation's `metrics.fractal_dimension` is within ±10% of 1.7 (i.e., between 1.53 and 1.87)
- GREEN verdict: all 5 pass

**Previous behaviour**: Df≈1.98 (+16.4% bias) — would FAIL this check.

---

## Step 2: Parametric sweep via UI

**Action**: Create simulations with the following targets (kf=1.3, N=350, seed_type=dimers):

| Df target | Tolerance | Expected range |
|-----------|-----------|----------------|
| 1.4       | ±10%      | 1.26 – 1.54    |
| 1.7       | ±10%      | 1.53 – 1.87    |
| 2.0       | ±5%       | 1.90 – 2.10    |

**Expected**: Each simulation's `metrics.fractal_dimension` falls within the expected range.

---

## Step 3: Rollback test

**Action**:
1. In Easypanel (or deployment env), set environment variable: `CC_TUNABLE_USE_PHASE3_ALGORITHM=false`
2. Restart the backend container (no engine rebuild needed — flag is read at simulation init)
3. Re-run a simulation with `target_df=1.7`, `kf=1.3`, `N=350`, `dimers`

**Expected**:
- Simulation completes, but `metrics.fractal_dimension` ≈ 1.98 (the old biased value)
- This validates the rollback works — the Phase 2 code path is still intact

**Cleanup**: Remove the env var (or set `CC_TUNABLE_USE_PHASE3_ALGORITHM=true`) and restart.

---

## Step 4: merge_trace inspection

**Action**: For one completed simulation from Step 1, fetch the full detail:
```
GET /api/v1/projects/{pk}/simulations/{sim_id}/
```

Inspect `metrics.merge_trace` entries.

**Expected**:
- `merge_type` distribution:
  - `"tunable"`: majority (~80%+ of entries)
  - `"adaptive"`: some entries (replacing previous `"ballistic"` for geometrically tight merges)
  - `"ballistic"`: rare or zero (only when march-inward fails)
- Adaptive entries have `overshoot_pct` field (float, typically small positive %)
- No entries with `merge_type` values outside `{"tunable", "adaptive", "ballistic"}`

---

## Verdict Checklist

| # | Check | Pass? |
|---|-------|-------|
| 1 | All 5 default sims (Df=1.7) have Df_measured within ±10% | ☐ |
| 2 | Parametric sweep: Df=1.4 within ±10% | ☐ |
| 3 | Parametric sweep: Df=1.7 within ±10% | ☐ |
| 4 | Parametric sweep: Df=2.0 within ±5% | ☐ |
| 5 | Rollback: flag=false produces biased Df≈1.98 | ☐ |
| 6 | Rollback: flag=true (or unset) restores convergence | ☐ |
| 7 | merge_trace contains "adaptive" entries | ☐ |
| 8 | merge_trace adaptive entries have overshoot_pct field | ☐ |
| 9 | No unknown merge_type values in trace | ☐ |

**Overall**: PASS if all 9 checks are ☑. Any failure → investigate before production release.
