<!-- Last sync: 2026-10-29 from change distribution-grid-mode (R13 added; R1, R2, R7, R8, R10, R11 modified) -->

# Spec: Batch CC Tunable — Parameter Grid Parity

## Purpose

Specification for extending `ParametricStudy.parameter_grid` with 4 new keys (`kf_distribution`, `particle_radius_config`, `sintering_config`, `seed_type`), achieving feature parity between the batch form and the single-sim CC tunable form. Covers backend validation, task expansion, frontend UX, and safety caps.

## Requirements

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

The refusal scenarios in this requirement are read under the convention R13 states.

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
- THEN a 400 response: a bare scalar is not a distribution config, and the message says exactly that
  (`Distribution config must be a dict.`), naming no discriminator

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
on it being reachable. The batch form offers the same three shapes, so a `uniform` primary size is
configurable from the interface and not only through the API.

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

The refusal scenarios in this requirement are read under the convention R13 states.

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

### Requirement: R3 — sintering_config Grid Key

The system MUST accept sintering settings in the **sintering domain shape**, which is not the
generic distribution shape: its ranges are bounded and the fixed variant uses `coefficient`,
not `value`.

| `distribution_type` | Required fields | Validation |
|-------------------|----------------|-----------|
| `fixed` | `coefficient` | `0.5 <= coefficient <= 1.0` |
| `uniform` | `min`, `max` | `0.5 <= min,max <= 1.0`, `min <= max` |
| `normal` | `mean`, `std` | `0.5 <= mean <= 1.0`, `0 < std <= 0.2` |

`parameter_grid.sintering_config` MUST be an **array** of such settings.

Sintering also reaches a child as **flat scalars**, the shape the worker actually reads
(the sintering kwargs block of `run_simulation_task`). Those MUST be validated too:

| `sintering_type` | Required keys | Validation |
|---|---|---|
| `fixed`, and also when `sintering_type` is absent | `sintering_coeff` | `0.5 <= sintering_coeff <= 1.0` |
| `uniform` | `sintering_min`, `sintering_max` | `0.5 <= each <= 1.0`, `min <= max` |
| `normal` | `sintering_coeff` (the mean), `sintering_std` | `0.5 <= sintering_coeff <= 1.0`, `0 < sintering_std <= 0.2` |

A flat `sintering_coeff` with no `sintering_type` MUST be read as `fixed`: the batch form sends
exactly that on every `limiting` submit (the `limiting` payload built in `handleSubmit`), and rejecting it would
break that algorithm's only sintering input. Any **flat** `sintering_*` key outside
`{sintering_type, sintering_coeff, sintering_min, sintering_max, sintering_std}` MUST be
rejected, in particular `sintering_mean`, which no consumer reads. The key `sintering_config`
is the dict shape, not a flat key.

**Input surfaces.** Sintering reaches a child by seven user-controlled paths, and all seven MUST
be validated. Validation exists to return a useful 400 **before anything is written** (R12).

| # | Surface | Shape | `None` / `{}` |
| --- | --- | --- | --- |
| 1 | `parameter_grid.sintering_config[i]` | dict | rejected (400) |
| 2 | `ParametricStudy.sintering_config` | dict | accepted: this study configures no sintering |
| 3 | `base_parameters["sintering_config"]` | dict | accepted, same meaning |
| 4 | `base_parameters["sintering_*"]` | flat | absent means no sintering |
| 5 | `parameter_grid["sintering_*"]` | flat, swept | absent means no sintering |
| 6 | `limiting_cases_config.theoretical_extremes["sintering_*"]` | flat, swept | absent means no sintering |
| 7 | `limiting_cases_config.theoretical_extremes["sintering_config"]` | dict, swept | absent means no sintering |

Surfaces 6 and 7 are the same user-supplied map, whose keys are written verbatim into each child
by `generate_limiting_cases`. Their contents MUST be validated before any write. A
**well-formed** dict swept there MUST keep working; a malformed one — the `{mode, …}` shape the UI selector
produces — MUST be rejected like any other.

For the swept surfaces 5 and 6 the required-keys check applies to the child's **merged
projection** (base parameters plus the swept value), since the rest of the shape may legitimately
live in `base_parameters`; range and unknown-key checks apply per key, where they are written.

**Precedence is unchanged by this contract.** On the path through `create_simulation`, any dict
setting wins over any flat key regardless of where it came from, because the `sintering_config` pop in `create_simulation` pops
`sintering_config` from the merged parameters and `apply_sintering_config` then overwrites the
flat keys; among dicts the order is grid, then `base_parameters`, then the study field.

One path is exempt from that ordering and MUST stay that way: the sintering-extremes block
(the sintering-extremes block of `perform_create`) runs only when a study dict exists, yet deliberately does not call
`apply_sintering_config`, so each child keeps the flat `sintering_coeff` that
`generate_sintering_extreme_cases` wrote for it. A dict exists there and the flat key still
wins. This contract validates these settings and reorders none of them.

