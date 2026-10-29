# Spec: Batch CC Tunable — Parameter Grid Parity

## Purpose

Specification for extending `ParametricStudy.parameter_grid` with 4 new keys (`kf_distribution`, `particle_radius_config`, `sintering_config`, `seed_type`), achieving feature parity between the batch form and the single-sim CC tunable form. Covers backend validation, task expansion, frontend UX, and safety caps.

## Requirements

### R1 — kf_distribution Grid Key

The system MUST accept `parameter_grid.kf_distribution` as an array of distribution config objects. Each entry MUST be one of:

| Shape | Validation |
|-------|-----------|
| Scalar number | Treated as `{type: "fixed", value: N}` where `N > 0` |
| `{type: "fixed", value}` | `value > 0` |
| `{type: "normal", mean, std}` | `mean > 0`, `std >= 0` |
| `{type: "uniform", min, max}` | `min > 0`, `min < max` |

Task expansion MUST produce one child sim per config entry x `seeds_per_combination`. Each child sim's `params` MUST include the distribution object verbatim (engine samples per #633).

#### Scenario R1.1 — Happy path: two normal distributions expand correctly

- GIVEN `parameter_grid = {kf_distribution: [{type:"normal",mean:1.2,std:0.05},{type:"normal",mean:1.3,std:0.05}]}` and `seeds_per_combination = 2`
- WHEN the ParametricStudy is created
- THEN 4 child sims are created (2 configs x 2 seeds)
- AND each child sim's params contains its corresponding `kf_distribution` object

#### Scenario R1.2 — Scalar shorthand normalized to fixed

- GIVEN `parameter_grid = {kf_distribution: [1.3]}`
- WHEN the serializer validates
- THEN the value is accepted and treated as `{type: "fixed", value: 1.3}`

#### Scenario R1.3 — Invalid config rejected with 400

- GIVEN `parameter_grid = {kf_distribution: [{type:"normal", mean:-1, std:0.1}]}`
- WHEN the serializer validates
- THEN a 400 response with message identifying `mean > 0` constraint

#### Scenario R1.4 — Missing required fields rejected

- GIVEN `parameter_grid = {kf_distribution: [{type:"uniform", min:1.0}]}` (missing `max`)
- WHEN the serializer validates
- THEN a 400 response with descriptive error

#### Scenario R1.5 — Uniform with min >= max rejected

- GIVEN `parameter_grid = {kf_distribution: [{type:"uniform", min:1.5, max:1.0}]}`
- WHEN the serializer validates
- THEN a 400 response

---

### R2 — particle_radius_config Grid Key

The system MUST accept `parameter_grid.particle_radius_config` as an array of radius/polydispersity configs.

| Shape | Validation |
|-------|-----------|
| `{type: "fixed", mean}` | `mean > 0` |
| `{type: "normal", mean, std}` | `mean > 0`, `std/mean <= 0.3` |

Child sims receive the config in params for the engine to sample.

#### Scenario R2.1 — Normal polydispersity within ratio limit

- GIVEN `parameter_grid = {particle_radius_config: [{type:"normal", mean:1.0, std:0.2}]}`
- WHEN the serializer validates
- THEN accepted (`std/mean = 0.2 <= 0.3`)

#### Scenario R2.2 — Excessive std/mean ratio rejected

- GIVEN `parameter_grid = {particle_radius_config: [{type:"normal", mean:1.0, std:0.5}]}`
- WHEN the serializer validates
- THEN a 400 response identifying `std/mean <= 0.3` constraint (prevents negative radii)

#### Scenario R2.3 — Fixed radius accepted

- GIVEN `parameter_grid = {particle_radius_config: [{type:"fixed", mean:1.5}]}`
- WHEN the serializer validates
- THEN accepted; child sim params contain `{type:"fixed", mean:1.5}`

---

### R3 — sintering_config Grid Key

The system MUST accept `parameter_grid.sintering_config` as an array of sintering distribution configs. Grid-level sintering MUST OVERRIDE study-level `sintering_config` for that child sim (precedence: grid > study > default).

| distribution_type | Required fields | Validation |
|-------------------|----------------|-----------|
| `fixed` | `value` | `value > 0` |
| `uniform` | `min, max` | `min > 0`, `min < max` |
| `normal` | `mean, std` | `mean > 0`, `std >= 0` |

