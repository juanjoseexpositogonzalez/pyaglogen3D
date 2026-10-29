# Exploration: batch-cc-tunable-parameter-parity

> Add 4 missing parameters to the Parametric Study (batch) workflow for CC tunable, achieving feature parity with the single-simulation form.

## A. Current Backend State — What Already Works

### ParametricStudy model (`backend/apps/simulations/models.py:109-174`)

```python
class ParametricStudy(models.Model):
    base_parameters = models.JSONField(help_text="Fixed parameters for all simulations")
    parameter_grid = models.JSONField(help_text="Parameters to vary: {param_name: [values]}")
    seeds_per_combination = models.PositiveIntegerField(default=1)
    sintering_config = models.JSONField(null=True, blank=True)  # ← EXISTS but frontend doesn't expose for batch
```

The model already has `sintering_config` as a JSONField. The `parameter_grid` is a free-form JSONField with no schema enforcement.

### ParametricStudySerializer (`backend/apps/simulations/serializers.py:255-384`)

- **No `validate_parameter_grid` method exists.** The serializer accepts ANY keys in the grid.
- `sintering_config` validation exists (L310-348) and supports `{distribution_type: "fixed"|"uniform"|"normal", ...}`.
- **No validation of grid value shapes** — currently assumes flat arrays of scalars.

### Batch sim generation (`backend/apps/simulations/views.py:1727-1812`)

```python
def perform_create(self, serializer):
    param_names = list(study.parameter_grid.keys())     # L1750
    param_values = [study.parameter_grid[name] for name in param_names]  # L1751
    combinations = list(itertools.product(*param_values))  # L1754

    def create_simulation(params, case_type, case_label):
        sim_params = dict(params)
        sim_params = apply_sintering_config(sim_params, study.sintering_config)  # L1768
        for seed_idx in range(study.seeds_per_combination):  # L1775
            seed = random.randint(0, 2**31 - 1)
            sim = Simulation.objects.create(
                project_id=project_id,
                algorithm=study.base_algorithm,
                parameters=sim_params,  # ← FLAT scalar dict
                seed=seed,
                name=auto_name,
                status=SimulationStatus.QUEUED,
                is_batch=True,
                # NOTE: no seed_type= argument here!
            )
```

**Critical findings:**
1. `itertools.product` works with flat scalar lists only — passing distribution objects will produce per-combination entries correctly (each combo gets a full distribution object), but the **engine doesn't receive the distribution directly** from `parameters`.
2. `create_simulation` does NOT set `seed_type` on the Simulation model — it stays at the default `"monomers"`.
3. Sintering is applied via `apply_sintering_config()` from `study.sintering_config` (a study-level field), NOT from `parameter_grid`. It's "fixed for all sims in the study" today.

### How `run_simulation_task` handles tunable_cc (`tasks.py:1404-1436`)

```python
elif algorithm == "tunable_cc":
    sim_seed_type = getattr(simulation, "seed_type", None)  # reads MODEL field
    dpo_kwargs = expand_distribution_kwargs("dpo", params.get("dpo_distribution"))
    kf_kwargs = expand_distribution_kwargs("kf", params.get("target_kf_distribution"))

    result = aglogen_core.run_tunable_cc(
        ...,
        seed_type=sim_seed_type,
        **dpo_kwargs,
        **kf_kwargs,
    )
```

**Key insight**: The task already reads `target_kf_distribution` and `dpo_distribution` from the params dict and expands them into engine kwargs. **If we put these distribution dicts into the child sim's `parameters` JSONField, the task will pick them up automatically.** No task code changes needed for kf and dpo distributions.

### `expand_distribution_kwargs` (`tasks.py:15-44`)

Pure function. Maps `{"mode": "normal", "mean": 1.3, "std": 0.05}` → `{"kf_mode": "normal", "kf_mean": 1.3, "kf_std": 0.05}` which the engine consumes.

### `apply_sintering_config` (`utils.py:236-271`)

Maps study-level sintering config → per-sim params: `sintering_type`, `sintering_coeff` / `sintering_min`/`sintering_max` / `sintering_mean`/`sintering_std`.

## B. Current Frontend State — What's Exposed

### Single-sim form (`frontend/src/components/forms/SimulationForm.tsx`)

