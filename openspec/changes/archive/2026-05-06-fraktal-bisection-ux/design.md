# Design: Fraktal Bisection UX (Cycle 12 / PYA-13)

## Technical Approach

Surface already-computed bisection diagnostic data from the engine discard point (`granulated_2012.rs:296`), classify quality via residual thresholds, propagate through all layers (binding → DB → API → CSV → frontend). No algorithmic changes — pure UX/categorization.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|----------|--------|----------------------|-----------|
| Where quality lives | Engine-side classification in `granulated_2012.rs` wrapper | Backend-side classification from raw residual | Engine has full context (bracket_found, kf sign); avoids leaking algorithm internals |
| BisectionResult changes | Add `bracket_found: bool` field | Wrap in new enum variant | Minimal change; solver remains generic; granulated wrapper derives failure_reason |
| Approximate threshold | `EXCLUDED_RESIDUAL_THRESHOLD = 1.0` as `const` | Config file, DB setting | Simpler; constant is greppable; tunable via code change post-deploy |
| Stats semantics | `mean_df` = converged only; `mean_df_inclusive` = converged + approximate | Single mean with toggle | Preserves backward compat for existing consumers; explicit naming |
| CSV column placement | Appended at end of row | Inserted after error column | Won't break existing parsers that index by position |

## Data Flow

```
Engine (BisectionSolver)
  │ returns BisectionResult { df, kf, iterations, function_value, converged, bracket_found }
  ▼
granulated_2012.rs wrapper
  │ classifies → AnalysisQuality + FailureReason
  │ surfaces on FraktalResult { ..existing, bisection_iterations, bisection_residual, failure_reason, df_estimate, quality }
  ▼
batch.rs
  │ maps FraktalResult → BatchImageResult (gains 5 Optional fields)
  ▼
python/src/lib.rs (PyO3 binding)
  │ exposes 5 new keys in result dict
  ▼
Django service (persist_batch_results)
  │ stores on FraktalBatchImage (5 nullable cols)
  ▼
API views
  │ detail: 5 fields per image
  │ batch summary: n_converged/n_approximate/n_excluded/n_failed + mean_df_inclusive
  ▼
CSV export
  │ 5 new columns appended
  ▼
Frontend
  │ QualityBadge component (shared)
  │ Drill-down: category-specific error card
  │ Results table: badge column
  │ Distributions: yellow overlay for approximate
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `aglogen_core/engine/src/fractal/fraktal/bisection.rs` | Modify | Add `bracket_found: bool` to `BisectionResult`; set in both `solve` (true) and `fallback_optimization` (false) |
| `aglogen_core/engine/src/fractal/fraktal/result.rs` | Modify | Add 5 diagnostic fields to `FraktalResult` + `AnalysisQuality` and `FailureReason` enums |
| `aglogen_core/engine/src/fractal/fraktal/granulated_2012.rs` | Modify | Replace discard at L296 with quality classification; surface diagnostic fields on both success and failure paths |
| `aglogen_core/engine/src/fractal/fraktal/batch.rs` | Modify | Add 5 `Option` fields to `BatchImageResult`; populate from `FraktalResult` on both success/failure |
| `aglogen_core/engine/tests/` | Create | `test_bisection_quality.rs` — synthetic objectives for all 4 quality states |
| `aglogen_core/python/src/lib.rs` | Modify | Expose 5 new keys in per-image result dicts (L1491-1500 and L1625-1632) |
| `backend/apps/fractal_analysis/models.py` | Modify | Add 5 nullable fields to `FraktalBatchImage` |
| `backend/apps/fractal_analysis/migrations/0011_add_bisection_diagnostic_fields.py` | Create | Additive nullable migration |
| `backend/apps/fractal_analysis/services/batch.py` | Modify | Extract + persist 5 new fields from engine result dict |
| `backend/apps/fractal_analysis/views.py` | Modify | Batch detail: aggregate counters + mean_df_inclusive; drill-down: include 5 fields |
| `backend/apps/fractal_analysis/services/csv_export.py` | Modify | Append 5 columns to `BATCH_IMAGE_COLUMNS` + `SINGLE_IMAGE_COLUMNS`; include in rows |
| `frontend/src/lib/api.ts` | Modify | Extend `FraktalBatchImageDetail` interface + batch summary types |
| `frontend/src/components/fraktal/QualityBadge.tsx` | Create | Shared badge component (4 states: green/yellow/gray/red) |
| `frontend/src/components/fraktal/FraktalBatchImageDetail.tsx` | Modify | Category-specific error cards per failure_reason + quality |
| `frontend/src/components/fraktal/FraktalBatchResultsView.tsx` | Modify | Add sortable "Quality" badge column |
| `frontend/src/components/fraktal/FraktalBatchDistributions.tsx` | Modify | Yellow overlay traces for approximate; dual mean display |

## Quality Classification Heuristic

```rust
const CONVERGENCE_THRESHOLD: f64 = 0.1;      // existing
const EXCLUDED_RESIDUAL_THRESHOLD: f64 = 1.0; // new, configurable

