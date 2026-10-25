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
| `{mode: "normal", mean, std}` | `mean > 0`, `std > 0` |
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

> The title is inherited **verbatim** because a MODIFIED block may not drop a scenario, and it has
> always been false: a bare scalar has never been normalised. Measured: `Distribution config must
> be a dict.` Renaming it needs its own change; until then this note keeps the contradiction
> visible instead of silent.

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
| `{mode: "normal", mean, std}` | `mean > 0`, `std > 0`, `std/mean <= 0.3` |
| `{mode: "uniform", min, max}` | `min > 0`, `min < max` |

`uniform` is accepted here because the engine implements `dpo_mode="uniform"` and R13.6 depends
on it being reachable. The batch form restricts this key to `fixed` and `normal`; aligning the
form is part of this change, not a licence for the API to differ from it.

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
(`kf_distribution`, `particle_radius_config`, `sintering_config`, `seed_type`), behavior MUST be
IDENTICAL to before that change.

**Carve-out.** That guarantee does not extend to sintering settings this contract now validates:
flat `sintering_*` keys, a `sintering_config` in `base_parameters` or in
`limiting_cases_config`, and the `fixed` payload the canonical documents with a `value` key —
which used to run with no sintering at all, because nothing read `value`, and is now rejected
(R7.3). Nor does it extend to the `normal` mean, which used to travel in `sintering_mean` and
reach the engine as `1.0`.

One more narrowing belongs in this list, recorded at archive time: a **study-level**
`sintering_config = {distribution_type:"fixed"}` with no `coefficient` used to be accepted and
defaulted; it now returns 400, because a setting that says nothing is not a setting.

#### Scenario R7.1 — Old grid with only scalar keys

- **GIVEN** `parameter_grid = {n_particles: [100, 200], target_df: [1.8]}`
- **WHEN** the study is created
- **THEN** child sims are created identically to pre-change behavior

#### Scenario R7.2 — Historical ParametricStudies remain valid

- **GIVEN** a ParametricStudy record saved before this change
- **WHEN** it is read or child sims are re-listed
- **THEN** no error occurs; results are identical to pre-change

#### Scenario R7.3 — The carve-out is explicit

- **GIVEN** `parameter_grid = {n_particles: [100], "sintering_coeff": [42.0]}`
- **WHEN** the serializer validates
- **THEN** 400, even though the grid contains none of the four added keys
- **AND** `sintering_config = {distribution_type:"fixed", value:0.9}` also yields 400, although that is the payload canonical R3 documents

This change adds a second group of rejections, on top of the sintering ones above. A study is
now also refused when it declares a `kf` or primary-size distribution that used to be accepted
and silently defaulted:

- a `mode` outside `fixed`, `normal`, `uniform` — previously `201`, reaching the engine as no kwargs at all;
- a config whose values are out of range (`value <= 0`, `std <= 0`, `min <= 0`, `max <= min`) — previously `201`, and several of them panic the worker;
- a config that is not an object — previously `201`, storing key names as values in the children.

Each of those used to answer `201` and produce a simulation that ignored what was asked, so the
identical-behaviour promise never covered them.

#### Scenario R7.4 — The distribution carve-out is explicit

- GIVEN `parameter_grid = {target_kf_distribution: [{mode:"lognormal", value:1.8}]}`, which contains none of the four parity keys
- WHEN the serializer validates
- THEN a 400 response, and R7's identical-behaviour promise does not apply to it

### Requirement: R10 — Frontend: Parameter-to-Vary Dropdown Extension

The existing dropdown in `BatchSimulationForm.tsx` MUST gain 4 new options:

