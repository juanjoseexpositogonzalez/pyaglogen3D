# Tasks: verify-rg

## Overview

Execute the unit-contract fix in four parallelisable layers with a single integration checkpoint. Engine tests (T1) and docs (T13) are fully independent and can start immediately. The two language shims (T2 Python, T3 TypeScript) are the gating dependencies for everything else in their respective stacks: T2 unblocks backend tasks (CSV single + batch, serializer stamp, tasks.py wiring, backend integration tests); T3 unblocks all frontend surfaces (detail page, project page, AI page, batch table, chart, form rename, banner). Manual acceptance (T12) requires all frontend surfaces. Final verification (T14) requires everything.

## Dependency graph

```
T1  (engine tests)          ──►  (independent)
T13 (docs)                  ──►  (independent, any time)

T2  (python shim)           ──►  T4, T5, T6, T6b, T11
T3  (ts shim)               ──►  T7, T8, T9, T10, T10b, T10c, T10d
T10d (banner component)     ──►  T10e (mount), T10f (test)
T7..T10c, T10e              ──►  T12 (manual acceptance)

T1, T11, T12, T10f, T2-tests, T3-tests ──►  T14 (final verify)
```

**Parallel-ready batches**:
- **Batch A (start immediately)**: T1, T2, T3, T13
- **Batch B (after T2)**: T4, T5, T6, T6b (all backend write/export sites)
- **Batch C (after T3)**: T7, T8, T9, T10, T10b, T10c, T10d (all frontend display sites + form + banner component)
- **Batch D (after T2 + T4/T5/T6)**: T11 (backend integration tests)
- **Batch E (after T10d)**: T10e, T10f
- **Batch F (after Batches C + E)**: T12 (manual acceptance)
- **Final**: T14

## Tasks

### T1. [engine] Add Rg correctness tests
**Effort**: M
**Location**: `aglogen_core/engine/src/simulation/metrics.rs` — extend existing `#[cfg(test)] mod tests` (starts ~line 312)
**Depends on**: nothing
**Deliverables**:
- [x] `test_rg_scaling_invariance` — for α ∈ {2.0, 10.0, 0.1}, assert `Rg(α·coords, α·radii) == α·Rg(coords, radii)` with `assert_relative_eq!(..., epsilon = 1e-10)`
- [x] `test_rg_translation_invariance` — translate all coords by `[17.3, -4.1, 9.0]`, assert Rg unchanged with tolerance `1e-10`
- [x] `test_rg_dimer_closed_form` — 2 spheres `r=1` separated by distance 2, assert `Rg == sqrt(1.0 + 3.0/5.0)` with tolerance `1e-10`
- [x] `test_rg_linear_chain_matches_kf_analytic` — for N ∈ {3, 5, 10} build chain of touching unit spheres, compare to `kf_analytic::radius_of_gyration(Line, n, 2.0)`, tolerance `1e-6`
- [x] `test_rg_hex_plane_matches_kf_analytic` — for N ∈ {7, 19} build centred-hex planar arrangement, compare to `kf_analytic::radius_of_gyration(Hex, n, 2.0)`, tolerance `1e-6`
- [x] Also cover existing scenarios from spec if not already present: single sphere `r` → `sqrt(3/5)·r`, empty input → `0.0`
**Risk**: "Engine tests become too strict and fail on fp noise" — mitigated by explicit per-test epsilon (1e-10 deterministic, 1e-6 analytic).
**Done when**: `cargo test -p aglogen-engine metrics` passes including all 5+ new tests

### T2. [backend] Create Python param shim
**Effort**: M
**Location**: `backend/apps/simulations/services/params.py` (new file) + `backend/apps/simulations/tests/test_params_shim.py` (new file)
**Depends on**: nothing
**Deliverables**:
- [x] Module constants: `PARAM_KEY_DIAMETER = "primary_particle_diameter_nm"`, `PARAM_KEY_RADIUS_LEGACY = "primary_particle_radius_nm"`, `DEFAULT_DIAMETER_NM = 50.0`, `SCHEMA_VERSION_CURRENT = "v2"`
- [x] `get_primary_particle_diameter_nm(params: dict) -> float` — fallback order: v2 key if positive → v1 key × 2 if positive → `DEFAULT_DIAMETER_NM`
- [x] `get_scale_factor_nm(params: dict) -> float` — returns `get_primary_particle_diameter_nm(params) / 2`
- [x] `get_schema_version(params: dict) -> str | None` — returns `"v2"` | `"v1"` | `None`; `"v1"` when `primary_particle_radius_nm` present and no explicit version; `None` for fully ambiguous rows
- [x] Unit tests covering: v2 present → D; only v1 present → R×2; neither → 50.0; both present → v2 wins; v1 = 0 → default; v1 negative → default; v2 = 0 → fall through to v1; explicit `parameters_schema_version="v1"` detected
**Risk**: fallback ordering must be byte-identical with TS shim (T3). Document fallback precedence in a module docstring.
**Done when**: `pytest backend/apps/simulations/tests/test_params_shim.py` passes with ≥ 8 cases

