# Proposal: Fraktal Bisection UX (Cycle 12 / PYA-13)

## Intent

Today any image where bisection doesn't converge gets a generic "Bisection method failed to converge" error. User can't distinguish 3 different causes (no sign change = physical limitation, kf negative = invalid solution, iteration limit = recoverable approximate). In a real batch (~30/31 images fail), there's no way to know which are usable as approximate results vs truly excluded.

The exploration confirmed all diagnostic data (residual, iterations, df estimate, kf) is ALREADY computed but discarded at `granulated_2012.rs:296`. This cycle is UX/categorization — surface what's already there + define visualization rules.

## Scope

### In Scope

- Engine: surface `BisectionResult` diagnostic fields up to `FraktalResult` struct (stop discarding at line 296)
- Engine: add `quality_score` classification heuristic with 3 categories (`converged`, `approximate`, `excluded`) + configurable residual threshold constant (start: 1.0)
- Engine: detect `failure_reason` cleanly at point of failure (`no_sign_change`, `kf_negative`, `iteration_limit`)
- Backend: migration adds 5 nullable fields to `FraktalBatchImage` (`quality`, `bisection_iterations`, `bisection_residual`, `failure_reason`, `df_estimate`)
- Backend: per-batch counters (`n_converged`, `n_approximate`, `n_excluded`, `n_failed`) in batch detail response
- Backend: stats block adds `mean_df_inclusive` (converged + approximate) alongside existing `mean_df` (converged only)
- Backend: CSV export adds 5 new columns (appended, backward-compatible)
- Frontend: drill-down detail card distinguishes 3 failure categories with specific labels/explanations
- Frontend: results table gains quality badge column (green=converged, yellow=approximate, gray=excluded, red=failed)
- Frontend: distribution histograms show approximate values in yellow overlay; legend explains; tooltip discriminates
- Tests: unit tests for category detection per engine layer; integration test with synthetic failing images

### Out of Scope

- Algorithmic improvements to bisection (search range expansion to [1.0, 3.0]) — backlog
- Changing the equation form of Granulated 2012 model
- Voxel 2018 algorithm changes (Granulated only; Voxel follow-up separate)
- PYA-14 (CC tunable Df<1.8 drift) — separate cycle
- F1+F2 (polidispersion dpo/kf) — separate backlog item

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `fraktal-batch-contract`: R-DELTA — drill-down response gains diagnostic fields (`bisection_iterations`, `bisection_residual`, `failure_reason`, `df_estimate`, `quality`); batch detail gains per-quality counters and `mean_df_inclusive`
- `fraktal-batch-persistence`: R-DELTA — 5 new nullable fields on `FraktalBatchImage`, migration `0010`
- `csv-export-locale`: R-DELTA — 5 new columns appended in single-image and batch CSV exports
- `fraktal-batch-distributions`: R-DELTA — histograms render approximate with yellow overlay; `mean_df` + `mean_df_inclusive` both shown in stats panel

## Approach

Bottom-up. Engine first (categorization lives algorithm-side), then Python binding plumbing, then backend persistence + endpoints, then CSV (orthogonal), then frontend UX, then integration + docs.

| Phase | Description | Depends on |
|-------|-------------|------------|
| P1 | Engine: surface BisectionResult fields + quality classification + `cargo test` with synthetic objective functions covering all 3 failure categories | — |
| P2 | Python binding: expose new fields in result dict + binding tests | P1 |
| P3 | Backend: migration + model fields + serializer + per-batch counters + stats `mean_df_inclusive` + pytest | P2 |
| P4 | Backend: CSV export with 5 new columns (single + batch) + pytest byte-equivalence | P3 |
| P5 | Frontend: drill-down error card + results table badge column + distributions yellow overlay + vitest | P3 |
| P6 | Integration tests + docs + CHANGELOG + Jira PYA-13 close | P1–P5 |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `aglogen_core/engine/src/fraktal/granulated_2012.rs` | Modified | Stop discarding BisectionResult at line 296; surface fields to FraktalResult |
| `aglogen_core/engine/src/fraktal/mod.rs` | Modified | FraktalResult struct gains diagnostic fields |
| `aglogen_core/engine/tests/` | New | Unit tests for 3 failure categories with synthetic objective functions |
| `aglogen_core/python/src/lib.rs` | Modified | PyO3 binding exposes new fields in result dict |
| `backend/apps/fractal_analysis/models.py` | Modified | FraktalBatchImage gains 5 nullable fields |
| `backend/apps/fractal_analysis/migrations/` | New | Migration `0010_add_bisection_diagnostic_fields.py` |
| `backend/apps/fractal_analysis/serializers.py` | Modified | Expose diagnostic fields + per-quality counters + mean_df_inclusive |
| `backend/apps/fractal_analysis/views.py` | Modified | CSV export adds 5 columns |
| `backend/apps/fractal_analysis/tests/` | Modified | pytest for counters, stats, CSV |
| `frontend/src/components/fraktal/` | Modified | Badge column, drill-down error card, distribution overlay |
| `frontend/src/components/fraktal/__tests__/` | New/Modified | vitest for badges, overlay, error categorization |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Residual threshold `1.0` is theoretical | Medium | Configurable constant; tunable post-deploy without code change |
| Migration touches FraktalBatchImage (many fields from prior frentes) | Low | Nullable defaults, additive only, no destructive changes; legacy rows → `quality: converged` (optimistic default) |
| Frontend complexity grows (many visual states) | Low | Consistent badge component reused across table + drill-down + distributions |
| CSV format change | Low | New columns appended (not inserted); backward-compatible with parsers ignoring unknown columns |

## Rollback Plan

1. Revert migration `0010` (drops only the 5 new nullable columns)
2. Revert engine: FraktalResult fields removed; line 296 discards again
3. Revert frontend: badge column + overlay removed
4. All changes additive — rollback at any phase boundary is safe; no data loss

## Dependencies

- Frentes 1–11 all archived (latest: `dd3f0a2`, 2026-05-05)
- No external dependencies; all diagnostic data already computed in engine

## Success Criteria

- [ ] Engine classifies synthetic images into all 3 categories correctly (`cargo test`)
- [ ] Batch detail response includes `n_converged`, `n_approximate`, `n_excluded`, `n_failed` counters
- [ ] `mean_df_inclusive` computed over converged + approximate; `mean_df` unchanged (converged only)
- [ ] CSV exports include 5 new columns; existing columns unchanged (`uv run pytest`)
- [ ] Frontend badge renders 4 colors correctly; distributions show yellow overlay for approximate
- [ ] Legacy batches (pre-migration) render without error; default `quality = converged`
- [ ] All test suites green: `cargo test`, `uv run pytest`, `npm test`
- [ ] Jira PYA-13 closed