- "kf distribution (normal/uniform/fixed)"
- "Particle radius (polydispersity)"
- "Sintering coefficient distribution" — **only for the algorithms that consume sintering**
  (R11): `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `tunable_cc`
- "Seed type (monomer/dimer/trimer)"

Each option MUST swap the value input UI to the corresponding component (DistributionGridInput
for distributions, multi-select chips for seed_type).

For `base_algorithm = "limiting"` the dropdown keeps its own separate list
(the `limiting` branch of `parameterOptionsFor`), offering none of the four and instead a flat
`sintering_coeff` sweep (`:294`). That algorithm also has a dedicated "Base Sintering Coeff."
input (`:409-418`) sent as `base_parameters.sintering_coeff` on every submit (`:220`). Both are
sintering inputs under R3 and MUST produce a payload R3 accepts; in particular an emptied field
MUST NOT be submitted as `null` or `NaN`.

The `sintering_config` payload MUST be sent in R3's dict shape, not in the selector component's
`{mode, …}` shape; the translation MUST live in a single pure function.

When the selected algorithm changes, any configured variation the new algorithm does not accept
MUST be cleared or flagged, so the form cannot submit a payload R11 rejects without telling the
user why.

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

`particle_radius_config` MUST NOT be labelled polydispersity. The engine samples it once per run
and every particle of that run shares the sampled value, so the honest label names per-run
variation of the primary particle size.

#### Scenario R10.7 — The primary size option does not promise polydispersity

- GIVEN the batch form's parameter-to-vary dropdown
- WHEN `particle_radius_config` is listed
- THEN its label describes per-run variation of the primary particle size
- AND it does not use the word polydispersity, which the engine does not deliver

## ADDED Requirements
### Requirement: R13 — A declared distribution reaches the engine, or the study is refused

Within the batch study surfaces enumerated here, a distribution config for `target_kf` or
primary particle size MUST either be delivered to the engine or refused at validation. The
surfaces are, exhaustively: `parameter_grid.kf_distribution` and
`parameter_grid.particle_radius_config` (R1, R2); `parameter_grid.target_kf_distribution` and
`parameter_grid.dpo_distribution`; those four names inside `base_parameters`; and **all four**
swept through `limiting_cases_config.theoretical_extremes`.

One surface of the same family is deliberately left out, and this says so rather than leaving it
to be discovered. The single-simulation serializer accepts `target_kf_distribution` and
`dpo_distribution` for every algorithm, while the worker reads them only in its `tunable_cc`
branch, so every other algorithm accepts and discards them. That is real and it is the same
silent failure, but it belongs to the single-simulation path, not to batch expansion, and
widening a contract mid-flight to cover a newly found surface is what killed this one's
predecessor.

Storing a configuration whose `mode` the translator does not recognise is forbidden: it reaches
the engine as no kwargs at all, and the simulation silently runs with the default.

Range validation is part of delivering it, not a separate nicety, and it MUST match what
`cc-tunable-aggregation` R11 and R12 already require of these same engine inputs: reject
`value <= 0`, `std <= 0` for Normal, `min <= 0`, and `max <= min` for Uniform. Two of those are
not cosmetic: measured against the real binding, `kf_mode="fixed", kf_value=-1.0` and
`kf_mode="uniform", kf_min=2.0, kf_max=1.0` both raise a Rust `PanicException`, which derives
from `BaseException` and escapes the worker's only outer `except Exception`, leaving the
simulation stuck in `RUNNING`.

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

#### Scenario R13.5 — The dpo surfaces are validated on the same terms

- GIVEN `parameter_grid = {dpo_distribution: [{mode:"lognormal", value:1.8}]}`
- WHEN the serializer validates
- THEN a 400 response
- AND the same holds for `base_parameters = {dpo_distribution: {mode:"lognormal", value:1.8}}`
- AND a well-formed entry reaches the engine as `dpo_mode` plus its parameters

#### Scenario R13.8 — An out-of-range value is refused on every surface

- GIVEN `parameter_grid = {target_kf_distribution: [{mode:"fixed", value:-1.0}]}`
- WHEN the serializer validates
- THEN a 400 response
- AND the same for `std <= 0` on Normal and `min <= 0` on Uniform, on any of the surfaces listed above

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

#### Scenario R13.9 — Precedence when a grid key and base_parameters both declare one

- GIVEN a study whose `base_parameters` declares `target_kf_distribution` and whose `parameter_grid` declares `kf_distribution`
- WHEN its children are expanded
- THEN the grid entry wins for every child, because the grid is what the study is sweeping
- AND that precedence is the same one R3 already fixes for the sintering equivalent
