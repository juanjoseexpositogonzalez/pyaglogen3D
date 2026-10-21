# Delta Spec: sintering-reaches-engine → capability batch-cc-tunable-parameter-parity

> MODIFIED blocks are **full restatements**: they replace the whole canonical requirement.
> Written in English because these blocks become canonical on archive, and `openspec/specs/`
> is English throughout (AGENTS.md: technical artefacts in English). The change folder's
> proposal, design and tasks stay in Spanish, matching the archived precedent.
>
> ## How the guarantee is stated, and why
>
> Two review rounds refuted an enumeration of input surfaces: first three, then five, then a
> sixth (`limiting_cases_config.theoretical_extremes`). An enumeration is only as good as the
> next reader's imagination, so the guarantee of this capability is **not** stated as a list of
> inputs. It is stated at the single point every expanded child passes through — the
> construction of a child simulation's parameters (R11) — and the input surfaces are named only
> to specify where a useful 400 must be raised (R3) and that nothing is written before that
> check (R12).
>
> ## Inventory of changes versus the canonical
>
> This list covers **every point where the canonical and this delta contradict each other**,
> plus the deliberate hardenings and relaxations. It does not inventory the MUSTs this delta
> adds with no canonical counterpart; those live in their requirements.
>
> **Divergences the implementation never followed:**
>
> 1. Canonical R3 says `fixed` carries `value`; `apply_sintering_config` reads `coefficient`
>    (`utils.py:263`) and `validate_sintering_config` validates `coefficient`
>    (`serializers.py:374`). The implementation is canonized.
> 2. Canonical R3 states the precedence as `grid > study > default`. The real order among dict
>    surfaces is `grid > base_parameters > study > default`, because `views.py:1804` pops
>    `sintering_config` from the **merged** dict. Verified by probe; canonized in R3.
>
> **Deliberate hardenings and relaxations:**
>
> 3. Canonical R3 bounds with `> 0`; the implementation bounds `0.5 <= … <= 1.0`
>    (`serializers.py:373-396`). The stricter implemented bound is canonized.
> 4. Canonical R3 allows `std >= 0` for `normal`; this delta requires `0 < std <= 0.2`. A
>    normal with zero spread is a fixed in disguise and must be declared as such.
> 5. **Declared relaxation**: canonical R3 `uniform` requires `min < max`; this delta accepts
>    `min <= max`, canonizing the existing validator (`serializers.py:386`), which already
>    accepts `min == max`. A degenerate interval equals a `fixed` and yields no invalid value.
> 6. Canonical R3 says the system **MUST accept** the key with no algorithm condition; this
>    delta restricts it to algorithms whose engine invocation receives sintering parameters
>    (R11). This hardens an existing canonical MUST.
> 7. Canonical R10 mandates the four dropdown options **with no algorithm condition**; this
>    delta conditions **only the sintering row**. The other three rows are restated with the
>    canonical's exact labels — `distribution-grid-wiring` rewrites them on top of the
>    canonical this change archives.
> 8. **Canonical R7** (`openspec/specs/batch-cc-tunable-parameter-parity.md:330-345`) promises
>    that a grid without any of the four new keys behaves **identically to before this change**.
>    A grid of `{"sintering_coeff": [-5.0, 42.0]}` contains no new key, is accepted today, and
>    must be rejected under R3. R7 is MODIFIED below with an explicit carve-out; without it the
>    archived capability would hold two requirements demanding opposite outcomes.
>
> **Canonical guarantees retained but easy to lose in a restatement:**
>
> 9. Canonical R3's array MUST ("MUST accept `parameter_grid.sintering_config` **as an array**",
>    enforced at `serializers.py:472-477`) is restated verbatim.
>
> **Retired or renumbered scenarios:** none. R3.1-R3.4, R7.1-R7.2 and R10.1-R10.3 keep their
> numbers and meaning; new scenarios are R3.5-R3.11, R7.3 and R10.4-R10.6.
>
> **Requirement numbering.** This change reserves R11 and R12. The next contracts in the chain
> number from R13.

## MODIFIED Requirements

