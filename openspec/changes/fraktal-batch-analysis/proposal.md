# Proposal: fraktal-batch-analysis

## Intent

pyaglogen3D already emits projection ZIPs carrying a `metadata.json` with
`parameters.pixels_per_100nm` per commit a19a9e5. FRAKTAL, however, still
accepts a single image at a time and forces the user to either type the scale
manually or run auto-calibration every time. Automating the ZIP → batch
analysis flow closes the scientific loop end-to-end: simulate → export
projections → run FRAKTAL → obtain a Df distribution, without anyone touching a
calibration slider.

Batch mode unlocks the statistic a physicist actually wants: the distribution
(mean, std, per-view Df) of the fractal dimension across the N projections of
the same aggregate. Single-image mode cannot produce this. On top of that, once
we have a batch mean Df we can meaningfully compare it against the simulator's
own 3D box-counting Df and the user's `target_df`, with a short educational
note explaining the expected 2D-vs-3D gap (Sorensen 1992). See `explore.md` for
the full investigation.

## Scope

### In Scope

- Backend endpoint accepting a ZIP upload for batch FRAKTAL analysis.
- Auto-read `metadata.parameters.pixels_per_100nm` when the ZIP carries
  pyaglogen metadata; fall back to manual scale / autocalibrate dpo for legacy
  ZIPs and for the existing single-image flow.
- Per-image Df / kf / R² computation reusing the existing Rust analyzers
  (`analyze_granulated_2012`, `analyze_voxel_2018`) — **no changes** to those.
- One-shot dpo auto-calibration: run `estimate_particles_and_dpo` on
  `image[0]` only and reuse the resulting dpo across the whole batch.
  Reduces 4N Rust calls to N.
- Sync path for `N ≤ 30` images; Celery async path for `N > 30` with progress
  reporting, following the pattern used in `build_projections_zip_task`.
- Reuse `metadata.directions[].azimuth/elevation` as row labels in the results
  table when present.
- Frontend batch upload UX: drag-and-drop ZIP, mode indicator (auto-calibrate
  shown when metadata is found, manual inputs otherwise), progress bar for the
  async path.
- Results page: sortable table (filename, Az, El, Df, kf, R²), histogram of Df
  values, and a comparison card (FRAKTAL mean Df ± std, simulation
  `target_df`, simulation `metrics.fractal_dimension` (3D box-counting) when
  the ZIP originates from a pyaglogen simulation).
- Legacy single-image FRAKTAL UI and endpoint untouched — batch is purely
  additive.
- Tests: Rust batch orchestrator, backend endpoint (sync + async), frontend
  batch upload and results components.

### Out of Scope (explicit deferrals)

- Persisting batch results to a new `FraktalAnalysis` model — current lineage
  is view-and-forget. Deferred to full scope.
- CSV export of per-image batch results.
- Embedding the FRAKTAL batch Df in the Simulation detail page.
- Processing external non-pyaglogen ZIPs with different metadata shapes (e.g.
  MATLAB direct exports with their own schema).
- Real-time preview of individual images mid-batch.
- Re-running batches with different scales from the results page (user would
  re-upload).

## Approach

The work splits into four phases that are mostly independent and can be
verified separately.

**Phase 1 — Rust batch orchestrator.** Add
`aglogen_core/engine/src/fractal/fraktal/batch.rs` as a thin layer on top of
the existing analyzers. It accepts a `Vec<ImageBytes>`, a `scale`, and an
optional `dpo_hint`. If `dpo_hint` is `None`, it calls
`estimate_particles_and_dpo` **only on `images[0]`** and caches the returned
dpo. It then iterates over all images calling `analyze_granulated_2012` and
`analyze_voxel_2018` with the cached dpo. No existing analyzer signature
changes.

**Phase 2 — PyO3 binding.** Expose `analyze_batch(images, scale, dpo_hint)` in
`aglogen_core/python/src/lib.rs` returning a list of per-image result dicts
(Df, kf, R², dpo used, filename). This is the only Python-facing change to the
core crate.

