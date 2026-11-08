## MODIFIED Requirements

### Requirement: R4 — seed_type Grid Key

The system MUST accept `parameter_grid.seed_type` as an array of values from `{"monomers", "dimers", "trimers"}`, and only for the algorithms that consume it: `tunable_cc`, the single branch of `run_simulation_task` whose engine call declares `seed_type`. For any other algorithm the request MUST be refused with 400 naming the surface that carried the value - `parameter_grid.seed_type`, `base_parameters.seed_type` or `limiting_cases_config.theoretical_extremes.seed_type` - because the value would be stored and never read.

Each child sim MUST have `seed_type` set on the Simulation **MODEL FIELD** (not in the params blob). This is the fix for latent bug #634 (`create_simulation`).

#### Scenario R4.1 — Valid seed_type grid expansion

- GIVEN `base_algorithm = "tunable_cc"`, `parameter_grid = {seed_type: ["dimers", "trimers"]}` and `seeds_per_combination = 2`
- WHEN the ParametricStudy is created
- THEN 4 child sims are created (2 types x 2 seeds)
- AND each child sim's `Simulation.seed_type` MODEL FIELD equals its grid value

#### Scenario R4.2 — Invalid seed_type rejected

- GIVEN `base_algorithm = "tunable_cc"` and `parameter_grid = {seed_type: ["quadrimers"]}`
- WHEN the serializer validates
- THEN a 400 response listing valid values

#### Scenario R4.4 — A seed_type the algorithm never reads is refused

- GIVEN `base_algorithm = "fracval"` and `parameter_grid = {seed_type: ["dimers"]}`
- WHEN the serializer validates
- THEN a 400 response naming `parameter_grid.seed_type`
- AND the same for `base_parameters.seed_type` and for `limiting_cases_config.theoretical_extremes.seed_type`, each named where it was sent
- AND no study and no child simulation is created
- AND a study stored before this rule can still be renamed, while a `PUT` or any request carrying `base_algorithm` - even unchanged - is judged (R11.8), and the refusal says how to clear the value in the same request

#### Scenario R4.3 — seed_type set on model field, not params

- GIVEN a child sim created from `seed_type: ["dimers"]`
- WHEN the sim is read from the DB
- THEN `sim.seed_type == "dimers"` (model field)
- AND `sim.parameters` does NOT contain a `seed_type` key

---

### Requirement: R5 — Combinatorial Expansion Semantics

Grid expansion MUST be the Cartesian product of all parameter_grid keys x `seeds_per_combination`. Key iteration order MUST be alphabetical for deterministic expansion.

#### Scenario R5.1 — Multi-key cross product

- GIVEN `base_algorithm = "tunable_cc"` (the only one that reads `seed_type`, R4), `parameter_grid = {kf_distribution: [d1, d2], seed_type: ["monomers", "dimers"]}` and `seeds_per_combination = 3`
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

- GIVEN `base_algorithm = "tunable_cc"`, `parameter_grid = {n_particles: [100, 350], seed_type: ["dimers", "trimers"]}` and `seeds_per_combination = 1`
- WHEN the ParametricStudy is created
- THEN 4 child sims (2 x 2 x 1), each with correct `n_particles` param AND correct `seed_type` model field

#### Scenario R5.5 — Unique RNG seed per child

- GIVEN any multi-combination grid
- WHEN child sims are created
- THEN each child sim receives a unique RNG seed

---

### Requirement: R7 — Backward Compatibility

When `parameter_grid` includes none of the four keys added by the parity change
(`kf_distribution`, `particle_radius_config`, `sintering_config`, `seed_type`), behavior MUST be
IDENTICAL to before that change.

**Carve-out.** That guarantee does not extend to sintering settings this contract now validates:
flat `sintering_*` keys, a `sintering_config` in `base_parameters` or in
`limiting_cases_config`, and the `fixed` payload carrying `value` where canonical R3 requires
`coefficient` — which used to run with no sintering at all, because nothing read `value`, and is
now rejected (R7.3). Nor does it extend to the `normal` mean, which used to travel in `sintering_mean` and
reach the engine as `1.0`.

