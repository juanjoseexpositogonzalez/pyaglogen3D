# Tasks: import-aggregate

## Overview

Execution follows 5 phases matching the proposal. **Phase 1** fixes correctness in the existing CSV path (unit-contract stamping, eliminates double-parse, removes `sequential_df`) — this is a hard gate: nothing else ships until CSV import is correct end-to-end. **Phase 2** wires box-counting as the primary Df algorithm with an N≥50 guard. **Phase 3** adds the MATLAB `.mat` importer and the explicit `.dat` rejection. **Phase 4** (largest) ships CSV localization (sniffer + user-profile override) and the new `ImportAggregateDialog` UI, including export unit changes (`radius_nm` column + locale-aware output). **Phase 5** is docs + final verification. Phases 2 and 3 can run in parallel after Phase 1 closes; within Phase 4, the backend locale group (T12–T16), the frontend sniffer lib (T19–T20), and tests run largely independently until the dialog (T21) consumes the sniffer.

## Dependency graph

```
Phase 1 (gate):
  T1 ──► T2 ──► T3 ──► T4 ──► T5
  (T1–T4 sequential on views.py/tasks.py; T5 runs after T4)

Phase 2 and Phase 3 run in PARALLEL after Phase 1:

  Phase 2:            Phase 3:
  T6 ──► T7           T10 (independent, quick) ──┐
                      T8 ──► T9 ─────────────────┤──► T11
                                                 │
                      (T8 independent of T10)────┘

Combined gate after Phase 2 + Phase 3 ──►

Phase 4:
  Backend locale group (parallel):
    T12 ──► T13
    T14 (independent, migration)
    T15, T16 (depend on T14 for profile fields)
  Backend locale tests:
    T17 (after T13), T18 (after T15 + T16)

  Frontend group (parallel with backend):
    T19 ──► T20
    T19 ──► T21 ──► T22
    T21 ──► T23
    T21 ──► T24
    T14 ──► T25 (settings UI needs profile fields)

Phase 5:
  T26, T27 (any time after Phase 4 backend is green)
  T28 (LAST — full test suite + manual acceptance)
```

**Parallel batches:**
- Batch A (Phase 2 ∥ Phase 3): T6+T7 alongside T8+T9+T10+T11
- Batch B (Phase 4 backend): T12→T13, T14, T15, T16 concurrent
- Batch C (Phase 4 frontend): T19→T20→T21→{T22,T23,T24} concurrent with Batch B
- Batch D: T26, T27 concurrent once code is green

## Tasks

### Phase 1 — Correctness foundation (fix existing CSV path)

#### T1. [backend] Extract reusable parser-entry helper in upload view
**Effort**: S
**Location**: `backend/apps/simulations/views.py` (upload branch in `SimulationViewSet.create` — around current CSV-upload handling)
**Depends on**: nothing
**Deliverables**:
- [x] Extract a private method `_parse_geometry_upload(uploaded_file, extension, overrides)` that dispatches on extension and returns `(particles, metadata)` tuple
- [x] Current CSV path routes through this helper (behavior unchanged for CSV)
- [x] Helper is typed (return type annotation, kwargs for locale overrides added empty for now)
**Risk**: Regressing existing CSV upload — mitigated by running existing CSV integration tests before moving on.
**Done when**: `pytest backend/apps/simulations/tests/ -k csv` all green with the helper in place.

#### T2. [backend] Stamp unit-contract parameters BEFORE serializer
**Effort**: M
**Location**: `backend/apps/simulations/views.py` (upload branch, after `_parse_geometry_upload` returns)
**Depends on**: T1
**Deliverables**:
- [x] Stamp `parameters["primary_particle_diameter_nm"]` from parsed geometry (nm, positive float)
- [x] Stamp `parameters["source"] = "imported"`, `parameters["original_filename"]`, `parameters["original_format"]` (`"csv"` | `"mat"`)
- [x] Stamp `parameters["import_metadata"]` with locale info from parser (CSV) or MATLAB variable info (.mat)
- [x] Stamp `parameters["schema_version"] = "v2"`
- [x] All stamping happens BEFORE `SimulationSerializer` is instantiated
**Risk**: Downstream code reading these params mid-pipeline — grep confirms stamping-before-serialize is the contract; verify no earlier readers.
**Done when**: A new simulation created via CSV upload has all 5 fields present in `parameters` when fetched via API.

