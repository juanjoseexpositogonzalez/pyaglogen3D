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