### T3. [frontend] Create TypeScript units shim (parity with Python)
**Effort**: M
**Location**: `frontend/src/lib/units.ts` (new) + `frontend/src/lib/__tests__/units.test.ts` (new)
**Depends on**: nothing (but spec fallback order MUST match T2)
**Deliverables**:
- [x] `export const DEFAULT_DIAMETER_NM = 50.0`
- [x] `export const SCHEMA_VERSION_CURRENT = "v2" as const`
- [x] `export function getPrimaryParticleDiameterNm(params: Record<string, unknown>): number` — same fallback order as Python
- [x] `export function getScaleFactorNm(params: Record<string, unknown>): number` — returns `dpo / 2`
- [x] `export function getSchemaVersion(params: Record<string, unknown>): "v1" | "v2" | null`
- [x] Unit tests mirroring T2: v2 present; only v1; neither; both (v2 wins); v1=0; v1<0; v2=0 falls through; explicit v1 string
**Risk**: If Python and TS diverge, CSV and UI will disagree numerically. Mirror the exact case list and default values.
**Done when**: Frontend test runner (`npm test` / `vitest run frontend/src/lib/__tests__/units.test.ts`) passes with ≥ 8 cases and values match T2 case-by-case

### T4. [backend] CSV single-sim export: nm + Unit column
**Effort**: S
**Location**: `backend/apps/simulations/views.py:474`
**Depends on**: T2
**Deliverables**:
- [x] Import `get_scale_factor_nm` from `apps.simulations.services.params`
- [x] Compute `scale = get_scale_factor_nm(simulation.parameters)` once per export
- [x] Multiply the Rg value by `scale` before writing to CSV
- [x] Ensure `Unit` column exists and Rg row has `Unit = "nm"` (replace any prior `"particle radii"`)
- [x] No behavioural change for non-Rg rows
**Risk**: "CSV format change breaks user's existing spreadsheets/scripts" — unit value changes from `"particle radii"` → `"nm"` AND Rg scales by dpo/2. Documented in proposal; no code mitigation needed beyond a clean swap.
**Done when**: Manual curl/export of a known simulation returns CSV with `Unit=nm` and Rg = `rg_engine × dpo/2`

### T5. [backend] CSV batch export: nm + Unit column
**Effort**: S
**Location**: `backend/apps/simulations/views.py` around lines 1116 and 1143
**Depends on**: T2
**Deliverables**:
- [x] Per simulation in the batch, compute `scale = get_scale_factor_nm(sim.parameters)` (shim handles v1/v2)
- [x] Multiply each Rg column value by the per-row `scale`
- [x] Add a `Unit` column (or per-column unit annotation) so Rg columns are labelled `"nm"`. This is additive — existing columns preserved
- [x] Verify both CSV emission sites (~1116 and ~1143) go through the same path
**Risk**: Batch consumers may rely on column indices; adding a column is additive but document in changelog. Same scaling bug as single-sim if shim import missed.
**Done when**: A batch CSV for a study mixing v1 and v2 simulations has correctly scaled Rg per row and an explicit `nm` unit annotation

### T6. [backend] SimulationSerializer stamps `parameters_schema_version = "v2"`
**Effort**: S
**Location**: `backend/apps/simulations/serializers.py` — `SimulationSerializer.create` (and any analogous `update` that rewrites parameters)
**Depends on**: T2 (to import `SCHEMA_VERSION_CURRENT` and the diameter key constant)
**Deliverables**:
- [x] On create, ensure `validated_data["parameters"]["parameters_schema_version"] = "v2"`
- [x] On create, ensure `validated_data["parameters"]` carries `primary_particle_diameter_nm` and NEVER writes `primary_particle_radius_nm`
- [x] If the serializer accepts legacy payloads from old clients (transitional), it MUST convert radius → diameter on the way in before persisting
- [x] Add or extend a serializer test asserting a newly created simulation persists `parameters_schema_version == "v2"` and only the new key
**Risk**: Silent writes of legacy key would poison new data. Assertion in tests guards against regression.
**Done when**: Serializer test confirms v2 stamping + new-key exclusivity on a fresh create

