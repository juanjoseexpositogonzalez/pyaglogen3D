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

Task expansion MUST produce one child sim per config entry x `seeds_per_combination`. Each
child's params MUST include the distribution object **verbatim** (the engine samples it per
#633), never normalised or rewritten, and MUST carry it under **both** names: `kf_distribution`, which four result
views read as `sim.parameters[grid key]` and which R5.2 requires, **and**
`target_kf_distribution`, which the worker translates for the engine. Translation here means
*adding* the engine name, never replacing the grid key: removing it empties a column in
`fractal_analysis_summary`, `export_csv`, `formatConfigLabel` and `varyingParams`.

One inherited scenario title contradicts its own body and cannot be renamed here: `R1.2 — Scalar
shorthand normalized to fixed` now requires a 400, because a bare scalar has never been
normalised (measured: `Distribution config must be a dict.`). The title survives because a
MODIFIED block may not drop a scenario, and renaming it needs its own change.

#### Scenario R1.1 — Happy path: two normal distributions expand correctly

- GIVEN `parameter_grid = {kf_distribution: [{mode:"normal",mean:1.2,std:0.05},{mode:"normal",mean:1.3,std:0.05}]}` and `seeds_per_combination = 2`
- WHEN the ParametricStudy is created
- THEN 4 child sims are created (2 configs x 2 seeds)
- AND each child sim's params contains its corresponding config under **both** `kf_distribution`, which the result views read and R5.2 requires, and `target_kf_distribution`, which the worker translates
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
- THEN a 400 response whose message names the `min < max` constraint, not the discriminator

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

The cap on `std/mean` exists to prevent negative radii and MUST NOT be weakened. It therefore
follows the **magnitude**, not the spelling: it applies to `particle_radius_config` and to
`dpo_distribution` alike, on every surface R13 enumerates. Guarding one name and leaving the
other open would let the same value reach the same engine input by renaming the key, which is
weakening it by another route: measured, `particle_radius_config` answered 400 and
`dpo_distribution` 201 for the same `std/mean = 0.5`.

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
- THEN accepted; the child sim's params contain that config under **both** `particle_radius_config`, which the result views read, and `dpo_distribution`, which the worker translates
- AND the engine call for that child receives `dpo_mode="fixed"` and `dpo_value=1.5`

### Requirement: R7 — Backward Compatibility

When `parameter_grid` includes none of the four keys added by the parity change
(`kf_distribution`, `particle_radius_config`, `sintering_config`, `seed_type`), behavior MUST be
IDENTICAL to before that change.

**Carve-out.** That guarantee does not extend to sintering settings this contract now validates:
flat `sintering_*` keys, a `sintering_config` in `base_parameters` or in
`limiting_cases_config`, and the `fixed` payload the canonical documents with a `value` key —
which used to run with no sintering at all, because nothing read `value`, and is now rejected
(R7.3). Nor does it extend to the `normal` mean, which used to travel in `sintering_mean` and
reach the engine as `1.0`.

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

#### Scenario R7.4 — The distribution carve-out is explicit

- GIVEN `parameter_grid = {target_kf_distribution: [{mode:"lognormal", value:1.8}]}`, which contains none of the four parity keys
- WHEN the serializer validates
- THEN a 400 response whose message names the accepted modes
- AND R7's identical-behaviour promise does not apply to it

### Requirement: R8 — Frontend: DistributionGridInput Component

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

- GIVEN a DistributionGridInput entry with `mode: "normal"` and `mean: -1`
- WHEN the user blurs the mean field
- THEN a red border and error message appear on that field

### Requirement: R10 — Frontend: Parameter-to-Vary Dropdown Extension

The existing dropdown in `BatchSimulationForm.tsx` MUST gain 4 new options:

