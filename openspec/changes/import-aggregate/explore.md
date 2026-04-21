# Exploration: import-aggregate

> Investigation of the import-aggregate feature (MATLAB + CSV → pyaglogen3D),
> positioned as a reference/validation path so imported geometries can be cross-
> checked against pyaglogen3D's own simulator and metrics.

## 1. Executive summary

- **A CSV import path is ALREADY implemented end-to-end** in both backend and
  frontend as `SimulationAlgorithm.IMPORTED = "imported"`. CSV data is
  base64-posted, parsed with required columns `x,y,z,radius`, stored as a
  NumPy (N×4) binary blob in `Simulation.geometry`, and metrics are computed
  asynchronously by `compute_import_metrics_task` in
  `backend/apps/simulations/tasks.py:1117`.
- **MATLAB `.mat` import is NOT implemented anywhere.** No `scipy.io.loadmat`
  usage, no `.mat` handler, no parser for the cell-array/matrix format that
  `agloGen3D.m` returns.
- **The `MATLAB Prueba.dat` file under `aglogen3D/BoxCount/` is NOT a per-particle
  geometry file** — it is a *surface-sample point cloud* (unit sphere tesselated
  at `precision` points, scaled/translated per particle). This is the input to
  box-counting, not a usable export format. Importing `.dat` as-is would
  re-ingest ~69k points as "particles", producing garbage metrics. See §2.
- **The existing CSV import silently violates the verify-rg unit contract**
  (schema v2, `primary_particle_diameter_nm`). The view at
  `backend/apps/simulations/views.py:82-95` stores `n_particles`, `radius_min`,
  `radius_max`, `source`, and `original_filename` in `parameters`, but never a
  `primary_particle_diameter_nm`. `get_scale_factor_nm` therefore falls through
  to `DEFAULT_DIAMETER_NM/2 = 25 nm`, and CSV export multiplies the Rg (already
  computed from imported coordinates that are presumably in the user's own
  unit) by 25. Unless the user imports in "dimensionless diameter-units", Rg_nm
  is off by a fixed factor. There are **zero tests** for the imported path
  (`tests/test_csv_export_units.py` only covers simulator outputs).
- **UX-wise the "import" action is buried** as one entry in the simulation
  algorithm dropdown ("Import from CSV File") rather than being a top-level
  first-class action. Given the user's framing (import as *reference* data,
  parallel to "run a simulation"), elevating it in the UI is in scope.

Net: the brief frames this as a new feature, but what actually needs to happen
is split into (a) **fix + test** the existing CSV path so it's unit-correct and
user-visible, and (b) **add** MATLAB import. Decisions about UX elevation and
MATLAB format choice are blocking — see §7.

## 2. MATLAB output format

### 2.1 What `agloGen3D.m` returns (in-memory)

Reading `aglogen3D/agloGen3D.m:1-529`, the function signature is:

```matlab
function [ clusters, referencias, intentos, vec, deltas ] = agloGen3D( varargin )
```

At the end (`agloGen3D.m:523-528`):

```matlab
clusters = cell2mat( clusters );
clusters =  clusters( :, 3 : end );   % drop cluster# and particle# columns
vec = determinarVecindad( clusters );
```

So `clusters` in the returned matrix is:

| Column | Content |
|--------|---------|
| 1      | x (center)            |
| 2      | y (center)            |
| 3      | z (center)            |
| 4      | radius                |

i.e. the same `(N × 4)` contract pyaglogen3D already uses internally. Units in
MATLAB/soot literature: **nm**, primary-particle diameter `dop` is typically
`25` or `30` nm.

`referencias` is a cell array of geometry metadata (center of gravity, Rg,
bounding sphere) — not part of the geometry payload.

### 2.2 How MATLAB *saves* agglomerate data to disk

Two different serialisation paths exist:

1. **Native `.mat`** — `demoAgglomerates.m:77`:
   ```matlab
   save( [ simDir '/' sprintf( timestamp ) '.mat' ] );
   ```
   This is a `save(-v7/-v7.3)` workspace dump. All workspace variables at that
   point are saved: `NofPart, maxJ, RadiusOfGir, part, vec, escala, ...`. The
   raw per-particle geometry lives in `part` as a big `(ΣN_i × 4)` matrix,
   where `NofPart(i)` gives the split indices.

