# Proposal: import-aggregate

## Intent

Close the validation loop. Imports from legacy tools (MATLAB `agloGen3D.m`) and
external CSV sources must be trustworthy, unit-correct, and use an independent
metric (box-counting Df) so a user can verify pyaglogen3D's simulator against
known reference geometries. Today the existing CSV path silently violates the
`rg-unit-contract` (no `primary_particle_diameter_nm` stamped) and fits Df from
CSV row order — both are correctness bugs hiding behind a buried UI entry.

See `explore.md` for full investigation.

## Scope

### In Scope

- Fix unit-contract bug on CSV import (stamp `primary_particle_diameter_nm`).
- Drop Rg-law Df for imports; replace with box-counting as the only trusted Df.
- Regression tests for CSV import path (currently zero coverage).
- MATLAB `.mat` single-agglomerate importer (`scipy.io.loadmat`).
- Explicit rejection of `.dat` files with a helpful error (see explore §2.2).
- CSV schema Option A: optional `#key=value` metadata lines, default unit=`nm`.
- Coordinate re-centering to CoM on import.
- Top-level "Import Aggregate" button on project page.
- CSV import locale auto-detect (decimal/delimiter) + manual override in dialog.
- CSV export locale preference on user profile (decimal + delimiter).
- CSV export adds `radius_nm` column alongside existing `radius` (additive).
- User profile model extension + migration for CSV preferences.

### Out of Scope (deferred)

- Multi-agglomerate `.mat` import (Q6 — future change).
- MATLAB v7.3 (HDF5) support.
- Bidirectional `.mat` export back to MATLAB.
- Aggregate comparison page (imported vs simulated side-by-side).
- Retroactive migration of historical imports with bad Df metrics.

## Approach

Four phases, ordered by risk and dependency:

1. **Fix existing CSV path** — unit-contract stamp + drop `sequential_df`.
   Unblocks regression tests and makes current prod imports correct.
2. **Box-counting on import** — wire `compute_import_metrics` into
   `aglogen_core.box_counting_agglomerate`. Replaces the Rg-law Df entirely.
3. **MATLAB `.mat` importer** — new `services/mat_parser.py`. Reuses the
   validated CSV pipeline post-parse (same `(N×4)` contract). `.dat` files
   rejected early with explicit error.
4. **CSV localization + export unit** — sniffer (import), user profile
   preference (export), new `radius_nm` column. UI dialog + settings page.

Phase 1 reuses the `get_primary_particle_diameter_nm` shim already shipped by
verify-rg. Phase 2 swaps the ordered-Df computation for an independent
geometric one — the existing `sequential_df` field is removed, not renamed,
because it was never a user-contracted output. Phase 3 follows the existing
base64-via-JSON upload precedent (FRAKTAL, RAG) — no multipart machinery.
Phase 4 adds scope but no architectural risk: sniffer is read-side, profile
prefs are write-side, both isolated.

**Testing strategy**: each phase ships its own regression tests. Phase 1 adds
unit-contract assertions; phase 2 adds box-counting cross-check fixture;
phase 3 adds `.mat` happy path + `.dat` rejection; phase 4 adds locale roundtrip.

**Migration risk**: existing production imports have bad Df values from the
Rg-law path. Change notes must flag this; a recompute action may follow in a
future change but is not in scope here.

### Key decisions (locked)

- **Q1** framing: both paths shipped (MATLAB primary + CSV secondary).
- **Q2** MATLAB: `.mat` single-agglomerate MVP; `.dat` rejected explicitly.
- **Q3** CSV: Option A — `#key=value` metadata, default `unit=nm`, backwards-compat.
- **Q4** Df: box-counting only; `sequential_df` removed.
- **Q5** UX: top-level "Import Aggregate" button; dropdown entry deprioritized.
- **Q6** Batch: single-agglomerate MVP only.
- **Extra-A** CSV import: auto-detect decimal/delimiter + manual override.
- **Extra-B** CSV export: user-profile locale preference (default `.` + `,`).
- **Extra-C** CSV export: new `radius_nm` column alongside existing `radius`.

## Capabilities

### New Capabilities

- `import-aggregate-contract`: end-to-end contract for importing geometries
  from CSV and `.mat`, with unit-correct metrics (box-counting Df),
  locale-aware CSV handling, and a first-class UI entry point.

### Modified Capabilities

