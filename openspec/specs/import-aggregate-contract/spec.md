# Spec: import-aggregate-contract

## Purpose

End-to-end contract for importing aggregate geometries from CSV and MATLAB
`.mat` files. Covers parser behavior (metadata, locale), unit-contract
stamping, independent Df via box-counting, coordinate normalization, export
locale, UI entry point, and explicit rejection of unsupported formats.

Rationale and investigation: see
`openspec/changes/import-aggregate/proposal.md` and `explore.md`.

## Requirements

### Requirement: CSV parser accepts metadata comment lines

The CSV parser SHALL treat lines beginning with `#` that appear before the
column header as `key=value` metadata pairs. Supported keys MUST include
`unit`, `primary_particle_diameter_nm`, `source`, and `generated_at`. Unknown
keys MUST be logged and ignored. Malformed `#` lines MUST be skipped, not
cause rejection.

- `unit` ∈ {`nm`, `dimensionless`}; default is `nm` when omitted.
- `primary_particle_diameter_nm`: float override for the stamped diameter.
- `source`: free-form string (e.g. `matlab-agloGen3D`).
- `generated_at`: ISO-8601 datetime string.

#### Scenario: No metadata — defaults applied

- GIVEN a CSV with no `#` lines before the header `x,y,z,radius`
- WHEN the parser runs
- THEN parsing succeeds
- AND the effective metadata is `{unit: "nm"}` with no explicit diameter

#### Scenario: Full metadata block

- GIVEN `# unit=nm`, `# primary_particle_diameter_nm=30.0`, `# source=matlab`, `# generated_at=2026-04-21T10:00:00Z` above the header
- WHEN the parser runs
- THEN all four keys are extracted
- AND downstream code sees the explicit diameter `30.0`

#### Scenario: Partial metadata

- GIVEN only `# source=manual` above the header
- WHEN the parser runs
- THEN `source="manual"` is extracted
- AND `unit` defaults to `nm`

#### Scenario: Unknown key is ignored

- GIVEN a metadata line `# wavelength=532`
- WHEN the parser runs
- THEN parsing succeeds
- AND the unknown key is logged but does not appear in stamped parameters

#### Scenario: Malformed metadata line

- GIVEN a line `# not a pair` above the header
- WHEN the parser runs
- THEN the line is skipped
- AND parsing of the remaining file succeeds

### Requirement: CSV parser auto-detects decimal and delimiter

The parser SHALL sniff the first 10 data lines (after metadata) to determine
decimal separator and column delimiter. Users MAY override detection via a
`locale_override` request field of shape `{decimal: "." | ",", delimiter: "," | ";"}`.

- Decimal: `.` when numeric cells contain dots but no commas; `,` when
  commas but no dots; ambiguous → default `.`.
- Delimiter: result of `csv.Sniffer().sniff()` unless overridden.
- Sample size: first 5 data rows. With < 5 rows, detection still runs
  but the response includes a `locale_warning` flag so the frontend can
  surface "we detected X — override if wrong" instead of erroring out.

#### Scenario: US format auto-detect

- GIVEN a CSV with `1.5,2.5,3.5,0.25`-style rows
- WHEN sniffing runs
- THEN `decimal="."` and `delimiter=","`

#### Scenario: European format auto-detect

- GIVEN a CSV with `1,5;2,5;3,5;0,25`-style rows
- WHEN sniffing runs
- THEN `decimal=","` and `delimiter=";"`

#### Scenario: Explicit override beats sniffer

- GIVEN a CSV whose sniffer would pick `(".", ",")`
- AND request carries `locale_override={decimal: ",", delimiter: ";"}`
- WHEN parsing runs
- THEN the override values are used

#### Scenario: Small sample size emits warning

- GIVEN a CSV with fewer than 5 data rows after metadata
- WHEN the parser runs without `locale_override`
- THEN detection still runs on the available rows
- AND the response includes `locale_warning=true` with the detected values
- AND the frontend surfaces "we detected X format — override if wrong"
- AND parsing is NOT rejected (user can confirm or correct via override)

### Requirement: Import stamps primary_particle_diameter_nm

