## MODIFIED Requirements

### Requirement: Parameter schema versioning

Every simulation's stored `parameters` MUST carry an explicit
`parameters_schema_version` field so readers can dispatch on format rather than
probing for keys. Legacy simulations without the field MUST remain readable.
Imported simulations (CSV and `.mat`) MUST also satisfy this contract.

#### Scenario: New simulation is written as v2

- GIVEN a new simulation is created after this change ships
- WHEN its parameters are persisted
- THEN `parameters.parameters_schema_version == "v2"`
- AND `parameters.primary_particle_diameter_nm` is present
- AND `parameters.primary_particle_radius_nm` is absent

#### Scenario: Legacy simulation is detected as v1

- GIVEN a stored simulation whose `parameters` either has no
  `parameters_schema_version` field, has it set to `null`, or set to `"v1"`,
  AND carries `primary_particle_radius_nm`
- WHEN the simulation is loaded
- THEN it is treated as schema `v1`
- AND loading succeeds with no data loss

#### Scenario: Imported simulation is written as v2

- GIVEN a simulation is created via the import pipeline (CSV or `.mat`)
- WHEN its parameters are persisted
- THEN `parameters.parameters_schema_version == "v2"`
- AND `parameters.primary_particle_diameter_nm` is present
- AND its value is either the explicit metadata override or
  `2 * mean(radius)` (or `50.0` when `unit=dimensionless`)

#### Scenario: Imported nm geometry carries scale_nm

- GIVEN a simulation is created via the import pipeline whose geometry is
  already in nanometres: a CSV whose declared unit is not `dimensionless`
  (the parser defaults the unit to `nm` when the header omits it, and the
  declared unit is normalized with `strip().lower()` before the comparison,
  so `#unit=NM` behaves like `nm`), or a `.mat` file, whose documented
  convention is that all distances share the radius column's physical unit
- WHEN its parameters are persisted
- THEN `parameters.scale_nm == 1.0`
- AND `parameters.primary_particle_diameter_nm` remains the real physical
  diameter (`2 * mean(radius)` or the explicit override)

#### Scenario: Imported dimensionless geometry carries no scale_nm

- GIVEN a CSV import whose declared unit is `dimensionless`
- WHEN its parameters are persisted
- THEN `parameters.scale_nm` is absent
- AND `parameters.primary_particle_diameter_nm` is `50.0` (the historical
  default path)

### Requirement: Read-side shim for parameter keys

A single helper MUST resolve the primary-particle diameter in nm from either
schema version, so downstream callers never branch on schema version themselves.
Imported simulations MUST be resolved by the same shim without special-casing.

The same shim family resolves the engine-to-nm scale factor: when
`params.scale_nm` is present and a positive finite number, it IS the factor,
before any diameter key is consulted; otherwise the factor falls through to
`getPrimaryParticleDiameterNm(params) / 2`. `scale_nm` is an input field read
identically by the Python shim (`apps.simulations.services.params`) and the
TypeScript shim (`frontend/src/lib/units.ts`), in the same priority order with
the same acceptance rule — it is not a special case for imports.

#### Scenario: v2 parameters present

- GIVEN `params.primary_particle_diameter_nm = D` with `D` a positive number
- WHEN `getPrimaryParticleDiameterNm(params)` is called
- THEN it returns `D`
- AND the legacy key is not read even if also present

#### Scenario: Only legacy v1 parameters present

- GIVEN `params.primary_particle_radius_nm = R` and no `primary_particle_diameter_nm`
- WHEN `getPrimaryParticleDiameterNm(params)` is called
- THEN it returns `R * 2`

#### Scenario: Neither key present

- GIVEN `params` has neither key set
- WHEN `getPrimaryParticleDiameterNm(params)` is called
- THEN it returns the default `50.0`

#### Scenario: Writes always use the new key

- GIVEN any code path that persists parameters (form submission, batch study, import)
- WHEN the parameters are written
- THEN `primary_particle_diameter_nm` is set
- AND `primary_particle_radius_nm` is not written

#### Scenario: Imported simulation resolves via the shim

- GIVEN an imported simulation whose parameters were stamped with an
  explicit `primary_particle_diameter_nm = D`
- WHEN `getPrimaryParticleDiameterNm(params)` is called during CSV export
  or any display surface
- THEN it returns `D`
- AND CSV export scales `radius_nm = radius_engine × F` correctly, where `F`
  is the shim-resolved scale factor (`scale_nm` when present, else `D / 2`)

#### Scenario: Explicit scale_nm is the factor

- GIVEN `params.scale_nm = S` with `S` a positive finite number
- WHEN `getScaleFactorNm(params)` is called on either shim (Python or
  TypeScript)
