# Delta: batch-cc-tunable-parameter-parity

## MODIFIED Requirements
### Requirement: R1 — kf_distribution Grid Key

The system MUST accept `parameter_grid.kf_distribution` as an array of distribution config
objects in the shape the engine pipeline reads, whose discriminator key is `mode` — the key
`DistributionField` already requires on the single-simulation path and the only key
`expand_distribution_kwargs` understands. Any other discriminator (`type`, `distribution_type`)
MUST be refused rather than stored, because a shape the translator does not recognise reaches
the engine as nothing at all.

| Shape | Validation |
|-------|-----------|
| `{mode: "fixed", value}` | `value > 0` |
| `{mode: "normal", mean, std}` | `mean > 0`, `std >= 0` |
| `{mode: "uniform", min, max}` | `min > 0`, `min < max` |

Task expansion MUST produce one child sim per config entry x `seeds_per_combination`, and each
child MUST carry the configuration under **both** names: `kf_distribution`, which four result
views read as `sim.parameters[grid key]` and which R5.2 requires, **and**
`target_kf_distribution`, which the worker translates for the engine. Translation here means
*adding* the engine name, never replacing the grid key: removing it empties a column in
`fractal_analysis_summary`, `export_csv`, `formatConfigLabel` and `varyingParams`.

#### Scenario R1.1 — Happy path: two normal distributions expand correctly

- GIVEN `parameter_grid = {kf_distribution: [{mode:"normal",mean:1.2,std:0.05},{mode:"normal",mean:1.3,std:0.05}]}` and `seeds_per_combination = 2`
- WHEN the ParametricStudy is created
- THEN 4 child sims are created (2 configs x 2 seeds)
- AND each child sim's params contains its corresponding config under `target_kf_distribution`
- AND the engine call for that child receives `kf_mode="normal"` and `kf_mean` of that entry

#### Scenario R1.2 — Scalar shorthand normalized to fixed

- NOTE the title is inherited **verbatim** because a MODIFIED block may not drop a scenario, and it has always been false: a bare scalar has never been normalised. Measured: `Distribution config must be a dict.` Renaming it needs its own change, and until then this note is what keeps the contradiction visible instead of silent.
- GIVEN `parameter_grid = {kf_distribution: [1.3]}`
- WHEN the serializer validates
- THEN a 400 response: a bare scalar is not a distribution config, and the error names `mode`

#### Scenario R1.3 — Invalid config rejected with 400

- GIVEN `parameter_grid = {kf_distribution: [{mode:"normal", mean:-1, std:0.1}]}`
- WHEN the serializer validates
- THEN a 400 response with message identifying `mean > 0` constraint

#### Scenario R1.4 — Missing required fields rejected

- GIVEN `parameter_grid = {kf_distribution: [{mode:"uniform", min:1.0}]}` (missing `max`)
- WHEN the serializer validates
- THEN a 400 response with descriptive error

#### Scenario R1.5 — Uniform with min >= max rejected

- GIVEN `parameter_grid = {kf_distribution: [{mode:"uniform", min:1.5, max:1.0}]}`
- WHEN the serializer validates
- THEN a 400 response

#### Scenario R1.6 — An unknown mode is refused, not defaulted

- GIVEN `parameter_grid = {kf_distribution: [{mode:"lognormal", value:1.8}]}`
- WHEN the serializer validates
- THEN a 400 response naming the accepted modes
- AND no study is created whose child would reach the engine with no kf kwargs at all

### Requirement: R2 — particle_radius_config Grid Key

The system MUST accept `parameter_grid.particle_radius_config` as an array of primary-particle
size configs in the same `mode`-keyed shape, and MUST write each entry into its children under
the name the worker reads (`dpo_distribution`).

| Shape | Validation |
|-------|-----------|
| `{mode: "fixed", value}` | `value > 0` |
| `{mode: "normal", mean, std}` | `mean > 0`, `std/mean <= 0.3` |

The cap on `std/mean` exists to prevent negative radii and MUST NOT be weakened.

This key varies the primary particle size **per run**, not within a run: the engine samples the
distribution once at run start and every particle of that run shares the sampled value (measured:
a `uniform` 0.5-2.0 dpo leaves all 60 particles of the run at 0.5008). What the interface may call
it is governed by R10, which this change modifies; stating it here too would leave two
requirements to drift apart.

Children carry the configuration under **both** `particle_radius_config` and `dpo_distribution`,
on the same terms as R1.

#### Scenario R2.1 — Normal polydispersity within ratio limit

- GIVEN `parameter_grid = {particle_radius_config: [{mode:"normal", mean:1.0, std:0.2}]}`
- WHEN the serializer validates
- THEN accepted (`std/mean = 0.2 <= 0.3`)

#### Scenario R2.2 — Excessive std/mean ratio rejected

- GIVEN `parameter_grid = {particle_radius_config: [{mode:"normal", mean:1.0, std:0.5}]}`
- WHEN the serializer validates
- THEN a 400 response identifying `std/mean <= 0.3` constraint (prevents negative radii)

#### Scenario R2.3 — Fixed radius accepted

- GIVEN `parameter_grid = {particle_radius_config: [{mode:"fixed", value:1.5}]}`
- WHEN the serializer validates
- THEN accepted; the child sim's params contain that config under `dpo_distribution`
- AND the engine call for that child receives `dpo_mode="fixed"` and `dpo_value=1.5`

### Requirement: R7 — Backward Compatibility

A `parameter_grid` that contains none of the four parity keys MUST behave identically to before
this change, and historical studies MUST keep loading and listing.

The carve-out, stated here rather than left to the reader: this change **adds** rejections for
inputs that used to be accepted and silently defaulted. A study is now refused when it declares,
in a grid key, in `base_parameters`, or swept through `theoretical_extremes`:

