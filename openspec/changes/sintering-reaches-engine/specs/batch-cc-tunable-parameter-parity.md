# Delta Spec: sintering-reaches-engine → capability batch-cc-tunable-parameter-parity

> MODIFIED blocks are **full restatements**: they replace the whole canonical requirement.
> Written in English because these blocks become canonical on archive, and `openspec/specs/`
> is English throughout (AGENTS.md: technical artefacts in English). The change folder's
> proposal, design and tasks stay in Spanish, matching the archived precedent.
>
> ## How the guarantee is stated, and why
>
> Three review rounds refuted three enumerations: first three input surfaces, then five, then a
> sixth; and then the claim that every expanded child is built by one function. `perform_create`
> creates children at **two** sites (`views.py:1826` inside the shared builder and `:1889`
> inline for sintering extremes), and the inline one is the sintering one.
>
> So the guarantee is not stated as a list of inputs, and the premise it rests on is made true
> rather than assumed: R11 requires **one** builder for every expanded child, and states the
> invariant there. The input surfaces are named only to specify where a useful 400 must be
> raised (R3) and that nothing is written before that check (R12).
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
> 8. **Canonical R7** (`openspec/specs/batch-cc-tunable-parameter-parity.md:213-227`) promises
>    that a grid without any of the four new keys behaves **identically to before this change**.
>    A grid of `{"sintering_coeff": [-5.0, 42.0]}` contains no new key, is accepted today, and
>    must be rejected under R3. R7 is MODIFIED below with an explicit carve-out; without it the
>    archived capability would hold two requirements demanding opposite outcomes.
>
> **Deliberate behaviour changes:**
>
> 9. Canonical R3's array MUST ("MUST accept `parameter_grid.sintering_config` **as an array**",
>    enforced at `serializers.py:472-477`) is restated below, reworded and relocated into the
>    input-surfaces block. Listed here because a wholesale MODIFIED block would otherwise drop
>    it silently.
>
> 10. **Precedence behaviour change.** Today a study-level dict beats a per-child swept value:
>     the four `limiting` children named `theoretical: sintering_coeff=0.5…1.0` all run at the
>     study's coefficient (verified by probe). Their names lie. This delta makes a value swept
>     **for that child** win over the study field, which is what the sintering-extremes block
>     already assumes (`views.py:1875-1876`: *"they define their own sintering"*).
> 11. **Second precedence change: flat `base_parameters` beats the study field.** Today the
>     asymmetry is real and verified: a `sintering_config` **dict** in `base_parameters` beats
>     the study field, but **flat** `sintering_*` keys there do not —
>     `apply_sintering_config` overwrites them with the study's values (`views.py:1808`). This
>     delta makes `base_parameters` win in both shapes. Affects only studies that combine flat
>     base sintering with a study-level dict; the batch form cannot create that combination
>     (it never sends a study-level `sintering_config`), but an API client can.
> 12. **`seed_type` on sintering-extreme children.** Unifying the two creation sites makes the
>     inline block set `seed_type` like every other child, closing existing violations of
>     `cc-tunable-aggregation` R17 (`:869`) **and of canonical R4 of this capability**
>     (`openspec/specs/batch-cc-tunable-parameter-parity.md:128`: the model field, not the
>     params blob). Those children also stop carrying `seed_type` inside `parameters`, and for
>     `tunable_cc` the worker reads the model field (`tasks.py:1676`), so their engine seed type
>     changes from the default `monomers` to the declared one.
> 13. **R10 for `limiting`.** The dropdown returns early for that algorithm
>     (`BatchSimulationForm.tsx:289-297`) and offers **none** of the four canonical options. The
>     canonical mandates all four unconditionally; the delta blesses the existing behaviour.
> 14. **Third precedence change: a value decided for a child beats a `base_parameters` dict.**
>     Today any dict wins over any flat key regardless of level, because `views.py:1804` pops
>     `sintering_config` from the merged dict and `apply_sintering_config` then overwrites the
>     flat keys. Verified: `base_parameters.sintering_config` fixed 0.60 plus a grid sweep
>     `{"sintering_coeff":[0.70]}` runs at **0.60**; the same with a theoretical extreme runs at
>     0.60 too. Under R3's levels both must run at 0.70 / at the extreme's value. The dict/flat
>     axis stops dominating the level axis.
> 15. **The canonical's own `fixed` payload now 400s.** `{distribution_type:"fixed", value:0.9}`
>     is the shape canonical R3 documents; today it returns 201 and the child runs at
>     `sintering_coeff = 1.0` because nothing reads `value`. Item 1 canonizes `coefficient`, so
>     that payload becomes a 400. Declared because it is a visible rejection, not only a
>     rewording.
>
> **Retired or renumbered scenarios:** canonical **R7.2** ("Historical ParametricStudies remain
> valid" — the read path) is **kept verbatim under its own number**; the new scenarios are
> R7.3 and R7.4. R3.1-R3.4, R7.1 and R10.1-R10.3 keep their numbers and meaning; the other new
> scenarios are R3.5-R3.12 and R10.4-R10.6.
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

A flat setting MUST carry the keys its type requires. For the **swept** surfaces 5 and 6, where
the setting is a single key and the rest of the shape may legitimately live in
`base_parameters`, the required-keys check applies to the child's **merged projection** (base
plus the swept value); range and unknown-key checks apply per key, where they are written. Other keys from the same five-key set may
be present — real children carry leftovers from `base_parameters` — and MUST also be in range;
the worker ignores the ones its type does not use. A flat `sintering_coeff` with no
`sintering_type` MUST be read as `fixed`: the batch form sends
exactly that on every `limiting` submit (`BatchSimulationForm.tsx:220`), and rejecting it would
break the only sintering input that algorithm has. Any **flat** `sintering_*` key outside
`{sintering_type, sintering_coeff, sintering_min, sintering_max, sintering_std}` MUST be
rejected — in particular `sintering_mean`, which no consumer reads. The key `sintering_config`
is **not** a flat key: it is the dict shape, governed by the rules above and by its surface row.

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
| 7 | `limiting_cases_config.theoretical_extremes["sintering_config"]` | **dict**, swept | **rejected** (400) |

