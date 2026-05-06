# Design: Parametric Values — dpo & target_kf Distributions

## Technical Approach

Add `DpoDistribution` and `TargetKfDistribution` enums to the engine following the `SinteringDistribution` pattern (`sintering.rs:17-24`). Wire into `TunableCcParams`, sample once per run at the start of `run_tunable_cc_internal` (monodisperse per run — NOT per particle), propagate sampled values through `SimulationResult` → Python binding → backend → frontend. All layers default to `Fixed` for full backward compatibility.

**Key scope constraint**: dpo distribution samples a single value per run, applied uniformly to `radius_min`/`radius_max`. Per-particle polydispersity (each primary has its own sampled dpo) is a different design and NOT in scope.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|----------|--------|----------------------|-----------|
| Enum placement | Separate `DpoDistribution` + `TargetKfDistribution` in `tunable_cc.rs` | Generic `ParameterDistribution<T>` | Follows existing sintering pattern; separate enums allow domain-specific clamping ranges per parameter |
| Truncation strategy | Retry up to 10× then fall back to mean | Hard clamp like sintering | Sintering clamps to [0.5, 1.0] (physical bounds). dpo/kf have no universal hard bounds — retry+fallback avoids silent clipping |
| Sampling point | Once at run start, before main loop | Per-merge (like sintering samples per contact) | Locked decision: dpo/kf are run-level parameters, not contact-level. Sintering is per-contact because each neck can differ |
| Python binding shape | 12 flat kwargs (`dpo_type`, `dpo_value`, `dpo_mean`, `dpo_std`, `dpo_min`, `dpo_max` + same for `kf_`) | Single dict kwarg | Matches `parse_sintering` pattern at `lib.rs:550-562`; flat kwargs = no serde dependency in binding |
| Backend storage | Flat keys in existing JSONField params dict (`dpo_type`, `dpo_value`, etc.) | Nested `dpo_distribution: {mode, ...}` sub-object | Consistent with sintering storage (`sintering_type`, `sintering_coeff`, `sintering_min`, etc.) in params dict |
| Result field types | `dpo_used: f64`, `target_kf_used: f64` (always populated for CC tunable) | `Option<f64>` | CC tunable always has both values; non-CC algos don't produce `SimulationResult` through this path, so Option adds noise |

## Data Flow

