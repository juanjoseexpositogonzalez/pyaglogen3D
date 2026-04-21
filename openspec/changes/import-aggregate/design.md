# Design: import-aggregate

## Architecture overview

Imports flow through a single pipeline regardless of source format. The upload
view detects the format (extension + content-type), dispatches to a format-
specific parser, converts to the canonical `(N × 4)` geometry, stamps the
`rg-unit-contract` keys into `parameters` **before** the serializer runs, and
enqueues `compute_import_metrics_task`. The task computes geometry-only metrics
plus **box-counting Df** (no Rg-law fit), and writes `metrics`. Frontend surfaces
a top-level Import dialog with client-side locale sniffing; CSV export honors
per-user locale preferences.

```
  [Client]                      [Backend]                          [Worker]
  ImportAggregate ──POST──► views.py::upload
    Dialog                   │
      │  base64+format       ├── .dat? → 400 reject (explicit msg)
      │                      ├── .mat? → mat_parser.parse_mat_geometry
      │                      └── .csv? → utils.parse_csv_geometry(locale)
      │                         │
      │                         ├─ stamp primary_particle_diameter_nm
      │                         │  + schema_version=v2 + import_metadata
      │                         │  + re-center coords to mass-weighted CoM
      │                         │
      │                         ├─ serializer.create → Simulation row
      │                         └─ enqueue compute_import_metrics_task ──►
      │                                                                  │
      │◄── 201 { id }                                     box_counting_agglomerate
      │                                                   + Rg, porosity, shape …
      │                                                   write metrics JSON
```

## Key components

### Component 1: services/params.py — REUSED
Shipped by `verify-rg`. Used here to stamp `primary_particle_diameter_nm` and
read it back via the shim (`get_primary_particle_diameter_nm`). No changes.

### Component 2: services/mat_parser.py — NEW
- **Location**: `backend/apps/simulations/services/mat_parser.py`
- **Purpose**: parse MATLAB `.mat` single-agglomerate files
- **Interface**:
  ```python
  def parse_mat_geometry(raw: bytes) -> tuple[np.ndarray, dict]:
      """Returns (geometry (N,4) float64, metadata dict)."""
  ```
- **Behavior**:
  - `scipy.io.loadmat(BytesIO(raw), squeeze_me=True)`; on `NotImplementedError`
    raise `ImportError("MATLAB v7.3 (HDF5) not supported; save as -v7 or earlier")`.
  - Variable preference: `clusters` → `part` (fallback). If both exist, prefer
    `clusters`.
  - If `part` + `NofPart` present and `NofPart` has `> 1` element → raise
    `ImportError("Multi-agglomerate .mat not supported; export a single agglomerate")`.
  - Validate shape: must be 2-D `(N, 4)` with `N > 0`. Cast to `float64`.
  - Validate: all radii (`col 3`) positive; all values finite.
  - Return `geometry` + `{"source": "matlab", "original_variable": "clusters"|"part", "n_particles": N}`.

### Component 3: utils.parse_csv_geometry — EXTENDED
- **Location**: `backend/apps/simulations/utils.py`
- **New signature**:
  ```python
  def parse_csv_geometry(
      raw: bytes,
      *,
      decimal_override: str | None = None,
      delimiter_override: str | None = None,
  ) -> tuple[np.ndarray, int, float, float, dict]:
      """Returns (geometry, n_particles, radius_min, radius_max, metadata)."""
  ```
- **New behavior**:
  - Strip leading `#key=value` lines, collect them into `metadata` dict.
  - Locale detection uses a sample of the **first 5 data rows**:
    - Delimiter: `csv.Sniffer().sniff(sample)` first; fallback to `,`.
    - Decimal: count `,` vs `.` occurrences in numeric tokens. `.` if only
      dots, `,` if only commas, default `.` if both/none appear.
  - **Small-sample warning** (not error): if fewer than 5 data rows are
    available, detection still runs but the return dict includes
    `locale_warning=True` so the view can forward it to the frontend.
    Parsing itself does not fail — the user can re-upload with
    `locale_override` if the detected format is wrong.
  - Overrides (`decimal_override`, `delimiter_override`) bypass detection
    entirely.
  - Existing validations preserved (columns `x,y,z,radius`, `radius > 0`,
    `N ≤ 100_000`, finite values).