#### Scenario R3.1 — Grid sintering overrides study-level

- GIVEN study-level `sintering_config = {distribution_type:"fixed", value:0.9}` AND `parameter_grid = {sintering_config: [{distribution_type:"uniform", min:0.7, max:0.95}]}`
- WHEN child sims are created
- THEN each child sim uses the grid entry `{distribution_type:"uniform", min:0.7, max:0.95}`, NOT the study-level

#### Scenario R3.2 — No grid sintering uses study-level

- GIVEN study-level `sintering_config = {distribution_type:"fixed", value:0.9}` AND `parameter_grid` has no `sintering_config` key
- WHEN child sims are created
- THEN each child sim uses the study-level sintering (existing behavior)

#### Scenario R3.3 — Invalid sintering config rejected

- GIVEN `parameter_grid = {sintering_config: [{distribution_type:"uniform", min:0.9, max:0.5}]}`
- WHEN the serializer validates
- THEN a 400 response (`min < max` violated)

#### Scenario R3.4 — Unknown distribution_type rejected

- GIVEN `parameter_grid = {sintering_config: [{distribution_type:"lognormal", mean:0.9, std:0.1}]}`
- WHEN the serializer validates
- THEN a 400 response (only fixed/uniform/normal allowed)

---

### R4 — seed_type Grid Key

The system MUST accept `parameter_grid.seed_type` as an array of values from `{"monomers", "dimers", "trimers"}`.

Each child sim MUST have `seed_type` set on the Simulation **MODEL FIELD** (not in the params blob). This is the fix for latent bug #634 (`views.py:1784-1792`).

#### Scenario R4.1 — Valid seed_type grid expansion

- GIVEN `parameter_grid = {seed_type: ["dimers", "trimers"]}` and `seeds_per_combination = 2`
- WHEN the ParametricStudy is created
- THEN 4 child sims are created (2 types x 2 seeds)
- AND each child sim's `Simulation.seed_type` MODEL FIELD equals its grid value

#### Scenario R4.2 — Invalid seed_type rejected

- GIVEN `parameter_grid = {seed_type: ["quadrimers"]}`
- WHEN the serializer validates
- THEN a 400 response listing valid values

#### Scenario R4.3 — seed_type set on model field, not params

- GIVEN a child sim created from `seed_type: ["dimers"]`
- WHEN the sim is read from the DB
- THEN `sim.seed_type == "dimers"` (model field)
- AND `sim.parameters` does NOT contain a `seed_type` key

---

### R5 — Combinatorial Expansion Semantics

Grid expansion MUST be the Cartesian product of all parameter_grid keys x `seeds_per_combination`. Key iteration order MUST be alphabetical for deterministic expansion.

#### Scenario R5.1 — Multi-key cross product

- GIVEN `parameter_grid = {kf_distribution: [d1, d2], seed_type: ["monomers", "dimers"]}` and `seeds_per_combination = 3`
- WHEN the ParametricStudy is created
- THEN 12 child sims are created (2 x 2 x 3)

#### Scenario R5.2 — Single-value grid key is identity

- GIVEN `parameter_grid = {kf_distribution: [d1]}` and `seeds_per_combination = 5`
- WHEN the ParametricStudy is created
- THEN 5 child sims (1 x 5), each with `kf_distribution = d1`

#### Scenario R5.3 — Empty grid key array rejected

- GIVEN `parameter_grid = {kf_distribution: []}`
- WHEN the serializer validates
- THEN a 400 response (at least one entry per key required)

#### Scenario R5.4 — Mixed old and new keys

- GIVEN `parameter_grid = {n_particles: [100, 350], seed_type: ["dimers", "trimers"]}` and `seeds_per_combination = 1`
- WHEN the ParametricStudy is created
- THEN 4 child sims (2 x 2 x 1), each with correct `n_particles` param AND correct `seed_type` model field

#### Scenario R5.5 — Unique RNG seed per child

- GIVEN any multi-combination grid
- WHEN child sims are created
- THEN each child sim receives a unique RNG seed

---

### R6 — Batch Size Warning and Hard Cap

The system MUST warn when projected sim count > 200 and MUST reject when > 1000.

