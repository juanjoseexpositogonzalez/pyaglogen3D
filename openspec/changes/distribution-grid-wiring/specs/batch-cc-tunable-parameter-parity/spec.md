# Delta: batch-cc-tunable-parameter-parity

## MODIFIED Requirements

### Requirement: R1 — kf_distribution Grid Key

The system MUST accept `parameter_grid.kf_distribution` as an array of distribution config
objects in the **domain shape**, whose discriminator key is `distribution_type` — the same key
`SimulationSerializer` already requires on the single-simulation path, and the same key the
sintering domain shape uses. `type` and `mode` are not accepted.

| Shape | Validation |
|-------|-----------|
| `{distribution_type: "fixed", value}` | `value > 0` |
| `{distribution_type: "normal", mean, std}` | `mean > 0`, `std >= 0` |
| `{distribution_type: "uniform", min, max}` | `min > 0`, `min < max` |

Task expansion MUST produce one child sim per config entry x `seeds_per_combination`, and each
child MUST carry the configuration **under the name the worker reads**
(`target_kf_distribution`), so the value declared in the grid reaches the engine instead of
being stored under a name nothing consumes.

The grid key keeps its own name in `parameter_grid` so result tables that build their columns
from `Object.keys(parameter_grid)` keep working.

#### Scenario R1.1 — Happy path: two normal distributions expand correctly

- GIVEN `parameter_grid = {kf_distribution: [{distribution_type:"normal",mean:1.2,std:0.05},{distribution_type:"normal",mean:1.3,std:0.05}]}` and `seeds_per_combination = 2`
- WHEN the ParametricStudy is created
- THEN 4 child sims are created (2 configs x 2 seeds)
- AND each child sim's params contains its corresponding config under `target_kf_distribution`
- AND the engine call for that child receives that distribution, not the `1.3` default

#### Scenario R1.2 — Scalar shorthand normalized to fixed

- GIVEN `parameter_grid = {kf_distribution: [1.3]}`
- WHEN the serializer validates
- THEN a 400 response: a bare scalar is not a distribution config
- AND the error names the `distribution_type` key the caller must supply

#### Scenario R1.3 — Invalid config rejected with 400

- GIVEN `parameter_grid = {kf_distribution: [{distribution_type:"normal", mean:-1, std:0.1}]}`
- WHEN the serializer validates
- THEN a 400 response with message identifying `mean > 0` constraint

#### Scenario R1.4 — Missing required fields rejected

- GIVEN `parameter_grid = {kf_distribution: [{distribution_type:"uniform", min:1.0}]}` (missing `max`)
- WHEN the serializer validates
- THEN a 400 response with descriptive error

#### Scenario R1.5 — Uniform with min >= max rejected

- GIVEN `parameter_grid = {kf_distribution: [{distribution_type:"uniform", min:1.5, max:1.0}]}`
- WHEN the serializer validates
- THEN a 400 response

#### Scenario R1.6 — The selector shape is rejected, and says so

- GIVEN `parameter_grid = {kf_distribution: [{mode:"fixed", value:1.5}]}`
- WHEN the serializer validates
- THEN a 400 response naming `distribution_type` as the expected key
- AND the same holds for `{type:"fixed", value:1.5}`

### Requirement: R2 — particle_radius_config Grid Key

The system MUST accept `parameter_grid.particle_radius_config` as an array of
radius/polydispersity configs in the same domain shape, keyed by `distribution_type`, and MUST
write each entry into its children under the name the worker reads (`dpo_distribution`).

| Shape | Validation |
|-------|-----------|
| `{distribution_type: "fixed", value}` | `value > 0` |
| `{distribution_type: "normal", mean, std}` | `mean > 0`, `std/mean <= 0.3` |

The cap on `std/mean` exists to prevent negative radii and MUST NOT be weakened.

#### Scenario R2.1 — Normal polydispersity within ratio limit

- GIVEN `parameter_grid = {particle_radius_config: [{distribution_type:"normal", mean:1.0, std:0.2}]}`
- WHEN the serializer validates
- THEN accepted (`std/mean = 0.2 <= 0.3`)

#### Scenario R2.2 — Excessive std/mean ratio rejected

- GIVEN `parameter_grid = {particle_radius_config: [{distribution_type:"normal", mean:1.0, std:0.5}]}`
- WHEN the serializer validates
- THEN a 400 response identifying `std/mean <= 0.3` constraint (prevents negative radii)

#### Scenario R2.3 — Fixed radius accepted

- GIVEN `parameter_grid = {particle_radius_config: [{distribution_type:"fixed", value:1.5}]}`
- WHEN the serializer validates
- THEN accepted; the child sim's params contain that config under `dpo_distribution`
- AND a `mean` key in place of `value` yields 400, naming `value`

## ADDED Requirements

### Requirement: R13 — A grid entry reaches the engine, or the study is refused

A distribution grid key MUST either reach the engine under a name the worker reads, or be
refused at validation. Storing a configuration in a child's parameters under a name no consumer
reads is the silent failure this requirement forbids: the study reports success and the
simulation runs with the engine default.

#### Scenario R13.1 — The declared kf distribution changes the engine call

- GIVEN a study whose grid declares `kf_distribution` with `{distribution_type:"fixed", value:1.8}`
- WHEN its child runs
- THEN the engine binding receives that distribution
- AND it does not receive the `target_kf` default of `1.3`

#### Scenario R13.2 — The declared radius distribution changes the engine call

- GIVEN a study whose grid declares `particle_radius_config` with `{distribution_type:"normal", mean:2.0, std:0.2}`
- WHEN its child runs
- THEN the engine binding receives that distribution rather than the `1.0` default radius

#### Scenario R13.3 — No unread distribution key is written into a child

- GIVEN any accepted study that declares either distribution grid key
- WHEN expansion writes its children
- THEN no child's parameters contain `kf_distribution` or `particle_radius_config`
- AND the study's own `parameter_grid` still lists the key it was asked for, so result tables keep their column

#### Scenario R13.4 — A bare object swept through theoretical extremes is refused

- GIVEN `limiting_cases_config.theoretical_extremes = {kf_distribution: {mode:"fixed", value:1.5}}`
- WHEN the serializer validates
- THEN a 400 response
- AND no child is created whose `kf_distribution` value is the string `"mode"` or `"value"`

#### Scenario R13.5 — An unorderable or mistyped grid value is refused before it is stored

- GIVEN `parameter_grid = {target_df: [1.8, "abc"]}`
- WHEN the serializer validates
- THEN a 400 response naming the offending entry
- AND `parameter_grid = {seed_type: [["monomers"]]}` yields 400, never a 500