The import pipeline MUST stamp `parameters.primary_particle_diameter_nm`
before the serializer persists the simulation, honoring the
`rg-unit-contract`. The serializer MUST then stamp
`parameters_schema_version = "v2"`.

#### Scenario: Implicit diameter from mean radius (unit=nm)

- GIVEN a CSV uploaded with `unit=nm` and no `primary_particle_diameter_nm` metadata
- WHEN the view processes the upload
- THEN `parameters.primary_particle_diameter_nm = 2 * mean(radius)` is stamped
- AND `parameters.parameters_schema_version = "v2"` is stamped

#### Scenario: Explicit metadata override

- GIVEN a CSV with `# primary_particle_diameter_nm=30.0`
- WHEN the view processes the upload
- THEN `parameters.primary_particle_diameter_nm = 30.0` (override wins over mean)

#### Scenario: Dimensionless unit uses default diameter

- GIVEN a CSV with `# unit=dimensionless` and no explicit diameter
- WHEN the view processes the upload
- THEN `parameters.primary_particle_diameter_nm = 50.0` (historical default)

#### Scenario: Empty or invalid radius column

- GIVEN a CSV whose `radius` column is missing, empty, or non-numeric
- WHEN the view processes the upload
- THEN the upload is rejected with a validation error
- AND no Simulation row is created

### Requirement: Import computes Df via box-counting only

For any imported geometry (CSV or `.mat`), `compute_import_metrics` MUST
compute `metrics.fractal_dimension` using
`aglogen_core.box_counting_agglomerate`. The field `sequential_df` MUST NOT
be written. `metrics.fractal_dimension_std` MUST reflect the R² → stderr
conversion of the box-counting fit, or be `None` when N is too small for a
stable fit.

#### Scenario: Known line geometry

- GIVEN a linear chain of 20 identical touching spheres
- WHEN import metrics run
- THEN `metrics.fractal_dimension` is within ±0.1 of 1.0

#### Scenario: Known plane geometry

- GIVEN a 2D hexagonal planar packing of 30 identical spheres
- WHEN import metrics run
- THEN `metrics.fractal_dimension` is within ±0.15 of 2.0

#### Scenario: Known cube geometry

- GIVEN a dense 3D cubic packing of 64 identical spheres
- WHEN import metrics run
- THEN `metrics.fractal_dimension` is within ±0.15 of 3.0

#### Scenario: Too few particles for stable Df

- GIVEN an import with N < 50 particles (box-counting minimum threshold)
- WHEN metrics run
- THEN `metrics.fractal_dimension` is set to `None`
- AND `metrics.fractal_dimension_std` is `None`
- AND `metrics.notes.fractal_dimension` = "Insufficient particles for stable box-counting (N < 50)"
- AND other geometric metrics (Rg, porosity, coordination, shape) are still computed normally

#### Scenario: `sequential_df` never written

- GIVEN any imported simulation after this change ships
- WHEN its metrics are persisted
- THEN `metrics` has no key named `sequential_df`

### Requirement: Coordinates re-centered to CoM on import

Imported coordinates MUST be translated so the mass-weighted center of mass
(using `radius³` as mass) is at the origin before being stored in
`Simulation.geometry`.

#### Scenario: Offset origin is re-centered

- GIVEN imported coordinates with mass-weighted CoM at `(10, -5, 3)` nm
- WHEN the geometry is stored
- THEN the stored array has mass-weighted CoM within `1e-9` of `(0, 0, 0)`

#### Scenario: Already at origin

- GIVEN coordinates whose CoM is already at `(0, 0, 0)` within tolerance
- WHEN the geometry is stored
- THEN coordinates are unchanged within `1e-9`

#### Scenario: Single particle

- GIVEN a CSV with a single row at `(5, 5, 5)` with radius `r`
- WHEN the geometry is stored
- THEN the stored particle is at `(0, 0, 0)`

### Requirement: MATLAB `.mat` parser accepts single-agglomerate files

The system SHALL accept MATLAB `.mat` v7 files (non-HDF5) uploaded via
`algorithm=imported` with `format=mat`. Parsing MUST extract an `(N×4)`
ndarray from a variable named `part` or `clusters` and route it through the
same post-parse pipeline as CSV (re-centering, diameter stamping,
box-counting Df).