- "kf distribution (normal/uniform/fixed)" — only for the algorithms that consume it (R13)
- "Particle radius (per-run variation)" — only for the algorithms that consume it (R13)
- "Sintering coefficient distribution" — **only for the algorithms that consume sintering**
  (R11): `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `tunable_cc`
- "Seed type (monomer/dimer/trimer)"

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

### Requirement: R11 — Sintering reaches the engine, and only where it is consumed

Sintering settings MUST reach the engine with the values the user declared. For
`distribution_type: "normal"` the mean MUST travel in `sintering_coeff`, the parameter
`parse_sintering` reads as the mean (`parse_sintering`). The set of sintering parameters the worker
reads is exactly `{sintering_type, sintering_coeff, sintering_min, sintering_max,
sintering_std}` (the sintering kwargs block of `run_simulation_task`), and the system MUST NOT write any sintering key outside
that set into a child's parameters.

**Algorithm scope, as an allow-list** (the model has eleven algorithms, `SimulationAlgorithm`; any
algorithm not listed is rejected with 400):

| Setting | Allowed for |
| --- | --- |
| Sintering with any type | `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `tunable_cc` |
| Sintering with `fixed` only | `limiting`, which reads `sintering_coeff` (the `limiting` branch of `run_simulation_task`) but ignores type, min, max and std |
| None | `fracval`, `gcca`, `box_rfa`, `imported` |

The allow-list MUST apply to every input surface of R3. On a partial update that omits
`base_algorithm`, it MUST be evaluated against the instance's stored `base_algorithm`.

