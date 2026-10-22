# Delta Spec: sintering-reaches-engine → capability batch-cc-tunable-parameter-parity

> MODIFIED blocks are **full restatements**: they replace the whole canonical requirement,
> keeping every canonical scenario title **verbatim**, because the archive matches scenarios by
> exact title. Written in English; `openspec/specs/` is English throughout.
>
> ## Scope note: precedence is out
>
> Six review rounds on this contract produced three undeclared precedence inversions, each
> found only after the previous one was fixed. None of the four defects in scope needs a
> precedence change: they are closed by validating the shape, by sending the mean in the
> parameter the engine reads, and by refusing sintering where the engine ignores it.
>
> So **this contract does not reorder precedence**. Today's order is described as it is, not
> changed. The defect where a child named `theoretical: sintering_coeff=0.5` runs at the
> study's coefficient is real, but it is a different defect — the name lies — and it gets its
> own contract.
>
> ## Archive dependency: resolved
>
> `openspec validate --strict` and `openspec show` require the canonical spec to live at
> `openspec/specs/<capability>/spec.md` with `### Requirement:` headers. That migration landed
> in `bb54fae` (PR #86): the canonical spec now has that layout and the tooling reads its ten
> requirements. **This delta is no longer blocked on it.** The headers below use the canonical
> requirement text with the `Requirement:` prefix the tooling expects.
>
> ## Inventory of changes versus the canonical
>
> Every point where the canonical and this delta contradict each other, plus the deliberate
> hardenings and relaxations.
>
> 1. Canonical R3 says `fixed` carries `value`; `apply_sintering_config` reads `coefficient`
>    (`utils.py:263`) and `validate_sintering_config` validates `coefficient`
>    (`serializers.py:374`). The implementation is canonized. Consequence: the payload the
>    canonical itself documents, `{distribution_type:"fixed", value:0.9}`, returns 201 today and
>    the child runs with **no sintering** because nothing reads `value`; it now returns 400.
> 2. Canonical R3 states the precedence as `grid > study > default`; this delta describes
>    today's three dict levels, `grid > base_parameters > study field`, so the
>    `base_parameters` level is new wording versus the canonical. It is a description of what
>    already happens, not a reorder: see the precedence paragraph below.
> 3. Canonical R3 bounds with `> 0`; the implementation bounds `0.5 <= … <= 1.0`
>    (`serializers.py:373-396`). The stricter implemented bound is canonized.
> 4. Canonical R3 allows `std >= 0` for `normal`; this delta requires `0 < std <= 0.2`. A normal
>    with zero spread is a fixed in disguise.
> 5. **Declared relaxation**: canonical R3 `uniform` requires `min < max`; this delta accepts
>    `min <= max`, canonizing `serializers.py:386`, which already accepts `min == max`.
> 6. Canonical R3 says the system MUST accept the key with no algorithm condition; this delta
>    restricts it to algorithms whose engine invocation receives sintering parameters (R11).
> 7. Canonical R10 mandates the four dropdown options with no algorithm condition; this delta
>    conditions **only the sintering row**. The other three rows are restated with the
>    canonical's exact labels.
> 8. Canonical R10 is already not met for `limiting`: the dropdown returns early
>    (`BatchSimulationForm.tsx:289-297`) and offers none of the four. The delta records the
>    existing behaviour.
> 9. Canonical R7 promises identical behaviour when the grid carries none of the four added
>    keys. Flat `sintering_*` keys are such a case and are now validated, so R7 gets an explicit
>    carve-out.
>
> **Retired or renumbered scenarios:** none. Every canonical scenario of R3, R7 and R10 is kept
> with its title verbatim; new scenarios are appended.

## MODIFIED Requirements

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
(`tasks.py:1592-1598`). Those MUST be validated too:

| `sintering_type` | Required keys | Validation |
|---|---|---|
| `fixed`, and also when `sintering_type` is absent | `sintering_coeff` | `0.5 <= sintering_coeff <= 1.0` |
| `uniform` | `sintering_min`, `sintering_max` | `0.5 <= each <= 1.0`, `min <= max` |
| `normal` | `sintering_coeff` (the mean), `sintering_std` | `0.5 <= sintering_coeff <= 1.0`, `0 < sintering_std <= 0.2` |

A flat `sintering_coeff` with no `sintering_type` MUST be read as `fixed`: the batch form sends
exactly that on every `limiting` submit (`BatchSimulationForm.tsx:220`), and rejecting it would
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
(`utils.py:199-203`) and whose contents no validator inspects today. A **well-formed** dict swept
there works today and MUST keep working; a malformed one — the `{mode, …}` shape the UI selector
produces — MUST be rejected like any other.

For the swept surfaces 5 and 6 the required-keys check applies to the child's **merged
projection** (base parameters plus the swept value), since the rest of the shape may legitimately
live in `base_parameters`; range and unknown-key checks apply per key, where they are written.

**Precedence is unchanged by this contract.** On the path through `create_simulation`, any dict
setting wins over any flat key regardless of where it came from, because `views.py:1804` pops
`sintering_config` from the merged parameters and `apply_sintering_config` then overwrites the
flat keys; among dicts the order is grid, then `base_parameters`, then the study field.

One path is exempt and MUST stay that way: the sintering-extremes block (`views.py:1869-1906`)
runs only when a study dict exists, yet deliberately does not call `apply_sintering_config`, so
each child keeps the flat `sintering_coeff` that `generate_sintering_extreme_cases` wrote for
it. A dict exists there and the flat key still wins. This contract validates these settings and
reorders none of them.

**Explicit rejection, never a silent default.** The system MUST NOT accept an incomplete or
unrecognised sintering setting and then apply defaults: the result would be a simulation whose
declared parameters do not describe what ran. Any violation of the shape tables MUST produce 400.
Additionally, `apply_sintering_config` MUST raise on a non-empty dict that violates the dict
rules, including an unknown `distribution_type`, rather than passing it to the worker, where the
engine falls through its default arm to `fixed(1.0)` (`lib.rs:600-604`).

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
- **AND** a well-formed `{"sintering_config":[{distribution_type:"fixed", coefficient:0.8}]}` is accepted, as it is today, and its child runs at 0.8
- **AND** a malformed `{"sintering_config":[{mode:"normal", mean:0.8, std:0.05}]}` yields 400, where today it returns 201 and the child runs at 1.0

#### Scenario R3.10 — The helper invents no default

- **GIVEN** `apply_sintering_config(params, {"mode": "normal", "mean": 0.8, "std": 0.05})`
- **WHEN** the helper is called directly
- **THEN** it raises, and does not return `{"sintering_type": "fixed", "sintering_coeff": 1.0}`
- **AND** `{"distribution_type":"lognormal", …}` raises as well
- **AND** `None` and `{}` still return the parameters untouched

---

### Requirement: R7 — Backward Compatibility

When `parameter_grid` includes none of the four keys added by the parity change
(`kf_distribution`, `particle_radius_config`, `sintering_config`, `seed_type`), behavior MUST be
IDENTICAL to before that change.

**Carve-out.** That guarantee does not extend to sintering settings this contract now validates:
flat `sintering_*` keys, a `sintering_config` in `base_parameters` or in
`limiting_cases_config`, and the `fixed` payload the canonical documents with a `value` key —
which runs today with no sintering at all, because nothing reads `value`. Nor does it extend to
the `normal` mean, which used to travel in `sintering_mean` and reach the engine as `1.0`.

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

---

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
(`BatchSimulationForm.tsx:289-297`), offering none of the four and instead a flat
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

---

## ADDED Requirements

### Requirement: R11 — Sintering reaches the engine, and only where it is consumed

Sintering settings MUST reach the engine with the values the user declared. For
`distribution_type: "normal"` the mean MUST travel in `sintering_coeff`, the parameter
`parse_sintering` reads as the mean (`lib.rs:602`). The set of sintering parameters the worker
reads is exactly `{sintering_type, sintering_coeff, sintering_min, sintering_max,
sintering_std}` (`tasks.py:1592-1598`), and the system MUST NOT write any sintering key outside
that set into a child's parameters.

**Algorithm scope, as an allow-list** (the model has eleven algorithms, `models.py:8-21`; any
algorithm not listed is rejected with 400):

| Setting | Allowed for |
| --- | --- |
| Sintering with any type | `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `tunable_cc` |
| Sintering with `fixed` only | `limiting`, which reads `sintering_coeff` (`tasks.py:1800`) but ignores type, min, max and std |
| None | `fracval`, `gcca`, `box_rfa`, `imported` |

The allow-list MUST apply to every input surface of R3. On a partial update that omits
`base_algorithm`, it MUST be evaluated against the instance's stored `base_algorithm`.

This requirement governs study expansion. The single-simulation endpoints, the Django admin and
the AI assistant tool (`apps/ai_assistant/tools/study_tools.py:166`) are outside it; the chained
contract `study-expansion-single-source` covers the last one.

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

- **GIVEN** `base_algorithm` in `{fracval, gcca, box_rfa, imported}` and a sintering setting on any surface of R3
- **WHEN** the serializer validates
- **THEN** 400 stating that this algorithm does not consume sintering
- **AND** in particular `base_parameters = {"sintering_coeff": 0.8}` and a theoretical extreme `{"sintering_coeff":[0.8]}` are both rejected

#### Scenario R11.5 — limiting accepts the fixed shape only

- **GIVEN** `base_algorithm = "limiting"` and a sintering setting `{distribution_type:"normal", mean:0.8, std:0.05}`
- **WHEN** the serializer validates
- **THEN** 400 stating that `limiting` accepts the fixed shape only
- **AND** `{distribution_type:"fixed", coefficient:0.9}` is accepted, a flat sweep `{"sintering_coeff": [0.7, 0.9]}` is accepted, and the server-side default extremes (`utils.py:70`) remain accepted

#### Scenario R11.6 — Partial update evaluates against the stored algorithm

- **GIVEN** an existing study with `base_algorithm = "fracval"`
- **WHEN** a `PATCH` supplies only `base_parameters = {"sintering_coeff": 0.8}`
- **THEN** the rule is evaluated against the instance's `base_algorithm` and the request is rejected with 400

---

### Requirement: R12 — Invalid sintering settings are rejected before any write

Every sintering setting on an input surface of R3 MUST be validated **before the first write to
the database**. An invalid setting MUST produce 400 **and zero rows**: no `ParametricStudy`, no
`Simulation`, no queued task.

The system MUST NOT rely on `apply_sintering_config` raising during expansion as its rejection
mechanism: by then the study exists and some children are already queued. `perform_create`
(`views.py:1750`) does not wrap the expansion in `try/except` or `transaction.atomic`, the
project defines no `ATOMIC_REQUESTS`, and `run_simulation_task.delay` is called inside the
per-seed loop (`views.py:1841`), so a dispatched task is not undone by a database rollback.

**Known remaining half-creation path, not closed here.** A `parameter_grid.sintering_config`
with two or more entries — which R3 requires accepting — combined with `include_limiting_cases`
still crashes mid-expansion: `generate_limiting_cases` sorts dict values (`utils.py:180`),
raising `TypeError` after the study row and some children exist. That defect predates this
change and belongs to `distribution-grid-wiring`. This requirement governs rejection of invalid
settings, not every way the expansion can fail.

#### Scenario R12.1 — An invalid sintering setting creates nothing

- **GIVEN** a study creation request with `parameter_grid = {n_particles: [100, 200], sintering_config: [{distribution_type:"fixed", coefficient:0.9}, {mode:"normal", mean:0.8, std:0.05}]}`, the second entry invalid
- **WHEN** the request is processed
- **THEN** the response is 400, the `ParametricStudy` and `Simulation` row counts are unchanged, and no task was queued

#### Scenario R12.2 — The same for every other input surface

- **GIVEN** a request with `base_parameters = {"sintering_config": {"distribution_type":"uniform"}}` without `min`/`max`
- **WHEN** the request is processed
- **THEN** 400, zero studies, zero simulations, zero tasks
- **AND** the same for a flat `base_parameters = {"sintering_coeff": 42.0}` and for `limiting_cases_config.theoretical_extremes = {"sintering_mean":[0.9]}`
