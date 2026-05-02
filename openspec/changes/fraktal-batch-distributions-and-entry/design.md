# Design: Batch Distributions & Simulation Entry Point

## Technical Approach

Bottom-up: add `rg_nm` to model + Rust batch binding → extend backend responses with per-metric aggregate stats → build reusable `FraktalBatchDistributions` component → integrate in summary page → add Rg column to table → wire sim→batch entry point with query params.

All four histogram distributions are computed **frontend-side** from the per-image data array already returned by `batch_detail_view`. Backend only adds `rg_nm` per image and per-metric aggregate stats to the response — no new histogram endpoints.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Rg source in batch | Add `rg` field to Rust `BatchImageResult` + PyO3 binding | Compute Rg from Df+kf+npo formula on backend | Engine already computes Rg in `FraktalResult` (line 48, result.rs) but batch wrapper discards it. Surfacing the real engine Rg is more accurate than back-calculating. |
| Histogram computation location | Frontend (in `FraktalBatchDistributions`) | Backend returns pre-binned histograms for all 4 metrics | Current single-Df histogram is backend-computed, but adding 3 more backend histograms bloats the response. Per-image data is already in the response; Sturges binning is trivial in JS. Existing backend `compute_histogram` stays for backward compat of `histogram` field. |
| Aggregate stats location | Backend `batch_detail_view` response | Frontend-only computation | Backend is authoritative for stats; avoids inconsistency between summary card and histograms. Cheap: N≤500, 4 metrics × 5 aggregates = 20 values. |
| Upload page route | Reuse existing `/projects/{id}/fraktal/batch/page.tsx` with `useSearchParams()` | Create new `/projects/{id}/fraktal/batch/upload/page.tsx` | The existing page already composes `FraktalBatchUpload`; adding query param parsing there is simpler. No new route file needed. |
| Batch summary histograms | Client-side from `FraktalBatchResult.images` array | Server-rendered, cached | Keeps server stateless; N≤500 images is instant in JS; Plotly is already loaded (dynamic import, no SSR). |

## Data Flow