```
Frontend (SimulationForm)
  │ dpo_type + dpo_value/mean/std/min/max  (kf_ same)
  ▼
Backend (SimulationSerializer → params JSONField)
  │ validates mode + required keys per mode
  ▼
tasks.py (run_simulation_task)
  │ expand flat kwargs: dpo_type="normal", dpo_mean=1.0, dpo_std=0.1, ...
  ▼
Python binding (run_tunable_cc)
  │ parse_dpo_distribution() → DpoDistribution enum
  │ parse_kf_distribution() → TargetKfDistribution enum
  ▼
Engine (TunableCcParams)
  │ run_tunable_cc_internal: sample once at start
  │   dpo_used = params.dpo_distribution.sample(&mut rng)
  │   kf_used  = params.target_kf_distribution.sample(&mut rng)
  │   effective radius_min = radius_max = dpo_used
  │   effective target_kf = kf_used
  ▼
SimulationResult { ..., dpo_used, target_kf_used }
  │
  ▼
PySimulationResult → tasks.py metrics → API response
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `aglogen_core/engine/src/simulation/tunable_cc.rs` | Modify | Add `DpoDistribution` + `TargetKfDistribution` enums (with `sample`, `Default`); add fields to `TunableCcParams`; sample at start of `run_tunable_cc_internal`; populate result |
| `aglogen_core/engine/src/simulation/result.rs` | Modify | Add `dpo_used: f64` and `target_kf_used: f64` fields to `SimulationResult` |
| `aglogen_core/python/src/lib.rs` | Modify | Add `parse_dpo_distribution` + `parse_kf_distribution` helpers (mirror `parse_sintering`); add 12 kwargs to `run_tunable_cc`; add fields to `PySimulationResult` + `From` impl |
| `backend/apps/simulations/serializers.py` | Modify | Add `validate_dpo_distribution` and `validate_kf_distribution` methods to `SimulationSerializer` |
| `backend/apps/simulations/tasks.py` | Modify | Read `dpo_type`/`dpo_*` and `kf_type`/`kf_*` from params dict; pass as kwargs to `run_tunable_cc` |
| `frontend/src/components/forms/SimulationForm.tsx` | Modify | Add distribution sub-form for dpo and target_kf (replicate sintering pattern at L1006-1133); only visible when algorithm = `tunable_cc` |
| `frontend/src/lib/api.ts` | Modify | Extend simulation create payload type with `dpo_type`, `dpo_value`, `dpo_mean`, `dpo_std`, `dpo_min`, `dpo_max`, `kf_type`, `kf_value`, `kf_mean`, `kf_std`, `kf_min`, `kf_max` |

## Sampling Math — Truncated Normal

```rust
pub fn sample<R: Rng>(&self, rng: &mut R) -> f64 {
    match self {
        Self::Fixed { value } => *value,
        Self::Normal { mean, std } => {
            let lower = mean - 3.0 * std;
            let upper = mean + 3.0 * std;
            for _ in 0..10 {
                let dist = Normal::new(*mean, *std).unwrap();
                let x = dist.sample(rng);
                if x >= lower && x <= upper { return x; }
            }
            *mean  // fallback after 10 rejections
        }
        Self::Uniform { min, max } => {
            Uniform::new_inclusive(*min, *max).sample(rng)
        }
    }
}
```

Probability of 10 consecutive out-of-bounds: `(1 - 0.9973)^10 ≈ 2×10⁻26`. Fallback to mean is effectively unreachable but makes the function total.

## Backwards Compatibility Matrix

| Layer | Legacy | New | Breaking? |
|-------|--------|-----|-----------|
| `TunableCcParams` | scalar `radius_min`/`radius_max` + `target_kf` | + `dpo_distribution` + `target_kf_distribution` (Default = Fixed of existing scalar) | No |
| `SimulationResult` | no dpo/kf fields | + `dpo_used: f64` + `target_kf_used: f64` | No — additive |
| Python binding | existing kwargs | + 12 optional kwargs (None → Fixed fallback) | No |
| Backend params dict | scalar `target_kf`, `radius_min`/`radius_max` | + `dpo_type`/`dpo_*`, `kf_type`/`kf_*` (absent → Fixed) | No |
| Frontend | single input fields | dropdown + conditional inputs (default mode = Fixed = current UX) | No |

## Migration Strategy

No DB migration required. `Simulation.parameters` is a JSONField — the new distribution keys are additive and optional. Legacy rows without distribution keys default to Fixed behavior in `tasks.py`.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Engine unit | Each variant samples correctly; truncation stays in ±3σ; Fixed seed reproducibility; `Default` = Fixed | `cargo test -p aglogen-engine` — new test module in `tunable_cc.rs` |
| Engine regression | Existing tunable_cc tests pass bit-identical (no distribution kwargs = Fixed = same behavior) | Existing cargo tests |
| Python binding | Smoke: call with each mode → check `dpo_used`/`target_kf_used` populated; legacy call without new kwargs works | Maturin build + pytest |
| Backend serializer | Validates each mode; rejects invalid params (negative std, max < min) | pytest in `test_serializers.py` |
| Backend tasks | Plumbs distribution kwargs correctly to engine call (mock `aglogen_core.run_tunable_cc`) | pytest |
| Frontend | Dropdown renders; conditional inputs show/hide per mode; payload shape matches API contract | vitest |
| Integration (P6) | End-to-end: create simulation with Normal dpo → run → verify `dpo_used` ∈ [μ-3σ, μ+3σ] | Cross-layer test |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Reproducibility broken by sampling order | Low | Distribution sampling uses the run's seeded `Rng` BEFORE the main loop. No `thread_rng()` calls. Regression test with fixed seed asserts bit-identical results |
| Per-particle polydispersity expected by user | Low | Document scope: dpo samples ONCE per run. Per-particle polydispersity is a separate design (different struct, different sampling point) |
| 12 new kwargs bloat the Python binding | Low | Consistent with sintering (5 kwargs × all algos). Could be grouped into a dict in future refactor |
| Frontend form complexity | Low | Shared sub-component for distribution inputs (reuse for both dpo and kf) |

## Open Questions

None — all decisions locked from exploration and proposal.