fn classify(result: &BisectionResult, failure: Option<&FailureReason>) -> AnalysisQuality {
    match failure {
        Some(FailureReason::KfNegative) => AnalysisQuality::Failed,
        _ => {
            let r = result.function_value.abs();
            if r < CONVERGENCE_THRESHOLD { AnalysisQuality::Converged }
            else if r <= EXCLUDED_RESIDUAL_THRESHOLD { AnalysisQuality::Approximate }
            else { AnalysisQuality::Excluded }
        }
    }
}
```

Threshold rationale: residual scale is O(1–100) for the FRAKTAL equation. Values < 0.1 are exact solutions. The 0.1–1.0 range indicates the function was near zero (borderline geometry). Above 1.0, the equation has no viable solution at this viewing angle. MATLAB's `buscafractal2012.m` never rejects approximate results, supporting the "usable with warning" interpretation.

## failure_reason Detection Table

| Condition at `granulated_2012.rs` | failure_reason | quality |
|-----------------------------------|----------------|---------|
| `!result.bracket_found` AND `!result.converged` | `no_sign_change` | Excluded (residual-based) |
| `result.kf <= 0.0` | `kf_negative` | Failed (always) |
| `result.iterations == max_iterations` AND `!result.converged` | `iteration_limit` | Approximate or Excluded (residual-based) |
| None of above, `result.converged` | None | Converged |
| None of above, `!result.converged`, residual ≤ 1.0 | None | Approximate |

Priority: `kf_negative` > `no_sign_change` > `iteration_limit` (checked in order).

## Backwards Compatibility Matrix

| Layer | Legacy behavior | New behavior | Breaking? |
|-------|----------------|--------------|-----------|
| Engine `BisectionResult` | 5 fields | +1 (`bracket_found`) | No — additive |
| Engine `FraktalResult` | existing fields | +5 diagnostic `Option` fields | No — all Optional |
| Engine `BatchImageResult` | 8 fields | +5 `Option` fields (None for legacy callers) | No |
| Python binding dict | core keys | +5 keys | No — additive dict |
| DB `FraktalBatchImage` | existing cols | +5 nullable cols (NULL for old rows) | No |
| API response | existing shape | +5 fields per image, +4 counters on batch | No — additive JSON |
| CSV | N columns | N+5 columns appended at end | No — parsers ignore trailing |
| Frontend | error string or success | quality badge + category card | No — graceful fallback for NULL |

## Migration Strategy

- Migration `0011`: additive nullable fields, no data backfill
- Reversible: `RemoveField` operations in reverse migration
- Legacy rows: Python service returns `quality="converged"` when field is NULL (optimistic default)
- Engine API: new `Option` fields default to `None`; callers that don't use them unaffected

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Engine unit | 4 quality states from synthetic objectives | Known residuals → assert classification |
| Engine unit | `bracket_found` flag correctness | Objective with/without zero crossing |
| Engine unit | failure_reason derivation (3 categories) | Craft objectives triggering each path |
| Engine regression | Existing tests still pass at threshold 0.1 | `cargo test` green |
| Python binding | Result dict has 5 new keys with correct types | Unit test with mock engine call |
| Backend migration | Additive, reversible | `uv run manage.py migrate --check` |
| Backend persistence | Each quality state stored correctly | pytest with mocked engine results |
| Backend stats | `mean_df` vs `mean_df_inclusive` over mixed batch | Assert different values |
| Backend CSV | 5 new columns; locale-aware formatting | byte-equivalence test |
| Frontend badge | 4 colors rendered per quality state | vitest + testing-library |
| Frontend drill-down | Category-specific cards (3 failure + approximate) | vitest |
| Frontend distributions | Yellow overlay traces; dual mean display | vitest |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Threshold 1.0 needs tuning post-deploy | Medium | Configurable constant; monitor distribution |
| Frontend complexity (4 states × 3 components) | Low | Shared `QualityBadge` component |
| CSV column order breaks parsers | Low | Appended only; documented in CHANGELOG |

## Open Questions

None — all decisions locked from exploration + proposal phase.