### T6b. [backend] Update `tasks.py` engine-input mapping via the shim
**Effort**: S
**Location**: `backend/apps/simulations/tasks.py` around line 1185
**Depends on**: T2
**Deliverables**:
- [x] Replace any direct `params["primary_particle_radius_nm"]` or `params["primary_particle_diameter_nm"]` read with `get_primary_particle_diameter_nm(params)` (or `get_scale_factor_nm`, whichever matches the downstream unit)
- [x] Verify the engine input values produced are numerically unchanged for v2 simulations and correctly doubled-from-radius for v1 simulations
- [x] Add or extend a task-level test (or targeted unit test on the mapping helper) covering both schema versions
**Risk**: Silent unit drift into the engine. Mitigation: keep a single shim import and a regression test that loads a v1 fixture and asserts the mapped engine input.
**Done when**: `tasks.py` no longer references the legacy key directly; v1 and v2 fixtures both produce correct engine inputs

### T7. [frontend] Detail page uses `getScaleFactorNm`
**Effort**: S
**Location**: `frontend/src/app/projects/[id]/simulations/[simId]/page.tsx` (around lines 377–378)
**Depends on**: T3
**Deliverables**:
- [x] Replace inline `params.primary_particle_radius_nm` / inline scale math with `getScaleFactorNm(simulation.parameters)` imported from `@/lib/units`
- [x] Ensure the displayed Rg is `rg_engine × scale` and the label/adjacent text includes ` nm`
- [x] No duplicate scaling (multiply exactly once at this boundary)
**Risk**: Double-scaling if helper is applied both here and in a shared component. Confirm the chart/table downstream don't also scale via the same parent.
**Done when**: Detail page renders correct nm Rg for a v1 fixture AND a v2 fixture

### T8. [frontend] Project list page uses `getScaleFactorNm`
**Effort**: S
**Location**: `frontend/src/app/projects/[id]/page.tsx` (around lines 290–292)
**Depends on**: T3
**Deliverables**:
- [x] Import and apply `getScaleFactorNm` per-simulation
- [x] Append ` nm` or `(nm)` to Rg cells
- [x] Same numeric result as the detail page for the same simulation
**Done when**: Project list Rg column matches detail-page value cell-by-cell for the same sim

### T9. [frontend] AI page Rg display: scale + "nm" suffix
**Effort**: S
**Location**: `frontend/src/app/ai/page.tsx:861`
**Depends on**: T3
**Deliverables**:
- [x] Multiply Rg by `getScaleFactorNm(params)` at the display site
- [x] Append ` nm` to the value
- [x] Verify the AI prompt/context (if it also receives Rg) uses the same scaled value OR explicitly the dimensionless engine value — do NOT send conflicting numbers
**Risk**: AI sidebar may double-pipe Rg. Grep the component for any second reference and pick one representation.
**Done when**: AI sidebar Rg matches detail-page Rg numerically and is labelled nm

### T10. [frontend] BatchResultsTable: column header `Rg (nm)` + scale
**Effort**: S
**Location**: `frontend/src/components/batch/BatchResultsTable.tsx` (around lines 213, 248)
**Depends on**: T3
**Deliverables**:
- [x] Column header literal changes to `Rg (nm)` (or localisable equivalent)
- [x] Rg cell value = `rg_engine × getScaleFactorNm(row.parameters)`
- [x] Sort/compare logic (if any) uses the scaled value consistently
**Done when**: Batch table for a mixed v1/v2 study shows nm-consistent Rg across rows

