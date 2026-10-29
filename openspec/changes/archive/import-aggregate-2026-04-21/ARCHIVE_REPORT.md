# Archive Report — import-aggregate

**Change**: `import-aggregate`
**Archived on**: 2026-04-21
**Archive location**: `openspec/changes/archive/import-aggregate-2026-04-21/`
**Previous archive**: `verify-rg-2026-04-20` (retained — rg-unit-contract scenarios preserved and extended)

## Scope summary

End-to-end import pipeline overhaul: CSV correctness fix (schema v2 + diameter stamping + elimination of double-parse), box-counting fractal dimension as primary Df algorithm with N≥50 guard, MATLAB `.mat` importer, explicit `.dat` rejection, CSV locale handling (sniffer + user profile override) on both import and export paths, `radius_nm` export column, new `ImportAggregateDialog` UI, and user-facing documentation.

## Task summary (28 total)

| # | Task | Status |
|---|------|--------|
| T1 | [backend] Extract reusable parser-entry helper in upload view | ✅ |
| T2 | [backend] Stamp unit-contract parameters BEFORE serializer | ✅ |
| T3 | [backend] Eliminate double-parse in serializer | ✅ |
| T4 | [backend] Remove `sequential_df` computation | ✅ |
| T5 | [tests] CSV v2 contract unit tests | ✅ |
| T6 | [backend] Wire box-counting into `compute_import_metrics` | ✅ |
| T7 | [tests] Fractal fixture tests through import path | ✅ |
| T8 | [backend] Implement `.mat` parser service | ✅ |
| T9 | [backend] Route `.mat` through upload pipeline | ✅ |
| T10 | [backend] Reject `.dat` before parse | ✅ |
| T11 | [tests] MAT import + `.dat` rejection tests | ✅ |
| T12 | [backend] CSV parser strips `#key=value` metadata | ✅ |
| T13 | [backend] CSV locale detection (sniffer) | ✅ |
| T14 | [backend] User profile CSV preferences + migration | ✅ |
| T15 | [backend] Single-sim CSV export with locale + `radius_nm` | ✅ |
| T16 | [backend] Batch CSV export locale + `radius_nm` | ✅ |
| T17 | [tests] CSV import locale tests | ✅ |
| T18 | [tests] CSV export locale tests | ✅ |
| T19 | [frontend] Client-side CSV sniffer lib | ✅ |
| T20 | [frontend-test] CSV sniffer unit tests | ✅ |
| T21 | [frontend] `ImportAggregateDialog` component | ✅ |
| T22 | [frontend-test] Dialog tests | ✅ |
| T23 | [frontend] Top-level "Import Aggregate" button | ✅ |
| T24 | [frontend] Deprioritize `imported` entry in SimulationForm | ✅ |
| T25 | [frontend] CSV preferences in settings | ✅ |
| T26 | [docs] User-facing import guide | ✅ |
| T27 | [docs] Changelog entry | ✅ |
| T28 | [verify] Final full-suite verification | ✅ (manual acceptance checklist deferred post-deploy) |

**All 28 tasks complete.** T28 manual acceptance checklist (8 items) is deferred to the post-deploy/staging phase and is tracked as an open list in the appendix below.

## Commits (5 total)

Range: `7b8751b^..HEAD` on `main`

| Hash | Message |
|------|---------|
| `7b8751b` | feat(import-aggregate): apply Phase 1 GATE — CSV correctness fix |
| `c9eeadf` | feat(import-aggregate): apply Phase 2 (box-counting Df) + Phase 3 (.mat importer) |
| `891e3f1` | feat(import-aggregate): apply Phase 4 backend — CSV localization + radius_nm |
| `a7ebdc6` | feat(import-aggregate): apply Phase 4 frontend — locale lib + dialog + UI wiring |
| `3230050` | docs(import-aggregate): add user guide + changelog entry (Phase 5) |

## Test count delta

| Layer | Before | After | Δ |
|-------|--------|-------|---|
| Engine (Rust / cargo, `-p aglogen-engine`) | 160 | 165 | +5 |
| Backend (Python / pytest, `apps/simulations/tests/`) | ~62 | 83 | +21 |
| Frontend (TypeScript / vitest) | 0 | 57 | +57 |
| **Total** | **~222** | **305** | **+83** |

New test files added by this change:
- `backend/apps/simulations/tests/test_csv_import_v2_contract.py`
- `backend/apps/simulations/tests/test_box_counting_df.py` (fractal fixtures)
- `backend/apps/simulations/tests/test_mat_import.py`
- `backend/apps/simulations/tests/test_csv_import_locale.py`
- `backend/apps/simulations/tests/test_csv_export_locale.py`
- `backend/apps/simulations/tests/test_csv_export_units.py`
- `backend/apps/simulations/tests/test_import_metrics_fixtures.py`
- `frontend/src/lib/__tests__/csv-locale.test.ts` (12 tests)
- `frontend/src/lib/__tests__/units.test.ts` (29 tests)
- `frontend/src/components/banners/__tests__/UnitConventionBanner.test.tsx` (6 tests — introduced with locale-aware UI)
- `frontend/src/components/forms/__tests__/ImportAggregateDialog.test.tsx` (10 tests)

## Canonical spec changes