2. **ASCII `.dat` (for BoxCount)** — `aglogen3D/BoxCount/crearArchivoDat.m:22`:
   ```matlab
   formatSpec = '%4.8f %4.8f %4.8f\n';
   ```
   This is an **expanded surface-point cloud**: it tessellates a unit sphere
   at `precision` points, scales each by `radius_i`, translates by
   `(x_i, y_i, z_i)`, and writes only `(x, y, z)` lines — the radius is
   absorbed into the geometry. `Prueba.dat` in the repo is exactly this:
   68 998 lines of `%4.8f %4.8f %4.8f` inside a bounding box roughly
   `[-25, +475]` nm (confirmed by `head`/`tail` inspection). That's about
   20 MATLAB points × 100 particles = 2 000 surface points per particle × 35
   particles — NOT per-particle data.

   **We should never ingest `.dat` files of this shape as geometry.** If a
   user accidentally hands us one, we'll need to detect the 3-column-only
   format and reject it with an explicit message pointing to the correct
   source (either `part` inside `.mat` or a 4-column CSV).

3. **TEM-projection `.csv`** — `demoAgglomerates.m:71-76` writes a
   `Escalas_<timestamp>.csv` table, but this is 2D projection scale info, not
   geometry.

### 2.3 How to parse `.mat` from Python

`scipy.io.loadmat` handles MATLAB `.mat` up to v7.0 natively. For v7.3 (HDF5
underneath), `h5py` is required. `agloGen3D.m` doesn't specify a version and
`demoAgglomerates.m` uses plain `save(...)` which defaults to v7 — but a
production-grade parser should try `scipy.io.loadmat` first and fall back to
`h5py` on `NotImplementedError`.

Minimal extractor sketch (NOT code — for planning only):

1. Load `.mat` → dict of variable name → ndarray.
2. Require `part` (the `(ΣN × 4)` stacked matrix) *and* `NofPart` (the 1×M
   split vector). If only `part` is present, treat the whole thing as a single
   agglomerate.
3. Slice `part` by cumulative sum of `NofPart` → list of per-agglomerate
   `(N_i × 4)` arrays.
4. **Decide which agglomerate to import** — this is a product question (§7).
5. Emit the chosen `(N × 4)` matrix through the same pipeline as CSV import.

### 2.4 Where the MATLAB files live

- Source of truth (read-only): `/home/juanjo/code/aglogen3D/` with 50+ `.m`
  files. Key ones for import are `agloGen3D.m`, `demoAgglomerates.m`,
  `saveAgglomerate.m` (which only saves a `.tif` screenshot, not geometry),
  `BoxCount/crearArchivoDat.m`, `BoxCount/guardarCoordenadas.m`.
- Mirror inside pyaglogen3D: `pyaglogen3D/matlab_reference/` has the same
  `.m` files (no `output/` or `BoxCount/Prueba.dat`). This is documentation,
  not a runtime dependency.

## 3. CSV format — current state and options

### 3.1 Current contract (already shipped)

`backend/apps/simulations/utils.py:270-339` — `parse_csv_geometry`:

- Columns (case-insensitive, order-independent, **header required**):
  `x`, `y`, `z`, `radius`.
- Data: float per cell, `radius > 0`.
- Max particles: **100 000** (hard-coded).
- Returns `(geometry, n_particles, radius_min, radius_max)` where geometry is
  `(N × 4) float64`.
- Frontend limit: **10 MB** file size (`SimulationForm.tsx:609`).
- Frontend accept filter: `.csv` only.

### 3.2 Schema gaps that need a decision

| Item                    | Current behaviour                                    | Problem                                                                 |
|-------------------------|------------------------------------------------------|-------------------------------------------------------------------------|
| Unit of `x,y,z,radius`  | Whatever the user put in the file                    | Backend has no way to apply the v2 unit contract. Rg display breaks.   |
| Coordinate frame        | Whatever the user put                                | Not re-centered to CoM or geometric center on import.                  |
| Metadata columns        | Rejected (extra columns are ignored by DictReader)    | Users can't attach notes / source / wavelength.                         |
| Provenance              | `source="csv_import"` + `original_filename`          | No way to tell "this came from MATLAB `agloGen3D.m` seed=42".           |

### 3.3 Proposed schemas (pick one in PROPOSE)

**Option A — extend current contract with optional unit + header comment**
(backwards-compatible):

```csv
# unit=nm  source=manual  generated_at=2026-04-21
x,y,z,radius
0.0,0.0,0.0,12.5
25.0,0.0,0.0,12.5
...
```

- `#`-prefixed lines at the start are metadata (`key=value` pairs).
- `unit` ∈ `{nm, dimensionless}`. Default `nm` (soot-literature default).
- Ignoring metadata lines is already compatible with `csv.DictReader` if we
  strip them first.