### Component 4: views.py upload branch — MODIFIED
- **Location**: `backend/apps/simulations/views.py` (imported-algorithm branch
  currently at lines 74–125).
- **Changes**:
  - Route by filename/content-type BEFORE decoding:
    - `*.dat` → HTTP 400 with message: *"The .dat format from Box-Counter
      contains tessellated surface points, not per-particle coordinates.
      To import an aggregate, use CSV (.csv) or MATLAB (.mat) with
      per-particle (x, y, z, radius) data."*
    - `*.mat` → `parse_mat_geometry`
    - `*.csv` or default → `parse_csv_geometry(locale from request)`
  - Re-center coordinates to mass-weighted CoM (weights = `radius**3`).
  - Compute `primary_particle_diameter_nm = 2 * mean(radius)` if import
    metadata does not provide one; otherwise honor the metadata override.
  - Inject into `parameters` **before** passing to serializer:
    - `primary_particle_diameter_nm`
    - `source` (`csv_import` | `mat_import`)
    - `original_filename`
    - `original_format` (`csv` | `mat`)
    - `import_metadata` (metadata dict from parser)
  - Serializer then stamps `parameters_schema_version = "v2"` as today.
  - Eliminate the double-parse: validate by invoking the parser once in the
    view; serializer validator only checks size/base64.

### Component 5: tasks.py compute_import_metrics — MODIFIED
- **Location**: `backend/apps/simulations/tasks.py:990–1114`.
- **Remove**: Rg-law `Df(n)` fit (`tasks.py:1077-1094`) entirely — including any
  `sequential_df`, `sequential_kf` writes.
- **Add**: `from aglogen_core import box_counting_agglomerate`.
  - Call `box_counting_agglomerate(coords, radii, precision=18)`.
  - Store result under `metrics.fractal_dimension` + `metrics.fractal_dimension_std`
    (stderr derived from R², or `None` if unavailable).
- **Small-N guard**: if `N < 50`, set `fractal_dimension = None` and
  `metrics.notes.fractal_dimension = "Insufficient particles for stable
  box-counting (N < 50)"`. Threshold of 50 chosen because box-counting
  needs enough points to resolve the power-law region at multiple scales;
  below ~50 particles, any Df < 3.0 is noise-dominated. Other geometric
  metrics (Rg, porosity, coordination, shape) ARE still computed (they
  don't require scale-wise statistics). Threshold documented in
  `docs/import-aggregate.md`.
- Keep: `Rg`, `porosity`, `coordination`, `principal_moments`, `anisotropy`,
  `asphericity`, `acylindricity`. Drop `rg_evolution` for imports (order-
  dependent, misleading — §4.3 of explore).

### Component 6: User profile model — EXTENDED
- **Location**: `backend/apps/accounts/models.py`
- **New fields**:
  ```python
  csv_decimal_separator = CharField(
      max_length=1, choices=[('.', '.'), (',', ',')], default='.'
  )
  csv_column_delimiter = CharField(
      max_length=1, choices=[(',', ','), (';', ';')], default=','
  )
  ```
- **Migration**: `backend/apps/accounts/migrations/00XX_csv_locale_prefs.py`.
  Fields are `null=False` with defaults applied to existing rows (data migration
  not required — Django fills defaults on ALTER).

### Component 7: CSV export views — MODIFIED
- **Location**: single-sim and batch export views in
  `backend/apps/simulations/views.py` (Unit column already added by `verify-rg`).
- **Changes**:
  - Read `request.user.csv_decimal_separator` and `csv_column_delimiter`.
  - Pass `delimiter` to `csv.writer` natively.
  - Post-process numeric cells to replace `.` with the user's decimal (Python's
    `csv` module does not handle locale decimals).
  - Add `radius_nm` column: `radius_engine * (D_nm / 2)` using the shim.
  - Existing `radius` column stays (engine units) — additive change.