### Requirement: R3 — Sintering settings: shapes, surfaces, precedence, explicit rejection

Sintering settings exist in two shapes. Both MUST be validated wherever a user can supply them.

**Dict shape** (the sintering domain shape — not the generic distribution shape: its ranges are
bounded and the fixed variant uses `coefficient`, not `value`):

| `distribution_type` | Required fields | Validation |
|-------------------|----------------|-----------|
| `fixed` | `coefficient` | `0.5 <= coefficient <= 1.0` |
| `uniform` | `min`, `max` | `0.5 <= min,max <= 1.0`, `min <= max` |
| `normal` | `mean`, `std` | `0.5 <= mean <= 1.0`, `0 < std <= 0.2` |

A dict setting MUST declare a `distribution_type` from that table, MUST carry all of its
required fields, and MUST NOT carry keys outside
`{distribution_type, coefficient, min, max, mean, std}`.

**Flat shape** (the scalars the worker actually reads, `tasks.py:1592-1598`):

| `sintering_type` | Required keys | Validation |
|---|---|---|
| `fixed` (also the meaning when `sintering_type` is absent) | `sintering_coeff` | `0.5 <= sintering_coeff <= 1.0` |
| `uniform` | `sintering_min`, `sintering_max` | `0.5 <= each <= 1.0`, `min <= max` |
| `normal` | `sintering_coeff` (the mean), `sintering_std` | `0.5 <= sintering_coeff <= 1.0`, `0 < sintering_std <= 0.2` |

A flat `sintering_coeff` with no `sintering_type` MUST be read as `fixed`: the batch form sends
exactly that on every `limiting` submit (`BatchSimulationForm.tsx:220`), and rejecting it would
break the only sintering input that algorithm has. Any `sintering_*` key outside
`{sintering_type, sintering_coeff, sintering_min, sintering_max, sintering_std}` MUST be
rejected — in particular `sintering_mean`, which no consumer reads.

#### Input surfaces

These are the surfaces known to carry sintering into a study expansion. They are listed so the
system can reject bad input with a useful 400 **before writing anything** (R12). They are not
the source of the guarantee: that is R11.

| # | Surface | Shape | `None` / `{}` |
| --- | --- | --- | --- |
| 1 | `parameter_grid.sintering_config[i]` | dict | **rejected** (400) |
| 2 | `ParametricStudy.sintering_config` | dict | accepted: "this study configures no sintering" |
| 3 | `base_parameters["sintering_config"]` | dict | accepted, same meaning |
| 4 | `base_parameters["sintering_*"]` | flat | absent means no sintering |
| 5 | `parameter_grid["sintering_*"]` | flat, swept | absent means no sintering |
| 6 | `limiting_cases_config.theoretical_extremes["sintering_*"]` | flat, swept | absent means no sintering |

Surface 6 is a user-supplied `{param_name: [values]}` map whose keys are written verbatim into
each child (`utils.py:199-203`) and whose contents no validator inspects today.
`parameter_grid.sintering_config` MUST be an **array** of dict settings.

#### Precedence

Stated per shape, because the orders differ:

- Among dict surfaces: `parameter_grid.sintering_config` > `base_parameters.sintering_config` >
  study field > default.
- Among flat surfaces, later writers win in expansion order: a swept grid value overrides
  `base_parameters`, and a theoretical-extreme value overrides both for the child it generates.
- **Any applying dict setting beats every flat key**: when a dict applies to a child, that
  child's sintering keys MUST be exactly the ones that dict produces, and no other
  `sintering_*` key inherited from `base_parameters` may survive (R11).

#### Explicit rejection, never a silent default

The system MUST NOT accept an incomplete or unrecognised sintering setting and then apply
defaults: the result would be a simulation whose declared parameters do not describe what ran.
Any violation of the shape tables above MUST produce 400.

Additionally, `apply_sintering_config` MUST raise on a non-empty dict that violates the dict
rules, **including an unknown `distribution_type`**, rather than passing it to the worker, where
the engine falls through its default arm to `fixed(1.0)` (`lib.rs:600-604`).

These settings are only valid for the algorithms R11 permits.

