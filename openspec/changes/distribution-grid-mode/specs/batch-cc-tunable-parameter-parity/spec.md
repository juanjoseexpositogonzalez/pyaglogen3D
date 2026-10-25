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
| `{mode: "uniform", min, max}` | `min > 0`, `min <= max` |

Task expansion MUST produce one child sim per config entry x `seeds_per_combination`, and each
child MUST carry the configuration under the name the worker reads
(`target_kf_distribution`), while the study's own `parameter_grid` keeps both the key and the
value it was asked for, so result views that read `sim.parameters[grid key]` keep working.

#### Scenario R1.1 — Happy path: two normal distributions expand correctly

- GIVEN `parameter_grid = {kf_distribution: [{mode:"normal",mean:1.2,std:0.05},{mode:"normal",mean:1.3,std:0.05}]}` and `seeds_per_combination = 2`
- WHEN the ParametricStudy is created
- THEN 4 child sims are created (2 configs x 2 seeds)
- AND each child sim's params contains its corresponding config under `target_kf_distribution`
- AND the engine call for that child receives `kf_mode="normal"` and `kf_mean` of that entry

#### Scenario R1.2 — Scalar shorthand normalized to fixed

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
| `{mode: "uniform", min, max}` | `min > 0`, `min <= max` |

The cap on `std/mean` exists to prevent negative radii and MUST NOT be weakened.

This key varies the primary particle size **per run**, not within a run: the engine samples the
distribution once at run start and every particle of that run shares the sampled value. The
interface MUST NOT present it as polydispersity.

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

## ADDED Requirements

### Requirement: R13 — A declared distribution reaches the engine, or the study is refused

Every surface that accepts a distribution config for `target_kf` or primary particle size MUST
either deliver it to the engine or refuse it at validation. The surfaces are: the two parity
grid keys (R1, R2), the engine-named grid keys `parameter_grid.target_kf_distribution` and
`parameter_grid.dpo_distribution`, and the same two names inside `base_parameters`.

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
