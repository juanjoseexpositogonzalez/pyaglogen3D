# Delta for cc-tunable-aggregation

## MODIFIED Requirements

### R17 — Seed Type Parameter Routing

The simulation API MUST accept `seed_type` as a value inside the `parameters` JSON object (nested) and route it to the engine, in addition to the existing top-level field.

The system MUST resolve `seed_type` using the following precedence:

1. If `parameters.seed_type` is present -> use that value (nested wins).
2. Else if top-level `seed_type` is present -> use that value (legacy fallback).
3. Else -> default to `"monomers"`.

The persisted `Simulation.seed_type` field MUST reflect the value actually sent to the engine, NOT the DRF serializer default. After persistence, `parameters` SHOULD NOT contain a `seed_type` key (it is lifted via `pop()`).

Valid values: `"monomers"`, `"dimers"`, `"trimers"`. Any other value MUST be rejected with a 400 error before creating a simulation record.

**The batch path (`ParametricStudy.create_simulation()` in `views.py:1761-1802`) MUST also apply this routing**: when `seed_type` appears in child sim params (from grid expansion or `base_parameters`), the helper MUST pop it from params and set it on the `Simulation` model field. This ensures batch-created sims have the correct `seed_type` model field, not the default `"monomers"`.

(Previously: R17 covered only the single-sim serializer path. The batch `create_simulation()` helper did not set `seed_type` on the model field — all batch sims defaulted to `"monomers"` regardless of intent. See bug #634.)

#### Scenario R17.1 — Nested seed_type wins over absent top-level

- GIVEN a POST with `parameters.seed_type = "dimers"` and no top-level `seed_type`
- WHEN the serializer processes the request
- THEN the engine receives `seed_type = "dimers"`
- AND `Simulation.seed_type == "dimers"` in the DB
- AND `parameters` does not contain a `seed_type` key after persistence

#### Scenario R17.2 — Legacy top-level seed_type used when nested absent

- GIVEN a POST with top-level `seed_type = "trimers"` and no `parameters.seed_type`
- WHEN the serializer processes the request
- THEN the engine receives `seed_type = "trimers"`
- AND `Simulation.seed_type == "trimers"` in the DB

#### Scenario R17.3 — Nested wins when both top-level and nested present

- GIVEN a POST with `parameters.seed_type = "dimers"` AND top-level `seed_type = "monomers"`
- WHEN the serializer processes the request
- THEN the engine receives `seed_type = "dimers"` (nested wins)
- AND `Simulation.seed_type == "dimers"` in the DB

#### Scenario R17.4 — Default to monomers when neither present

- GIVEN a POST with no `seed_type` at top-level and no `parameters.seed_type`
- WHEN the serializer processes the request
- THEN the engine receives `seed_type = "monomers"`
- AND `Simulation.seed_type == "monomers"` in the DB

#### Scenario R17.5 — Invalid nested value rejected with 400

- GIVEN a POST with `parameters.seed_type = "foo"`
- WHEN the serializer validates the request
- THEN a 400 response is returned with a descriptive validation error
- AND no `Simulation` record is created

#### Scenario R17.6 — Batch create_simulation sets model field from grid params

- GIVEN a ParametricStudy with `parameter_grid.seed_type = ["dimers", "trimers"]`
- WHEN `create_simulation()` creates a child sim with `sim_params` containing `seed_type = "dimers"`
- THEN `create_simulation()` pops `seed_type` from `sim_params`
- AND passes `seed_type="dimers"` as a model kwarg to `Simulation.objects.create()`
- AND the resulting `Simulation.seed_type == "dimers"` in the DB
- AND `sim.parameters` does NOT contain `seed_type`

#### Scenario R17.7 — Batch create_simulation defaults when seed_type absent from params

- GIVEN a ParametricStudy where `parameter_grid` has no `seed_type` key
- WHEN `create_simulation()` creates a child sim
- THEN `Simulation.seed_type` uses the model default (`"monomers"`)
- AND behavior is identical to pre-change (backward compat)

#### Scenario R17.8 — Batch seed_type from base_parameters

- GIVEN a ParametricStudy with `base_parameters.seed_type = "trimers"` and no grid `seed_type`
- WHEN `create_simulation()` creates child sims
- THEN each child sim has `Simulation.seed_type == "trimers"` (popped from base_parameters)