### T10b. [frontend] RgEvolutionChart: scale yData, axis label `log10(Rg/nm)`
**Effort**: S
**Location**: `frontend/src/components/charts/RgEvolutionChart.tsx`
**Depends on**: T3
**Decision locked**: keep log-log; axis label `log10(Rg/nm)`
**Deliverables**:
- [x] `yData = rg_evolution.map(v => v * scale)` where `scale = getScaleFactorNm(params)`
- [x] Y-axis label: `log10(Rg/nm)`
- [x] X-axis unchanged
- [x] Empty `rg_evolution` renders "no data" gracefully (no NaN/Infinity)
**Risk**: Applying `Math.log10` after scaling for an empty series → NaN. Guard with length check.
**Done when**: Chart for a reference sim matches scale-then-log10 of the engine series, axis label is present

### T10c. [frontend] Form: rename field to `primary_particle_diameter_nm`, default 25
**Effort**: M
**Location**: `frontend/src/components/forms/SimulationForm.tsx`
**Depends on**: T3
**Deliverables**:
- [x] Form state key renamed `primary_particle_radius_nm` → `primary_particle_diameter_nm`
- [x] Default value: `25`
- [x] Label: "Primary Particle Diameter (nm)" or equivalent
- [x] Help text: `"Primary particle diameter (dpo) in nm (soot convention)"`
- [x] Submission payload writes `primary_particle_diameter_nm` and never `primary_particle_radius_nm`
- [x] Any validation (min/max) adjusted for a diameter rather than radius
- [x] Remove any now-dead imports or constants tied to the old key
**Risk**: "User confusion during transition (why did my Rg double?)" — mitigated by the banner (T10d) plus docs (T13).
**Done when**: Submitting the form creates a simulation whose `parameters.primary_particle_diameter_nm` is set and `primary_particle_radius_nm` is absent

### T10d. [frontend] Banner component `UnitConventionBanner.tsx`
**Effort**: M
**Location**: `frontend/src/components/banners/UnitConventionBanner.tsx` (new)
**Depends on**: T3
**Deliverables**:
- [x] Props: `{ simulationId: string; schemaVersion: "v1" | null; userId: string; onDismiss: () => void }`
- [x] Renders only when `schemaVersion` is `"v1"` or `null` AND no dismissal flag is present
- [x] Dismissal key: `localStorage["dismissed-banner:unit-convention:" + userId]` (boolean)
- [x] Copy (EN): "Unit convention updated. Rg values previously displayed were 2× the correct nm value; display is now corrected. Stored data unchanged." + link "Learn more" → `/docs/unit-convention` + "Dismiss" button
- [x] `onDismiss` writes the localStorage key and calls parent callback
- [x] SSR-safe: guard `localStorage` access behind `typeof window !== "undefined"`
**Risk**: localStorage unavailable in SSR → runtime error. Guard on window.
**Done when**: Storybook/isolated render shows the banner for v1, hides for v2, persists dismissal across reloads

### T10e. [frontend] Mount banner on detail page + project list page
**Effort**: S
**Location**: `frontend/src/app/projects/[id]/simulations/[simId]/page.tsx` AND `frontend/src/app/projects/[id]/page.tsx`
**Depends on**: T10d, T3
**Deliverables**:
- [x] Detail page: mount `<UnitConventionBanner />` at top, pass `schemaVersion = getSchemaVersion(simulation.parameters)` (cast/narrow to `"v1" | null` since v2 returns early)
- [x] Project list page: mount once at top of page (not per-row) if ANY listed simulation resolves to v1/null schema
- [x] Pass current `userId` from the auth context
**Risk**: Banner rendered on every row → visual noise. Detail page = per-simulation mount; project page = single top-of-page mount conditional on any legacy sim.
**Done when**: Navigating to a v1 sim shows the banner; a v2 sim does not; the banner stays dismissed across navigation

### T10f. [frontend] Banner component test
**Effort**: S
**Location**: `frontend/src/components/banners/__tests__/UnitConventionBanner.test.tsx` (new)
**Depends on**: T10d
**Deliverables**:
- [x] Renders when `schemaVersion = "v1"` and no localStorage flag
- [x] Renders when `schemaVersion = null` and no localStorage flag
- [x] Does NOT render when `schemaVersion = "v2"` (component should early-return or the prop type guards it)
- [x] Does NOT render when localStorage dismissal flag present for the given `userId`
- [x] Dismiss click: writes localStorage key, invokes `onDismiss`, hides banner
- [x] Different `userId` has independent dismissal state
**Done when**: Component test suite passes; coverage includes all 5 cases

