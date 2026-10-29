# Post-Frente 12 — Results Endpoint 500 Diagnosis

**Date**: 2026-05-06
**Endpoint**: `GET /api/v1/fraktal-status/{job_id}/results/`
**Batch**: `710613c7-0427-4d30-9267-c18b4d6302fd`
**Status**: READ-ONLY diagnosis (no code changes)

## Hypothesis Ranking (by likelihood)

### 1. H1 — `build_comparison_data` crash with `None` mean_df → **RULED OUT**

`build_comparison_data(sim_id, batch_mean_df, batch_std_df)` at line 906 accepts
`batch_mean_df: float | None` and simply passes it through to the response dict
(lines 268, 280). No arithmetic on it. For external FRAKTAL batches, `sim_id=None`
→ returns `None` immediately (line 253). **Cannot crash.**

### 2. H2 — `compute_metric_stats` over `images_out` → **RULED OUT**

`compute_metric_stats(images, key)` at line 350 uses `img.get(key) is not None` as
guard. All keys (`prefactor`, `rg_nm`, `n_particles_counted`) exist in every
`images_out` dict. None-valued entries are filtered. Empty list → returns
`null_result`. **Cannot crash.**

### 3. H4 — `compute_histogram(df_values)` with empty list → **RULED OUT**

Line 392 filters `None` and non-finite. `n < 5` → returns `None`. **Cannot crash.**

### 4. H5 — Migration / DB state mismatch → **RULED OUT**

Migration 0011 adds `quality` with `default="converged"` (column-level default).
All pre-existing rows get `"converged"`. New fields are nullable. **No mismatch.**

### 5. H6 — `std_df` + comparison mismatch → **RULED OUT**

`build_comparison_data` passes `batch_std_df` through without computation.
**Cannot crash.**

### 6. H3 — Frontend type-strict parse → **RULED OUT (server-side 500)**

### 7. 🔴 MOST LIKELY: Undiagnosed crash — traceback required

Every code path in `_serialize_batch_from_db` (lines 839-927) has been traced
line-by-line. All None guards are present. All numpy operations are wrapped in
`float()`. All model fields exist. JSON serialization of the response dict should
succeed for all Python-native types returned.

**Possible remaining causes (ranked by plausibility):**

1. **Celery result backend deserialization error**: `_resolve_batch_id_from_celery`
   catches all exceptions (line 834) and returns `None` → falls through to legacy
   JSON path → 404, not 500. Unless Redis connection fails AFTER returning a
   partial result. Low probability.

2. **DB connection drop mid-serialization**: The function makes 7+ DB queries
   (initial queryset + 4 quality counts + 2 values_list). A connection pool
   exhaustion or transient PG error during any of these would raise
   `OperationalError` → unhandled → 500. **Plausible in prod under load.**

3. **`np.mean` on unexpected type from `values_list`**: If `psycopg3` returns
   `Decimal` instead of `float` for a `FloatField` under certain PG configs,
   `float(np.mean([Decimal(...)]))` would work but the raw `Decimal` values
   might leak elsewhere. Unlikely — Django's FloatField adapter guarantees float.

4. **Race condition**: Frontend polls `/status/` → gets `done` → fetches
   `/results/`. If the worker hasn't finished `persist_batch_results` yet
   (batch exists but `batch.save(update_fields=...)` hasn't run), `batch.n_images`
   is 0, `batch.mean_df` is None, etc. This wouldn't crash, but confirms the
   500 is from something else.

## Exact Crash Line

**Cannot be determined without the server traceback.** All code paths in
`_serialize_batch_from_db` appear guarded for None, empty lists, and edge cases.

## Recommended Fix Scope

1. **Get the traceback** — this is the highest-priority action. Check:
   - Django's stdout/stderr logs (docker logs or journal)
   - Gunicorn/uvicorn error output
   - Any structured logging at `ERROR` level

2. **Defensive wrapper**: Add a try/except around `_serialize_batch_from_db`'s
   body that logs the full traceback and returns a structured 500:

   ```python
   except Exception:
       logger.exception("_serialize_batch_from_db crashed for batch %s", batch_id)
       raise
   ```

3. **If traceback is truly unavailable**, the safest hotfix is wrapping the
   entire function body in try/except with detailed logging, redeploying, and
   reproducing with the same batch UUID.

## Test That Should Be Added

```python
def test_results_endpoint_with_bisection_fields(self):
    """POST-frente-12: results endpoint includes quality, bisection_iterations,
    bisection_residual, failure_reason, df_estimate, and quality counters."""
    # Create batch with mixed quality images (converged + approximate + failed)
    # Verify 200 response with all new fields present
    # Verify n_converged, n_approximate, n_excluded, n_failed in stats
    # Verify mean_df is converged-only, mean_df_inclusive present
```

The existing test `test_fraktal_results_endpoint.py` only creates images with
the OLD field set (no bisection fields). No test exercises the endpoint with
frente-12 field shapes.

## Open Questions

1. **Do we have access to the actual server traceback?** Without it, this entire
   diagnosis is elimination-by-code-reading. The traceback would instantly
   identify the crash line.
2. **Is the 500 reproducible?** Hit the same endpoint again — still 500?
3. **Is it batch-specific?** Try `/results/` for a different batch UUID.
4. **Was the Celery worker restarted during deploy?** If the worker processed
   this batch with pre-frente-12 code while web served post-frente-12 code,
   data shape mismatches are possible.
