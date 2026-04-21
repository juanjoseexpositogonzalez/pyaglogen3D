# Delta for rg-unit-contract

Only requirements that change or gain scenarios are listed. All other
requirements in `openspec/specs/rg-unit-contract.md` remain in force.

## MODIFIED Requirements

### Requirement: Parameter schema versioning

Every simulation's stored `parameters` MUST carry an explicit
`parameters_schema_version` field so readers can dispatch on format rather
than probing for keys. Legacy simulations without the field MUST remain
readable. Imported simulations (CSV and `.mat`) MUST also satisfy this
contract.

(Previously: same requirement without an explicit import-path scenario.)

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
schema version, so downstream callers never branch on schema version
themselves. Imported simulations MUST be resolved by the same shim without
special-casing.

(Previously: same requirement without an explicit import-path scenario.)

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
