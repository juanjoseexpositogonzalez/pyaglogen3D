# Proposal: verify-rg

## Intent

The Radius of Gyration (Rg) is the primary scalar output of the 3D aggregate
simulator, used by users to compare simulations against published soot data
and by downstream features (import, AI analysis, batch export) as a proxy for
aggregate size. Exploration (`explore.md`) proved the formula is
mathematically correct and matches MATLAB 1:1, but also uncovered that the
scientific meaning of the number shown to the user is ambiguous: the engine
emits a dimensionless Rg, only two of six display surfaces scale it to nm,
the CSV export uses a confusing `"particle radii"` unit, and the input field
labelled "Primary Particle Radius (nm) = 25" is semantically a diameter in
the rest of the codebase (FRAKTAL, AI tools, MATLAB, soot literature).

This change verifies correctness with formal tests and makes the unit
contract consistent end-to-end so that every Rg value a user sees — on every
page, in the CSV, in the AI sidebar, in the chart — represents the same
physical quantity in nanometers, publication-ready.

## Scope

### In Scope
- Engine unit tests proving Rg correctness: scaling invariance, translation
  invariance, known geometries (dimer, linear chain, hexagonal plane) against
  `kf_analytic` closed forms.
- Rename parameter `primary_particle_radius_nm` → `primary_particle_diameter_nm`
  with default `25.0`; derive scale factor as `dpo_nm / 2`.
- **Parameter schema versioning**: add `parameters_schema_version` field
  (e.g. `"v1"` legacy, `"v2"` post-rename) alongside the shim so tooling can
  detect the format rather than only trying key fallbacks.
- Read-side shim: both legacy (`primary_particle_radius_nm`) and new
  (`primary_particle_diameter_nm`) keys are read; writes always use the new key
  AND set `parameters_schema_version = "v2"`.
- Propagate nm scaling to ALL frontend display paths (detail page, project
  page, AI sidebar, batch results table, Rg-evolution chart).
- **Transition banner**: visible banner on simulation detail/list pages for
  simulations stored with `parameters_schema_version ∈ {null, "v1"}`
  explaining "Unit convention updated — Rg previously shown at 2× correct nm
  value; display now corrected. Stored data unchanged." Dismissable per-user.
- Backend CSV export: scale Rg server-side to nm and add explicit `Unit`
  column with `"nm"`.
- Short docs section explaining the unit convention (engine dimensionless,
  display in nm via diameter/2) AND the parameter schema versioning scheme.

### Out of Scope
- Changing the Rg formula itself (verified correct, no changes needed).
- FRAKTAL 2D image-domain Rg (`image_processing.rs`) — already in nm.
- Porosity metric refactor (depends on Rg but remains correct after change).
- Migrating historical stored simulations to the new key (shim handles it).
- FracVAL `geometric_mean` semantics documentation beyond a brief doc note.

## Capabilities

### New Capabilities
- `rg-unit-contract`: end-to-end contract that Rg is dimensionless in the
  engine and displayed/exported in nm everywhere user-facing, with
  `primary_particle_diameter_nm / 2` as the single source of scaling.

### Modified Capabilities
- None (no pre-existing specs in `openspec/specs/`).

## Approach

Three layers, applied in order so each is independently verifiable:

**Layer 1 — Engine verification (Rust).** Add unit tests in
`aglogen_core/engine/src/simulation/metrics.rs` covering scaling invariance
(`Rg(α·coords, α·radii) = α·Rg`), translation invariance, and closed-form
matches against `kf_analytic::radius_of_gyration` for Line and Hex packings.
This freezes the current (correct) behaviour as a regression suite so any
future refactor is caught.

**Layer 2 — Backend CSV (Python).** In
`backend/apps/simulations/views.py`, multiply Rg by
`params.primary_particle_diameter_nm / 2` before writing both the
single-simulation CSV (line 474) and the batch CSV (lines 1116, 1143). Add an
explicit `Unit` column valued `"nm"` so the file is self-describing. The
backend reads the diameter parameter via the shim (see Layer 3).

**Layer 3 — Frontend rename + consistent scaling (TypeScript).** Rename the
form field in `SimulationForm.tsx` (label, default, help text, state key).
Introduce a helper `getScaleFactorNm(params)` that reads
`params.primary_particle_diameter_nm ?? (params.primary_particle_radius_nm *
2) ?? 50` and returns `dpo / 2`. Wire it through every display path
identified in explore §4.2: detail page, project page, AI page,
BatchResultsTable, RgEvolutionChart. The shim means old stored simulations
keep working.

