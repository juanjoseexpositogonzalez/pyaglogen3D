# Delta Spec: sintering-reaches-engine → capability batch-cc-tunable-parameter-parity

> MODIFIED blocks are **full restatements**: they replace the whole canonical requirement.
> Written in English because these blocks become canonical on archive, and
> `openspec/specs/` is English throughout (AGENTS.md: technical artefacts in English).
>
> ## Inventory of changes versus the canonical
>
> This list covers **every point where the canonical and this delta contradict each other**,
> plus the deliberate hardenings and relaxations. It does not inventory the MUSTs this delta
> adds with no canonical counterpart (required fields per type, unknown-key rejection, empty
> entry rejection, the two flat-scalar surfaces): those live in R3 and are read there.
>
> **Divergences the implementation never followed:**
>
> 1. Canonical R3 says `fixed` carries `value`; `apply_sintering_config` reads `coefficient`
>    (`utils.py:263`) and `validate_sintering_config` validates `coefficient`
>    (`serializers.py:374`). The implementation is canonized.
> 2. Canonical R3 states the precedence as `grid > study > default`. The real order is
>    `grid > base_parameters > study > default`: `views.py:1804` pops `sintering_config` from
>    the **merged** dict, so a config in `base_parameters` silently beats the study field
>    (verified by probe). The delta canonizes the real order and makes it explicit.
>
> **Deliberate hardenings and relaxations:**
>
> 3. Canonical R3 bounds with `> 0`; the implementation bounds `0.5 <= … <= 1.0`
>    (`serializers.py:373-396`). The stricter implemented bound is canonized.
> 4. Canonical R3 allows `std >= 0` for `normal`; the delta requires `0 < std <= 0.2`, so
>    `std = 0` goes from legal to 400. A normal with zero spread is a fixed in disguise and
>    must be declared as such.
> 5. **Declared relaxation**: canonical R3 `uniform` requires `min < max`; the delta accepts
>    `min <= max`. This is not a new weakness but the canonization of the existing validator
>    (`serializers.py:386`, `if min_val > max_val: raise`), which already accepts
>    `min == max`. A degenerate sintering interval equals a `fixed` and yields no invalid
>    value.
> 6. Canonical R3 says the system **MUST accept** the key with no algorithm condition; the
>    delta restricts it to algorithms whose engine invocation receives sintering parameters
>    (R11). This hardens an existing canonical MUST.
> 7. Canonical R10 mandates the four dropdown options **with no algorithm condition**; the
>    delta conditions **only the sintering row**. The other three rows are restated exactly as
>    the canonical has them — `distribution-grid-wiring` will rewrite them on top of the
>    canonical this change archives.
>
> **Canonical guarantees retained but easy to lose in a restatement:**
>
> 8. Canonical R3's array MUST ("MUST accept `parameter_grid.sintering_config` **as an array**
>    of sintering distribution configs", enforced at `serializers.py:473-477`) is restated
>    verbatim below. It is listed here because a wholesale MODIFIED block would otherwise drop
>    it silently.
>
> **Retired or renumbered scenarios:** none. R3.1-R3.4 and R10.1-R10.3 keep their numbers and
> their meaning; new scenarios are R3.5-R3.10 and R10.4-R10.6.
>
> **Requirement numbering.** This change reserves R11 and R12. The next contracts in the chain
> number from R13.

## MODIFIED Requirements

### Requirement: R3 — Sintering settings: shape, surfaces, precedence, explicit rejection

The system MUST accept sintering settings in the **sintering domain shape**, which is not the
generic distribution shape (its ranges are bounded and the fixed variant uses `coefficient`,
not `value`):

| `distribution_type` | Required fields | Validation |
|-------------------|----------------|-----------|
| `fixed` | `coefficient` | `0.5 <= coefficient <= 1.0` |
| `uniform` | `min`, `max` | `0.5 <= min,max <= 1.0`, `min <= max` |
| `normal` | `mean`, `std` | `0.5 <= mean <= 1.0`, `0 < std <= 0.2` |