Being exempt from the ordering does **not** exempt that path from R11. Because it copies
`base_parameters` verbatim in `generate_sintering_extreme_cases` and the `sintering_config` pop
lives only in `create_simulation`, its children used to store a `sintering_config` dict that
**contradicts** the coefficient they run at — surface 3 with `coefficient: 0.7` yields a child
running the `0.5` extreme while storing `0.7`. That is a stored parameter that does not describe
what ran, which is what this contract exists to close. R11.7 requires it removed.

**Explicit rejection, never a silent default.** The system MUST NOT accept an incomplete or
unrecognised sintering setting and then apply defaults: the result would be a simulation whose
declared parameters do not describe what ran. Any violation of the shape tables MUST produce 400.
Additionally, `apply_sintering_config` MUST raise on a non-empty dict that violates the dict
rules, including an unknown `distribution_type`, rather than passing it to the worker, where the
engine falls through its default arm to `fixed(1.0)` (`parse_sintering`).

These settings are only valid for the algorithms R11 permits.

#### Scenario R3.1 — Grid sintering overrides study-level

- **GIVEN** study-level `sintering_config = {distribution_type:"fixed", coefficient:0.9}` AND `parameter_grid = {sintering_config: [{distribution_type:"uniform", min:0.7, max:0.95}]}`
- **WHEN** child sims are created
- **THEN** each child sim uses the grid entry, NOT the study-level one

#### Scenario R3.2 — No grid sintering uses study-level

- **GIVEN** study-level `sintering_config = {distribution_type:"fixed", coefficient:0.9}` AND `parameter_grid` has no `sintering_config` key
- **WHEN** child sims are created
- **THEN** each child sim uses the study-level sintering (existing behavior)

#### Scenario R3.3 — Invalid sintering config rejected

- **GIVEN** `parameter_grid = {sintering_config: [{distribution_type:"uniform", min:0.95, max:0.7}]}`
- **WHEN** the serializer validates
- **THEN** a 400 response (`min <= max` violated)
- **AND** `{distribution_type:"fixed", coefficient:0.4}` yields 400, outside `0.5..1.0`
- **AND** `{distribution_type:"normal", mean:0.9, std:0.3}` yields 400, and `std:0.0` yields 400

#### Scenario R3.4 — Unknown distribution_type rejected

- **GIVEN** `parameter_grid = {sintering_config: [{distribution_type:"lognormal", mean:0.9, std:0.1}]}`
- **WHEN** the serializer validates
- **THEN** a 400 response (only fixed/uniform/normal allowed)

#### Scenario R3.5 — The selector shape is rejected, not silenced

- **GIVEN** `parameter_grid = {sintering_config: [{mode:"normal", mean:0.8, std:0.05}]}`
- **WHEN** the serializer validates
- **THEN** 400 naming the unknown key `mode`
- **AND** no child is created with `sintering_coeff = 1.0`

#### Scenario R3.6 — Incomplete fields and empty entries rejected

- **GIVEN** `parameter_grid = {sintering_config: [{distribution_type:"fixed"}]}` without `coefficient`
- **WHEN** the serializer validates
- **THEN** 400 naming the missing `coefficient`
- **AND** the same for `uniform` without `min`/`max` and `normal` without `mean`/`std`
- **AND** `[{}]` yields 400, while a study-level `{}` or `null` is still accepted

#### Scenario R3.7 — base_parameters is validated like the others

- **GIVEN** `base_parameters = {"sintering_config": {"distribution_type": "fixed"}}` without `coefficient`
- **WHEN** the serializer validates
- **THEN** 400, and no study and no child simulation is created
- **AND** `{"distribution_type":"fixed", "coefficient":0.9}` is accepted and its children receive that sintering

#### Scenario R3.8 — Flat scalars are validated wherever they enter

- **GIVEN** `base_parameters = {"n_particles":100, "sintering_type":"normal", "sintering_coeff":0.6, "sintering_std":0.07}`
- **WHEN** the serializer validates
- **THEN** it is accepted and the children carry those values
- **AND** `{"sintering_coeff": 0.9}` with no type is accepted and means `fixed`
- **AND** `{"sintering_coeff": 42.0}` yields 400, and `parameter_grid = {"sintering_coeff": [-5.0, 42.0]}` yields 400
- **AND** `{"sintering_mean": 0.9}` yields 400, since no consumer reads that key
- **AND** a flat `{"sintering_type":"uniform"}` with no `min`/`max` anywhere yields 400

#### Scenario R3.9 — Theoretical extremes are validated, and the working path survives

- **GIVEN** `limiting_cases_config = {"theoretical_extremes": {"sintering_coeff":[42.0]}}`
- **WHEN** the serializer validates
- **THEN** 400, and the same for `{"sintering_mean":[0.9]}` and `{"sintering_type":["lognormal"]}`
- **AND** `{"sintering_coeff":[0.5, 0.9]}` is accepted for an algorithm R11 permits
- **AND** a well-formed `{"sintering_config":[{distribution_type:"fixed", coefficient:0.8}]}` is accepted and its child runs at 0.8
- **AND** a malformed `{"sintering_config":[{mode:"normal", mean:0.8, std:0.05}]}` yields 400