Surfaces 6 and 7 are the same user-supplied `{param_name: [values]}` map, whose keys are
written verbatim into each child (`utils.py:199-203`) and whose contents no validator inspects
today. It can carry a **dict** as well as flat scalars: a `sintering_config` swept there is
popped by the builder (`views.py:1804`) and fed to `apply_sintering_config`, which is how the
`{mode}` shape of D2 reaches `fixed/1.0` through this door (verified: 201 today). Sweeping a
dict there is rejected; a dict belongs in `parameter_grid.sintering_config`.
`parameter_grid.sintering_config` MUST be an **array** of dict settings.

#### Precedence

Stated by level, strongest first. Within a level, a dict setting beats a flat one.

1. **Sintering decided for that specific child**: a `parameter_grid.sintering_config` entry or
   a flat grid sweep for that combination, a **range-boundary** value taken from a swept
   sintering key, a theoretical-extreme `sintering_*` value, or a sintering-extreme case.
2. `base_parameters` (its `sintering_config` dict, else its flat keys).
3. The study-level `sintering_config` field.
4. Default: no sintering.

**Provenance is required.** Today everything reaches the child builder already merged
(`views.py:1849-1851`), and the merged dict cannot distinguish a flat key that came from
`base_parameters` from one swept for that child: `base_parameters = {sintering_config: D,
sintering_coeff: 0.8}` and `base_parameters = {sintering_config: D}` with a grid sweep
`{"sintering_coeff":[0.8]}` produce the same dict and require opposite outcomes. Therefore the
caller that knows the provenance MUST resolve the precedence and pass the **winning setting**
explicitly to the builder; the builder MUST NOT infer it from the merged parameters.

Three **behaviour changes** are declared here:

- Level 1 beating level 3: today the study dict overrides a swept value, so a child named
  `theoretical: sintering_coeff=0.5` runs at the study's coefficient. After this change the
  name and the physics agree.
- Level 2 beating level 3 **in its flat form**: today `base_parameters`'s `sintering_config`
  dict beats the study field, but its flat `sintering_*` keys do not — `apply_sintering_config`
  overwrites them (`views.py:1808`). After this change `base_parameters` wins in both shapes.
- Level 1 beating level 2 **in its dict form**: today a `base_parameters.sintering_config` dict
  overwrites a value swept or chosen for that child. After this change the per-child value
  wins. This is the general case of the rule that the dict/flat axis no longer dominates.