**Phase 3 — Backend wiring.** Add
`backend/apps/fractal_analysis/services/batch.py` that: (a) extracts the ZIP
into a temp dir, (b) parses `metadata.json` if present and pulls
`parameters.pixels_per_100nm`, (c) decides sync vs async based on image count,
(d) dispatches to Rust via the new binding. The view layer gets a new
`analyze_batch` action on the existing `FractalAnalysisViewSet` accepting
multipart ZIP upload. For `N > 30` we enqueue `analyze_fraktal_batch_task`,
return 202 + `job_id`, and expose a status-polling endpoint. Progress is
reported every image via cache, same mechanism as projections export.

**Phase 4 — Frontend.** Add routes `/projects/[id]/fraktal/batch` (upload) and
`/projects/[id]/fraktal/batch/[jobId]` (results). `FraktalBatchUpload` is a
drag-and-drop component that shows "Auto-calibrated from metadata" when the
ZIP carries pyaglogen metadata and falls back to the existing Scale
Calibration + Autocalibrate inputs otherwise. `FraktalBatchResultsView`
renders the sortable table plus a Recharts histogram. `FraktalComparisonCard`
pulls the three Df values (batch mean, `target_df`, 3D box-counting) and
renders a short explanatory note about the 2D-vs-3D Df gap. A "Batch mode" CTA
is added to the existing `/fraktal/new` page — the single-image form stays as
the default.

**Comparison card math.** Batch mean Df and std are computed client-side from
the table. `target_df` and `metrics.fractal_dimension` are fetched from the
linked `Simulation` when the ZIP filename matches `{sim_id}_projections.zip`.
If the ZIP has no associated simulation, the card hides the simulator columns
and only shows the batch statistics.

### Key decisions (locked)

- Metadata path: **`metadata.parameters.pixels_per_100nm`** (nested — confirmed
  against exported ZIPs).
- Sync/async threshold: **N = 30 images**. Matches the 10–50× per-image cost of
  FRAKTAL vs matplotlib rendering.
- Auto-calibrate: **one-shot on `image[0]`**, cached dpo reused across the
  batch. 4N → N Rust calls.
- Results UI: **table AND histogram** (both, not either/or).
- Comparison: **FRAKTAL mean Df + sim `target_df` + sim 3D box-counting Df** +
  explanatory note.
- Scope: **Medium**, ~5 days.
- Legacy single-image FRAKTAL UI and endpoint preserved as-is.

## Capabilities

### New capabilities

- `fraktal-batch-contract`: contract for the batch analysis flow — ZIP input,
  auto-calibration semantics, per-image output shape, sync/async threshold,
  progress reporting, and results view requirements.

### Modified capabilities

- None. Legacy single-image `FraktalAnalysis` behaviour is unchanged.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `aglogen_core/engine/src/fractal/fraktal/batch.rs` | NEW | Batch orchestrator over existing analyzers + one-shot dpo cache |
| `aglogen_core/python/src/lib.rs` | Modify | Expose `analyze_batch(images, scale, dpo_hint)` binding |
| `backend/apps/fractal_analysis/views.py` | Modify | New `analyze_batch` action accepting ZIP multipart upload |
| `backend/apps/fractal_analysis/tasks.py` | Modify | New Celery task `analyze_fraktal_batch_task` for N>30 |
| `backend/apps/fractal_analysis/services/batch.py` | NEW | ZIP extraction + metadata parse + dispatch to Rust batch analyzer |
| `backend/apps/fractal_analysis/serializers.py` | Modify | New `BatchRequest` + `BatchResult` serializers |
| `backend/apps/fractal_analysis/urls.py` | Modify | Register new endpoint + status polling path |
| `frontend/src/components/fraktal/FraktalBatchUpload.tsx` | NEW | Drag-and-drop ZIP upload with mode indicator |
| `frontend/src/components/fraktal/FraktalBatchResultsView.tsx` | NEW | Results page: table + histogram + comparison card |
| `frontend/src/components/fraktal/FraktalComparisonCard.tsx` | NEW | Sim vs batch Df comparison with explanatory note |
| `frontend/src/lib/api.ts` | Modify | `simulationsApi.analyzeBatch()` + polling helper (reuse exportProjections pattern) |
| `frontend/src/app/projects/[id]/fraktal/batch/page.tsx` | NEW | Route for batch upload |
| `frontend/src/app/projects/[id]/fraktal/batch/[jobId]/page.tsx` | NEW | Route for batch results |
| `frontend/src/app/projects/[id]/fraktal/new/page.tsx` | Modify | Add "Batch mode" entry point |
| `docs/fraktal-batch.md` | NEW | User guide |