`parameter_grid.sintering_config` MUST be an **array** of such configs.

#### The five input surfaces

Sintering reaches a child simulation by five user-controlled paths. The worker reads **flat
scalars** (`tasks.py:1592-1598`), so a rule written only for the `sintering_config` key leaves
the flat ones unguarded. All five MUST be validated:

| # | Surface | Shape | `None` / `{}` |
| --- | --- | --- | --- |
| 1 | `parameter_grid.sintering_config[i]` | domain dict | **rejected** (400) |
| 2 | `ParametricStudy.sintering_config` | domain dict | accepted: "this study configures no sintering" |
| 3 | `base_parameters["sintering_config"]` | domain dict | accepted, same meaning |
| 4 | `base_parameters["sintering_*"]` | flat scalars | absent means no sintering |
| 5 | `parameter_grid["sintering_*"]` | flat scalars, swept | absent means no sintering |

A grid entry that declares nothing would be a sweep point running without sintering and not
saying so.

**Flat scalars (surfaces 4 and 5).** The only accepted keys are
`sintering_type`, `sintering_coeff`, `sintering_min`, `sintering_max` and `sintering_std`,
with `sintering_type` ∈ `{fixed, uniform, normal}` and every coefficient-like value within the
same bounds as the table above. Any other `sintering_*` key MUST be rejected with 400 — in
particular `sintering_mean`, which no consumer reads (R11).

#### Precedence

When more than one surface supplies sintering for the same child, the order MUST be:

```text
parameter_grid.sintering_config  >  base_parameters.sintering_config  >  study field  >  default
```

A dict config from any of surfaces 1-3 MUST win over flat scalars, and when it applies, the
child's sintering keys MUST be exactly those that config produces: any other `sintering_*` key
inherited from `base_parameters` MUST NOT survive into the child.

#### Explicit rejection, never a silent default

A non-empty sintering setting MUST declare a known `distribution_type` (or, for flat scalars, a
known `sintering_type`), MUST carry **all** fields that type requires, and MUST NOT carry keys
outside the sets named above. Any violation MUST produce 400. The system MUST NOT accept an
incomplete or unrecognised setting and then apply defaults: the result would be a simulation
whose declared parameters do not describe what ran.

Additionally, `apply_sintering_config` MUST raise on a non-empty dict that violates the above,
**including an unknown `distribution_type`**, rather than passing it to the worker, where the
engine falls through its default arm to `fixed(1.0)` (`lib.rs:600-604`).

These settings are only valid for the algorithms R11 permits.

#### Scenario R3.1 — Grid sintering overrides the study field

- **GIVEN** study-level `sintering_config = {distribution_type:"fixed", coefficient:0.9}` AND `parameter_grid = {sintering_config: [{distribution_type:"uniform", min:0.7, max:0.95}]}`
- **WHEN** child sims are created
- **THEN** each child uses the grid entry, NOT the study-level one

#### Scenario R3.2 — Without grid sintering the study field is used

- **GIVEN** study-level `sintering_config = {distribution_type:"fixed", coefficient:0.9}` AND `parameter_grid` has no `sintering_config` key
- **WHEN** child sims are created
- **THEN** each child uses the study-level sintering (existing behaviour)

#### Scenario R3.3 — Invalid config rejected

- **GIVEN** `parameter_grid = {sintering_config: [{distribution_type:"uniform", min:0.95, max:0.7}]}`
- **WHEN** the serializer validates
- **THEN** 400 (`min <= max` violated)
- **AND** `{distribution_type:"fixed", coefficient:0.4}` yields 400 (outside `0.5..1.0`)
- **AND** `{distribution_type:"normal", mean:0.9, std:0.3}` yields 400 (`std > 0.2`)
- **AND** `{distribution_type:"normal", mean:0.9, std:0.0}` yields 400 (`std > 0` required)

#### Scenario R3.4 — Unknown `distribution_type` rejected