**Layer 4 — Docs.** Add a short unit-convention section to `docs/` so
contributors don't reopen this question.

### Key decisions (from interactive review)
- **Option A** for the rename: `primary_particle_radius_nm` →
  `primary_particle_diameter_nm`, default `25 nm`. Aligns the 3D simulator
  with FRAKTAL, AI tools, RAG chunking, and MATLAB `agloGen3D.m`.
- **Scope**: complete fix — tests + docs + rename + display fixes + CSV
  unit column + transition banner + schema versioning.
- **CSV format**: nm (scaled server-side) with explicit `Unit` column.
- **Migration strategy**: read-side shim + parameter schema version field.
  The shim reads both keys for backwards compatibility; the version field
  (`parameters_schema_version`) makes the format explicit and future-proofs
  further schema evolution.
- **Transition banner**: dismissible banner on legacy simulations (schema
  v1 or null) explaining the unit correction — users understand why their
  Rg numbers now show at half the previous displayed value.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `aglogen_core/engine/src/simulation/metrics.rs` | Modified (tests) | Add Rg verification tests |
| `backend/apps/simulations/views.py` | Modified | Scale Rg to nm, add Unit column in both CSV exports |
| `backend/apps/simulations/tasks.py` | Modified | Accept both param keys (shim) |
| `frontend/src/components/forms/SimulationForm.tsx` | Modified | Rename field + default |
| `frontend/src/app/projects/[id]/simulations/[simId]/page.tsx` | Modified | Use `dpo/2` helper |
| `frontend/src/app/projects/[id]/page.tsx` | Modified | Use helper |
| `frontend/src/app/ai/page.tsx` | Modified | Scale Rg, add nm unit |
| `frontend/src/components/batch/BatchResultsTable.tsx` | Modified | Scale Rg, nm unit |
| `frontend/src/components/charts/RgEvolutionChart.tsx` | Modified | Scale yData, label unit |
| `frontend/src/lib/units.ts` (new) | New | `getScaleFactorNm(params)` helper with shim + version detection |
| `frontend/src/components/banners/UnitConventionBanner.tsx` (new) | New | Dismissible banner for legacy-schema simulations |
| `docs/unit-convention.md` (new) | New | Document engine-unitless → nm convention + schema versioning |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Breaking historical stored simulations using `primary_particle_radius_nm` | Medium | Read-side shim accepts both keys; writes use new key |
| Rg values on existing simulations change by 2× once user reloads | Medium | Expected and correct — communicate in changelog + docs; old values were wrong by factor 2 |
| Engine tests become too strict and fail on fp noise | Low | Use `assert_relative_eq!` with explicit epsilon (1e-10 for determinstic arrangements, 1e-6 for chains) |
| CSV format change breaks user's existing spreadsheets/scripts | Low-Med | Adding a column is additive; document in release notes |
| User confusion during transition ("why did my Rg double?") | Medium | Docs section + changelog entry explaining diameter/radius convention |

## Rollback Plan

1. **Engine tests**: harmless, can be removed or `#[ignore]`d without side effects.
2. **CSV backend**: revert the scaling/unit-column commit; old files remain
   readable, only export format reverts.
3. **Frontend rename**: revert to `primary_particle_radius_nm`. Shim in Layer 3
   already reads the legacy key, so no data loss on rollback. Stored
   simulations written with the new key will be re-read as "radius" and
   require a one-line migration helper if this rollback is permanent.
4. **Ordering**: roll back Layer 3 (frontend) first, then Layer 2 (backend),
   then Layer 1 (tests) — opposite order of application.

## Dependencies

- None external. All changes are within the existing codebase.

## Success Criteria

- [ ] Engine `cargo test` passes with new Rg verification tests covering
      scaling, translation, Line-N, Hex-N.
- [ ] A single simulation's Rg value displayed on detail page, project page,
      AI sidebar, batch table, Rg-evolution chart axis, and CSV export is
      numerically identical (within rounding) and all labelled `nm`.
- [ ] CSV exports contain a `Unit` column with `"nm"` for the Rg field.
- [ ] Old simulations in the DB load without error and render Rg correctly
      through the legacy-key shim.
- [ ] New simulations write `primary_particle_diameter_nm` AND
      `parameters_schema_version: "v2"` and never
      `primary_particle_radius_nm`.
- [ ] Legacy simulations (null or `"v1"` schema version) show the transition
      banner exactly once per user (dismissible) with a link to the docs.
- [ ] `docs/unit-convention.md` exists and explains both the unit contract
      and the schema versioning scheme in ≤ 1 page.