### Component 8: ImportAggregateDialog.tsx — NEW
- **Location**: `frontend/src/components/forms/ImportAggregateDialog.tsx`
- **Props**: `{ projectId: string; open: boolean; onClose: () => void; onSuccess: (simId: string) => void }`
- **Layout**: tabbed dialog, two tabs: **CSV** | **MATLAB (.mat)**.
- **CSV tab**:
  - `<input type="file" accept=".csv">` + 10 MB client guard.
  - On file pick: read text, run `detectCsvLocale` + `stripMetadataComments`.
  - Show detected `decimal` and `delimiter` with override dropdowns.
  - Preview first 5 parsed rows + metadata kv list.
- **MATLAB tab**:
  - `<input type="file" accept=".mat">` + 10 MB client guard.
  - Info panel: *"Single-agglomerate files only. v7.3 (HDF5) not supported."*
- **Validation**: reject `.dat` on both tabs with explicit message before submit.
- **Submit**: base64 payload → existing POST endpoint with `algorithm=imported`.

### Component 9: csv-locale.ts — NEW
- **Location**: `frontend/src/lib/csv-locale.ts`
- **Functions**:
  ```ts
  export function detectCsvLocale(text: string):
    { decimal: '.' | ','; delimiter: ',' | ';'; ambiguous: boolean }
  export function stripMetadataComments(text: string):
    { metadata: Record<string, string>; body: string }
  ```
- **Heuristic**:
  - `delimiter`: count `;` vs `,` outside quotes on first non-comment line; if
    tie, default to `,`.
  - `decimal`: inspect numeric tokens on first data row; if any token contains
    both `,` and `.` → `.` is decimal, `,` is thousands (reject as ambiguous
    unless user overrides); else the rarer one is decimal.

### Component 10: Project page button — MODIFIED
- **Location**: `frontend/src/app/projects/[id]/page.tsx`
- **Change**: add `<Button onClick={() => setImportOpen(true)}>Import Aggregate</Button>`
  next to the existing "New Simulation" button. Mount `<ImportAggregateDialog>`.
  The existing dropdown entry (`SimulationAlgorithm.IMPORTED`) stays but is
  visually deprioritized (last position, lighter label).

### Component 11: Settings page CSV section — NEW
- **Location**: `frontend/src/app/settings/page.tsx` (extend existing section).
- **UI**: "CSV Preferences" card with two `<Select>`s (decimal `.` / `,`,
  delimiter `,` / `;`). PATCH to `/api/accounts/profile/` on change.
- **Accounts API**: extend profile serializer to expose/accept the two new fields.

## Data model changes

### User profile (`backend/apps/accounts/models.py`)
- `csv_decimal_separator: CharField(1)`, default `'.'`
- `csv_column_delimiter: CharField(1)`, default `','`

### `Simulation.parameters` (JSON, `imported` branch, post-change)
MUST contain:
- `parameters_schema_version = "v2"` (serializer)
- `primary_particle_diameter_nm: float` (view)
- `source: "csv_import" | "mat_import"` (view)
- `original_filename: str` (view)
- `original_format: "csv" | "mat"` (view) — NEW
- `import_metadata: dict` (view) — NEW, captures `#key=value` lines or `.mat`
  source variable info.

### `Simulation.metrics` (JSON, `imported`)
- `fractal_dimension: float | None` (from box-counting)
- `fractal_dimension_std: float | None`
- `radius_of_gyration: float` (mass-weighted)
- `porosity, coordination, principal_moments, principal_axes,
  anisotropy, asphericity, acylindricity` — unchanged
- `notes: list[str]` — NEW, optional
- **REMOVED**: `sequential_df`, `sequential_kf`, `rg_evolution` (imports only;
  simulator outputs keep these).

## Edge cases