- THEN it returns `S`
- AND the diameter keys are not consulted for the factor, even when a valid
  `primary_particle_diameter_nm` is also present

#### Scenario: Invalid scale_nm falls through

- GIVEN `params.scale_nm` is `0`, negative, `NaN`, a non-numeric string, or
  absent
- WHEN `getScaleFactorNm(params)` is called on either shim
- THEN the factor falls through to `getPrimaryParticleDiameterNm(params) / 2`
  with the historical diameter fallback order unchanged

#### Scenario: Both shims resolve the factor identically

- GIVEN any `params` payload (`scale_nm` present, invalid, or absent; v1, v2,
  or empty) and the mirrored test cases in
  `backend/apps/simulations/tests/test_params_shim.py` and
  `frontend/src/lib/__tests__/units.test.ts`
- WHEN `get_scale_factor_nm` (Python) and `getScaleFactorNm` (TypeScript) are
  called on the same payload
- THEN both return the same value for every case

#### Scenario: Imported nm geometry reads at face value

- GIVEN an imported simulation whose geometry is already in nm (stamped
  `scale_nm = 1.0`) with uniform particle radius 12 nm and physical diameter
  `2 * 12 = 24`
- WHEN any display surface renders the particle radius or the CSV export
  writes the `radius_nm` column
- THEN the value reads 12, not `12 × (24 / 2) = 144`

### Requirement: Backend CSV export includes Unit column and nm-scaled Rg

Single-simulation and batch-study CSV exports MUST be self-describing: every Rg
value is pre-scaled to nm on the server, and an explicit `Unit` column states
`"nm"`.

#### Scenario: Single-simulation CSV

- GIVEN a simulation with stored engine Rg `rg_engine` and parameters resolving
  to diameter `D_nm` via the shim
- WHEN the single-simulation CSV is exported
- THEN the CSV contains a `Unit` column
- AND the row for Rg has `Unit = "nm"`
- AND the Rg value equals `rg_engine * F`, where `F` is the scale factor
  resolved by the shim (`scale_nm` when present and positive finite, else
  `D_nm / 2`)

#### Scenario: Batch-study CSV

- GIVEN a batch study containing simulations with stored engine Rg values
- WHEN the batch CSV is exported
- THEN the CSV contains a `Unit` column (or per-column unit annotation) identifying Rg columns as `"nm"`
- AND each Rg value equals `rg_engine * F` using the shim per simulation,
  where `F` is the shim-resolved scale factor (`scale_nm` when present and
  positive finite, else `D_nm / 2`)

#### Scenario: Legacy simulation export

- GIVEN a stored v1 simulation (only `primary_particle_radius_nm = R` present)
- WHEN the CSV is exported
- THEN the shim resolves diameter as `R * 2`
- AND the export completes successfully with `Unit = "nm"` and Rg scaled accordingly

### Requirement: Frontend displays Rg consistently in nm

Every frontend surface that shows Rg MUST display it scaled to nm using the
shim, with an explicit `nm` unit in the label or axis. The same simulation MUST
show the same numeric Rg on every surface within display rounding.

#### Scenario: Display surfaces are unit-consistent

- GIVEN a simulation with engine Rg `rg_engine` and resolved diameter `D_nm`
- WHEN it is rendered on any of: simulation detail page
  (`simulations/[simId]/page.tsx`), project list page (`projects/[id]/page.tsx`),
  AI sidebar (`ai/page.tsx`), `BatchResultsTable`, and `RgEvolutionChart`
- THEN each surface displays `rg_engine * F` within display rounding, where
  `F` is the scale factor resolved by the shim (`scale_nm` when present and
  positive finite, else `D_nm / 2`)
- AND each surface shows `(nm)` or a ` nm` suffix on the value or axis label

#### Scenario: Rg-evolution chart axis is labelled nm

- GIVEN an `rg_evolution` series from the engine
- WHEN the chart renders
- THEN the y-axis label includes `nm`
- AND plotted values are scaled by the shim-resolved factor `F`
  (`scale_nm` when present and positive finite, else `D_nm / 2`)

### Requirement: Documentation contract

A single contributor-oriented document MUST describe the unit convention and
schema versioning so the question is not reopened in future changes.

#### Scenario: Doc exists and covers required topics

- GIVEN the repository after this change is applied
- WHEN a contributor opens `docs/unit-convention.md`
- THEN the document exists
- AND it explains that the engine is dimensionless
- AND it explains that display/export scale by the factor the shim resolves:
  `scale_nm` when it is present and positive finite, else
  `primary_particle_diameter_nm / 2`
- AND it explains that an import whose geometry already is in nm carries
  `scale_nm = 1.0`, so nothing rescales it
- AND it explains the `parameters_schema_version` scheme (`v1` legacy vs `v2` current)
- AND its length is at most one page