One more narrowing joins this list, and it is not a sintering setting: `seed_type` is now accepted
only for the algorithm that reads it (R4), so a study declaring it for any other algorithm - on the
grid, in `base_parameters` or in the swept extremes - is refused where it used to create children
that stored a value nothing read. A request whose grid carries none of the four keys is still
judged against this rule, which is what the paragraph below is for.

One more narrowing belongs in this list: a **study-level**
`sintering_config = {distribution_type:"fixed"}` with no `coefficient` used to be accepted and
defaulted; it now returns 400, because a setting that says nothing is not a setting.

This change adds a second group of rejections, on top of the sintering ones above. A study is
also refused when it declares a `kf` or primary-size distribution that used to be accepted and
silently defaulted: a `mode` outside `fixed`, `normal`, `uniform`; a config out of range
(`value <= 0`, `mean <= 0`, `std <= 0`, `min <= 0`, `max <= min`); or a config that is not an
object. A primary-size config whose `std/mean` exceeds the cap R2 fixes is also refused now, on
any surface rather than only in the grid — and it belongs to a different group than the rest:
it was **not** silently defaulted. Measured, `base_parameters.dpo_distribution` with
`std/mean = 0.5` reached the engine as `dpo_mode="normal", dpo_std=0.5` and ran, with a spread
wide enough to produce negative radii, which is what that cap exists to prevent. Not all of the
others used to answer `201`: on the two parity grid keys — the only two that
reach the shared distribution validator — `std < 0` and `min > max` were already refused. On the
other ten surfaces there was no distribution validation at all, so even those answered `201`. Those that did answer `201` and produced a simulation ignoring what was
asked include `value <= 0`, `mean <= 0`, `std == 0`, `min <= 0` and `min == max` on the parity
keys, and — on the ten surfaces with no validation at all — every malformed **config shape** of those
three kinds, the unknown `mode` among them: measured, `parameter_grid.target_kf_distribution = [{mode:"lognormal",
value:1.8}]` answers `201` and reaches the engine with no kwargs, so the simulation runs at the
default. The identical-behaviour promise never covered any of them, which is what R7.4 carves out of this
requirement and R13.1, R13.2, R13.5, R13.7 and R13.8 carve out of R13 — all seven, not a
selection.

There is a third group, larger than the two above: a config that is **well formed** is still
refused when the study's algorithm does not consume it, which R13 fixes as an allow-list. For
the ten algorithms outside it, every one of the four keys R13 governs — `kf_distribution`,
`particle_radius_config`, `target_kf_distribution` and `dpo_distribution` — two of them among
the parity four named in the opening sentence, two of them the engine-facing names — used to be accepted on every surface and read by nobody; now
each is a 400.

A well-formed config in `base_parameters.kf_distribution` or
`base_parameters.particle_radius_config` is not refused **for its shape or its range** when the
algorithm does consume it: R13 requires it to be delivered to the engine instead.

The refusal scenarios in this requirement are read under the convention R13 states.

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
- **AND** `sintering_config = {distribution_type:"fixed", value:0.9}` also yields 400, because canonical R3 documents `coefficient`, not `value`, for the fixed shape

#### Scenario R7.4 — The distribution carve-out is explicit

- GIVEN `parameter_grid = {target_kf_distribution: [{mode:"lognormal", value:1.8}]}`, which contains none of the four parity keys
- WHEN the serializer validates
- THEN a 400 response whose message names the accepted modes
- AND R7's identical-behaviour promise does not apply to it

### Requirement: R10 — Frontend: Parameter-to-Vary Dropdown Extension

The existing dropdown in `BatchSimulationForm.tsx` MUST gain 4 new options:

- "kf distribution (normal/uniform/fixed)" — only for the algorithms that consume it (R13)
- "Particle radius (per-run variation)" — only for the algorithms that consume it (R13)
- "Sintering coefficient distribution" — **only for the algorithms that consume sintering**
  (R11): `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `tunable_cc`
- "Seed type (monomer/dimer/trimer)"

  The qualification this requirement gives its three siblings is **not** applied here yet: the
  form still offers the option for every algorithm but `limiting`, while the server refuses it
  for all but `tunable_cc` (R4). The record matches the code; the qualification lands with the
  form change, not before it.

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
