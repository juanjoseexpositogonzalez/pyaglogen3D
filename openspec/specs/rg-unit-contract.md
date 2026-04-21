# Spec: rg-unit-contract

## Overview

This capability establishes the end-to-end contract for the Radius of Gyration (Rg)
value in the 3D aggregate simulator: the Rust engine emits Rg as a dimensionless
scalar, and every user-facing surface (frontend pages, AI sidebar, CSV exports,
charts) scales it to nanometers using `primary_particle_diameter_nm / 2` as the
single source of truth for the scale factor.

It also defines the parameter schema versioning scheme, a read-side shim for
legacy stored simulations, and a user-facing transition banner so the unit
correction is observable and reversible. Context and rationale are in
`openspec/changes/verify-rg/proposal.md` and `openspec/changes/verify-rg/explore.md`.

## Requirements

### Requirement: Engine Rg formula correctness

The engine's `calculate_radius_of_gyration` function SHALL satisfy the
mathematical invariants of a mass-weighted radius of gyration for spheres,
verified via tests; the formula itself MUST NOT be modified by this change.

#### Scenario: Scaling invariance

- GIVEN arbitrary coordinates `coords` and radii `radii` and a positive scalar `α`
- WHEN `Rg(α·coords, α·radii)` is computed
- THEN the result equals `α · Rg(coords, radii)` within floating-point tolerance

#### Scenario: Translation invariance

- GIVEN arbitrary coordinates `coords`, radii `radii`, and a constant vector `t`
- WHEN `Rg(coords + t, radii)` is computed
- THEN the result equals `Rg(coords, radii)` within floating-point tolerance

#### Scenario: Known geometry — linear chain

- GIVEN a linear chain of `N` identical touching spheres of radius `r`, for `N ∈ {2, 3, ..., 10}`
- WHEN Rg is computed on the arrangement
- THEN it matches `kf_analytic::radius_of_gyration(Line, N, 2r)` within tolerance

#### Scenario: Known geometry — hexagonal plane

- GIVEN the 7-sphere hexagonal planar packing of identical radius `r`
- WHEN Rg is computed on the arrangement
- THEN it matches `kf_analytic::radius_of_gyration(Hex, 7, 2r)` within tolerance

#### Scenario: Single particle

- GIVEN a single sphere of radius `r` at arbitrary position
- WHEN Rg is computed
- THEN it equals `sqrt(3/5) · r` within floating-point tolerance

#### Scenario: Empty input

- GIVEN an empty coordinate list
- WHEN Rg is computed
- THEN it returns `0.0`

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

### Requirement: Read-side shim for parameter keys

A single helper MUST resolve the primary-particle diameter in nm from either
schema version, so downstream callers never branch on schema version themselves.
Imported simulations MUST be resolved by the same shim without special-casing.

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
- AND CSV export scales `radius_nm = radius_engine × (D / 2)` correctly

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
- AND the Rg value equals `rg_engine * (D_nm / 2)`

#### Scenario: Batch-study CSV

- GIVEN a batch study containing simulations with stored engine Rg values
- WHEN the batch CSV is exported
- THEN the CSV contains a `Unit` column (or per-column unit annotation) identifying Rg columns as `"nm"`
- AND each Rg value equals `rg_engine * (D_nm / 2)` using the shim per simulation

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
- THEN each surface displays `rg_engine * (D_nm / 2)` within display rounding
- AND each surface shows `(nm)` or a ` nm` suffix on the value or axis label

#### Scenario: Rg-evolution chart axis is labelled nm

- GIVEN an `rg_evolution` series from the engine
- WHEN the chart renders
- THEN the y-axis label includes `nm`
- AND plotted values are scaled by `D_nm / 2`

### Requirement: Transition banner for legacy simulations

A dismissible banner MUST appear on the simulation detail and project list
pages whenever a loaded simulation has `parameters_schema_version` equal to
`null` or `"v1"`, explaining the unit correction.

#### Scenario: Banner appears for legacy simulation

- GIVEN a loaded simulation with `parameters_schema_version ∈ {null, "v1"}`
- WHEN the simulation detail page or project list page renders
- THEN a banner is visible
- AND the banner text explains: unit convention updated, Rg values are now
  displayed in nm using `diameter/2` scaling, the previous display had a
  factor-of-2 naming bug
- AND the banner includes a link to `docs/unit-convention.md`

#### Scenario: Banner is dismissable and stays dismissed

- GIVEN the banner is visible to a user
- WHEN the user dismisses it
- THEN it is hidden for that user on subsequent renders (persisted via
  localStorage or a user preference)

#### Scenario: Banner does not appear for v2 simulations

- GIVEN a loaded simulation with `parameters_schema_version = "v2"`
- WHEN any page renders
- THEN the banner is not shown

### Requirement: Documentation contract

A single contributor-oriented document MUST describe the unit convention and
schema versioning so the question is not reopened in future changes.

#### Scenario: Doc exists and covers required topics

- GIVEN the repository after this change is applied
- WHEN a contributor opens `docs/unit-convention.md`
- THEN the document exists
- AND it explains that the engine is dimensionless
- AND it explains that display/export scale by `primary_particle_diameter_nm / 2`
- AND it explains the `parameters_schema_version` scheme (`v1` legacy vs `v2` current)
- AND its length is at most one page