- **GIVEN** `parameter_grid = {sintering_config: [{distribution_type:"lognormal", mean:0.9, std:0.1}]}`
- **WHEN** the serializer validates
- **THEN** 400 (only `fixed`/`uniform`/`normal`)

#### Scenario R3.5 — The UI's `{mode}` shape is rejected, not silenced

- **GIVEN** `parameter_grid = {sintering_config: [{mode:"normal", mean:0.8, std:0.05}]}`
- **WHEN** the serializer validates
- **THEN** 400 naming the unknown key `mode`
- **AND** NO child is created with `sintering_coeff = 1.0`

#### Scenario R3.6 — Incomplete fields and empty entries rejected

- **GIVEN** `parameter_grid = {sintering_config: [{distribution_type:"fixed"}]}` (no `coefficient`)
- **WHEN** the serializer validates
- **THEN** 400 naming the missing `coefficient`
- **AND** the same for `{distribution_type:"uniform"}` without `min`/`max`, and `{distribution_type:"normal"}` without `mean`/`std`
- **AND** `parameter_grid = {sintering_config: [{}]}` yields 400
- **AND** a **study-level** `sintering_config` of `{}` or `null` is still accepted

#### Scenario R3.7 — `base_parameters.sintering_config` is validated like the others

- **GIVEN** `base_parameters = {"sintering_config": {"distribution_type": "fixed"}}` (no `coefficient`)
- **WHEN** the serializer validates
- **THEN** 400
- **AND** no study and no child simulation is created
- **AND** `{"distribution_type":"fixed", "coefficient":0.9}` is accepted and its children receive that sintering

#### Scenario R3.8 — Flat sintering scalars are validated wherever they enter

- **GIVEN** `base_parameters = {"n_particles":100, "sintering_type":"normal", "sintering_coeff":0.6, "sintering_std":0.07}`
- **WHEN** the serializer validates
- **THEN** it is accepted, and the children carry exactly those values
- **AND** `base_parameters = {"sintering_coeff": 42.0}` yields 400 (outside `0.5..1.0`)
- **AND** `parameter_grid = {"sintering_coeff": [-5.0, 42.0]}` yields 400
- **AND** `base_parameters = {"sintering_mean": 0.9}` yields 400 (no consumer reads that key)

#### Scenario R3.9 — Precedence across surfaces

- **GIVEN** study `sintering_config` fixed 0.95, `base_parameters.sintering_config` fixed 0.60 and `parameter_grid.sintering_config` fixed 0.80
- **WHEN** child sims are created
- **THEN** each child's effective coefficient is **0.80**
- **AND** with the grid entry removed it is **0.60**, not 0.95
- **AND** when a dict config applies, no `sintering_*` key inherited from `base_parameters` survives into the child

#### Scenario R3.10 — The helper invents no default

- **GIVEN** `apply_sintering_config(params, {"mode": "normal", "mean": 0.8, "std": 0.05})`
- **WHEN** the helper is called directly
- **THEN** it raises
- **AND** it does NOT return `{"sintering_type": "fixed", "sintering_coeff": 1.0}`
- **AND** `{"distribution_type":"lognormal", "mean":0.9, "std":0.1}` raises as well
- **AND** `None` and `{}` still return the parameters untouched

---

### Requirement: R10 — Frontend: Parameter-to-Vary Dropdown Extension

The dropdown in `BatchSimulationForm.tsx` MUST offer the 4 added options:

- "kf distribution (normal/uniform/fixed)"
- "Particle radius (polydispersity)"
- "Sintering coefficient distribution" — **only for the algorithms that consume sintering**
  (R11): `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `tunable_cc`
- "Seed type (monomer/dimer/trimer)"

For `base_algorithm = "limiting"` the dropdown keeps its own separate option list
(`BatchSimulationForm.tsx:289-297`), which offers none of the four and instead offers the flat
`sintering_coeff` sweep. That flat key is surface 5 of R3 and MUST be validated like any other
sintering input.

Each option MUST swap the value input to the corresponding component
(`DistributionGridInput` for distributions, multi-select chips for `seed_type`).

The `sintering_config` payload MUST be sent in the **sintering domain shape** (R3), not in the
selector component's `{mode, …}` shape; the translation MUST live in a single pure function.

When the selected algorithm changes, any configured variation that the new algorithm does not
accept MUST be cleared or flagged, so the form cannot submit a payload R11 will reject without
telling the user why.

#### Scenario R10.1 — Selecting kf distribution shows DistributionGridInput

- **GIVEN** the user opens the parameter-to-vary dropdown
- **WHEN** they select "kf distribution (normal/uniform/fixed)"
- **THEN** a `DistributionGridInput` replaces the scalar value input

#### Scenario R10.2 — Selecting seed_type shows the chip multi-select

- **GIVEN** the user opens the parameter-to-vary dropdown
- **WHEN** they select "Seed type (monomer/dimer/trimer)"
- **THEN** a chip multi-select with 3 options replaces the scalar value input

#### Scenario R10.3 — Scalar parameter keeps its previous behaviour

- **GIVEN** the user opens the parameter-to-vary dropdown
- **WHEN** they select `n_particles` (existing scalar key)
- **THEN** the original scalar array input is shown (no regression)

#### Scenario R10.4 — The sintering option is not offered where the engine ignores it

- **GIVEN** the selected algorithm is `fracval`, `gcca` or `box_rfa`
- **WHEN** the user opens the parameter-to-vary dropdown
- **THEN** "Sintering coefficient distribution" does NOT appear
- **AND** with `ballistic` it does appear

#### Scenario R10.5 — The sintering payload uses the domain shape

- **GIVEN** the user configures a normal sintering variation with mean 0.8 and std 0.05
- **WHEN** they submit the form
- **THEN** `parameter_grid.sintering_config[0]` is `{distribution_type:"normal", mean:0.8, std:0.05}`
- **AND** it carries no `mode` key
- **AND** the selector's default `uniform` produces a payload the API accepts with no prior edit

#### Scenario R10.6 — Switching algorithm does not leave an unsubmittable variation

- **GIVEN** the user configured a `sintering_config` variation with `ballistic`
- **WHEN** they switch the algorithm to `fracval`
- **THEN** that variation is cleared, or flagged as invalid for the new algorithm
- **AND** the form does not submit a payload that R11 rejects without an explanation

---

## ADDED Requirements

### Requirement: R11 — Sintering reaches the engine, and only where it is consumed

Sintering settings MUST reach the engine with the values the user declared. For
`distribution_type: "normal"` the mean MUST travel in the parameter the worker sends and the
engine reads as the mean: `sintering_coeff`, read in `parse_sintering` (`lib.rs:602`).

The set of sintering parameters the worker reads is exactly
`{sintering_type, sintering_coeff, sintering_min, sintering_max, sintering_std}`
(`tasks.py:1592-1598`). The system MUST NOT write any sintering key outside that set into a
child's parameters, whatever surface it came from.

**Algorithm scope, as an allow-list** (the model has eleven algorithms, `models.py:8-21`; any
algorithm not listed is rejected with 400):

| Setting | Allowed for |
| --- | --- |
| Sintering with any type | `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `tunable_cc` |
| Sintering with `fixed` only | `limiting` (reads `sintering_coeff` at `tasks.py:1800` but ignores `sintering_type/min/max/std`) |
| None | `fracval`, `gcca`, `box_rfa`, `imported` |

The rule MUST apply to **all five surfaces** of R3. On a partial update that omits
`base_algorithm`, the rule MUST be evaluated against the stored `base_algorithm` of the
instance.

#### Scenario R11.1 — Normal sintering arrives with its mean

- **GIVEN** a `ballistic` study with `parameter_grid = {sintering_config: [{distribution_type:"normal", mean:0.8, std:0.05}]}`
- **WHEN** the child's task runs
- **THEN** the engine binding is invoked with `sintering_type="normal"` and `sintering_coeff=0.8`
- **AND** NOT with `sintering_coeff=1.0`

