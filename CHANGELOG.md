## 2026-04-24 — Hotfix: FRAKTAL + Legacy ZIP metadata

### Fixed

- **FRAKTAL single-image from simulation**: the task path previously raised `TypeError: project_to_2d() got an unexpected keyword argument 'resolution'` because the call site passed `resolution=...` / `format="raw"` kwargs that the Rust binding doesn't accept, then tried to read a non-existent `.image` attribute. The path now calls `project_to_2d` with supported kwargs only and rasterizes the geometric projection to a grayscale `uint8` array via a new `_rasterize_projection_to_grayscale` helper — identical shape to what the batch FRAKTAL path feeds the analyzer after PIL decoding.
- **TIFF/BMP preview in FraktalAnalysisForm**: browsers can't natively decode TIFF or BMP, so the old `<img src={blobURL}>` just rendered a broken-image icon. The form now detects the MIME type and shows an informative placeholder (filename, format, size) for non-renderable formats while still accepting them for analysis.

### Changed (additive, backwards-compatible)

- **Projection ZIP exports in legacy mode** now include a `metadata.json` file with `parameters.pixels_per_100nm`, bringing legacy mode to parity with `grid`/`fibonacci` modes for FRAKTAL batch auto-calibration. Existing consumers that iterate PNG files are unaffected — PNG filenames and bytes are preserved (R3).
- **R3 spec clause** softened: `metadata.json` MAY be present in legacy ZIPs as an additive file. Pre-existing parsers that ignore unknown ZIP entries continue to work.

## fraktal-batch-analysis (unreleased)

### Added

- **Batch FRAKTAL analysis** — upload a projection ZIP, analyze all images at once.
- **Auto-calibration** from `metadata.parameters.pixels_per_100nm` when the ZIP comes from the pyaglogen3D projection export. Automatic fallback to manual scale for legacy/external uploads.
- **One-shot dpo** autocalibrate: analyze image[0] once, reuse for all N images (with image[N/2] retry on failure). Saves 4× Rust calls.
- **Async execution** for N > 30 images via Celery, with per-stage progress reporting (autocalibrate → analyzing → aggregating).
- **Results UI**: batch summary card, sortable per-image table, Df histogram (Freedman-Diaconis ≥10, Sturges 5–9, hidden <5), Sorensen comparison card linking FRAKTAL batch mean Df + simulation target_df + simulation 3D box-counting Df.
- **Comparison card** auto-links ZIP filename (`{uuid}_projections.zip`) to the source Simulation; manual `sim_id` override supported.
- New endpoints:
  - `POST /api/v1/fraktal/analyze-batch/` (multipart ZIP)
  - `GET /api/v1/fraktal-status/{job_id}/` (polling)
  - `GET /api/v1/fraktal-status/{job_id}/results/` (download)
- New Rust module `aglogen_core::fractal::fraktal::batch` with `analyze_batch` orchestrator.
- New Python binding `aglogen_core.analyze_fraktal_batch`.
- New component `FraktalBatchUpload` with client-side metadata detection via JSZip.
- New component `FraktalBatchResultsView` with Plotly histogram.
- New component `FraktalComparisonCard` with fixed Sorensen 1992 note.
- New routes: `/projects/{id}/fraktal/batch` and `/projects/{id}/fraktal/batch/{jobId}`.
- CTA link on the single-image FRAKTAL page.
- User guide at `docs/fraktal-batch.md`.

### Unchanged

- Legacy single-image FRAKTAL endpoint and UI — byte-for-byte backwards compatible.

### Dependencies

- Frontend: `jszip ^3.10.1` (client-side metadata pre-parse).

## projections-export-fix (unreleased)

### Added

- **Grid mode** — uniform azimuth × elevation sampling with automatic pole deduplication. Emits exactly `n_az * (n_el − 2) + 2` projections.
- **Fibonacci lattice mode** — exact N uniform projections via golden-angle spiral. Mathematically optimal sphere coverage.
- **metadata.json** inside every export ZIP with per-projection `{index, filename, azimuth, elevation}` records.
- **Async Celery path** for N > 200 projections: endpoint returns `202 {job_id}`, frontend polls `/projections-status/{job_id}/` and downloads when ready.
- User guide at `docs/projections-export.md`.

### Changed — silent projection drops FIXED

- The old export silently emitted fewer projections than the UI promised (e.g., "generate 24" but ZIP contained 19). Root cause: a half-baked pole dedup in `projection/mod.rs` only fired when elevations landed exactly on ±90° AND skipped non-first azimuths — partial, fragile, and mismatched with the UI count formula.
- Fix: dedicated `generate_direction_grid` (Rust) with correct pole math + frontend preview formula that matches backend output exactly.

### Fixed

- Matplotlib figure leak risk in large batches (N > 200) — single rendering helper with `plt.close(fig)` in `finally`.

### Infrastructure

- New Rust module `aglogen_core::projection::directions` with `Direction` struct + `generate_grid` + `generate_fibonacci`.
- Python bindings: `aglogen_core.generate_direction_grid(n_az, n_el)`, `aglogen_core.generate_direction_fibonacci(n)`, `aglogen_core.project_directions(coords, radii, directions)`.
- Backend service `apps.simulations.services.projections` (pure Python) for ZIP + metadata assembly.
- Endpoints: extended `POST /projection/batch/` with `mode` dispatch; new `GET /projections-status/{job_id}/` polling + `/projections-status/{job_id}/download/` streaming.
- Celery task `build_projections_zip_task` with progress reporting every 10 projections.
- 50 new tests: 7 Rust unit (directions.rs), 28 backend (services + integration + polling), 20 frontend (ProjectionControls + api polling).