### T11. [backend] Integration tests for CSV export (v1 and v2 simulations)
**Effort**: M
**Location**: extend existing CSV export test file under `backend/apps/simulations/tests/` (create `test_csv_export_units.py` if no suitable file exists)
**Depends on**: T2, T4, T5, T6
**Deliverables**:
- [x] Fixture: v1 simulation (`parameters.primary_particle_radius_nm = 25.0`, no schema version) with a known `rg_engine`
- [x] Fixture: v2 simulation (`parameters.primary_particle_diameter_nm = 50.0`, `parameters_schema_version = "v2"`) with a known `rg_engine`
- [x] Single-sim CSV test: for both fixtures, assert Rg cell equals `rg_engine * (D_nm/2)` and `Unit` column cell equals `"nm"`
- [x] Batch CSV test: mixed-version batch, assert each row scaled per its own shim resolution, Unit annotation present
- [x] Edge case: v1 simulation with `primary_particle_radius_nm = 0` → shim defaults → export still succeeds with `nm` unit
**Done when**: `pytest backend/apps/simulations/tests/test_csv_export_units.py` passes with all four scenarios

### T12. [manual] Acceptance checklist — 5 surfaces + chart + CSV
**Effort**: S
**Location**: no code; capture evidence in the PR description
**Depends on**: T7, T8, T9, T10, T10b, T10c, T10e, T4, T5
**Status**: [ ] **DEFERRED to post-deploy** — requires running application; user will execute manual QA against staging/production after merge
**Deliverables**:
- [ ] Pick a single reference simulation (ideally both a v1 and a v2 variant)
- [ ] Screenshot each surface showing the Rg value:
  - [ ] Simulation detail page
  - [ ] Project list page
  - [ ] AI sidebar
  - [ ] BatchResultsTable (within a batch study containing the sim)
  - [ ] RgEvolutionChart (axis labelled `log10(Rg/nm)`)
  - [ ] CSV export opened in a viewer (Rg value + `Unit` column)
- [ ] Verify each surface shows the SAME numeric Rg (within display rounding) and all are labelled `nm`
- [ ] For the v1 fixture, confirm the transition banner appears on detail and list pages and dismisses persistently
**Done when**: All screenshots collected, values match, banner behaviour confirmed, checklist attached to PR

### T13. [docs] `docs/unit-convention.md`
**Effort**: S
**Location**: `docs/unit-convention.md` (new)
**Depends on**: nothing (can run any time)
**Deliverables** — document MUST contain, in ≤ 1 page, four sections:
- [x] Section 1: "Engine is dimensionless" — state that `metrics.radius_of_gyration` is unitless
- [x] Section 2: "Display scaling" — explain `Rg_display_nm = Rg_engine × (primary_particle_diameter_nm / 2)` and that the single helper lives in `services/params.py` (backend) and `lib/units.ts` (frontend)
- [x] Section 3: "Schema versioning" — describe `parameters_schema_version`, v1 (legacy, `primary_particle_radius_nm`) vs v2 (`primary_particle_diameter_nm` + explicit version stamp), and the shim fallback order
- [x] Section 4: "Adding a new display surface" — checklist for contributors: import the helper, multiply exactly once, label `nm`, do not re-scale downstream
**Done when**: File exists at `docs/unit-convention.md`, contains all four sections, fits on one page of rendered markdown

### T14. [verify] Final full test run
**Effort**: S
**Location**: CI + local
**Depends on**: ALL previous tasks
**Status**: [x] Automated portions complete. Test count: **165 engine + 38 backend (34 new) + 38 frontend (~81 new total)**. Manual acceptance (T12) deferred to post-deploy.
**Deliverables**:
- [x] `cargo test -p aglogen-engine` green (165 pass, was 160 → +5 T1 tests)
- [x] `pytest backend` green (38 pass, +34: 25 shim + 6 serializer + 3 tasks + 4 CSV integration)
- [x] Frontend unit tests green (32 shim + 6 banner = 38 new; requires `npm install` for vitest+testing-library)
- [x] Lint + typecheck green on backend and frontend
- [ ] Manual acceptance checklist (T12) attached to the PR — **deferred to post-deploy**
- [x] Changelog entry drafted noting: CSV `Unit` now `"nm"`, Rg display scales by `dpo/2`, legacy `primary_particle_radius_nm` still read, new writes use `primary_particle_diameter_nm` + schema v2
**Done when**: All of the above green and the PR is ready for review