**Option B — diameter (not radius) to match soot literature**:

```csv
x_nm,y_nm,z_nm,diameter_nm
0.0,0.0,0.0,25.0
```

- Column-name-embeds-unit convention. No comments.
- Breaks the current `radius`-only contract — would need either a dual-format
  parser (detect by column names) or a one-shot migration of any existing
  imports.
- Matches MATLAB semantics: `dop` (diameter of particle) in
  `agloGen3D.m:11-13`.

**Option C — keep `radius`, add sibling `.meta.json`**:

- User uploads two files: `agglomerate.csv` + `agglomerate.meta.json`.
- JSON declares unit, provenance, algorithm-of-origin, seed.
- Rejected unless both are present. More rigorous, much worse UX.

Recommended in PROPOSE: **Option A** — it is strictly additive, lets us stamp
`primary_particle_diameter_nm` correctly (derived from `2 × mean(radius)` if
unit=nm, or from a new `primary_particle_diameter_nm=N` meta line if the user
wants to override), and keeps the existing fixtures working.

## 4. Existing codebase architecture

### 4.1 `Simulation` model (`backend/apps/simulations/models.py:33-97`)

- `algorithm` already includes `IMPORTED = "imported"`.
- `parameters` is a `JSONField` — algorithm-specific blob. Used by the shim at
  `services/params.py`.
- `geometry` is a `BinaryField` storing `numpy.save(buf, (N×4) array)`.
- `metrics` is a `JSONField` with Df/kf/Rg/porosity/coordination/rg_evolution/
  anisotropy/asphericity/acylindricity/principal_moments/principal_axes.
- `engine_version` for imports is `"python-import"` (see `tasks.py:1161`) —
  distinguishable from Rust simulation outputs.

### 4.2 Upload pipeline (`views.py:74-125`)

```
POST /api/projects/<pid>/simulations/
body: { algorithm: "imported", parameters: {...}, csv_data: "<base64>" }
  → SimulationSerializer.validate_csv_data (base64-decode + parse_csv_geometry for validation)
  → perform_create (view-level): base64-decode AGAIN, parse AGAIN,
    write geometry to model.geometry, enqueue compute_import_metrics_task
```

