# Exploration: distribution-config-wiring

> SDD phase: EXPLORE
> Change: `distribution-config-wiring`
> Date: 2026-10-21
> Base: `develop` @ `8423c4f`
> Status: complete — ready for proposal (2 product decisions open)

---

## 0. Origin

The user reported that the batch simulation form "has two places defining
particle-size polydispersity that may conflict". The exploration confirms the
intuition and finds that the problem is **larger and more severe** than a
duplicated control: the whole distribution-config family is **disconnected at
two different seams**, in both the single and the batch form.

Every claim below is backed by an executed probe or a literal code anchor, not
by reading comprehension.

---

## 1. Executive summary — four independent defects

| # | Defect | Severity | Symptom seen by the user |
| --- | --- | --- | --- |
| **D1** | Batch UI sends `{mode}`, API demands `{distribution_type}` | **Blocker** | `kf distribution` and `Particle radius (polydispersity)` in a batch study → **HTTP 400**, always |
| **D2** | Same mismatch on `sintering_config`, but it is *accepted* | **Blocker (silent)** | Batch sintering is **silently discarded** and replaced by `fixed / 1.0` (= no sintering). Results look valid and are wrong |
| **D3** | `particle_radius_config` / `kf_distribution` are never read by the worker | **Blocker** | Even with the correct shape, the engine never sees them. Child sims run monodisperse `radius=1.0` |
| **D4** | In the single form, `Size Distribution (Polydisperse)` is dead for `tunable_cc` | Major | The min/max ratio the user sets is overwritten by the dpo-distribution control |

D1-D3 mean that **three of the four parameters added by the archived change
`batch-cc-tunable-parameter-parity` (2026-05-13) have never worked in
production**. Only `seed_type` works (it is popped into a model field, a
different code path — `views.py:1797`).

---

## 2. The two seams

### Seam A — frontend → API (D1, D2)

The frontend has **one** distribution type, `DistributionValue`
(`frontend/src/lib/types.ts:90-93`):

```ts
export type DistributionValue =
  | { mode: 'fixed'; value: number }
  | { mode: 'normal'; mean: number; std: number }
  | { mode: 'uniform'; min: number; max: number }
```

`DistributionGridInput` emits exactly that shape
(`frontend/src/components/batch/DistributionGridInput.tsx:17`), and
`BatchSimulationForm` copies it verbatim into `parameter_grid`
(`BatchSimulationForm.tsx:231-235`, no transformation).

The backend validator reads a **different key**
(`backend/apps/simulations/services/distribution_validation.py:49`):

```python
dist_type = config.get("distribution_type")
if dist_type is None:
    raise ValidationError("distribution_type is required in distribution config.")
```

**Probe executed** (temporary test against the real serializer, removed
afterwards) with the exact shape the form sends,
`{"mode": "normal", "mean": 1.0, "std": 0.2}`:

```text
kf_distribution:        400 -> 'distribution_type is required in distribution config.'
particle_radius_config: 400 -> 'distribution_type is required in distribution config.'
sintering_config:       ACCEPTED -> {'mode': 'normal', 'mean': 1.0, 'std': 0.2}
apply_sintering_config({mode:'normal', mean:0.8, std:0.05})
                            -> {'sintering_type': 'fixed', 'sintering_coeff': 1.0}
```

The third line is the dangerous one. `sintering_config` is validated by a
different branch (`serializers.py:468-488` → `validate_sintering_config`) that
does not reject the unknown shape, and then
`apply_sintering_config` (`backend/apps/simulations/utils.py:259-263`) does
`sintering_config.get("distribution_type", "fixed")` and
`.get("coefficient", 1.0)` — **both keys absent → silent fallback to "no
sintering"**. The user asks for sintering normal(0.8, 0.05) and gets 1.0,
with no error anywhere.

### Seam B — API → engine (D3)

Even with the backend shape, the configs never reach the worker. The worker
reads **other parameter names, with yet another key**
(`backend/apps/simulations/tasks.py:1680-1684`):