#### Scenario R11.2 — Fixed and uniform still arrive

- **GIVEN** studies with `{distribution_type:"fixed", coefficient:0.9}` and with `{distribution_type:"uniform", min:0.7, max:0.95}`
- **WHEN** the children's tasks run
- **THEN** the binding receives `sintering_type="fixed"` and `sintering_coeff=0.9` for the first
- **AND** `sintering_type="uniform"` with `sintering_min=0.7` and `sintering_max=0.95` for the second

#### Scenario R11.3 — No sintering key without a reader

- **GIVEN** any valid sintering setting, from any of the five surfaces
- **WHEN** it is expanded into the child's parameters
- **THEN** the set of sintering keys written is contained in
  `{sintering_type, sintering_coeff, sintering_min, sintering_max, sintering_std}`
- **AND** in particular `sintering_mean` is never written

#### Scenario R11.4 — Rejected for algorithms that do not consume sintering

- **GIVEN** `base_algorithm` ∈ `{fracval, gcca, box_rfa, imported}` and a sintering setting on **any** of the five surfaces
- **WHEN** the serializer validates
- **THEN** 400 stating that this algorithm does not consume sintering
- **AND** in particular `base_parameters = {"sintering_coeff": 0.8}` with `fracval` is rejected

#### Scenario R11.5 — `limiting` accepts the fixed type only

- **GIVEN** `base_algorithm = "limiting"` and a sintering setting of `{distribution_type:"normal", mean:0.8, std:0.05}`
- **WHEN** the serializer validates
- **THEN** 400 stating that `limiting` accepts `distribution_type: "fixed"` only
- **AND** `{distribution_type:"fixed", coefficient:0.9}` is accepted
- **AND** a flat `parameter_grid = {"sintering_coeff": [0.7, 0.9]}` sweep is accepted, each value within `0.5..1.0`

#### Scenario R11.6 — Partial update evaluates against the stored algorithm

- **GIVEN** an existing study with `base_algorithm = "fracval"`
- **WHEN** a `PATCH` supplies only `base_parameters = {"sintering_coeff": 0.8}`
- **THEN** the rule is evaluated against the instance's `base_algorithm`
- **AND** the request is rejected with 400

---

### Requirement: R12 — The expansion leaves no half-created study

Every sintering setting reachable by the expansion MUST be validated **before the first write
to the database**. An invalid setting MUST produce 400 **and zero rows**: no `ParametricStudy`,
no `Simulation`, no queued task.

The system MUST NOT rely on the helper raising during expansion as its rejection mechanism: by
then the study exists and some of its children are already queued. `perform_create`
(`views.py:1749`) does not wrap the expansion in `try/except` or `transaction.atomic`, the
project defines no `ATOMIC_REQUESTS`, and `run_simulation_task.delay(...)` is called inside the
per-seed loop (`views.py:1838`), so a dispatched task is not undone by a database rollback.

#### Scenario R12.1 — An invalid sintering setting creates nothing

- **GIVEN** a study creation request with `parameter_grid = {n_particles: [100, 200], sintering_config: [{distribution_type:"fixed", coefficient:0.9}, {mode:"normal", mean:0.8, std:0.05}]}` (the second entry invalid)
- **WHEN** the request is processed
- **THEN** the response is 400
- **AND** the `ParametricStudy` row count is unchanged
- **AND** the `Simulation` row count is unchanged
- **AND** no task was queued

#### Scenario R12.2 — The same when the invalid setting comes from base_parameters

- **GIVEN** a request with `base_parameters = {"sintering_config": {"distribution_type":"uniform"}}` (no `min`/`max`)
- **WHEN** the request is processed
- **THEN** 400, zero studies created, zero simulations created, zero tasks queued
- **AND** the same holds for a flat `base_parameters = {"sintering_coeff": 42.0}`