This requirement governs study expansion. The single-simulation endpoints, the Django admin and
the AI assistant tool (the AI assistant's study-creation tool) are outside it; the chained
contract `study-expansion-single-source` covers the last one.

The allow-list is evaluated **only when the request touches a sintering setting or the
algorithm**. R11.6 fixes *which* algorithm a partial update is judged against — the stored one —
not *when* the rule runs, and running it over the stored values on every request froze rows
written before the allow-list existed: a `fracval` study carrying a sintering setting could not
be renamed, and recovering it meant clearing the setting or moving the study to an algorithm
that consumes it. Echoing the algorithm counts as touching it, so a `PUT`, which must carry
`base_algorithm`, is always **judged**: a full representation asserts "this algorithm with these
settings", and the allow-list decides. When the combination is allowed the update succeeds; when
it is not, it is refused — the judging is unconditional, the refusal is not.

This is the same gate R13.12 states for the four distribution keys — the same rule about **when**
the allow-list runs, written here so the two requirements say it rather than one of them implying
it. The parity stops at *when*: this clause fixes when the allow-list runs, and says nothing more.

#### Scenario R11.1 — Normal sintering arrives with its mean

- **GIVEN** a `ballistic` study with `parameter_grid = {sintering_config: [{distribution_type:"normal", mean:0.8, std:0.05}]}`
- **WHEN** the child's task runs
- **THEN** the engine binding is invoked with `sintering_type="normal"` and `sintering_coeff=0.8`, not 1.0

#### Scenario R11.2 — Fixed and uniform still arrive

- **GIVEN** studies with `{distribution_type:"fixed", coefficient:0.9}` and with `{distribution_type:"uniform", min:0.7, max:0.95}`
- **WHEN** the children's tasks run
- **THEN** the binding receives `sintering_type="fixed"` with `sintering_coeff=0.9` for the first
- **AND** `sintering_type="uniform"` with `sintering_min=0.7` and `sintering_max=0.95` for the second

#### Scenario R11.3 — No sintering key without a reader

- **GIVEN** any valid sintering setting from any surface of R3
- **WHEN** it is expanded into a child's parameters
- **THEN** the sintering keys written are contained in the set the worker reads
- **AND** `sintering_mean` is never written

#### Scenario R11.4 — Rejected for algorithms that do not consume sintering

- **GIVEN** `base_algorithm` in `{fracval, gcca, box_rfa, imported}` and a sintering setting **declared in the request** on any surface of R3
- **WHEN** the serializer validates
- **THEN** 400 stating that this algorithm does not consume sintering
- **AND** in particular `base_parameters = {"sintering_coeff": 0.8}` and a theoretical extreme `{"sintering_coeff":[0.8]}` are both rejected

#### Scenario R11.5 — limiting accepts the fixed shape only

- **GIVEN** `base_algorithm = "limiting"` and a sintering setting `{distribution_type:"normal", mean:0.8, std:0.05}`
- **WHEN** the serializer validates
- **THEN** 400 stating that `limiting` accepts the fixed shape only
- **AND** `{distribution_type:"fixed", coefficient:0.9}` is accepted, a flat sweep `{"sintering_coeff": [0.7, 0.9]}` is accepted, and the server-side default extremes (the `limiting` entry of `THEORETICAL_EXTREMES`) remain accepted

#### Scenario R11.6 — Partial update evaluates against the stored algorithm

- **GIVEN** an existing study with `base_algorithm = "fracval"`
- **WHEN** a `PATCH` supplies only `base_parameters = {"sintering_coeff": 0.8}`
- **THEN** the rule is evaluated against the instance's `base_algorithm` and the request is rejected with 400

#### Scenario R11.7 — Sintering-extreme children carry no sintering_config

- **GIVEN** a study whose `base_parameters` carry a `sintering_config` dict, with
  `include_limiting_cases` and a study-level sintering config, so the sintering-extremes block
  (the sintering-extremes block of `perform_create`) runs
- **WHEN** its children are created
- **THEN** no child's parameters contain `sintering_config`
- **AND** each child keeps the flat `sintering_coeff` of its own extreme

#### Scenario R11.8 — A stored row stays editable, and a full representation is still judged

- **GIVEN** a stored study with `base_algorithm = "fracval"` carrying a sintering setting on any surface of R3
- **WHEN** a `PATCH` changes only its name
- **THEN** 200, and the stored setting is left exactly as it was
- **AND** a `PUT`, or any request that carries `base_algorithm` even unchanged, is judged, and refused with 400 when the combination it asserts is one the allow-list forbids — a full update of a study whose settings are allowed still succeeds
- **AND** adding a sintering setting by update, or moving the algorithm out of the allow-list, is still rejected
- **AND** any stored container that is not an object — `base_parameters`, `parameter_grid`, `sintering_config`, `limiting_cases_config` or its `theoretical_extremes` — is ignored rather than judged, because such a row cannot be expanded either; only writers that skip the serializer can produce one, since a payload holding one is refused

## ADDED Requirements
### Requirement: R13 — A declared distribution reaches the engine, or the study is refused

Within the batch study surfaces enumerated here, a distribution config for `target_kf` or
primary particle size MUST either be delivered to the engine or refused at validation. The
surfaces are, exhaustively: `parameter_grid.kf_distribution` and
`parameter_grid.particle_radius_config` (R1, R2); `parameter_grid.target_kf_distribution` and
`parameter_grid.dpo_distribution`; those four names inside `base_parameters`; and **all four**
swept through `limiting_cases_config.theoretical_extremes`.

These keys MUST be accepted only for an algorithm that consumes them, on the same terms R11
already fixes for sintering, and the allow-list MUST be written as the set that is permitted,
never as a list of the excluded: the model declares eleven algorithms and an enumeration of the
excluded silently omitted two of them.

**How a refusal scenario is read.** A scenario in this file that ends in a 400 describes a request
whose only defect is the one its GIVEN states, every other rule the request touches holding. Its
THEN promises the message such a request receives, and says nothing about a request that breaks a
second rule as well.

| Algorithm | These four keys |
|---|---|
| `tunable_cc` | **accepted** — its worker branch expands them and `run_tunable_cc` is the only binding declaring `kf_mode`/`dpo_mode` |
| `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `fracval`, `gcca`, `box_rfa`, `limiting`, `imported` | **refused with 400** |

Before this change, every algorithm outside the allow-list accepted these keys, stored them in
its children and had no reader for them. The refusal MUST hold whichever way the mismatch is
reached: declaring the key on a study whose algorithm does not consume it, adding the key later
by update, **or changing the algorithm of a study that already carries it**. R10 governs what the
form offers, and this requirement does not restate it.

Two surfaces of the same family are deliberately left out, and this says so rather than leaving it
to be discovered: the single-simulation serializer accepts the same two keys for every algorithm,
and its worker reads them only for `tunable_cc`, so for the other ten they go nowhere. That is real and it is the same silent failure, but it belongs to the
single-simulation serializer, not to batch expansion, and widening a contract mid-flight to
cover a newly found surface is its own change, not this one. The second is the AI
assistant's study tool, which writes `ParametricStudy` and `Simulation` rows through the ORM
with no serializer, so no allow-list in this requirement reaches it; R11 named that same door and
derived it to `study-expansion-single-source`, and so does this one.

Storing a configuration whose `mode` the translator does not recognise is forbidden: it reaches
the engine as no kwargs at all, and the simulation silently runs with the default.

Range validation is part of delivering it, not a separate nicety, and it MUST match what
`cc-tunable-aggregation` R11 and R12 already require of these same engine inputs: reject
`value <= 0`, `mean <= 0` and `std <= 0` for Normal, `min <= 0`, and `max <= min` for Uniform,
plus the `std/mean` cap R2 fixes for the primary-size magnitude under either of its names, and
every magnitude MUST be a number rather than a string or a boolean: a string bound reaches the
binding and raises there, after the row is written, and a boolean runs silently as `1.0`. Both
belong in this list because this requirement is where the surfaces and their mandatory
rejections live: stating a rule only in R2 lets an implementer reading R13 drop half of it.
Three of those are not cosmetic: measured against the real binding, `kf_mode="fixed", kf_value=-1.0`, `kf_mode="normal", kf_mean=-1.0`
and `kf_mode="uniform", kf_min=2.0, kf_max=1.0` all raise a Rust `PanicException`, which derives
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

- GIVEN an accepted study declaring either parity grid key in the `mode` shape this change requires
- WHEN its results are listed, summarised or exported
- THEN the grid key is present in the study's `parameter_grid` with its configured values
- AND each child exposes the configured value for that key, so a results column shows the configuration rather than an empty cell

#### Scenario R13.10 — A parity key outside the grid is delivered, not discarded

- GIVEN a `tunable_cc` study with `base_parameters = {kf_distribution: {mode:"fixed", value:1.8}}` and a grid that does not mention it
- WHEN the study is expanded
- THEN every child carries it under `target_kf_distribution` as well, and the engine call receives `kf_mode="fixed", kf_value=1.8`
- AND the same holds for `base_parameters.particle_radius_config`, and for both keys swept through `limiting_cases_config.theoretical_extremes`
- AND no accepted surface of this requirement writes a configuration that no consumer reads

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
- AND the same holds for every pair naming the same magnitude, in either direction: a grid entry under `kf_distribution` or `target_kf_distribution` beats either name in `base_parameters`, and likewise for `particle_radius_config` and `dpo_distribution`
- AND that precedence is the same one R3 already fixes for the sintering equivalent

#### Scenario R13.11 — The uniform option is submittable without a prior edit

- GIVEN the batch form with `kf_distribution` selected and an entry switched to `uniform`
- WHEN the form submits without the user editing the bounds
- THEN the payload is accepted, because the selector does not emit `min == max` against a `min < max` rule
- AND this is the property R10.5 already fixes for the sintering payload

#### Scenario R13.12 — The keys are refused where the engine cannot receive them

- GIVEN a study whose `base_algorithm` is any of the ten outside the allow-list above, `limiting` and `imported` included
- WHEN it declares `kf_distribution`, `particle_radius_config`, `target_kf_distribution` or `dpo_distribution`, on any of the surfaces above
- THEN a 400 response naming the algorithms that consume the key
- AND the check runs on create and on update, so it cannot be bypassed by creating without the key and adding it afterwards
- AND a `tunable_cc` study that already carries one of these keys cannot have its `base_algorithm` changed to an algorithm outside the allow-list, which is the mismatch reached from the other side
- AND the check runs only on updates that touch one of these keys or the algorithm, so a row stored before this change stays editable in its other fields instead of becoming frozen