#### Scenario: `clusters` variable only

- GIVEN a `.mat` containing only `clusters` as an `(N×4)` ndarray
- WHEN uploaded
- THEN geometry is extracted from `clusters`
- AND the simulation is created via the shared post-parse pipeline

#### Scenario: `part` with single-element `NofPart`

- GIVEN a `.mat` containing `part` as `(N×4)` and `NofPart=[N]`
- WHEN uploaded
- THEN geometry is extracted as a single agglomerate

#### Scenario: Both names present

- GIVEN a `.mat` containing both `clusters` and `part`
- WHEN uploaded
- THEN `clusters` is used (preferred)

#### Scenario: Multiple agglomerates rejected (deferred)

- GIVEN a `.mat` with `NofPart` of length > 1
- WHEN uploaded
- THEN the request is rejected with HTTP 400 and a message stating
  multi-agglomerate import is out of scope

#### Scenario: Wrong array shape

- GIVEN a `.mat` whose candidate variable is not `(N×4)`
- WHEN uploaded
- THEN the request is rejected with HTTP 400 and a clear shape error

### Requirement: `.dat` files rejected with explicit guidance

Uploaded files with a `.dat` extension MUST be rejected before parsing.

#### Scenario: `.dat` upload

- GIVEN a file with extension `.dat` uploaded to the import endpoint
- WHEN the view processes it
- THEN the response is HTTP 400
- AND the error message reads exactly or equivalently:
  "The .dat format from Box-Counter contains tessellated surface points,
  not per-particle coordinates. To import an aggregate, use CSV (.csv)
  or MATLAB (.mat) with per-particle (x, y, z, radius) data."

### Requirement: CSV export uses user-profile locale preference

Single-simulation CSV export MUST format numbers and delimiters according to
the user's profile fields `csv_decimal_separator` and `csv_column_delimiter`.

#### Scenario: Default locale (US)

- GIVEN a user with defaults `csv_decimal_separator="."`, `csv_column_delimiter=","`
- WHEN CSV export runs
- THEN numbers use `.` as decimal and columns are separated by `,`

#### Scenario: European locale

- GIVEN a user with `csv_decimal_separator=","`, `csv_column_delimiter=";"`
- WHEN CSV export runs
- THEN numbers use `,` as decimal and columns are separated by `;`

#### Scenario: Mixed preference

- GIVEN a user with `csv_decimal_separator="."`, `csv_column_delimiter=";"`
- WHEN CSV export runs
- THEN numbers use `.` as decimal and columns are separated by `;`

### Requirement: CSV export includes `radius_nm` column

Single-simulation CSV export MUST include a `radius_nm` column equal to
`radius_engine × scale_factor_nm`, additive to the existing `radius` column.

#### Scenario: v2 simulation export

- GIVEN a v2 Simulation with stored radii in engine units
- WHEN CSV export runs
- THEN the output contains both `radius` (engine units) and `radius_nm`
- AND `radius_nm[i] = radius[i] × (primary_particle_diameter_nm / 2)`

#### Scenario: v1 legacy simulation export

- GIVEN a v1 Simulation exposing only `primary_particle_radius_nm`
- WHEN CSV export runs
- THEN the shim resolves `scale_factor_nm` from `primary_particle_radius_nm`
- AND `radius_nm` is populated correctly

#### Scenario: Imported simulation export

- GIVEN an imported simulation with explicit metadata-override diameter
- WHEN CSV export runs
- THEN `radius_nm` uses the stamped `primary_particle_diameter_nm`

### Requirement: Top-level Import Aggregate button on project page

The project detail page MUST render an "Import Aggregate" button alongside
"New Simulation". Clicking it MUST open a dialog supporting both CSV and
`.mat` tabs plus a locale override control.

#### Scenario: Button visible on project page

- GIVEN the user is on a project detail page
- WHEN the page renders
- THEN an "Import Aggregate" button is visible next to "New Simulation"

#### Scenario: Dialog opens with both tabs

- GIVEN the user clicks "Import Aggregate"
- WHEN the dialog opens
- THEN it presents a CSV tab and a `.mat` tab
- AND a locale override control is available on the CSV tab