- a `target_kf_distribution` or `dpo_distribution` whose `mode` is not one of `fixed`, `normal`, `uniform` — previously accepted, reaching the engine as no kwargs at all;
- a `uniform` config with `min >= max` — previously accepted, panicking in the worker;
- a distribution config that is not an object — previously accepted, storing key names as values.

Every one of those used to answer `201` and produce a simulation that ignored what was asked.
The exemption does not extend to them.

#### Scenario R7.1 — Old grid with only scalar keys

- GIVEN `parameter_grid = {n_particles: [100, 200], target_df: [1.8]}`
- WHEN the ParametricStudy is created
- THEN behaviour is identical to before this change

#### Scenario R7.2 — Historical ParametricStudies remain valid

- GIVEN a ParametricStudy record saved before this change
- WHEN it is read or its child sims are re-listed
- THEN it loads and lists unchanged, with no migration required

#### Scenario R7.3 — The carve-out is explicit

- GIVEN a payload named in the carve-out above, such as `parameter_grid = {target_kf_distribution: [{mode:"lognormal", value:1.8}]}`
- WHEN the serializer validates
- THEN a 400 response, and R7's identical-behaviour promise does not apply to it

### Requirement: R10 — Frontend: Parameter-to-Vary Dropdown Extension

The batch form's parameter-to-vary dropdown MUST offer the distribution keys this capability
governs, and MUST describe each one as what the engine does with it.

`particle_radius_config` MUST NOT be labelled polydispersity: the engine samples it once per run
and every particle of that run shares the sampled value, so the honest label is per-run variation
of the primary particle size.

#### Scenario R10.1 — Selecting kf distribution shows DistributionGridInput

- GIVEN the batch form with `base_algorithm = tunable_cc`
- WHEN the user selects `kf_distribution` as a parameter to vary
- THEN the DistributionGridInput component is rendered for that key

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

---

#### Scenario R10.7 — The primary size option does not promise polydispersity

- GIVEN the batch form's parameter-to-vary dropdown
- WHEN `particle_radius_config` is listed
- THEN its label describes per-run variation of the primary particle size
- AND it does not use the word polydispersity, which the engine does not deliver

## ADDED Requirements
### Requirement: R13 — A declared distribution reaches the engine, or the study is refused

Within the batch study surfaces enumerated here, a distribution config for `target_kf` or
primary particle size MUST either be delivered to the engine or refused at validation. The
surfaces are the two parity grid keys (R1, R2), the engine-named grid keys
`parameter_grid.target_kf_distribution` and `parameter_grid.dpo_distribution`, the same two
names inside `base_parameters`, and the same keys swept through
`limiting_cases_config.theoretical_extremes`.

**Declared outside this requirement, with its reason**: the single-simulation path accepts
`target_kf_distribution` and `dpo_distribution` for algorithms whose worker branch never reads
them (`dla`, `cca`, `fracval`, `gcca`, `box_rfa`). That is the same family and it is real, but it
belongs to the single-simulation serializer, not to batch expansion, and widening this contract
to cover it is what killed its predecessor.

Storing a configuration whose `mode` the translator does not recognise is forbidden: it reaches
the engine as no kwargs at all, and the simulation silently runs with the default.

#### Scenario R13.1 — The engine-named grid key is validated like the parity key

- GIVEN `parameter_grid = {target_kf_distribution: [{mode:"lognormal", value:1.8}]}`
- WHEN the serializer validates
- THEN a 400 response
- AND the same payload with `{mode:"fixed", value:1.8}` is accepted and its child's engine call receives `kf_mode="fixed", kf_value=1.8`

#### Scenario R13.2 — base_parameters is validated on the same terms

- GIVEN `base_parameters = {target_kf_distribution: {mode:"lognormal", value:1.8}}`
- WHEN the serializer validates
- THEN a 400 response
- AND the well-formed equivalent is accepted and reaches the engine

#### Scenario R13.3 — The study keeps the value its result views read

- GIVEN an accepted study declaring either parity grid key
- WHEN its results are listed, summarised or exported
- THEN the grid key is present in the study's `parameter_grid` with its configured values
- AND each child exposes the configured value for that key, so a results column shows the configuration rather than an empty cell

#### Scenario R13.4 — radius_max is not offered where the engine ignores it

- GIVEN a `tunable_cc` study
- WHEN the batch form offers parameters to vary
- THEN `radius_max` is not among them, because the engine overwrites it with the sampled primary size

#### Scenario R13.5 — The dpo surfaces are validated on the same terms

- GIVEN `parameter_grid = {dpo_distribution: [{mode:"lognormal", value:1.8}]}`
- WHEN the serializer validates
- THEN a 400 response
- AND the same holds for `base_parameters = {dpo_distribution: {mode:"lognormal", value:1.8}}`
- AND a well-formed entry reaches the engine as `dpo_mode` plus its parameters

#### Scenario R13.6 — An inverted uniform is refused, because the engine does not raise an Exception

- GIVEN `parameter_grid = {dpo_distribution: [{mode:"uniform", min:2.0, max:1.0}]}`
- WHEN the serializer validates
- THEN a 400 response
- AND no study is created whose children would reach `run_tunable_cc` with `dpo_min > dpo_max`, which panics in Rust as a `PanicException` deriving from `BaseException`, escaping the worker's `except Exception` guard

#### Scenario R13.7 — A config that is not an object is refused before translation

- GIVEN a swept entry that is a bare object, so that a child would store the string `"mode"` as its `kf_distribution`
- WHEN the serializer validates
- THEN a 400 response
- AND the translation step never receives a non-object, which would raise `AttributeError` inside the worker instead of reporting a bad request