#### Scenario R3.1 — Grid sintering overrides the study field

- **GIVEN** study-level `sintering_config = {distribution_type:"fixed", coefficient:0.9}` AND `parameter_grid = {sintering_config: [{distribution_type:"uniform", min:0.7, max:0.95}]}`
- **WHEN** child sims are created
- **THEN** each child uses the grid entry, NOT the study-level one

#### Scenario R3.2 — Without grid sintering the study field is used

- **GIVEN** study-level `sintering_config = {distribution_type:"fixed", coefficient:0.9}` AND `parameter_grid` has no `sintering_config` key
- **WHEN** child sims are created
- **THEN** each child uses the study-level sintering (existing behaviour)

#### Scenario R3.3 — Invalid dict config rejected

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
- **THEN** 400, and no study and no child simulation is created
- **AND** `{"distribution_type":"fixed", "coefficient":0.9}` is accepted and its children receive that sintering

#### Scenario R3.8 — Flat scalars are validated wherever they enter

- **GIVEN** `base_parameters = {"n_particles":100, "sintering_type":"normal", "sintering_coeff":0.6, "sintering_std":0.07}`
- **WHEN** the serializer validates
- **THEN** it is accepted, and the children carry exactly those values
- **AND** `base_parameters = {"sintering_coeff": 0.9}` with no `sintering_type` is accepted and means `fixed`
- **AND** `base_parameters = {"sintering_coeff": 42.0}` yields 400
- **AND** `parameter_grid = {"sintering_coeff": [-5.0, 42.0]}` yields 400
- **AND** `base_parameters = {"sintering_mean": 0.9}` yields 400 (no consumer reads that key)
- **AND** a flat `{"sintering_type":"uniform"}` without `sintering_min`/`sintering_max` yields 400

#### Scenario R3.9 — Theoretical extremes are validated too

- **GIVEN** `limiting_cases_config = {"theoretical_extremes": {"sintering_coeff":[42.0]}}`
- **WHEN** the serializer validates
- **THEN** 400
- **AND** the same for `{"sintering_mean":[0.9]}` and `{"sintering_type":["lognormal"]}`
- **AND** `{"sintering_coeff":[0.5, 0.9]}` is accepted for an algorithm R11 permits

#### Scenario R3.10 — Precedence across surfaces

- **GIVEN** study `sintering_config` fixed 0.95, `base_parameters.sintering_config` fixed 0.60 and `parameter_grid.sintering_config` fixed 0.80
- **WHEN** child sims are created
- **THEN** each child's effective coefficient is **0.80**
- **AND** with the grid entry removed it is **0.60**, not 0.95
- **AND** when a dict setting applies, no `sintering_*` key inherited from `base_parameters` survives into the child

#### Scenario R3.11 — The helper invents no default

- **GIVEN** `apply_sintering_config(params, {"mode": "normal", "mean": 0.8, "std": 0.05})`
- **WHEN** the helper is called directly
- **THEN** it raises, and does NOT return `{"sintering_type": "fixed", "sintering_coeff": 1.0}`
- **AND** `{"distribution_type":"lognormal", "mean":0.9, "std":0.1}` raises as well
- **AND** `None` and `{}` still return the parameters untouched

---

### Requirement: R7 — Backward Compatibility

When `parameter_grid` includes none of the four keys added by the parity change
(`kf_distribution`, `particle_radius_config`, `sintering_config`, `seed_type`), behaviour MUST
be identical to before that change.

**Carve-out.** That guarantee does not extend to malformed or out-of-range **sintering**
settings. A grid or `base_parameters` carrying flat `sintering_*` keys contains none of the four
new keys, yet is subject to R3 and MUST be rejected when it violates the flat shape table. This
is a deliberate behaviour change: such a payload is accepted today and reaches the engine
unvalidated.

#### Scenario R7.1 — Old grid with only scalar keys

- **GIVEN** `parameter_grid = {n_particles: [100, 500], sticking_probability: [0.5, 1.0]}`
- **WHEN** the study is created
- **THEN** child sims are created identically to pre-change behaviour

#### Scenario R7.2 — Old study-level sintering_config still works