#### T3. [backend] Eliminate double-parse in serializer
**Effort**: S
**Location**: `backend/apps/simulations/serializers.py` (`SimulationSerializer.validate` / `.create`)
**Depends on**: T2
**Deliverables**:
- [x] Remove CSV re-parse inside serializer; rely on particles already parsed in view
- [x] Serializer accepts parsed `particles` via context or extra kwarg
- [x] Serializer validation covers: particle count > 0, radii positive, no NaN coordinates (keep these checks — they're cheap)
**Risk**: Serializer used elsewhere (admin, management commands) — grep for all instantiations and audit.
**Done when**: `rg "parse_csv_geometry" backend/apps/simulations/serializers.py` returns zero matches.

#### T4. [backend] Remove `sequential_df` computation
**Effort**: S
**Location**: `backend/apps/simulations/tasks.py:1077-1094` (inside `compute_import_metrics`)
**Depends on**: T3
**Deliverables**:
- [x] Delete `sequential_df` block entirely
- [x] Leave placeholder comment: `# Df now computed via box-counting in T6`
- [x] `compute_import_metrics` still writes `fractal_prefactor` if already computed (keep other metrics untouched)
**Risk**: Migration orphans — check if any persisted sim has `sequential_df` in metrics JSON; if so, harmless leftover, not actively read.
**Done when**: `rg "sequential_df" backend/` returns only test files that assert its absence (if any) or zero matches.

#### T5. [tests] CSV v2 contract unit tests
**Effort**: M
**Location**: `backend/apps/simulations/tests/test_csv_import_v2_contract.py` (new file)
**Depends on**: T4
**Deliverables**:
- [x] Test: happy path CSV → all 5 parameter stamps present (R1, R2)
- [x] Test: `schema_version == "v2"` after create
- [x] Test: missing required column → 400 with clear error
- [x] Test: negative radius → 400
- [x] Test: invalid base64/garbled data → 400 (not 500)
- [x] Test: `primary_particle_diameter_nm` equals parsed value in nm (not raw unit)
- [x] ≥ 6 cases total
**Done when**: `pytest backend/apps/simulations/tests/test_csv_import_v2_contract.py -v` all green.

### Phase 2 — Box-counting as primary Df

#### T6. [backend] Wire box-counting into `compute_import_metrics`
**Effort**: M
**Location**: `backend/apps/simulations/tasks.py` (`compute_import_metrics`, where T4 left the placeholder)
**Depends on**: T4
**Deliverables**:
- [x] Call `aglogen_core.box_counting_agglomerate(particles)` guarded by `if len(particles) >= 50`
- [x] Write `metrics["fractal_dimension"]` (float) and `metrics["fractal_dimension_std"]` (float) on success
- [x] On `N < 50`: `metrics["fractal_dimension"] = None`, append to `metrics["notes"]`: `"fractal_dimension not computed: N < 50 particles (box-counting requires ≥ 50)"`
- [x] On algorithm failure (exception): log, set `fractal_dimension = None`, add note with error category
**Risk**: `aglogen_core.box_counting_agglomerate` signature/import path — verify exact name with `rg` in the Rust bindings before calling.
**Done when**: Import a 100-particle CSV → API returns numeric `fractal_dimension`; import a 20-particle CSV → returns `None` with note.

#### T7. [tests] Fractal fixture tests through import path
**Effort**: M
**Location**: `backend/apps/simulations/tests/test_box_counting_df.py` (new file)
**Depends on**: T6
**Deliverables**:
- [x] Fixture: line geometry (Df ≈ 1.0) from `fractal::limits` → assert Df within ±0.1
- [x] Fixture: plane (Df ≈ 2.0) → assert within ±0.15
- [x] Fixture: cube (Df ≈ 3.0) → assert within ±0.15
- [x] Fixture: Menger sponge (Df ≈ 2.73) from `fractal::fractals` → assert within ±0.2
- [x] Small-N test: N=20 → `fractal_dimension is None` AND note string matches spec R5
- [x] All fixtures go through the full import pipeline (upload → compute → fetch)
**Done when**: `pytest backend/apps/simulations/tests/test_box_counting_df.py -v` all green.

### Phase 3 — MATLAB `.mat` importer

#### T8. [backend] Implement `.mat` parser service
**Effort**: M
**Location**: `backend/apps/simulations/services/mat_parser.py` (new file)
**Depends on**: nothing (parallel with Phase 2)
**Deliverables**:
- [x] Function `parse_mat_geometry(file_bytes) -> tuple[list[Particle], dict]`
- [x] Uses `scipy.io.loadmat` with `appendmat=False`
- [x] Rejects HDF5/v7.3 files with message: `"MATLAB v7.3 / HDF5 .mat files not supported. Please re-save as v7 (default in MATLAB)."`
- [x] Variable preference order: `clusters` > `part`
- [x] If `part` is used and `NofPart` present: must equal 1 (else reject with multi-agglomerate message from spec)
- [x] Shape validation: expected Nx4 (x, y, z, radius) — reject with message if wrong
- [x] Returns `metadata = {"source_variable": "clusters"|"part", "mat_version": "v7", ...}`
- [x] All numeric conversions to float64, distances assumed in meters unless metadata says otherwise (per design C4)
**Risk**: scipy silently loads weird layouts — add explicit dtype/shape assertions with clear errors.
**Done when**: `python -c "from backend.apps.simulations.services.mat_parser import parse_mat_geometry"` imports cleanly; unit tests in T11 pass.

#### T9. [backend] Route `.mat` through upload pipeline
**Effort**: S
**Location**: `backend/apps/simulations/views.py` (`_parse_geometry_upload` from T1)
**Depends on**: T1, T8
**Deliverables**:
- [x] Add `.mat` branch dispatching to `parse_mat_geometry`
- [x] Re-center geometry to centroid (same post-parse step as CSV)
- [x] Stamp `original_format = "mat"` and MATLAB metadata into `import_metadata` (T2 already covers the stamping machinery)
**Done when**: POST a valid `.mat` file → simulation created with `original_format == "mat"` in params.

#### T10. [backend] Reject `.dat` before parse
**Effort**: S
**Location**: `backend/apps/simulations/views.py` (top of `_parse_geometry_upload`)
**Depends on**: T1
**Deliverables**:
- [x] If extension is `.dat`: return HTTP 400 with exact string from spec R7 (design Component 4 mirrors it)
- [x] Check happens BEFORE reading file contents (fast reject)
**Done when**: POST a `foo.dat` → 400 with the exact spec R7 error string.

#### T11. [tests] MAT import + .dat rejection tests
**Effort**: M
**Location**: `backend/apps/simulations/tests/test_mat_import.py` (new file)
**Depends on**: T9, T10
**Deliverables**:
- [x] `clusters` variable happy path
- [x] `part` + `NofPart=1` happy path
- [x] Both `clusters` and `part` present → `clusters` wins (assert metadata says so)
- [x] `part` + `NofPart > 1` → 400 with multi-agglomerate message
- [x] Wrong shape (e.g. Nx3) → 400
- [x] HDF5/v7.3 file → 400 with the re-save message
- [x] `.dat` extension → 400 with exact spec R7 string
**Done when**: `pytest backend/apps/simulations/tests/test_mat_import.py -v` all green.

### Phase 4 — CSV localization + export unit

#### T12. [backend] CSV parser strips `#key=value` metadata
**Effort**: M
**Location**: `backend/apps/simulations/utils.py` (`parse_csv_geometry`)
**Depends on**: Phase 1 gate closed
**Deliverables**:
- [x] Lines starting with `#` at file top are parsed as `key=value` into `metadata` dict
- [x] Malformed `#` lines (no `=`) are ignored (logged warning, not rejected)
- [x] Signature changes to return `(particles, metadata)` tuple; callers updated
- [x] Default `unit=nm` applied when metadata doesn't specify
**Risk**: Breaking existing callers — grep all usages, update in same PR.
**Done when**: `rg "parse_csv_geometry" backend/` shows all call sites unpacking 2-tuple.

#### T13. [backend] CSV locale detection (sniffer)
**Effort**: M
**Location**: `backend/apps/simulations/utils.py` (same module)
**Depends on**: T12
**Deliverables**:
- [x] `detect_csv_locale(sample_rows: list[str]) -> dict` returning `{decimal, delimiter, confidence, locale_warning}`
- [x] Sample size is first 5 data rows (post-metadata strip)
- [x] If < 5 rows available: still runs, sets `locale_warning=True` (spec threshold)
- [x] Heuristic: count `,` vs `;` vs `\t` for delimiter; count `.` vs `,` within numeric tokens for decimal
- [x] `parse_csv_geometry` accepts `decimal_override` and `delimiter_override` kwargs; when set, skip sniffer
- [x] Returns detection info in `metadata["locale"]`
**Done when**: Unit test (part of T17) validates US, EU, override, and small-sample paths.

#### T14. [backend] User profile CSV preferences + migration
**Effort**: S
**Location**: `backend/apps/users/models.py` + new migration
**Depends on**: nothing (parallel in Phase 4)
**Deliverables**:
- [x] Add `csv_decimal_separator = CharField(max_length=1, default='.', choices=[('.', 'Point'), (',', 'Comma')])`
- [x] Add `csv_column_delimiter = CharField(max_length=1, default=',', choices=[(',', 'Comma'), (';', 'Semicolon'), ('\t', 'Tab')])`
- [x] Migration `00XX_csv_locale_prefs.py` created
- [x] Migration auto-runs via existing `docker-compose.prod.yml` migrate step (verify — don't add new hook)
**Done when**: `python manage.py showmigrations apps.users` lists the new migration; `python manage.py migrate --check` clean after apply.

#### T15. [backend] Single-sim CSV export with locale + `radius_nm`
**Effort**: M
**Location**: `backend/apps/simulations/views.py` (~line 474, `export_csv` action from verify-rg)
**Depends on**: T14
**Deliverables**:
- [x] Read `request.user.csv_decimal_separator` and `csv_column_delimiter`
- [x] Apply to output via `csv.writer` dialect or custom formatting
- [x] New column `radius_nm` (float, nm units) added at end — additive, does not replace existing columns
- [x] Numeric formatting uses user's decimal separator
**Done when**: Export from a user with EU prefs produces `;`-delimited file with `,` decimals and `radius_nm` column.

#### T16. [backend] Batch CSV export locale + `radius_nm`
**Effort**: M
**Location**: `backend/apps/simulations/views.py` (~line 1116, batch export action)
**Depends on**: T14
**Deliverables**:
- [x] Same user-profile locale logic as T15
- [x] `Rg_nm` header already in place from verify-rg — don't touch
- [x] Add per-particle `radius_nm` when batch export includes particle data
**Done when**: Batch export for EU user → semicolon-delimited, comma-decimal, includes both `Rg_nm` and `radius_nm`.

#### T17. [tests] CSV import locale tests
**Effort**: M
**Location**: `backend/apps/simulations/tests/test_csv_import_locale.py` (new file)
**Depends on**: T13
**Deliverables**:
- [x] US format (`,` delim, `.` decimal) → parses correctly
- [x] EU format (`;` delim, `,` decimal) → parses correctly
- [x] Override kwargs bypass sniffer
- [x] Small-sample warning: 3-row CSV → `locale_warning=True` in metadata
- [x] Metadata lines: `#unit=um` changes parsed radii (conversion to nm)
- [x] Ambiguous file (mixed signals) → sniffer picks higher-confidence option, warning set
**Done when**: `pytest backend/apps/simulations/tests/test_csv_import_locale.py -v` all green.

#### T18. [tests] CSV export locale tests
**Effort**: M
**Location**: `backend/apps/simulations/tests/test_csv_export_locale.py` (new file)
**Depends on**: T15, T16
**Deliverables**:
- [x] US profile single export: `,` delim + `.` decimal + `radius_nm` present
- [x] EU profile single export: `;` + `,` + `radius_nm`
- [x] Mixed / default profile: fallback to US
- [x] Batch export mirrors single-export locale behavior
- [x] `radius_nm` column values equal stored radii in nm (roundtrip check)
**Done when**: `pytest backend/apps/simulations/tests/test_csv_export_locale.py -v` all green.

#### T19. [frontend] Client-side CSV sniffer lib
**Effort**: M
**Location**: `frontend/src/lib/csv-locale.ts` (new file)
**Depends on**: nothing (parallel)
**Deliverables**:
- [x] `detectCsvLocale(sample: string): { decimal, delimiter, confidence, warning }` — mirrors backend logic
- [x] `stripMetadataComments(raw: string): { body, metadata }` — strips `#key=value` lines
- [x] Pure functions, no DOM dependency (for testability)
- [x] Exported types reused by dialog
**Done when**: TypeScript compiles; T20 tests green.

#### T20. [frontend-test] CSV sniffer unit tests
**Effort**: M
**Location**: `frontend/src/lib/__tests__/csv-locale.test.ts` (new file)
**Depends on**: T19
**Deliverables**:
- [x] 6+ fixtures: US, EU, override-applied, ambiguous, metadata-only, empty
- [x] `stripMetadataComments` handles leading blank lines and mixed `#`/data
**Done when**: `npm test -- csv-locale` all green.

#### T21. [frontend] `ImportAggregateDialog` component
**Effort**: L
**Location**: `frontend/src/components/forms/ImportAggregateDialog.tsx` (new file)
**Depends on**: T19
**Deliverables**:
- [x] Tabs: "CSV" and "MATLAB (.mat)"
- [x] File input with extension validation (`.csv`, `.mat` accepted; `.dat` rejected client-side with clear message)
- [x] 10 MB size cap, error shown inline
- [x] CSV tab: preview sniffer result + manual override dropdowns (decimal, delimiter)
- [x] Submit wires to existing upload endpoint using `overrides` payload
- [x] Loading + error + success states
- [x] Accessible (labels, aria-describedby for errors)
**Done when**: Dialog renders via Storybook or manual mount; all states visible; upload succeeds end-to-end.

#### T22. [frontend-test] Dialog tests
**Effort**: M
**Location**: `frontend/src/components/forms/__tests__/ImportAggregateDialog.test.tsx` (new file)
**Depends on**: T21
**Deliverables**:
- [x] CSV upload happy path (mocked fetch)
- [x] MAT upload happy path
- [x] `.dat` rejection — error shown, no fetch call
- [x] Override interaction: changing decimal dropdown updates preview
- [x] Size cap: 11 MB file → error
**Done when**: `npm test -- ImportAggregateDialog` all green.

#### T23. [frontend] Top-level "Import Aggregate" button
**Effort**: S
**Location**: `frontend/src/app/projects/[id]/page.tsx`
**Depends on**: T21
**Deliverables**:
- [x] Button prominently placed above simulation list
- [x] Opens `ImportAggregateDialog`
- [x] On success, refreshes simulation list (existing hook)
**Done when**: Click button → dialog opens; complete upload → list refreshes.

#### T24. [frontend] Deprioritize `imported` entry in SimulationForm
**Effort**: S
**Location**: `frontend/src/components/forms/SimulationForm.tsx`
**Depends on**: T21
**Deliverables**:
- [x] `imported` source option still works (no removal)
- [x] Hint text added: `"For most users, use the 'Import Aggregate' button above the simulation list."`
- [x] Option moved to bottom of dropdown if applicable
**Done when**: Form renders with hint; legacy path still functional.

#### T25. [frontend] CSV preferences in settings
**Effort**: M
**Location**: `frontend/src/app/settings/page.tsx` (create if missing) + API binding
**Depends on**: T14
**Deliverables**:
- [x] Settings page exists (minimal shell if new)
- [x] "CSV Preferences" section with two dropdowns (decimal, delimiter)
- [x] Save button persists to user profile via existing user PATCH endpoint
- [x] Loads current values on mount
**Done when**: Change prefs → reload page → values persisted; CSV export reflects choice.

### Phase 5 — Docs + verification

#### T26. [docs] User-facing import guide
**Effort**: S
**Location**: `docs/import-aggregate.md` (new file)
**Depends on**: Phase 4 complete
**Deliverables**:
- [x] CSV format spec (columns, units, metadata lines)
- [x] MATLAB `.mat` format (v7 only, variable names, single-agglomerate)
- [x] `.dat` explicitly NOT supported + suggested conversion
- [x] Locale options + override behavior
- [x] N < 50 → no Df limitation explained
**Done when**: File exists, renders, linked from README import section.

#### T27. [docs] Changelog entry
**Effort**: S
**Location**: `CHANGELOG.md` (or equivalent)
**Depends on**: Phase 4 complete
**Deliverables**:
- [x] Note: schema v2 reinforced on imports
- [x] Note: new `radius_nm` export column (additive, non-breaking)
- [x] Note: box-counting Df (removes `sequential_df`) — breaking for any script reading that field
- [x] Note: `.mat` import added; `.dat` explicitly unsupported
**Done when**: Entry present under unreleased section with clear user-visible wording.

#### T28. [verify] Final full-suite verification
**Effort**: S
**Location**: repo root
**Depends on**: ALL previous tasks
**Deliverables**:
- [x] `cargo test` green (165 passed)
- [x] `pytest backend` green (83 passed)
- [x] `npm test` green (frontend — 57 passed)
- [x] Manual acceptance checklist documented in `.verify-import-aggregate.md` (pending post-deploy tick)
- [x] Verify all 34 scenarios from spec map to passing tests
**Done when**: All three test suites green AND manual checklist ticked.

## Effort summary

- **S**: 11 tasks — T1, T3, T4, T9, T10, T14, T23, T24, T26, T27, T28
- **M**: 16 tasks — T2, T5, T6, T7, T8, T11, T12, T13, T15, T16, T17, T18, T19, T20, T22, T25
- **L**: 1 task — T21
- **Total**: 28 tasks
