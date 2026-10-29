# Design: Batch CC Tunable — Parameter Grid Parity

## Technical Approach

Extend the existing `ParametricStudy` pipeline at 3 points: serializer validation (new grid key shapes), grid expansion in `perform_create` (handle object/enum values alongside scalars), and frontend form (new dropdown options with type-specific inputs). The engine samples distributions internally (#633) — backend only routes config dicts. Bug #634 fix is embedded in the same `create_simulation` function being modified.

## Architecture Decisions

| Decision | Alternatives | Rationale |
|----------|-------------|-----------|
| Validate grid keys in `ParametricStudySerializer.validate()` cross-field method | Per-key field-level validators | Grid keys are interdependent (batch size check needs ALL keys). Cross-field `validate()` is the existing DRF pattern in this serializer. |
| Keep grid expansion in `perform_create` (views.py) | Move to Celery task | `perform_create` already has the `itertools.product` loop + `create_simulation` helper. Moving to async adds complexity with no benefit — child sims already queue individually. |
| Reuse `DistributionSelector` as-is for batch | Extract/refactor sintering JSX into DistributionSelector | `DistributionSelector` (129 lines) is already a standalone reusable component. The sintering block in `SimulationForm.tsx` (lines 1025-1146) uses Sliders with sintering-specific ranges — it's a DIFFERENT UI pattern (sliders vs inputs). Don't merge them. |
| New `DistributionGridInput` wraps array of `DistributionSelector` | Inline array logic in BatchForm | Keeps BatchForm manageable. Grid input is reusable if future params need the same pattern. |
| `seed_type` as multi-select chips (inline in BatchForm) | Separate SeedTypeSelector component | Only 3 fixed options. A full component is overkill — a `<div>` with 3 toggle buttons matches the existing sintering type buttons pattern in SimulationForm. |
| Sintering grid override: check per-combo params BEFORE `apply_sintering_config` | Post-apply override | Cleaner — skip the study-level call entirely when grid provides its own config. Avoids partial-override bugs. |

## Data Flow

```
Frontend BatchSimulationForm
  ├─ parameterOptions dropdown (4 new entries)
  ├─ kf_distribution / particle_radius_config / sintering_config
  │    → DistributionGridInput → [{mode,value|mean,std|min,max}, ...]
  └─ seed_type → toggle chips → ["monomers","dimers",...]
       ↓
  POST parameter_grid: { kf_distribution: [config1, config2], seed_type: ["dimers","trimers"] }
       ↓
ParametricStudySerializer.validate()
  ├─ _validate_distribution_config(entry) per entry in dist keys
  ├─ validate seed_type entries against Simulation.SeedType.choices
  └─ compute projected sim count → reject >1000, warn >200
       ↓
perform_create → itertools.product(*param_values)
  ├─ for each combo:
  │   params = {base_parameters} | {grid combo values}
  │   seed_type_val = params.pop("seed_type", study.base_parameters.get("seed_type", "monomers"))
  │   if "sintering_config" in params:
  │       apply_sintering_config(params, params.pop("sintering_config"))
  │   else:
  │       apply_sintering_config(params, study.sintering_config)
  │   Simulation.objects.create(..., seed_type=seed_type_val)  ← FIX #634
  └─ enqueue run_simulation_task per sim
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/apps/simulations/serializers.py` | Modify | Add `_validate_distribution_config()` helper + extend `validate()` with grid key validation + batch size check |
| `backend/apps/simulations/views.py` | Modify | `create_simulation()`: pop seed_type → model kwarg (fix #634); sintering grid override; handle object grid values in combo unpacking |
| `frontend/src/components/batch/DistributionGridInput.tsx` | Create | Array-of-DistributionSelector with add/remove, min-1 enforcement |
| `frontend/src/components/batch/BatchSimulationForm.tsx` | Modify | 4 new parameterOptions entries, conditional DistributionGridInput/seed_type chips render, payload serialization, live sim counter warning |

## Interfaces / Contracts

### Backend: `_validate_distribution_config(config: dict, key_name: str) -> None`

```python
# In serializers.py — raises ValidationError on invalid shape
# Accepts: {"mode": "fixed", "value": float}
#         {"mode": "normal", "mean": float, "std": float}
#         {"mode": "uniform", "min": float, "max": float}
# key_name used for error messages only
# For particle_radius_config: additional constraint std/mean <= 0.3
```

### Backend: `create_simulation()` signature change

```python
# Before: create_simulation(params, case_type, case_label)
# After:  create_simulation(params, case_type, case_label)
#         (same signature — seed_type extracted INSIDE from params dict)
```

### Frontend: `DistributionGridInput` props

```typescript
interface DistributionGridInputProps {
  value: DistributionValue[]
  onChange: (configs: DistributionValue[]) => void
  label: string                    // e.g. "kf Distribution Configurations"
  minEntries?: number              // default 1
}
```

### Serializer response shape (warning field)

```python
# When batch > 200 sims, serializer adds to response:
# "warning": "Batch contains {N} simulations (threshold: 200). This may take a while."
# Returned via serializer context → view adds to response data
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (pytest) | `_validate_distribution_config` — all 3 modes, invalid mode, missing keys, particle_radius std/mean cap | Direct function calls |
| Unit (pytest) | Grid expansion — cartesian product with mixed scalar+object keys, seed_type popping, sintering precedence | Call `create_simulation` with mocked `Simulation.objects.create` |
| Integration (pytest) | POST ParametricStudy with new grid keys → child sims have correct params + seed_type model field | DRF APIClient |
| Integration (pytest) | Batch size >1000 → 400; batch size >200 → 200 with warning | DRF APIClient |
| Integration (pytest) | Bug #634: batch with seed_type in base_parameters → model field set | DRF APIClient |
| Unit (vitest) | DistributionGridInput: add/remove entries, min-1 enforcement, onChange calls | React Testing Library |
| Unit (vitest) | BatchSimulationForm: 4 new options visible, payload shape correct per selection | React Testing Library |

## Migration / Rollout

No migration required. `parameter_grid` is a free-form JSONField. Old grids without new keys → existing code path untouched. New keys only processed when present. Backward compat enforced by R7 spec scenarios.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Sintering precedence — grid-level vs study-level subtle bugs | Med | 3 explicit test cases: study-only, grid-only, both-present |
| Combinatorial blow-up | Low | Hard cap 1000 + warning 200 + live counter in UI |
| Bug #634 fix entangled with feature work | Low | Fix is 3 lines in same function. Can be cherry-picked if needed. |
| Object values in `itertools.product` — combo unpacking assumes scalars | Med | Grid expansion must handle dict values in param assignment (no int() coercion on dicts). Guard with `isinstance` check. |

## Open Questions

- None — all technical questions resolved during explore + spec phases.