```python
dpo_kwargs = expand_distribution_kwargs("dpo", params.get("dpo_distribution"))
kf_kwargs  = expand_distribution_kwargs("kf",  params.get("target_kf_distribution"))
```

and `expand_distribution_kwargs` (`tasks.py:33`) dispatches on
`dist_config.get("mode")`.

- `grep -rn "particle_radius_config" backend/apps/simulations/tasks.py` → **no match**.
- `grep -rn "kf_distribution" backend/apps/simulations/tasks.py` → only `target_kf_distribution`.

The grid expansion stores them as-is (`views.py:1789-1793`, "pass through
as-is for engine sampling"), and the archived test
`test_grid_expansion.py:313` only asserts the pass-through
(`sim.parameters.get("particle_radius_config") == radius_config`) — it never
asserts that the engine receives anything. So the gap is invisible to the suite.

**Three vocabularies for one concept:**

| Layer | Discriminator key | Parameter names |
| --- | --- | --- |
| Frontend (both forms) | `mode` | `dpo_distribution`, `target_kf_distribution`, grid `particle_radius_config`, `kf_distribution` |
| API validation (batch) | `distribution_type` | `particle_radius_config`, `kf_distribution`, `sintering_config` |
| Worker → engine | `mode` | `dpo_distribution`, `target_kf_distribution` |
| Canonical spec `batch-cc-tunable-parameter-parity` R1/R2 | `type` | `particle_radius_config`, `kf_distribution` |

The canonical spec uses a **fourth** spelling (`type`) that no layer
implements. This is a genuine contract defect, not only an implementation one.

---

## 3. The user's "two places" (D4) — confirmed, and worse in the single form

In the batch form there is only one polydispersity control
(`particle_radius_config`), so the duplication the user perceived is really
across the two forms. **In the single form the duplication is real and one of
the two controls is dead.**

For `tunable_cc`, `SimulationForm` renders **both**:

1. `Size Distribution` → `Polydisperse` toggle + `Min/Max Ratio`
   (`SimulationForm.tsx:952-1010`; the section is hidden only for `limiting`,
   `fracval`, `gcca`, `box_rfa`, `imported` — **not** for `tunable_cc`).
2. The dpo distribution control (PYA-15), sent as `dpo_distribution`.

And the payload builder silently resolves the conflict in favour of (2)
(`SimulationForm.tsx:713-719`):

```ts
;(algorithmParams as Record<string, unknown>).dpo_distribution = dpoDistribution
// Backward compat: include scalar fields when mode is fixed
if (dpoDistribution.mode === 'fixed') {
  algorithmParams.radius_min = dpoDistribution.value
  algorithmParams.radius_max = dpoDistribution.value   // ← overwrites the ratio
}
```

When the mode is `normal`/`uniform` the override happens in the engine instead:
`tunable_cc.rs:1121` samples `params.dpo_distribution`, and the engine's own
note at `tunable_cc.rs:2621` states that *"`dpo_distribution` sampling overrides
`radius_min`/`radius_max`"*.

**Net effect: for `tunable_cc` the `Polydisperse` toggle does nothing, ever,
while the UI claims "Particle sizes will vary from X to Y nm".** That caption
is actively misleading.

For `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable` the toggle **does**
work (they take `radius_min`/`radius_max` and have no dpo path), so removing it
outright is not an option.

---

## 4. Relation to the open question "Df=2.7, N=100 → 2.533"

**Not the cause.** A `tunable_cc` single simulation with the default
`dpo_distribution` mode `fixed` produces a monodisperse aggregate with the
intended radius, which is the configuration the estimator was calibrated for in
`cc-tunable-bc-alignment` (band ±0.35/±0.45). The 2.533 reading is within the
documented band of the estimator and belongs to the separate
`cc-tunable-df-fidelity` thread. **These defects do not explain it.**

They *would* contaminate any batch study where the user believed they were
sweeping polydispersity or sintering — the results would be a sweep of
identical monodisperse, unsintered runs.

---

## 5. Affected files

| File | Role |
| --- | --- |
| `frontend/src/lib/types.ts:90` | `DistributionValue` — `mode` discriminator |
| `frontend/src/components/batch/DistributionGridInput.tsx:17` | Emits `{mode}` |
| `frontend/src/components/batch/BatchSimulationForm.tsx:68,231-235,315` | Copies into `parameter_grid` without transform |
| `frontend/src/components/forms/SimulationForm.tsx:683-685,713-719,952-1010` | D4: dead Polydisperse toggle for `tunable_cc` |
| `backend/apps/simulations/services/distribution_validation.py:49` | Demands `distribution_type` |
| `backend/apps/simulations/serializers.py:433-468` | `_DISTRIBUTION_GRID_KEYS` |
| `backend/apps/simulations/utils.py:255-266` | `apply_sintering_config` — silent fallback (D2) |
| `backend/apps/simulations/views.py:1789-1793` | Grid expansion, pass-through |
| `backend/apps/simulations/tasks.py:19-48,1680-1690` | `expand_distribution_kwargs`, reads `dpo_distribution` only |
| `openspec/specs/batch-cc-tunable-parameter-parity.md` R1/R2 | Canonical spec, uses `type` |

---

## 6. Approaches

### A. One canonical shape, adapters at the edges (recommended)

Pick `{mode, ...}` (already used by the frontend **and** by the worker/engine —
the only layer that has to move is the batch validator) and:

1. Make `validate_distribution_config` accept `mode`, keeping
   `distribution_type` as a deprecated alias for already-stored studies.
2. Make `apply_sintering_config` **fail loudly** on an unrecognised shape
   instead of defaulting to 1.0. D2 is the worst defect precisely because it is
   silent.
3. Map the grid keys to the engine names at expansion time:
   `particle_radius_config → dpo_distribution`,
   `kf_distribution → target_kf_distribution` (`views.py::create_simulation`).
4. Amend the canonical spec: R1/R2 say `type`, which nothing implements.

- Pros: one vocabulary; minimal frontend churn; closes D1-D3 together.
- Cons: touches a canonical spec → requires contract approval.
- Effort: **M**.

### B. Adapt the frontend to the backend shape

Transform `{mode}` → `{distribution_type}` in `BatchSimulationForm` only.

- Pros: smallest diff; closes D1.
- Cons: leaves **three** vocabularies alive, does not close D3 (the real
  science bug) and does not close D2. A partial fix here is dangerous: it turns
  a visible 400 into a silent no-op.
- Effort: S. **Not recommended on its own.**

### C. Full unification including D4

A + remove/disable the `Polydisperse` toggle for `tunable_cc` and make the
`particle_radius_config` grid key the single polydispersity source.

- Pros: closes everything the user intuited.
- Cons: D4 is UI semantics for 6 algorithms; widens review surface.
- Effort: L.

**Recommendation: A, with D4 as a separate follow-up change.** D1-D3 are one
causal family (the seam); D4 is a UI-semantics decision that deserves its own
contract.

---

## 7. Risks

- **Already-stored studies.** Any `ParametricStudy` created before the fix may
  hold `{distribution_type}` entries. The migration path must be read-time
  tolerance, not a data migration, since those studies' children already ran
  (wrongly) and must not be silently reinterpreted.
- **D2 changes behaviour on purpose.** Batch studies that "worked" with
  sintering silently disabled will start sintering, or start failing
  validation. That is the point, but it must be stated in the proposal and in
  the Jira comment: previous batch sintering results are not what their
  parameters claim.
- **No CI.** `.github/workflows/` is empty; all verification is local.

## 8. Open product decisions (for the person)

1. **Scope**: change `A` (D1-D3) with D4 as a follow-up, or one single change
   covering all four?
2. **D2 retroactive**: do we mark the already-created batch studies whose
   `sintering_config` was silently discarded (e.g. a warning in the study
   detail), or do we only fix forward?

## 9. Ready for proposal

Yes for approach A. Decisions 1 and 2 must be answered first — both change what
the specs have to say.
