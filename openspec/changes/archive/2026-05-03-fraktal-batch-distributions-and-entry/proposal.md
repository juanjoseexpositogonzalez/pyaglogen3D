# Proposal: Batch Distributions & Simulation Entry Point

## Intent

Four gaps in the FRAKTAL batch UX:
1. **"Analyze projections" button missing** — Path A (sim-origin) was wired in frente 8 P5 but is unreachable: no button on the simulation detail page navigates to the batch upload with `?origin=simulation&sim_id=X`.
2. **Df histogram is ephemeral** — the distribution rendered inline after upload disappears when navigating to the persisted batch summary route (`FraktalBatchSummaryPage`).
3. **No distributions for kf, Rg, npo** — only Df histogram exists; scientists need all four metrics to characterize a batch.
4. **No Rg column in results table** — `FraktalBatchResultsView` lists Df, kf, npo, prefactor but omits Rg (radius of gyration), a key metric. Backend batch detail endpoint also omits Rg per image because `FraktalBatchImage` model lacks the field.

## Scope

### In Scope

- Frontend: "Analyze projections" button on simulation detail page
- Frontend: upload page reads query params (`origin`, `sim_id`) and passes as props to `FraktalBatchUpload`
- Frontend: new reusable `FraktalBatchDistributions` component (4 histograms: Df, kf, Rg, npo via Plotly)
- Frontend: integrate distributions into `FraktalBatchSummaryPage` (persisted view)
- Frontend: Rg column in `FraktalBatchResultsView` (scientific notation format)
- Backend: add `rg` field to `FraktalBatchImage` model + additive migration
- Backend: populate `rg` per image during batch task + include in detail/list responses
- Backend: compute batch-level Rg stats (mean, std, median) in summary
- Tests per layer + cross-cutting integration

### Out of Scope

- PYA-13 (bisection UX) — separate cycle
- PYA-10 + PYA-11 (CC tunable algorithm) — separate cycle
- Tooltips explaining each distribution — backlog
- Distributions for single-image `FraktalAnalysis` — batches only
- Comparison overlay between multiple batches — separate feature

## Capabilities

### New Capabilities

- `fraktal-batch-distributions`: which metrics get histograms, bucket algorithm (Sturges' rule for all four), failed-image exclusion, minimum N thresholds

### Modified Capabilities

- `fraktal-batch-persistence`: R-DELTA — `FraktalBatchImage` gains `rg` float field (nullable); detail & list responses include `rg` per image; `FraktalBatch` gains batch-level Rg stats
- `fraktal-batch-contract`: R-DELTA — simulation detail page gains "Analyze projections" button navigating to batch upload with query params; upload page propagates `origin` + `sim_id` as component props

## Approach

6 phases, bottom-up (backend data first → reusable component → integration → table → entry point):

| Phase | Description | Depends on |
|-------|-------------|------------|
| P1 | Backend: `rg` field on `FraktalBatchImage` + migration + populate in batch task + include in responses + batch-level Rg stats + pytest | — |
| P2 | Frontend: `FraktalBatchDistributions` reusable component (4 histograms, Plotly, Sturges' rule, failed exclusion) + vitest | — |
| P3 | Frontend: integrate distributions into `FraktalBatchSummaryPage` + vitest | P2 |
| P4 | Frontend: Rg column in `FraktalBatchResultsView` (scientific notation) + vitest | P1 |
| P5 | Frontend: "Analyze projections" button on sim detail + upload page query param propagation + vitest | — |
| P6 | Cross-cutting integration tests + CHANGELOG | P1-P5 |

P1, P2, P5 are independent (parallelizable).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/apps/fractal_analysis/models.py` | Modified | `FraktalBatchImage.rg` + `FraktalBatch` Rg stats fields |
| `backend/apps/fractal_analysis/migrations/` | New | Additive migration for `rg` field |
| `backend/apps/fractal_analysis/views.py` | Modified | Include `rg` in detail/list responses; batch Rg stats |
| `backend/apps/fractal_analysis/services/batch.py` | Modified | Compute batch-level Rg stats; histogram for kf/Rg/npo |
| `backend/apps/fractal_analysis/tasks.py` | Modified | Persist `rg` per image from engine result |
| `frontend/src/components/fraktal/FraktalBatchDistributions.tsx` | New | 4-histogram reusable component |
| `frontend/src/components/fraktal/FraktalBatchSummaryPage.tsx` | Modified | Mount distributions component |
| `frontend/src/components/fraktal/FraktalBatchResultsView.tsx` | Modified | Add Rg column |
| `frontend/src/app/projects/[id]/simulations/[simId]/page.tsx` | Modified | "Analyze projections" button |
| `frontend/src/app/projects/[id]/fraktal/batch/page.tsx` | Modified | Read query params, pass as props |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Plotly bundle size increase | None | Already in `package.json` — no new dependency |
| Buckets for small N (<5) | Low | Histograms omitted when `n_successful < 5` (existing R8 pattern) |
| Rg units (nm vs engine) | Low | Verify in P1 that engine returns nm; add unit test |
| `FraktalBatchSummaryPage` layout refactor for 4 histograms | Medium | May need grid layout change; flagged for P3 |
| Existing batch rows lack `rg` | High (all data) | Nullable field; NULL renders as "—" in table |

## Rollback Plan

1. Migration is additive (nullable `rg` column) — reverse migration drops it safely.
2. `FraktalBatchDistributions` is a new component — remove import from summary page.
3. Rg column: remove from table columns array.
4. "Analyze projections" button: remove from sim detail page.
5. All changes are additive — rollback safe at any phase boundary.

## Dependencies

- None external. All changes within pyaglogen3D monorepo.

## Success Criteria

- [ ] "Analyze projections" button navigates to batch upload with correct query params
- [ ] Upload page passes `origin` + `sim_id` to `FraktalBatchUpload` component
- [ ] Batch summary page shows 4 persistent histograms (Df, kf, Rg, npo)
- [ ] Histograms use Sturges' rule; omitted when `n_successful < 5`
- [ ] Failed images excluded from distributions with separate count shown
- [ ] Rg column visible in results table with scientific notation
- [ ] Backend returns `rg` per image in batch detail + drill-down responses
- [ ] All test suites green: `uv run pytest`, `npm test`