#### Scenario R6.1 — Warning at > 200

- GIVEN a grid producing 201 projected sims
- WHEN the frontend calculates `total_sims_in_batch`
- THEN a warning toast/banner is shown: "Large batch: 201 simulations will be generated."
- AND the user can confirm or cancel

#### Scenario R6.2 — Hard cap at 1000 (backend)

- GIVEN a grid producing 1001 projected sims
- WHEN the serializer validates
- THEN a 400 response: "Batch size exceeds maximum of 1000 simulations"

#### Scenario R6.3 — Exactly 1000 accepted

- GIVEN a grid producing exactly 1000 projected sims
- WHEN the serializer validates
- THEN the request is accepted (boundary: <= 1000)

---

### R7 — Backward Compatibility

WHEN `parameter_grid` does NOT include any of the new keys, behavior MUST be IDENTICAL to before this change.

#### Scenario R7.1 — Old grid with only scalar keys

- GIVEN `parameter_grid = {n_particles: [100, 200], target_df: [1.8]}` (pre-existing keys only)
- WHEN the ParametricStudy is created
- THEN child sims are created identically to pre-change behavior

#### Scenario R7.2 — Historical ParametricStudies remain valid

- GIVEN a ParametricStudy record saved before this change
- WHEN it is read or child sims are re-listed
- THEN no error occurs; results are identical to pre-change

---

### R8 — Frontend: DistributionGridInput Component

The system MUST provide a `DistributionGridInput` component that manages an array of distribution configs, embedding `DistributionSelector` per entry.

#### Scenario R8.1 — Add entry

- GIVEN a DistributionGridInput with 1 entry
- WHEN the user clicks "+ Add distribution"
- THEN a second DistributionSelector row appears

#### Scenario R8.2 — Remove entry (min 1)

- GIVEN a DistributionGridInput with 2 entries
- WHEN the user clicks the trash icon on the first entry
- THEN 1 entry remains

#### Scenario R8.3 — Cannot remove last entry

- GIVEN a DistributionGridInput with 1 entry
- WHEN the user attempts to remove it
- THEN the trash icon is disabled or hidden (min 1 required)

#### Scenario R8.4 — Inline validation feedback

- GIVEN a DistributionGridInput entry with `type: "normal"` and `mean: -1`
- WHEN the user blurs the mean field
- THEN a red border and error message appear on that field

---

### R9 — Frontend: seed_type Multi-Select

For `seed_type`, the system MUST provide a chip-style multi-select with exactly 3 options: monomers, dimers, trimers. At least 1 MUST be selected.

#### Scenario R9.1 — Multi-select default state

- GIVEN the user selects "Seed type" in the parameter-to-vary dropdown
- WHEN the input renders
- THEN 3 chips are shown (monomers, dimers, trimers), monomers selected by default

#### Scenario R9.2 — Deselect all prevented

- GIVEN only "monomers" is selected
- WHEN the user clicks to deselect it
- THEN the chip remains selected (minimum 1 required)

---

### R10 — Frontend: Parameter-to-Vary Dropdown Extension

The existing dropdown in `BatchSimulationForm.tsx` (~line 265-280) MUST gain 4 new options:
- "kf distribution (normal/uniform/fixed)"
- "Particle radius (polydispersity)"
- "Sintering coefficient distribution"
- "Seed type (monomer/dimer/trimer)"

Each option MUST swap the value input UI to the corresponding component (DistributionGridInput for distributions, multi-select chips for seed_type).

#### Scenario R10.1 — Selecting kf distribution shows DistributionGridInput

- GIVEN the user opens the parameter-to-vary dropdown
- WHEN they select "kf distribution (normal/uniform/fixed)"
- THEN a DistributionGridInput replaces the scalar value input

#### Scenario R10.2 — Selecting seed_type shows chip multi-select

- GIVEN the user opens the parameter-to-vary dropdown
- WHEN they select "Seed type (monomer/dimer/trimer)"
- THEN a chip multi-select with 3 options replaces the scalar value input

#### Scenario R10.3 — Selecting scalar param retains old behavior

- GIVEN the user opens the parameter-to-vary dropdown
- WHEN they select "n_particles" (existing scalar key)
- THEN the original scalar array input is shown (no regression)