## visualize-multiple (unreleased)

### Added

- **Compare multiple aggregates** — new `/projects/[id]/compare?sims=...` route
- **Checkbox selection** on project page simulation list (2–9 sims) + sticky "Compare" button
- **Grid mode** (default): responsive grid of 3D viewers (1×2 → 3×3) with synchronised cameras
- **Overlay mode**: all aggregates merged into single scene with CoM alignment + distinct colors
- **Synchronised cameras**: rotating one viewer rotates all (toggle to independent)
- **Metrics comparison table**: Df / Kf / Rg (nm) / N particles / Algorithm per sim
- **Multi-series Rg evolution chart**: log-log, one series per sim, missing data noted
- **Deterministic color palette** (Tableau10) assigned by sorted sim ID
- **Missing-sim banner** for 404/403 sims in shared URLs (renders survivors)
- **Processing banner** for sims whose geometry is still being computed
- `docs/visualize-multiple.md` user guide

### Changed

- `viewerStore.ts` — camera state scoped by key (`"single"` default + compare session scopes), preserving single-sim backwards compat via write-through mirror
- `Particles.tsx` — new optional `uniformColor` prop (default preserves existing behavior)
- `AgglomerateViewer.tsx` — new optional `colorOverride` + `cameraSource` props
- `RgEvolutionChart.tsx` — accepts alternative `series` prop shape for multi-series rendering (single-series API unchanged)

### Infrastructure

- New `frontend/src/components/compare/` module (7 files + tests)
- New `frontend/src/lib/compare-utils.ts` with palette, layout, URL parse helpers
- 53 new frontend tests (73 → 126)
# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to conventional commits.

## import-aggregate (unreleased)

### Added
- **"Import Aggregate" button** on project pages — top-level action alongside "New Simulation".
- **MATLAB `.mat` importer** (single-agglomerate, v7 or earlier). Multi-agglomerate files rejected.
- **CSV metadata lines**: `#key=value` preamble for unit, source, explicit diameter, generated_at.
- **CSV locale auto-detection**: decimal (`.`/`,`) and delimiter (`,`/`;`) detected from first 5 data rows. Manual override in upload dialog.
- **CSV export locale preferences**: new fields on user profile (Settings → CSV Export Preferences).
- **`radius_nm` column** on CSV exports, alongside existing (unitless) `radius`.
- `docs/import-aggregate.md` user-facing guide.

### Changed — IMPORT METRICS CORRECTNESS
- **CSV/MATLAB imports** now compute fractal dimension via **box-counting**, not via the CSV row order power-law fit. The previous implementation silently used deposition order — unreliable for static geometries. **Historical imports will have stale/incorrect `fractal_dimension` values until re-computed.** A `recompute metrics` action is out of scope for this release.
- Imports now stamp `parameters.primary_particle_diameter_nm` (honoring the `rg-unit-contract` from verify-rg). CSV exports of imports use the correct diameter instead of silently defaulting to 25 nm.
- `.dat` file extension explicitly rejected on upload with a clear error (previously they would be parsed as plain text and produce garbage metrics).
- Minimum particles for box-counting Df: **50**. Below this, `fractal_dimension` is `null` with a note.

### Removed
- `metrics.sequential_df` / `metrics.sequential_kf` / `metrics.rg_evolution` for imported simulations (order-dependent, misleading for static data).

### Tests
- Backend: +36 tests (CSV contract, box-counting fixtures, .mat parser, locale import/export). Total 83 simulation tests.
- Frontend: +22 tests (csv-locale lib, ImportAggregateDialog). Total 57 frontend tests.
- Engine: unchanged at 165.

## verify-rg (unreleased)

### Changed — UNIT CONVENTION UPDATED (observable to all users)

- Rg values displayed in the UI and CSV exports are now in **nm**, scaled
  from the dimensionless engine value by `primary_particle_diameter_nm / 2`.
- CSV exports: single-sim export uses `Unit = "nm"` (was `"particle radii"`);
  batch export renames the `Rg` column to `Rg_nm`.
- Simulations previously displayed had Rg at **2×** the correct nm value
  due to a long-standing naming bug (field called "radius" stored as diameter).
  **Stored data is unchanged**; only the display scaling is corrected.

### Added

- `parameters_schema_version` field on `Simulation.parameters` (`"v1"` legacy,
  `"v2"` current). Read-side shim handles both; writes always use `v2`.
- UnitConventionBanner on simulation detail and project list pages for
  legacy (v1) simulations. Dismissable per-user.
- `docs/unit-convention.md` — contributor reference.

### Fixed

- Rg display inconsistency across 5 surfaces (detail page, project page,
  AI sidebar, batch table, evolution chart).
- RgEvolutionChart axis label now reads `log10(Rg/nm)` (was `log10(Rg)`).

### Tests

- 5 engine Rg correctness tests (scaling, translation, dimer, chain, hex).
- 25 Python shim + 32 TypeScript shim tests (byte-for-byte parity).
- 6 serializer + 3 tasks.py mapping + 4 CSV export integration tests.
- 6 UnitConventionBanner component tests.

Total: ~81 new tests.