| Case | Handling |
|------|----------|
| Empty CSV (header only) | Reject: `"CSV has no data rows"` |
| CSV with mixed-locale numbers | `detectCsvLocale` returns `ambiguous=true` → require user override |
| `.mat` with `-v7.3` (HDF5) | Reject: `"MATLAB v7.3 not supported"` |
| `.mat` with cell array | Try `np.vstack` on cell contents; else reject |
| `.mat` multi-agglomerate (`NofPart` > 1 entry) | Reject with guidance |
| Negative or non-finite radii | Reject (parser) |
| Non-finite coordinates (NaN/Inf) | Reject (parser) |
| `N > 100_000` | Reject (existing limit preserved) |
| User has no profile prefs (first-time) | Apply defaults `.` + `,` |
| `.dat` file | Reject BEFORE parse with explicit error |
| Locale sniffer ambiguous, no override | Error: `"Set decimal/delimiter in dialog"` |
| `import_metadata.primary_particle_diameter_nm` present | Use user value, skip auto-compute |
| `import_metadata.unit = "dimensionless"` | Stamp `primary_particle_diameter_nm = 50.0` |

## Backwards compatibility

- Existing `algorithm="imported"` rows keep working. `get_primary_particle_diameter_nm`
  shim resolves v1 rows to diameter via `radius * 2`; v2-imported rows now have
  the field stamped correctly.
- Old CSV files (no `#`-metadata) parse unchanged — metadata stripping is a no-op.
- `sequential_df` removal: the frontend never reads this field (`SimulationDetail`,
  `BatchResultsTable`, AI sidebar all key off `fractal_dimension`), so removal
  is safe. Historical rows retain the field as dead data until a future recompute
  change — documented in the changelog as non-trustworthy.
- CSV export additive change: `radius_nm` column appended AFTER existing columns;
  consumers reading by header name are unaffected. `Unit` column already present
  from `verify-rg`.
- Profile prefs default to current behavior (`.` decimal, `,` delimiter) → no
  user-visible diff until the user changes them.

## Testing strategy

### Unit tests (Python)
- `test_csv_import.py` (new):
  - unit-contract stamping (`primary_particle_diameter_nm` present, schema v2)
  - `#key=value` metadata extraction
  - locale sniff (US, EU, ambiguous)
  - locale override
  - missing column rejection
  - negative radii rejection
  - `.dat` rejection via view
- `test_mat_import.py` (new):
  - happy path with `clusters` variable
  - happy path with `part` variable (single agglomerate, `NofPart = [N]`)
  - multi-agglomerate rejection (`NofPart = [10, 15]`)
  - invalid shape rejection
  - HDF5 (v7.3) rejection
- `test_params_shim.py`: existing coverage from `verify-rg` retained.
- `test_compute_import_metrics.py` (extend):
  - box-counting path produces finite Df on known aggregate
  - small-N (`N=5`) returns `fractal_dimension=None` + `notes`
  - known-geometry cross-check: linear chain → Df ≈ 1.0 ± tol

### Unit tests (TypeScript)
- `csv-locale.test.ts` (new): 6 fixtures — US standard, EU (`;` + `,`),
  ambiguous (mixed), override-wins, minimal 2 rows, metadata-only file.
- `ImportAggregateDialog.test.tsx` (new): renders CSV tab, MAT tab, `.dat`
  rejection UX, 10 MB limit guard, submit payload shape.

### Integration tests
- `test_csv_export_locale.py` (new): user with `(',', ';')` prefs → exported
  CSV uses `;` delimiter and `,` decimal; `radius_nm` column present.
- `test_import_end_to_end.py` (new): upload CSV → poll task → assert
  `metrics.fractal_dimension` from box-counting, `sequential_df` absent.

### Manual verification (T12-equivalent smoke)
- Upload a known `.mat` file from `pyaglogen3D/matlab_reference/` fixtures.
- Upload a European-locale CSV (`;` + `,`).
- Verify detail page: Rg in nm, Df from box-counting, banner absent (v2 stamped).
- Export CSV, verify `radius_nm` column + locale honored.

## Open questions

- Minimum N for box-counting → tentatively `10`; confirm via cross-check during
  `sdd-apply` (Component 5 small-N guard).
- `csv.Sniffer` tuning: may need a custom second pass if sniffer mislabels
  delimiter on files `< 3` data rows. Fallback: require override.
- Settings UI location: extend existing `/settings/page.tsx` (preferred) or
  introduce `/settings/csv`? Default: extend existing to avoid route proliferation.
- `radius_nm` column naming: confirm with existing export consumers (no known
  external parsers, safe to append).