```
Sim Detail Page
    │ click "Analyze projections"
    ▼
Batch Upload Page (?origin=simulation&sim_id=X)
    │ useSearchParams() → pass props to FraktalBatchUpload
    ▼
FraktalBatchUpload (origin="simulation", simulation={...})
    │ POST /api/v1/fraktal/analyze-batch/
    ▼
Backend (views.py → Rust engine)
    │ analyze_fraktal_batch → BatchImageResult now includes rg
    ▼
_build_batch_response + persist_batch_results
    │ rg_nm stored per FraktalBatchImage row
    ▼
batch_detail_view (GET)
    │ returns images[].rg_nm + stats.{kf,rg,npo} aggregates
    ▼
FraktalBatchSummaryPage
    │ fetches batch detail
    ├─→ FraktalBatchDistributions (4 Plotly histograms)
    ├─→ FraktalBatchResultsView (table with Rg column)
    └─→ FraktalComparisonCard (unchanged)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `aglogen_core/engine/src/fractal/fraktal/batch.rs` | Modify | Add `rg_nm: Option<f64>` to `BatchImageResult`; populate from `FraktalResult.rg` on success, `None` on failure |
| `aglogen_core/python/src/lib.rs` | Modify | Expose `rg_nm` in per-image dict for both `analyze_fraktal_batch` and `analyze_fraktal_batch_per_image_scale` |
| `backend/apps/fractal_analysis/models.py` | Modify | Add `rg_nm = FloatField(null=True, blank=True)` to `FraktalBatchImage` |
| `backend/apps/fractal_analysis/migrations/` | Create | Additive migration: nullable `rg_nm` column |
| `backend/apps/fractal_analysis/views.py` | Modify | `_build_batch_response`: include `rg_nm` per image from Rust result. `batch_detail_view` + `_serialize_batch_from_db`: include `rg_nm` per image + per-metric aggregate stats in `stats`. `batch_image_detail_view`: include `rg_nm`. |
| `backend/apps/fractal_analysis/services/batch.py` | Modify | Add `compute_metric_stats(images, key)` helper; extend `compute_batch_statistics` to include kf/rg/npo aggregates alongside existing Df stats |
| `backend/apps/fractal_analysis/services/batch.py:persist_batch_results` | Modify | Store `rg_nm` per `FraktalBatchImage` row from per-image result dict |
| `frontend/src/lib/api.ts` | Modify | Add `rg_nm: number \| null` to `FraktalBatchImageResult` and `FraktalBatchImageDetail`. Extend `FraktalBatchStats` with `kf`, `rg`, `npo` sub-objects `{mean,std,median,min,max}` |
| `frontend/src/components/fraktal/FraktalBatchDistributions.tsx` | Create | Reusable 4-histogram component: Plotly bar charts, Sturges binning, responsive 2×2/stack layout |
| `frontend/src/components/fraktal/FraktalBatchSummaryPage.tsx` | Modify | Mount `FraktalBatchDistributions` between header and `FraktalBatchResultsView` |
| `frontend/src/components/fraktal/FraktalBatchResultsView.tsx` | Modify | Add Rg column (after Df, before kf); add `rg_nm` to `SortKey` union; format `"{value.toFixed(1)} nm"`, null → "—" |
| `frontend/src/app/projects/[id]/simulations/[simId]/page.tsx` | Modify | Add "Analyze projections" `Link` button in completed-state action bar. Visible when `status === 'completed'`. Href: `/projects/${id}/fraktal/batch?origin=simulation&sim_id=${simId}` |
| `frontend/src/app/projects/[id]/fraktal/batch/page.tsx` | Modify | Read `origin` + `sim_id` from `useSearchParams()`; when `origin=simulation` + valid `sim_id`, fetch sim via `simulationsApi.get()`, pass `origin` + `simulation` props to `FraktalBatchUpload`; loading/error states for sim fetch |

## Interfaces / Contracts

### Rust: `BatchImageResult` extension

```rust
pub struct BatchImageResult {
    // ... existing fields ...
    pub rg_nm: Option<f64>,  // NEW — radius of gyration in nm
}
```

### Backend: extended stats response shape

```python
# stats block in batch_detail_view response
{
    # ... existing Df fields unchanged ...
    "kf": {"mean": float|None, "std": float|None, "median": float|None, "min": float|None, "max": float|None},
    "rg": {"mean": float|None, "std": float|None, "median": float|None, "min": float|None, "max": float|None},
    "npo": {"mean": float|None, "std": float|None, "median": float|None, "min": float|None, "max": float|None},
}
```

### Frontend: `FraktalBatchDistributions` props

```typescript
interface FraktalBatchDistributionsProps {
  images: FraktalBatchImageResult[]
  totalImages: number
}
```

## Plotly Integration

Already in `package.json` as `react-plotly.js` (dynamic-imported, SSR-disabled at line 35 of `FraktalBatchResultsView.tsx`). The new `FraktalBatchDistributions` component reuses the same `dynamic(() => import('react-plotly.js'), { ssr: false })` pattern. No bundle size increase — Plotly is already loaded for the existing Df histogram. Four plots share one `Plot` import.

## Sturges' Rule

**Formula**: `k = clamp(ceil(log2(n) + 1), 3, 30)` where `n` = count of non-null values for that metric.

**Edge cases**:
- `n < 5`: histogram panel shows "Insufficient data (N images)" instead of chart (existing R8 threshold)
- `n = 1`: single bar at the one value; `k = clamp(ceil(1+1), 3, 30) = 3` buckets but range is 0 → degenerate single-bar
- All same value (`std = 0`): single bar, bin width 0 → render as single bar centered on the value
- `n ≥ 5` normal: Sturges k computed per metric independently

**Implementation**: utility function `computeSturgesBins(values: number[]): {edges: number[], counts: number[]}` in `FraktalBatchDistributions.tsx`.

## Backward Compat Matrix

| Scenario | Backend | Frontend | Behavior |
|----------|---------|----------|----------|
| Old batch (no `rg_nm` column) + new client | `rg_nm = NULL` per image; `stats.rg` all null | Rg histogram shows "No data" msg; Rg column shows "—" | Safe |
| Old batch + old client | No `rg_nm` in response | Client ignores unknown fields | Safe (additive) |
| New batch + old client | `rg_nm` present; `stats.kf/rg/npo` present | Old client reads only `stats.mean_df` etc. — new keys ignored | Safe (additive) |
| New batch + new client | Full data | All 4 histograms + Rg column | Full feature |

## Migration Strategy

**One additive migration**: `ALTER TABLE fraktal_batch_images ADD COLUMN rg_nm DOUBLE PRECISION NULL`. No backfill. Reverse drops the column.

**No Rust engine migration**: the engine already computes `rg` per image (in `FraktalResult`). The change is in the batch wrapper (`batch.rs`) — surface the existing `r.rg` into `BatchImageResult.rg_nm`.

**Unit confirmation**: engine's `FraktalResult.rg` is documented as "Radius of gyration in nm" (result.rs:47). Batch wrapper passes `escala = 100.0` (nm) so `rg` is already in nm. No unit conversion needed.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Rust unit | `BatchImageResult` includes `rg_nm` on success, `None` on failure | Extend existing `batch.rs` tests |
| Backend pytest | `_build_batch_response` includes `rg_nm` per image | Mock Rust result with `rg_nm` key |
| Backend pytest | `batch_detail_view` returns `rg_nm` per image + `stats.{kf,rg,npo}` | Call endpoint with DB fixture |
| Backend pytest | NULL handling for legacy `FraktalBatchImage` rows without `rg_nm` | Create row, assert `rg_nm: null` in response |
| Backend pytest | `persist_batch_results` stores `rg_nm` on `FraktalBatchImage` | Inspect DB after persist |
| Frontend vitest | `FraktalBatchDistributions` renders 4 histograms when data present | Render with mock `images[]`, assert 4 Plot elements |
| Frontend vitest | `FraktalBatchDistributions` handles empty/single-value/all-null per metric | Edge case props, assert correct messages |
| Frontend vitest | Sturges binning: correct bucket count for n=5,20,2000 | Unit test `computeSturgesBins()` |
| Frontend vitest | `FraktalBatchResultsView` Rg column present, NULL → "—" | Render, query for "Rg" header + "—" cells |
| Frontend vitest | Sim detail "Analyze projections" button: visible when completed, hidden when running | Render with different sim statuses |
| Frontend vitest | Batch page query param parsing: simulation origin, external fallback, malformed | Mock `useSearchParams`, assert props passed to `FraktalBatchUpload` |
| E2E | Sim → "Analyze projections" → batch upload → complete → summary shows 4 histograms | Playwright or manual |

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Rust `BatchImageResult` struct change breaks PyO3 binding | Medium | PyO3 `set_item("rg_nm", ...)` is additive; existing keys unchanged. CI builds Rust+Python. |
| Plotly 4-plot render perf on mobile | Low | Plotly is already loaded; 4 small bar charts ≤500 points each. Responsive layout via Tailwind `grid-cols-1 md:grid-cols-2`. |
| `FraktalBatchSummaryPage` layout shift | Low | Distributions component inserted between header and `FraktalBatchResultsView`; no restructuring of existing elements. |
| Rg unit mismatch (engine vs display) | None | Verified: `FraktalResult.rg` doc says "nm" (result.rs:47), `escala=100.0` nm in batch.rs. No conversion needed. |
| Existing batch rows lack `rg_nm` | Expected | Nullable field; all backward compat paths return null → "—" in UI. |

## Open Questions

None — all decisions locked in proposal and specs.