- **GIVEN** a study with only a study-level `sintering_config` and no new grid keys
- **WHEN** child sims are created
- **THEN** sintering is applied as before, subject to R3's shape rules

#### Scenario R7.3 — The carve-out is explicit

- **GIVEN** `parameter_grid = {n_particles: [100], "sintering_coeff": [42.0]}`
- **WHEN** the serializer validates
- **THEN** 400, even though the grid contains none of the four added keys

---

### Requirement: R10 — Frontend: Parameter-to-Vary Dropdown Extension

The dropdown in `BatchSimulationForm.tsx` MUST offer the 4 added options:

- "kf distribution (normal/uniform/fixed)"
- "Particle radius (polydispersity)"
- "Sintering coefficient distribution" — **only for the algorithms that consume sintering**
  (R11): `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `tunable_cc`
- "Seed type (monomer/dimer/trimer)"

For `base_algorithm = "limiting"` the dropdown keeps its own separate option list
(`BatchSimulationForm.tsx:289-297`), which offers none of the four and instead offers a flat
`sintering_coeff` sweep (`:294`). That algorithm also has a dedicated "Base Sintering Coeff."
input (`:409-418`) sent as `base_parameters.sintering_coeff` on **every** limiting submit
(`:220`). Both are sintering inputs under R3 and MUST produce a payload R3 accepts: in
particular the form MUST NOT submit an empty base field as `null` or `NaN`.

Each option MUST swap the value input to the corresponding component
(`DistributionGridInput` for distributions, multi-select chips for `seed_type`).

The `sintering_config` payload MUST be sent in the dict shape of R3, not in the selector
component's `{mode, …}` shape; the translation MUST live in a single pure function.

When the selected algorithm changes, any configured variation the new algorithm does not accept
MUST be cleared or flagged, so the form cannot submit a payload R11 rejects without telling the
user why.

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

#### Scenario R10.5 — The sintering payload uses the dict shape

- **GIVEN** the user configures a normal sintering variation with mean 0.8 and std 0.05
- **WHEN** they submit the form
- **THEN** `parameter_grid.sintering_config[0]` is `{distribution_type:"normal", mean:0.8, std:0.05}`
- **AND** it carries no `mode` key
- **AND** the selector's default `uniform` produces a payload the API accepts with no prior edit

#### Scenario R10.6 — Limiting submits and algorithm switches stay submittable

- **GIVEN** the `limiting` algorithm with its "Base Sintering Coeff." field left empty
- **WHEN** the user submits
- **THEN** the payload carries no `sintering_coeff`, or a valid one — never `null` or `NaN`
- **AND** a `sintering_config` variation configured on `ballistic` is cleared or flagged when the user switches to `fracval`

---

## ADDED Requirements

### Requirement: R11 — The child sintering invariant, and where sintering is consumed

This requirement governs simulations created by **parametric study expansion**. Simulations
created through the single-simulation endpoints are out of its scope.

**The invariant.** Wherever its values came from, every child simulation created by expansion
MUST satisfy, at the point its parameters are built:

1. Its `sintering_*` keys are contained in
   `{sintering_type, sintering_coeff, sintering_min, sintering_max, sintering_std}` — the exact
   set the worker reads (`tasks.py:1592-1598`). In particular `sintering_mean` is never written.
2. Those keys form one complete flat shape of R3, with every value in range.
3. When a dict setting applied to that child, its keys are exactly the ones that setting
   produced.

The invariant MUST be enforced in the single function that builds a child's parameters, through
which every expanded child passes — grid combinations, limiting cases and theoretical extremes
alike (`views.py:1867` routes limiting cases through the same helper as grid combinations). A
violation at that point is a programming error, not a user error: R12 requires user input to
have been rejected earlier.

**Sintering reaches the engine with the declared values.** For the `normal` type the mean MUST
travel in `sintering_coeff`, the parameter `parse_sintering` reads as the mean (`lib.rs:602`).

**Algorithm scope, as an allow-list** (the model has eleven algorithms, `models.py:8-21`; any
algorithm not listed is rejected with 400):

| Setting | Allowed for |
| --- | --- |
| Sintering with any type | `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `tunable_cc` |
| Sintering with `fixed` only | `limiting` (reads `sintering_coeff` at `tasks.py:1800`, ignores `sintering_type/min/max/std`) |
| None | `fracval`, `gcca`, `box_rfa`, `imported` |