When a dict setting applies to a child, that child's sintering keys MUST be exactly the ones
that dict produces: no `sintering_*` key inherited from a weaker level may survive (R11).

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
- **AND** when a dict setting applies, no `sintering_*` key inherited from a weaker level survives into the child
- **AND** a `limiting` child named `theoretical: sintering_coeff=0.5` runs at **0.5**, not at the study coefficient
- **AND** with study `sintering_config` fixed 0.95 and `base_parameters = {"sintering_type":"fixed","sintering_coeff":0.60}`, the child runs at **0.60**, not 0.95 (today it runs at 0.95)
- **AND** with `base_parameters.sintering_config` fixed 0.60 and `parameter_grid = {"sintering_coeff":[0.70]}`, the child runs at **0.70**, not 0.60 (today it runs at 0.60)
- **AND** with `base_parameters.sintering_config` fixed 0.60 and a theoretical extreme `sintering_coeff = 0.5`, that child runs at **0.5**, not 0.60
- **AND** with study `sintering_config` fixed 0.95 and `parameter_grid = {"sintering_coeff":[0.6, 0.9]}` plus `include_limiting_cases`, the children named `boundary_min: sintering_coeff=0.6` and `boundary_max: sintering_coeff=0.9` run at **0.6** and **0.9**, not at 0.95 (today both run at 0.95)

#### Scenario R3.11 — The helper invents no default

- **GIVEN** `apply_sintering_config(params, {"mode": "normal", "mean": 0.8, "std": 0.05})`
- **WHEN** the helper is called directly
- **THEN** it raises, and does NOT return `{"sintering_type": "fixed", "sintering_coeff": 1.0}`
- **AND** `{"distribution_type":"lognormal", "mean":0.9, "std":0.1}` raises as well
- **AND** `None` and `{}` still return the parameters untouched

#### Scenario R3.12 — A dict swept through theoretical extremes is rejected

- **GIVEN** `limiting_cases_config = {"theoretical_extremes": {"sintering_config": [{"mode":"normal","mean":0.8,"std":0.05}]}}`
- **WHEN** the serializer validates
- **THEN** 400
- **AND** today this returns 201 and the child runs at `sintering_coeff = 1.0`, which is defect D2 through this door

---

### Requirement: R7 — Backward Compatibility

When `parameter_grid` includes none of the four keys added by the parity change
(`kf_distribution`, `particle_radius_config`, `sintering_config`, `seed_type`), behaviour MUST
be identical to before that change.

**Carve-out.** That guarantee does not extend to malformed or out-of-range **sintering**
settings, nor to the `fixed` payload the canonical itself documents with a `value` key: nothing
reads `value` today, so such a study silently runs without sintering, and R3 now rejects it. A grid or `base_parameters` carrying flat `sintering_*` keys contains none of the four
new keys, yet is subject to R3 and MUST be rejected when it violates the flat shape table. This
is a deliberate behaviour change: such a payload is accepted today and reaches the engine
unvalidated.

#### Scenario R7.1 — Old grid with only scalar keys

- **GIVEN** `parameter_grid = {n_particles: [100, 500], sticking_probability: [0.5, 1.0]}`
- **WHEN** the study is created
- **THEN** child sims are created identically to pre-change behaviour

#### Scenario R7.2 — Historical ParametricStudies remain valid

- **GIVEN** a ParametricStudy record saved before this change
- **WHEN** it is read or child sims are re-listed
- **THEN** no error occurs; results are identical to pre-change

#### Scenario R7.3 — Old study-level sintering_config still creates children

- **GIVEN** a study with only a study-level `sintering_config` and no new grid keys
- **WHEN** child sims are created
- **THEN** children are created as before, subject to R3's shape rules
- **AND** for `distribution_type: "normal"` the applied mean changes deliberately: it used to
  travel in `sintering_mean`, which no consumer reads, so the engine ran at `1.0`. R11 makes it
  travel in `sintering_coeff`. This is the headline behaviour change of this contract and is
  **not** covered by R7's identical-behaviour promise

#### Scenario R7.4 — The carve-out is explicit

- **GIVEN** `parameter_grid = {n_particles: [100], "sintering_coeff": [42.0]}`
- **WHEN** the serializer validates
- **THEN** 400, even though the grid contains none of the four added keys
- **AND** `sintering_config = {distribution_type:"fixed", value:0.9}` also yields 400, although that is the payload canonical R3 documents: today it returns 201 and the child runs at `sintering_coeff = 1.0`

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

**One builder.** Study expansion MUST create every child through a **single** parameter-building
function. Today it does not: `perform_create` creates children at `views.py:1826`, inside the
shared builder, and again at `views.py:1889`, an inline block for sintering extremes that
duplicates the loop, skips `apply_sintering_config` and omits `seed_type`. That block MUST be
routed through the same builder, which MUST accept an explicit "this child's sintering is
already decided" mode so a sintering-extreme child keeps its own coefficient (level 1 of R3's
precedence).