#### Scenario R3.10 — The helper invents no default

- **GIVEN** `apply_sintering_config(params, {"mode": "normal", "mean": 0.8, "std": 0.05})`
- **WHEN** the helper is called directly
- **THEN** it raises, and does not return `{"sintering_type": "fixed", "sintering_coeff": 1.0}`
- **AND** `{"distribution_type":"lognormal", …}` raises as well
- **AND** `None` and `{}` still return the parameters untouched

---

### Requirement: R4 — seed_type Grid Key

The system MUST accept `parameter_grid.seed_type` as an array of values from `{"monomers", "dimers", "trimers"}`.

Each child sim MUST have `seed_type` set on the Simulation **MODEL FIELD** (not in the params blob). This is the fix for latent bug #634 (`create_simulation`).

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

### Requirement: R5 — Combinatorial Expansion Semantics

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

### Requirement: R6 — Batch Size Warning and Hard Cap

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

### Requirement: R9 — Frontend: seed_type Multi-Select

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

The allow-list MUST apply to every input surface of R3. On a partial update that touches a
sintering setting or the algorithm and omits `base_algorithm`, it MUST be evaluated against the
instance's stored `base_algorithm`.

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

### Requirement: R12 — Invalid sintering settings are rejected before any write

Every sintering setting on an input surface of R3 MUST be validated **before the first write to
the database**. An invalid setting MUST produce 400 **and zero rows**: no `ParametricStudy`, no
`Simulation`, no queued task.

The system MUST NOT rely on `apply_sintering_config` raising during expansion as its rejection
mechanism: by then the study exists and some children are already queued. `perform_create`
(`ParametricStudyViewSet.perform_create`) does not wrap the expansion in `try/except` or `transaction.atomic`, the
project defines no `ATOMIC_REQUESTS`, and `run_simulation_task.delay` is called inside the
per-seed loop (the per-seed dispatch loop of `create_simulation`), so a dispatched task is not undone by a database rollback.

**A half-creation path this requirement did not set out to close, and closed anyway.** A
`parameter_grid.sintering_config` with two or more entries — which R3 requires accepting —
combined with `include_limiting_cases` used to crash mid-expansion: `generate_limiting_cases`
sorted dict values, raising `TypeError` after the study row and some children already existed.
That defect predated this change and belonged to `distribution-grid-wiring`. Validating by
previewing the real expansion forced it into the open: the boundary block now skips values it
cannot order, because a range boundary over objects is not ambiguous but meaningless, and such
a study is created. The requirement still governs rejection of invalid settings rather than
every way the expansion can fail; what changed is that this particular way no longer happens.

#### Scenario R12.1 — An invalid sintering setting creates nothing

- **GIVEN** a study creation request with `parameter_grid = {n_particles: [100, 200], sintering_config: [{distribution_type:"fixed", coefficient:0.9}, {mode:"normal", mean:0.8, std:0.05}]}`, the second entry invalid
- **WHEN** the request is processed
- **THEN** the response is 400, the `ParametricStudy` and `Simulation` row counts are unchanged, and no task was queued

#### Scenario R12.2 — The same for every other input surface

- **GIVEN** a request with `base_parameters = {"sintering_config": {"distribution_type":"uniform"}}` without `min`/`max`
- **WHEN** the request is processed
- **THEN** 400, zero studies, zero simulations, zero tasks
- **AND** the same for a flat `base_parameters = {"sintering_coeff": 42.0}` and for `limiting_cases_config.theoretical_extremes = {"sintering_mean":[0.9]}`

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

**How a refusal scenario is read.** In R1, R2, R7, R11 and R13, a scenario that expects a refusal
describes a request whose only defect is the one its GIVEN names: the payload the GIVEN writes is
taken as written, and every field it leaves unstated takes a value that satisfies the rules the
request touches. Its THEN promises the message that request receives; nothing the scenario asserts
is excused by a defect the GIVEN does not write. The scenarios of R5 and R6 are outside this
convention.

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

**Which keys a child keeps.** A child exposes the configured value for the keys it keeps, and
R13.3 asserts that for the two parity keys. Two swept keys are deliberately not among them. `seed_type`
is meant to travel in the child's own field, which is what R4.3 fixes for the grid path; a child that
keeps it in `parameters` while the field holds the default is the defect registered as point 3 of #115,
not a licence for this requirement to promise otherwise. `sintering_config` is translated into the flat
keys the worker reads, whose set and ranges R3 fixes. A view that keys its configurations on
`parameter_grid` therefore carries no value under those two names, and the effect is worse than an
empty cell: `fractal_analysis_summary` groups by exactly those keys, so two sweeps whose names read
null collapse into one configuration with their statistics pooled. This requirement adds no column for
them; what a view should show for a translated sweep is a separate change. Decided by the person on
2026-10-31 (#204), and the alternative - teaching the four views to render the translated value - is
registered in #115.

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
- THEN the grid entry wins for every child **the grid produces**, because the grid is what the
  study is sweeping
- AND the children of the limiting cases are not among them: they are built from
  `base_parameters` and keep its value under both names, which is how this expansion has always
  built them
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
