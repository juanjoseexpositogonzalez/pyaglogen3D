## MODIFIED Requirements

### Requirement: R4 — seed_type Grid Key

The system MUST accept `parameter_grid.seed_type` as an array of values from `{"monomers", "dimers", "trimers"}`, and only for the algorithms that consume it: `tunable_cc`, the single branch of `run_simulation_task` whose engine call declares `seed_type`. For any other algorithm the request MUST be refused with 400 naming the surface that carried the value - `parameter_grid.seed_type`, `base_parameters.seed_type` or `limiting_cases_config.theoretical_extremes.seed_type` - because the value would be stored and never read.

Each child sim MUST have `seed_type` set on the Simulation **MODEL FIELD** (not in the params blob). This is the fix for latent bug #634 (`create_simulation`).

#### Scenario R4.1 — Valid seed_type grid expansion

- GIVEN `base_algorithm = "tunable_cc"`, `parameter_grid = {seed_type: ["dimers", "trimers"]}` and
  `seeds_per_combination = 2`
- WHEN the ParametricStudy is created
- THEN 4 child sims are created (2 types x 2 seeds)
- AND each child sim's `Simulation.seed_type` MODEL FIELD equals its grid value

#### Scenario R4.2 — Invalid seed_type rejected

- GIVEN `parameter_grid = {seed_type: ["quadrimers"]}`
- WHEN the serializer validates
- THEN a 400 response listing valid values

#### Scenario R4.4 - A seed_type the algorithm never reads is refused

- GIVEN `base_algorithm = "fracval"` and `parameter_grid = {seed_type: ["dimers"]}`
- WHEN the serializer validates
- THEN a 400 response naming `parameter_grid.seed_type`
- AND the same for `base_parameters.seed_type` and for
  `limiting_cases_config.theoretical_extremes.seed_type`, each named where it was sent
- AND no study and no child simulation is created
- AND a study stored before this rule can still be renamed; changing `base_algorithm`
  judges it, and the refusal says how to clear the value in the same request

#### Scenario R4.3 — seed_type set on model field, not params

- GIVEN a child sim created from `seed_type: ["dimers"]`
- WHEN the sim is read from the DB
- THEN `sim.seed_type == "dimers"` (model field)
- AND `sim.parameters` does NOT contain a `seed_type` key

---

### Requirement: R10 — Frontend: Parameter-to-Vary Dropdown Extension

The existing dropdown in `BatchSimulationForm.tsx` MUST gain 4 new options:

- "kf distribution (normal/uniform/fixed)" — only for the algorithms that consume it (R13)
- "Particle radius (per-run variation)" — only for the algorithms that consume it (R13)
- "Sintering coefficient distribution" — **only for the algorithms that consume sintering**
  (R11): `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `tunable_cc`
- "Seed type (monomer/dimer/trimer)" — **only for the algorithms that consume it** (R4):
  `tunable_cc`

Each option MUST swap the value input UI to the corresponding component (DistributionGridInput
for distributions, multi-select chips for seed_type).

For `base_algorithm = "limiting"` the dropdown keeps its own separate list
(the `limiting` branch of `parameterOptionsFor`), offering none of the four and instead a flat
`sintering_coeff` sweep (see `parameterOptionsFor`). That algorithm also has a dedicated "Base Sintering Coeff."
input, rendered by `BatchSimulationForm` and sent by `handleSubmit` as
`base_parameters.sintering_coeff` whenever it holds a usable number — and not at all when it is empty. Both are
sintering inputs under R3 and MUST produce a payload R3 accepts; in particular an emptied field
MUST NOT be submitted as `null` or `NaN`.

The `sintering_config` payload MUST be sent in R3's dict shape, not in the selector component's
`{mode, …}` shape; the translation MUST live in a single pure function.

When the selected algorithm changes, any configured variation the new algorithm does not accept
MUST be cleared or flagged, so the form cannot submit a payload R11 rejects without telling the
user why.

`particle_radius_config` MUST NOT be labelled polydispersity. The engine samples it once per run
and every particle of that run shares the sampled value, so the label names per-run variation of
the primary particle size. This replaces the label the previous version of this requirement
fixed; keeping both would leave two opposite MUSTs about the same string.

#### Scenario R10.1 — Selecting kf distribution shows DistributionGridInput

- **GIVEN** the user opens the parameter-to-vary dropdown
- **WHEN** they select "kf distribution (normal/uniform/fixed)"
- **THEN** a DistributionGridInput replaces the scalar value input

#### Scenario R10.2 — Selecting seed_type shows chip multi-select

- **GIVEN** the user opens the parameter-to-vary dropdown
- **WHEN** they select "Seed type (monomer/dimer/trimer)"
- **THEN** a chip multi-select with 3 options replaces the scalar value input

#### Scenario R10.3 — Selecting scalar param retains old behavior

- **GIVEN** the user opens the parameter-to-vary dropdown
- **WHEN** they select "n_particles" (existing scalar key)
- **THEN** the original scalar array input is shown (no regression)

#### Scenario R10.4 — The sintering option is not offered where the engine ignores it

- **GIVEN** the selected algorithm is `fracval`, `gcca` or `box_rfa`
- **WHEN** the user opens the parameter-to-vary dropdown
- **THEN** "Sintering coefficient distribution" does not appear, and with `ballistic` it does

#### Scenario R10.5 — The sintering payload uses the dict shape

- **GIVEN** the user configures a normal sintering variation with mean 0.8 and std 0.05
- **WHEN** they submit the form
- **THEN** `parameter_grid.sintering_config[0]` is `{distribution_type:"normal", mean:0.8, std:0.05}` with no `mode` key
- **AND** the selector's default `uniform` produces a payload the API accepts with no prior edit

#### Scenario R10.6 — Limiting submits and algorithm switches stay submittable

- **GIVEN** the `limiting` algorithm with its "Base Sintering Coeff." field left empty
- **WHEN** the user submits
- **THEN** the payload carries no `sintering_coeff`, or a valid one, never `null` or `NaN`
- **AND** a `sintering_config` variation configured on `ballistic` is cleared or flagged when the user switches to `fracval`

#### Scenario R10.7 — The primary size option does not promise polydispersity

- GIVEN the batch form's parameter-to-vary dropdown
- WHEN `particle_radius_config` is listed
- THEN its label describes per-run variation of the primary particle size
- AND it does not use the word polydispersity, which the engine does not deliver

#### Scenario R10.8 — The distribution options are not offered where the engine ignores them

- GIVEN the batch form with an algorithm outside R13's allow-list, such as `fracval`
- WHEN the parameter-to-vary dropdown is opened
- THEN `kf distribution` and `Particle radius` are not among the options
- AND a `kf_distribution` variation configured while the algorithm was `tunable_cc` is cleared or flagged when the user switches to `fracval`, on the same terms R10.6 already fixes for sintering