| Feature | Component/Pattern | Payload shape |
|---------|------------------|---------------|
| **kf as distribution** | `<DistributionSelector label="target_kf" />` (L1287-1290). State: `targetKfDistribution: DistributionValue`. | `{mode: "normal", mean: 1.3, std: 0.05}` nested inside `parameters.target_kf_distribution` |
| **Particle radius / polydispersity** | Polydisperse toggle (L952-1017). State: `radius_ratio_min`, `radius_ratio_max`. | `parameters.radius_min`, `parameters.radius_max` as scalars |
| **Sintering distribution** | Enable/disable toggle + fixed/uniform/normal buttons (L1019-1147). State: multiple sintering params. | `parameters.sintering_type`, `sintering_coeff`, `sintering_min`, `sintering_max`, `sintering_std` |
| **Seed type** | `<Select>` dropdown (L1268-1279). State: `params.seed_type`. Options: monomers/dimers/trimers. | `parameters.seed_type` (extracted by serializer into model field) |
| **dpo distribution** | `<DistributionSelector label="dpo" />` (L1282-1286). State: `dpoDistribution`. | `parameters.dpo_distribution` |

### Batch form (`frontend/src/components/batch/BatchSimulationForm.tsx`)

- **Available grid parameters** (L260-284): `n_particles`, `target_df`, `sticking_probability` (some algos), `target_kf` (tunable/fracval/gcca). Plus limiting-case specifics.
- **Missing entirely**: kf distribution, particle_radius/polydispersity, sintering distribution in grid, seed_type, dpo distribution.
- Sintering exists only as study-level `sintering_config` (not in grid — it's applied uniformly to all sims).
- The batch form sends `parameter_grid` as `Record<string, unknown[]>` — already typed to accept objects in the array.

### Reusable `DistributionSelector` (`frontend/src/components/forms/DistributionSelector.tsx`)

Clean 129-line component. Props: `{label, value: DistributionValue, onChange, disabled?}`. Renders mode dropdown + conditional inputs for fixed/normal/uniform. **Directly reusable in batch form.**

### `DistributionValue` type (`frontend/src/lib/types.ts:89-93`)

```typescript
export type DistributionValue =
  | { mode: 'fixed'; value: number }
  | { mode: 'normal'; mean: number; std: number }
  | { mode: 'uniform'; min: number; max: number }
```

## C. Engine Support

### PyO3 binding (`aglogen_core/python/src/lib.rs:1300-1388`)

`run_tunable_cc` accepts:
- `seed_type: Option<&str>` — **"monomers" | "dimers" | "trimers"** (parsed to enum internally)
- `radius_min: f64`, `radius_max: Option<f64>` — monodisperse when equal, polydisperse when different
- `sintering_coeff`, `sintering_type` ("fixed"/"uniform"/"normal"), `sintering_min`/`max`/`std` — **engine handles the distribution sampling internally**
- `dpo_mode`, `dpo_value`/`mean`/`std`/`min`/`max` — DPO distribution (engine samples)
- `kf_mode`, `kf_value`/`mean`/`std`/`min`/`max` — KF distribution (engine samples)

**Critical conclusion: the ENGINE samples distributions internally.** The backend never samples — it just passes the distribution config to the engine. This means:
- For `kf_distribution` and `dpo_distribution`: backend puts the distribution dict into params → `expand_distribution_kwargs` unpacks it → engine receives kwargs → engine samples per-particle. **Each sim with different RNG seed produces different sampled values.** ✅
- For `sintering`: engine receives type/params and samples per-contact. Same mechanism. ✅
- For `particle_radius`: engine receives `radius_min`/`radius_max` and does uniform sampling in that range (polydisperse). ✅
- For `seed_type`: it's a discrete enum, no sampling needed. ✅

## D. parameter_grid Semantics Today

### Current allowed keys (from batch form L260-284)

For tunable/tunable_cc/fracval/gcca: `n_particles`, `target_df`, `target_kf`, `sticking_probability` (some algos).

### Serializer validation: **NONE on grid keys**

The `ParametricStudySerializer` has no `validate_parameter_grid` method. The JSONField accepts any dict. Grid values are consumed by `itertools.product(*param_values)` which works with any iterable.

### What each new key needs

| New grid key | Value shape in grid | Consumed by | Needs serializer validation? |
|---|---|---|---|
| `target_kf_distribution` | `[{mode,mean,std}, {mode,mean,std}, ...]` | `run_simulation_task` reads `params.get("target_kf_distribution")` → `expand_distribution_kwargs` → engine | Yes — validate each entry is a valid DistributionValue |
| `particle_radius_config` | `[{min:0.8,max:1.2}, {min:1.0,max:1.0}, ...]` | Task reads `params.get("radius_min")` / `params.get("radius_max")` | Yes — need task-side expansion from config to flat params |
| `sintering_config` | `[{dist_type:"fixed",coeff:0.9}, {dist_type:"normal",mean:0.9,std:0.05}, ...]` | `apply_sintering_config` already called in `create_simulation` | Tricky: currently applied from `study.sintering_config`, not grid. Need to support grid-level override. |
| `seed_type` | `["monomers", "dimers", "trimers"]` | Task reads `simulation.seed_type` (model field) | Need to set model field from grid value in `create_simulation` |

## E. UI Complexity Assessment

### Current batch form pattern

Parameter dropdown → flat list of scalar values (discrete or range). For new distribution-shaped params, we need a **list of distribution objects**.

### Recommended UI approach

1. **`seed_type`**: Just add it to `parameterOptions` dropdown. Values are discrete strings → existing "Discrete Values" input works (comma-separated: `monomers, dimers, trimers`). **Effort: Small.**

2. **`target_kf_distribution`**: New input type needed. When user selects "kf Distribution" from dropdown, show N rows of `<DistributionSelector>` components (reuse existing). Each row = one grid entry. User clicks "+" to add entries. **Effort: Medium** — need a `<DistributionGridInput>` wrapper.

3. **`particle_radius_config`**: Similar to kf — list of {min, max} pairs. Could reuse a simpler version of the grid input, or just two range inputs (min_ratio, max_ratio). **Effort: Medium.**

4. **`sintering_config`**: Most complex — each grid entry is a full sintering config (type + type-specific params). The single-sim sintering section (SimulationForm L1019-1147) is ~128 lines of inlined JSX. Need to extract a `<SinteringConfigInput>` component and use it N times in a grid. **Effort: Medium-High.**

### Proposed new component: `<DistributionGridInput>`

```typescript
interface DistributionGridInputProps {
  entries: DistributionValue[]
  onChange: (entries: DistributionValue[]) => void
  label: string
}
```

Renders N `<DistributionSelector>` rows with add/remove buttons. ~50-80 lines.

### Total UI complexity: **Medium**

## F. Backward Compatibility

- Existing `parameter_grid` dicts have only scalar arrays (`{target_df: [1.8, 2.0], n_particles: [100, 500]}`).
- New keys are ALL OPTIONAL. If absent: batch behaves exactly as today.
- `itertools.product` works fine with mixed scalar and object arrays — each combination gets one value from each axis.
- Serializer validation should accept both old shape (scalar arrays) and new shape (object arrays) without breaking.
- DB migration: **NONE needed.** All new data fits in existing JSONFields.

## G. Reusable Distribution Selector Component

**Found: `frontend/src/components/forms/DistributionSelector.tsx`** (129 lines)

Clean, reusable. Props: `{label, value, onChange, disabled}`. Already used for dpo and target_kf in single-sim form.

**Can be reused directly** in the batch form's `<DistributionGridInput>` component.

No extraction needed — it's already a standalone component.

## H. seed_type Handling Specifics

### Current flow (single sim):
1. Frontend sends `parameters.seed_type = "dimers"` inside the params dict
2. `SimulationSerializer.create()` (L142-159) pops `seed_type` from params and sets it on the model field
3. `run_simulation_task` reads `simulation.seed_type` (model field, L1408)
4. Engine receives `seed_type="dimers"` → parsed to enum internally

### For batch:
- `create_simulation()` in `views.py:1761-1802` does NOT set `seed_type` on the Simulation model.
- If `seed_type` is in `parameter_grid`, it ends up in `sim_params` dict after grid expansion.
- But the task reads `simulation.seed_type` (MODEL field), not `params["seed_type"]`.
- **Fix needed**: In `create_simulation()`, check if `sim_params` contains `"seed_type"`, pop it, and pass it to `Simulation.objects.create(seed_type=value)`.

## I. seeds_per_combination Interaction

### Current behavior
Each (grid combination) × `seeds_per_combination` = child sims. Each child gets a unique random seed (`random.randint(0, 2**31 - 1)`).

### With distributions
- `kf_distribution: [{type:"normal", mean:1.3, std:0.05}]` × `seeds_per_combination: 5` = 5 sims.
- All 5 sims get the SAME distribution config in their params: `{target_kf_distribution: {mode:"normal", mean:1.3, std:0.05}}`.
- But each sim has a DIFFERENT RNG seed → engine samples DIFFERENT kf values per particle.
- **Result: each sim is an independent realization.** ✅ Scientifically correct.
- No backend sampling needed — the engine handles it internally per-sim.

## Affected Areas

| File | Why |
|------|-----|
| `backend/apps/simulations/views.py:1727-1812` | `perform_create` — expand distribution/object grid values into child sim params; handle seed_type model field |
| `backend/apps/simulations/serializers.py:255-384` | Add `validate_parameter_grid` — validate new key shapes (distribution objects, seed_type strings) |
| `frontend/src/components/batch/BatchSimulationForm.tsx` | Add new parameter options to dropdown, new input modes for distribution/object grid entries |
| `frontend/src/lib/types.ts` | Extend `CreateParametricStudyInput` type if needed (already accepts `Record<string, unknown[]>`) |

## Approaches

### Single Approach (no meaningful alternative)

The architecture is clear — there's only one sensible path:

1. **Backend serializer**: Add optional `validate_parameter_grid` that type-checks new keys while remaining backward compatible with scalar arrays.
2. **Backend `create_simulation()`**: Handle object-shaped grid values → expand into flat sim params + set model fields (seed_type).
3. **Frontend batch form**: Add new options to parameter dropdown, create `<DistributionGridInput>` wrapper, reuse existing `<DistributionSelector>`.
4. **No engine changes. No model migrations. No task changes (for kf/dpo). Minimal task touch (for seed_type and sintering grid override).**

- Pros: Minimal code, reuses existing infrastructure, backward compatible, no migrations
- Cons: UI for sintering-in-grid is complex (but unavoidable)
- Effort: **Medium** (estimated 300-400 lines of changes)

## Open Questions

1. **UI presets?** Should the batch form offer presets like "Monodisperse kf=1.3" / "Polydisperse normal kf=1.3±0.05"? → Recommend: **defer to a follow-up cycle** (nice-to-have, not parity).

2. **Polydispersity std cap?** For particle_radius, should we cap `std/mean ≤ 0.3` to avoid negative radii? → **The engine uses radius_min/radius_max (uniform range), not normal distribution.** Cap: `radius_min > 0`. Already enforced by existing validation.

3. **Distribution with std=0?** Should `{mode:"normal", mean:1.3, std:0}` silently become fixed, or warn? → **The existing `DistributionField` validator (fields.py:49) requires `std > 0`.** So std=0 already errors. ✅ No change needed.

4. **Batch size safety?** Should we error if user asks for >1000 sims? → **Currently no limit.** Recommend: add a soft warning in the UI (not a hard block) when `totalSimulations > 500`. The backend can handle it; it's a UX concern.

5. **sintering_config: grid vs study-level?** Today sintering is study-level. If we add sintering to the grid, should study-level sintering be ignored when grid has sintering entries? → **Recommend: grid overrides study-level per combination.** If grid has sintering entries, `apply_sintering_config` is skipped for those combos.

## Risks

1. **Sintering grid override logic** — Most complex part. `apply_sintering_config` is called unconditionally today. Need conditional logic: if grid combo already has sintering params, skip study-level application.
2. **UI complexity for sintering-in-grid** — Each grid entry is a full sintering config (type + params). The sintering UI in single-sim form is 128 lines of inlined JSX. Need extraction into a reusable component.
3. **Combinatorial explosion** — A user could create `kf_dist: [3 entries] × sintering: [3 entries] × seed_type: [3 values] × seeds: 5 = 135 sims`. The UI should warn above a threshold.

## Recommendation

**Cycle size: MEDIUM** (estimated 300-400 changed lines across 4-5 files, no migrations, no engine changes).

**Biggest blocker**: The sintering-in-grid UI extraction. Everything else has clean existing patterns to follow.

**Ready for Proposal**: Yes — the design space is clear, the engine already supports all parameters, and the batch generation pattern just needs to handle object-shaped grid values alongside scalar ones.

## Next: propose