The builder MUST receive the **resolved** sintering setting from its caller, which is the only
place that knows each value's provenance (base parameters, grid combination, range boundary,
theoretical extreme, sintering extreme). The builder MUST NOT re-derive precedence from the
merged parameters: two different payloads produce the same merged dict and require opposite
outcomes.

In **both** modes the builder MUST remove the `sintering_config` key from the child's stored
parameters — it is a study-level instruction, not an engine parameter, and today a
sintering-extreme child persists it verbatim. When the builder sets a child's sintering itself
(either mode), it MUST first remove every `sintering_*` key the child inherited from a weaker
precedence level, so the stored shape matches the one that applies.

**The invariant.** Wherever its values came from, every child created by expansion MUST satisfy,
at the point its parameters are built:

1. Its `sintering_*` keys are contained in
   `{sintering_type, sintering_coeff, sintering_min, sintering_max, sintering_std}` — the exact
   set the worker reads (`tasks.py:1592-1598`). In particular `sintering_mean` is never written.
2. **If it carries any `sintering_*` key**, the keys its declared type requires are present and
   every value is in range. A child of a study with no sintering carries none, and satisfies
   this clause vacuously.
3. When the builder set that child's sintering — from a dict setting or in the "already
   decided" mode — its `sintering_*` keys are exactly the ones that setting produced.

A violation at that point is a programming error, not a user error: R12 requires user input to
have been rejected earlier.

**Scope.** This requirement governs children created by `ParametricStudyViewSet` study
expansion. Out of its scope, and each named here so the archived capability does not promise
what the code does not do:

- the single-simulation endpoints, which accept arbitrary sintering keys;
- the Django admin, which can edit an existing child's `parameters`;
- the AI assistant tool (`apps/ai_assistant/tools/study_tools.py:166`), which also expands
  studies but writes children straight through the ORM. The chained contract
  `study-expansion-single-source` closes it.

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

- **GIVEN** a study whose expansion produces grid children, limiting-case children, theoretical-extreme children **and sintering-extreme children**
- **WHEN** every child's parameters are built
- **THEN** every child was built by the same function
- **AND** each child's `sintering_*` keys are within the reader set, with the keys its type requires present and every value in range
- **AND** no child carries `sintering_mean`
- **AND** a child to which a dict setting applied carries exactly the keys that setting produced
- **AND** a child of a study with no sintering carries no `sintering_*` key at all

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
- **AND** the mirror case is rejected too: a `PATCH` that supplies `base_algorithm: "fracval"` while the stored `base_parameters` carry sintering

#### Scenario R11.7 — Sintering-extreme children join the builder

- **GIVEN** a `ballistic` study with `include_limiting_cases = true` and a study-level `sintering_config`
- **WHEN** the sintering-extreme children are created
- **THEN** they are created through the same builder as every other child
- **AND** each keeps its own extreme coefficient, not the study's
- **AND** each carries `seed_type` on the model field, as every other child does (`cc-tunable-aggregation` R17)
- **AND** none carries a `sintering_*` key inherited from a weaker level, nor the `sintering_config` key, in its stored parameters
- **AND** their stored `parameters` no longer carry `seed_type`, which moves to the model field

---

### Requirement: R12 — Invalid sintering settings are rejected before any write

Every sintering setting on an input surface of R3 MUST be validated **before the first write to
the database**. An invalid setting MUST produce 400 **and zero rows**: no `ParametricStudy`, no
`Simulation`, no queued task.

The system MUST NOT rely on the R11 invariant failing during expansion as its rejection
mechanism: by then the study exists and some of its children are already queued.
`perform_create` (`views.py:1750`) does not wrap the expansion in `try/except` or
`transaction.atomic`, the project defines no `ATOMIC_REQUESTS`, and `run_simulation_task.delay`
is called inside the per-seed loop (`views.py:1841`), so a dispatched task is not undone by a
database rollback.

**Known remaining half-creation path, not closed here.** A `parameter_grid.sintering_config`
with two or more entries — which R3 requires accepting — combined with `include_limiting_cases`
still crashes mid-expansion: `generate_limiting_cases` sorts dict values (`utils.py:180`),
raising `TypeError` after the study row and some children exist. That defect predates this
change and is closed by the chained contract `distribution-grid-wiring`. This requirement
governs rejection of **invalid** settings, not every way the expansion can fail.

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