## Success Criteria

- [ ] Uploading a pyaglogen projection ZIP triggers batch analysis of all N
      images without asking for calibration.
- [ ] Uploading a ZIP without `metadata.json` falls back to the Scale
      Calibration / Autocalibrate dpo inputs.
- [ ] N ≤ 30 → sync response with results within 1 minute on reference
      hardware.
- [ ] N > 30 → 202 + `job_id`; status endpoint returns progress per image;
      final results returned when the task completes.
- [ ] Results page shows a table sortable by any column, a histogram of Df,
      and a comparison card.
- [ ] Comparison card shows FRAKTAL batch mean ± std, simulation `target_df`,
      and simulation `metrics.fractal_dimension`, each labelled, with the
      fixed explanatory note.
- [ ] Single-image FRAKTAL flow is unchanged and all its existing tests pass.
- [ ] New tests cover: Rust batch orchestrator, backend endpoint end-to-end
      (sync and async), frontend batch upload and results components.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| One-shot dpo fails on `image[0]` but would succeed on other images | Low | On failure, retry on `image[N/2]`; surface a clear error and let the user override dpo manually |
| Batch of ~100 images exceeds Celery default timeout | Medium | Configure task timeout to 30 min; report progress every image; persist partial results on failure |
| `metadata.json` parses but has an unexpected shape | Medium | Strict schema check; log a warning; fall back to manual calibration silently with a UI hint |
| ZIP contains non-PNG files (user photos, `metadata.json.bak`) | Low | Filter by MIME sniff + filename suffix; ignore non-images |
| Histogram bins look noisy for small N | Low | Table-only when N < 10; histogram shown from N ≥ 10 |
| Users confused when 2D Df << 3D Df | High | Fixed educational note in comparison card: "2D projection Df is systematically lower than 3D Df (Sorensen 1992). Expected gap: 0.1–0.3." |

## Rollback Plan

1. Revert frontend routes `/fraktal/batch/*` (they 404 until reverted) — no
   impact on single-image FRAKTAL.
2. Revert backend endpoint + Celery task — single-image FRAKTAL keeps
   working.
3. Revert `aglogen_core/.../batch.rs` and the new PyO3 binding — purely
   additive, existing analyzers untouched.
4. No DB migration to revert (no new model in Medium scope).

## Dependencies

- None external. Builds on:
  - Projection export metadata (a19a9e5) — already shipped.
  - Existing Rust `analyze_granulated_2012`, `analyze_voxel_2018`.
  - Existing `estimate_particles_and_dpo` for the fallback autocalibrate path.
  - Celery infrastructure already used for projections async export.

## Open questions (deferred to spec/design)

- Histogram bin count heuristic: fixed 20, Freedman–Diaconis, or
  user-configurable?
- Exact CSV export format if CSV is pulled into scope later (deferred to
  Full).
- Whether the batch Celery task reuses the existing
  `/projections-status/{job_id}/` endpoint or gets a dedicated
  `/fraktal-status/{job_id}/` (DRY vs separation — design call).
- Whether the comparison card links ZIP → `sim_id` by filename convention
  (`{sim_id}_projections.zip`) or requires the user to pick a simulation
  manually.