- `rg-unit-contract`: reinforced by requiring import paths to stamp
  `primary_particle_diameter_nm`. No breaking change to the contract.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/apps/simulations/views.py` | Modified | Upload branch: stamp `primary_particle_diameter_nm`; route `.mat` to new parser |
| `backend/apps/simulations/serializers.py` | Modified | Validator updates for metadata lines and locale hints |
| `backend/apps/simulations/utils.py` | Modified | CSV parser: metadata comment lines + locale sniff |
| `backend/apps/simulations/services/mat_parser.py` | New | MATLAB `.mat` single-agglomerate importer |
| `backend/apps/simulations/tasks.py` | Modified | `compute_import_metrics`: drop Rg-law Df, call box-counting |
| `backend/apps/simulations/tests/test_csv_import.py` | New | Unit-contract + parser regression tests |
| `backend/apps/simulations/tests/test_mat_import.py` | New | `.mat` happy path + `.dat` rejection |
| `backend/apps/simulations/tests/test_csv_export_locale.py` | New | Locale roundtrip tests |
| `backend/apps/accounts/models.py` | Modified | User profile: `csv_decimal_separator`, `csv_column_delimiter` |
| `backend/apps/accounts/migrations/` | New | Nullable fields with sensible defaults |
| `frontend/src/components/forms/ImportAggregateDialog.tsx` | New | Elevated upload dialog with locale override |
| `frontend/src/app/projects/[id]/page.tsx` | Modified | Add top-level "Import Aggregate" button |
| `frontend/src/components/forms/SimulationForm.tsx` | Modified | Deprioritize `imported` dropdown entry |
| `frontend/src/lib/csv-locale.ts` | New | Decimal/delimiter sniffer |
| `frontend/src/app/settings/page.tsx` | Modified/New | CSV preferences section |
| `docs/import-aggregate.md` | New | User-facing "how to import" guide |

## Success Criteria

- [ ] Existing CSV imports stop silently misscaling Rg (unit contract honored).
- [ ] Df for imports comes from box-counting, never CSV row order.
- [ ] MATLAB `.mat` file imports end-to-end (single-agglomerate).
- [ ] `.dat` files rejected with a clear error pointing to the correct format.
- [ ] European user (comma decimal) can upload AND download CSVs in their locale.
- [ ] CSV export includes `radius_nm` column with correct nm values.
- [ ] User profile persists CSV locale preference across sessions.
- [ ] "Import Aggregate" button visible from project page (not only dropdown).
- [ ] Regression tests cover: happy path, wrong unit, missing column, `.dat` rejection, locale variants.
- [ ] `verify-rg` tests still green; non-import simulations unaffected.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Historical prod imports have bad Df from Rg-law path | High | Changelog note flagging recompute-needed; recompute action deferred to follow-up change |
| Users rely on buried "imported" dropdown | Medium | Keep dropdown entry working; only deprioritize visually |
| `.mat` format varies across MATLAB versions | Medium | MVP targets `-v7` via `scipy.io.loadmat`; document `-v7.3` fallback pattern (`h5py`) for future |
| Locale auto-detect false positives | Medium | UI shows detected format; user can override in the same dialog |
| Profile model migration on prod | Low | Idempotent migration, nullable fields, sensible defaults |
| Box-counting precision on small N | Low | Document minimum N; add sanity test with known Df |

## Rollback Plan

In reverse dependency order (safe per step):

1. **Frontend** — revert `ImportAggregateDialog`, project-page button, settings
   section, sniffer. The dropdown entry remains functional.
2. **CSV export locale** — revert export serializer changes; user profile
   fields stay (nullable, harmless).
3. **MATLAB importer** — remove `mat_parser.py` and its route in `views.py`.
   CSV path unaffected.
4. **Box-counting on import** — restore prior `compute_import_metrics` logic.
   Historical metrics regenerated by task rerun.
5. **Unit-contract stamp** — revert `views.py` branch; existing imports
   continue scaling via the 25 nm fallback (pre-change behavior).
6. **Profile migration** — `makemigrations` reverse; fields are nullable so no
   data loss.

## Dependencies

- `rg-unit-contract` (shipped by `verify-rg`) — `get_primary_particle_diameter_nm`
  shim is reused. No external dependencies.

## Open Questions (deferred to spec/design)

- `csv.Sniffer` heuristics fragile on small files — require ≥3 data rows?
- Minimum N for stable box-counting Df on import fixtures?
- `.mat` import: validate column count (must be 4) and warn on negative radii?