The allow-list MUST be applied to every input surface of R3, including theoretical extremes. On
a partial update that omits `base_algorithm`, it MUST be evaluated against the instance's
stored `base_algorithm`.

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

#### Scenario R11.3 — The invariant holds for every expanded child

- **GIVEN** a study whose expansion produces grid children, limiting-case children and theoretical-extreme children
- **WHEN** every child's parameters are built
- **THEN** each child's `sintering_*` keys are within the reader set and form one complete flat shape in range
- **AND** no child carries `sintering_mean`
- **AND** a child to which a dict setting applied carries exactly the keys that setting produced

#### Scenario R11.4 — Rejected for algorithms that do not consume sintering

- **GIVEN** `base_algorithm` ∈ `{fracval, gcca, box_rfa, imported}` and a sintering setting on **any** input surface of R3
- **WHEN** the serializer validates
- **THEN** 400 stating that this algorithm does not consume sintering
- **AND** in particular `base_parameters = {"sintering_coeff": 0.8}` and `limiting_cases_config.theoretical_extremes = {"sintering_coeff":[0.8]}` are both rejected with `fracval`

#### Scenario R11.5 — `limiting` accepts the fixed shape only

- **GIVEN** `base_algorithm = "limiting"` and a sintering setting of `{distribution_type:"normal", mean:0.8, std:0.05}`
- **WHEN** the serializer validates
- **THEN** 400 stating that `limiting` accepts the fixed shape only
- **AND** `{distribution_type:"fixed", coefficient:0.9}` is accepted
- **AND** a flat `parameter_grid = {"sintering_coeff": [0.7, 0.9]}` sweep is accepted
- **AND** the server-side default extremes for `limiting` (`sintering_coeff` 0.5/0.75/0.9/1.0, `utils.py:70`) remain accepted

#### Scenario R11.6 — Partial update evaluates against the stored algorithm

- **GIVEN** an existing study with `base_algorithm = "fracval"`
- **WHEN** a `PATCH` supplies only `base_parameters = {"sintering_coeff": 0.8}`
- **THEN** the rule is evaluated against the instance's `base_algorithm`, and the request is rejected with 400

---

### Requirement: R12 — The expansion leaves no half-created study

Every sintering setting on an input surface of R3 MUST be validated **before the first write to
the database**. An invalid setting MUST produce 400 **and zero rows**: no `ParametricStudy`, no
`Simulation`, no queued task.

The system MUST NOT rely on the R11 invariant failing during expansion as its rejection
mechanism: by then the study exists and some of its children are already queued.
`perform_create` (`views.py:1750`) does not wrap the expansion in `try/except` or
`transaction.atomic`, the project defines no `ATOMIC_REQUESTS`, and `run_simulation_task.delay`
is called inside the per-seed loop (`views.py:1841`), so a dispatched task is not undone by a
database rollback.

#### Scenario R12.1 — An invalid sintering setting creates nothing

- **GIVEN** a study creation request with `parameter_grid = {n_particles: [100, 200], sintering_config: [{distribution_type:"fixed", coefficient:0.9}, {mode:"normal", mean:0.8, std:0.05}]}` (the second entry invalid)
- **WHEN** the request is processed
- **THEN** the response is 400
- **AND** the `ParametricStudy` and `Simulation` row counts are unchanged, and no task was queued

#### Scenario R12.2 — The same for every other input surface

- **GIVEN** a request with `base_parameters = {"sintering_config": {"distribution_type":"uniform"}}` (no `min`/`max`)
- **WHEN** the request is processed
- **THEN** 400, zero studies, zero simulations, zero tasks
- **AND** the same holds for flat `base_parameters = {"sintering_coeff": 42.0}` and for `limiting_cases_config.theoretical_extremes = {"sintering_mean":[0.9]}`