**Observations**: CSV is parsed twice (once in the serializer validator, once
in the view). Only the view's parse result is persisted. No transactional
rollback if metrics fail. `csv_data` is never length-checked on the backend
(frontend does 10 MB, backend doesn't).

### 4.3 Metrics pipeline for imports (`tasks.py:990-1114`)

`compute_import_metrics` does everything `compute_limiting_metrics` does,
plus:

- Mass-weighted CoM and Rg (treating radius³ as mass).
- **Fits Df, kf from `Rg(n)` evolution using depositional order of the CSV
  rows** (`tasks.py:1077-1094`). This is why row order in the CSV silently
  matters — the "nth particle" in the file is assumed to be the nth deposited
  particle. If the user's CSV is sorted by radius, alphabet, or distance from
  origin, the Df/kf fit is garbage but silently succeeds. **This is a UX trap
  and needs explicit docs or a "don't trust Df/kf without provenance" flag.**
- Coordination: O(N²) pair loop with 5 % tolerance (`tasks.py:1045-1053`).

For static imports **without** a deposition order, the only theoretically
trustworthy path to Df is **box-counting**, which is already available as the
`@action` on SimulationViewSet and runs on the same stored geometry.

### 4.4 3D visualisation (frontend)

`frontend/src/app/projects/[id]/simulations/[simId]/page.tsx` (not fully read
here; visualised via the existing Three.js scene). Because geometry is stored
in the same `(N × 4)` shape regardless of algorithm, imports render
identically to simulations. No change needed in the viewer.

### 4.5 Other upload patterns in the codebase

Searched for `FileField`, `SimpleUploadedFile`, `ImageField`, `upload`:

- FRAKTAL (image-based Df): Uses base64-via-JSON, same pattern as CSV import.
  Located in `backend/apps/fraktal/*`.
- AI document upload (RAG): also base64-via-JSON.
- No `FileField` or multipart `/upload` endpoint anywhere.

**→ Precedent: POST JSON with base64 payload.** New MATLAB import should
follow the same convention rather than inventing multipart uploads.

## 5. Metrics handling for imports

| Metric                | Available for static import? | Source                                      |
|-----------------------|------------------------------|----------------------------------------------|
| Rg                    | **Yes — directly**           | Mass-weighted from coords+radii (exact).    |
| Df via box-counting   | **Yes — directly**           | `aglogen_core.box_counting_agglomerate`. This is the only independent Df estimator for imports. |
| Df via Rg(n) power law| Only if deposition order preserved | `compute_import_metrics` silently computes this. **Unreliable for static data.** |
| kf                    | Only if Df via Rg-law is trusted | Comes out of the same fit — inherits its unreliability. |
| Porosity              | Yes                          | From `Rg + r_mean`. Exact.                  |
| Coordination          | Yes                          | O(N²) geometric pass.                       |
| Shape (anisotropy…)   | Yes                          | Inertia tensor eigenvalues. Exact.          |
| rg_evolution curve    | **Order-dependent — ONLY meaningful for simulator output** | See §4.3. Should be either: suppressed for imports, or flagged as "deposition order from file". |

**Recommendation for the design phase**: for imports,

1. Always compute Rg, porosity, coordination, shape — these are geometry-only.
2. Run box-counting **automatically** as part of the import pipeline and use
   **that** as the primary Df. The current `compute_import_metrics` power-law
   Df should either be demoted to "sequential Df (provenance-dependent)" or
   removed entirely. This converts the import path into a real validation
   harness against the simulator.
3. Stamp `rg_evolution` only if we know the provenance has ordered deposition
   (e.g. imported from a MATLAB `.mat` with a full `part` + `NofPart`).

## 6. Integration surface

### 6.1 Where imports live in the data model

- Keep them as `Simulation` rows with `algorithm="imported"`.
- **Keep them inside projects.** Rationale: the user wants to compare imports
  with sibling simulations, and projects are the natural organising unit.
- **Do NOT mark them `is_batch=True`.** They are user-initiated single rows.

### 6.2 Where imports live in the UI

Two options:

- **A. Elevate**: add an "Import Aggregate" button on the project page, next to
  "New Simulation". Opens a dedicated dialog/page focussed on upload. The
  existing "imported" entry in the algorithm dropdown is kept as a fallback
  but de-emphasised.
- **B. Keep in dropdown**: no UX change; only add MATLAB as an alternative
  upload format within the existing `imported` algorithm card.

User framing ("position it as an import aggregate action visible to end
users") strongly favours **A**.

### 6.3 Target parameters / Df slider

The Df/kf sliders in the SimulationForm are **generation-time** parameters
(passed to the tunable engine). They are already hidden for `imported` at
`SimulationForm.tsx:880-901`. No changes needed here — but we should NOT
expose them on an elevated Import button either.

### 6.4 Appearance in tables

- Single simulations view lists imports alongside other simulations — already
  true today because `is_batch=False`.
- `BatchResultsTable` excludes imports by design (imports aren't in studies).
  This is correct.

### 6.5 Unit handling at import time (the schema-v2 contract)

New constraint (post verify-rg, memory #338, #343): every `Simulation.parameters`
must carry `parameters_schema_version="v2"` and a
`primary_particle_diameter_nm`. `services/params.py:get_scale_factor_nm`
requires it; otherwise CSV export silently uses `25 nm` as diameter.

**Required behaviour for imports (regardless of format)**:

1. Decide the import's unit convention at upload time (see §3.3 options).
2. Compute `primary_particle_diameter_nm` as `2 × mean(radius)` (or
   `2 × radius_median`, to be debated) and stamp it into `parameters`.
3. If unit is dimensionless (coords in units of primary-particle diameter),
   stamp `primary_particle_diameter_nm = 50.0` (the historical default) so
   the scale factor becomes `25`.
4. The serializer already stamps `parameters_schema_version="v2"` in
   `create()`. We need to make sure `primary_particle_diameter_nm` is added
   **before** the serializer runs, which means the view's import branch at
   `views.py:82-95` is where we compute and inject it.

## 7. Open questions for the user (gate for PROPOSE)

These are blocking. Please answer each before we can write a proposal.

### Q1. What is the primary use-case framing? (affects scope)

- **Q1a.** Is this primarily for you to validate pyaglogen3D against MATLAB
  outputs you already have on disk? → implies MATLAB `.mat` is the critical
  path, CSV is secondary.
- **Q1b.** Or is it for external users to bring their own aggregates from
  whatever tool they use? → implies CSV is the critical path, MATLAB is
  nice-to-have.
- Your brief says "reference/validation" which leans (a), but UX framing
  ("action visible to end users") leans (b).

### Q2. MATLAB format — which shape(s) do we accept?

- **Q2a.** `.mat` files from `save(workspace.mat)` as produced by
  `demoAgglomerates.m`, containing `part` + `NofPart` (multiple agglomerates
  in one file)? If yes: when a file has N > 1 agglomerates, do we
  (i) reject, (ii) import only the first, (iii) create N simulations in a
  loop, or (iv) show a picker in the upload dialog?
- **Q2b.** `.mat` files containing just a single `clusters` matrix (the direct
  output of `agloGen3D.m`)?
- **Q2c.** Explicit **no** to `.dat` files (§2.2) — right? The per-particle
  `.dat` path via `guardarCoordenadas.m` would be ambiguous with the
  box-count point-cloud `.dat` from `crearArchivoDat.m`.

### Q3. CSV schema decision

Which of §3.3 Option A / B / C do we adopt? (I recommend A.) Related:

- **Q3a.** Do we keep `radius` or switch to `diameter` to match MATLAB/soot
  literature? Changing it breaks the existing contract.
- **Q3b.** Default unit when none is declared: `nm` (soot convention) or
  `dimensionless` (pyaglogen3D engine convention)?

### Q4. Df provenance for imports

Per §5, the current code silently uses the CSV row order to fit a Df(Rg)
power law. Acceptable options:

- **Q4a.** Suppress the Rg-law Df on imports, rely entirely on box-counting.
  (Cleanest — recommended.)
- **Q4b.** Keep it, but label it "sequential Df" in the UI and docs.
- **Q4c.** Expose a checkbox "my CSV preserves deposition order" at upload
  time; only compute the Rg-law Df when ticked.

### Q5. UX elevation

- **Q5a.** Add an "Import Aggregate" button to the project page alongside
  "New Simulation"?
- **Q5b.** Or keep "Import from CSV File" as an entry in the algorithm
  dropdown only?

### Q6. Batch import (scoping decision)

Do we accept **multiple** agglomerates in a single upload (natural for
`.mat` files produced by `demoAgglomerates.m` with `maxAgglom = 100`)? If
yes, this becomes effectively a "batch import" and overlaps with the
`ParametricStudy` model. Scoping options:

- **Q6a.** Single-file, single-agglomerate only (MVP).
- **Q6b.** Single-file, multi-agglomerate → N simulations (no study).
- **Q6c.** Single-file, multi-agglomerate → one synthetic `ParametricStudy`
  grouping them.

## 8. Recommendations for PROPOSE

### Minimal scope (recommended start)

- **Backend**:
  - Fix the unit-contract bug in `views.py:82-95`: stamp
    `primary_particle_diameter_nm` into parameters before the serializer
    runs. (See §6.5.)
  - Add regression tests for the CSV import path (there are none today).
  - In `compute_import_metrics`, suppress the Rg-law Df and replace it with
    an on-import box-counting call, storing the result under
    `metrics.fractal_dimension` and moving the Rg-law Df to
    `metrics.sequential_df` with a comment "requires CSV row = deposition
    order".
- **Frontend**:
  - Surface a top-level "Import Aggregate" button on the project page that
    opens the existing `imported` path (no change in the backend handshake).
    The algorithm dropdown entry stays as-is.
- **Tests**: one happy-path + one wrong-unit + one missing-column test for
  the CSV branch.

### Medium scope

Adds, on top of minimal:

- **CSV schema v2** (§3.3 Option A): `#`-prefixed metadata lines with `unit`,
  `primary_particle_diameter_nm`, `source`. Backwards-compatible parser.
- **MATLAB `.mat` import** (single agglomerate only): `scipy.io.loadmat` →
  pick variable named `part` or the only `(N×4)` ndarray → feed through the
  same CSV pipeline. Reject `.dat` files with a clear error.
- **Coordinate re-centering on import**: always shift CoM to origin to match
  simulator convention.

### Full scope

Adds, on top of medium:

- **Multi-agglomerate `.mat` import** (Q6b/Q6c) with a picker dialog.
- **MATLAB v7.3 support** via `h5py` fallback.
- **Bidirectional export**: write `Simulation.geometry` back out as `.mat`
  readable by MATLAB's `agloGen3D` tooling, to complete the validation loop.
- **Aggregate comparison page**: side-by-side metrics table (imported vs.
  simulator-generated with matching N and target Df) to make the
  "validation harness" framing explicit in the UI.

---

## Ready for Proposal

**No — blocked on §7 user decisions.** Q1 (framing), Q2 (MATLAB format shape),
Q3 (CSV schema), Q4 (Df provenance), Q5 (UX placement), and Q6 (batch) all
need answers before we can commit to a scope and draft the proposal. Once those
are resolved, we can pick minimal / medium / full per §8 and move on.
