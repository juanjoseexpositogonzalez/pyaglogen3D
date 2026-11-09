# Delta: batch-cc-tunable-parameter-parity

## MODIFIED Requirements
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