- **New canonical spec**: `openspec/specs/import-aggregate-contract.md` (copied from delta, 322 lines)
- **Merged delta into `openspec/specs/rg-unit-contract.md`**:
  - R2 "Parameter schema versioning" — appended scenario "Imported simulation is written as v2"; header sentence extended to call out the import path
  - R3 "Read-side shim for parameter keys" — appended scenario "Imported simulation resolves via the shim"; header sentence extended
  - All verify-rg scenarios preserved (Scaling invariance, Translation invariance, Line, Hex, Single particle, Empty input, New-as-v2, Legacy-as-v1, v2-present, Only-legacy-v1, Neither-key, Writes-use-new-key, Single-sim CSV, Batch-study CSV, Legacy export, Display surfaces, Chart axis, Banner appears / dismissable / not-for-v2, Doc exists)

## Known follow-ups (deferred)

1. **Historical import recompute**: simulations imported before this change have stale `sequential_df` in their metrics blob (field now removed) and potentially stale `fractal_dimension` from the Rg-law fit. A data-migration / recompute job that walks existing imported simulations and re-runs `compute_import_metrics` with box-counting is **deferred to a future change**.

2. **Multi-agglomerate `.mat`**: Q6 from explore — supporting files with `NofPart` length > 1 would require splitting into N simulations (one per agglomerate) with shared provenance metadata. **Deferred.**

3. **MATLAB v7.3 (HDF5) `.mat`**: currently rejected with a clear re-save message. Future work to add an `h5py` fallback for the HDF5 variant. **Deferred.**

4. **Bidirectional `.mat` export**: export a simulation back into MATLAB v7 format so the round-trip MATLAB → pyAgloGen3D → MATLAB is clean. **Deferred.**

5. **Aggregate comparison page**: side-by-side view of an imported aggregate vs a simulator-generated aggregate with matching N and Df, for validation of the importer against known-good geometries. **Deferred.**

6. **T28 manual acceptance (post-deploy)**: 8 checklist items in the appendix (staging / prod sanity pass). These are NOT regressions — they are one-time smoke tests for the new upload paths, locale preferences, and UI. To be ticked after the next staging deploy.

## Appendix — consolidated verification report

_Originally at repo root as `.verify-import-aggregate.md`, deleted after consolidation._

### Timestamp

2026-04-21T12:33:50+02:00 — Phase 5, T28 final verification.

### Test suites

#### Engine (Rust / cargo)

```
cargo test -p aglogen-engine
```

`test result: ok. 165 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 23.22s`

- Passed: **165**
- Failed: **0**
- Ignored: 1 (pre-existing doc-test / unrelated)

#### Backend (Python / pytest)

```
uv run pytest apps/simulations/tests/ --no-migrations
```

`83 passed, 32 warnings in 6.87s`

- Passed: **83**
- Failed: **0**
- Warnings: 32 (benign — `staticfiles` dir not present, unrelated to correctness)

Covers the new files added by this change: `test_csv_import_v2_contract.py`, `test_csv_export_locale.py`, `test_csv_export_units.py`, `test_import_metrics_fixtures.py`, `test_mat_import.py`, plus pre-existing `test_params_shim.py` from verify-rg.

#### Frontend (TypeScript / vitest)

```
npm test
```

`Test Files 4 passed (4); Tests 57 passed (57)` in 8.88s

- Passed: **57** across 4 files
- Failed: **0**

Files:
- `src/lib/__tests__/csv-locale.test.ts` — 12 tests
- `src/lib/__tests__/units.test.ts` — 29 tests
- `src/components/banners/__tests__/UnitConventionBanner.test.tsx` — 6 tests
- `src/components/forms/__tests__/ImportAggregateDialog.test.tsx` — 10 tests

### Migrations

Postgres dev DB was not running at verification time, so `showmigrations` could not query applied state. **Migration files on disk verified present**:

- `backend/apps/accounts/migrations/0004_csv_locale_prefs.py` ✅
- `backend/apps/ai_assistant/migrations/0003_conversation_chatmessage_notification.py` ✅

Migrations auto-apply via the existing `docker-compose.prod.yml` migrate step (per T14 contract — no new hook added).

### TypeScript

```
npx tsc --noEmit
```

**Exit code: 0** — no type errors.

### Code hygiene

```
grep -rn "sequential_df\|sequential_kf" backend/apps/ | grep -v "test_\|# "
```

**Result: empty** — no stray `sequential_df` / `sequential_kf` references in production code. Phase 1 (T4) removal is clean.

### Summary table

| Check | Status |
|-------|--------|
| Engine tests (165) | ✅ |
| Backend tests (83) | ✅ |
| Frontend tests (57) | ✅ |
| `tsc --noEmit` clean | ✅ |
| Migration files present | ✅ |
| No stray `sequential_df` | ✅ |
| Docs (`docs/import-aggregate.md`) | ✅ |
| Changelog entry | ✅ |

**Total new+existing test coverage**: 305 tests green (165 engine + 83 backend + 57 frontend).

### Manual acceptance checklist (post-deploy on staging / prod)

_Deferred — to be ticked after the next staging deploy._

- [ ] Upload a CSV from MATLAB export — verify Df via box-counting appears (not from row order)
- [ ] Upload a `.mat` file — verify it imports and metrics look right
- [ ] Try to upload a `.dat` file — verify clear error message
- [ ] Change CSV preferences in Settings → export → verify format applies
- [ ] European user: upload `;`-delimited CSV with `,` decimals — verify parses correctly
- [ ] Upload CSV with < 50 particles — verify Df shows as "insufficient particles"
- [ ] Check that verify-rg's schema v2 banner is NOT shown for newly imported simulations
- [ ] Verify old non-import simulations still show Rg in nm correctly (no regression)

---

**SDD cycle complete.** Ready for the next change.
