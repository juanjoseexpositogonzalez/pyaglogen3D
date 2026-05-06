# Tasks: parametric-values-dpo-and-kf (PYA-15)

> Cycle 13 / PYA-15 — Polydisperse `dpo` and `target_kf` via Normal/Uniform distributions

## Phase P1 — Engine: enums + sampling helpers (~5 tasks)

- [x] P1.1 — Define `DpoDistribution` enum in new file `aglogen_core/engine/src/simulation/dpo_distribution.rs` following `SinteringDistribution` pattern at `sintering.rs:17-24` with variants: `Fixed { value: f64 }`, `Normal { mean: f64, std: f64 }`, `Uniform { min: f64, max: f64 }` (file: `aglogen_core/engine/src/simulation/dpo_distribution.rs`)
- [x] P1.2 — Define `TargetKfDistribution` enum in the same file with the same three variants (file: `aglogen_core/engine/src/simulation/dpo_distribution.rs`)
- [x] P1.3 — Implement `sample<R: Rng>(&self, rng: &mut R) -> f64` for both enums: Fixed returns value; Normal truncates to [μ-3σ, μ+3σ] with max 10 retries falling back to μ; Uniform uses `Uniform::new_inclusive` (file: `aglogen_core/engine/src/simulation/dpo_distribution.rs`)
- [x] P1.4 — Add `Default` impls for both enums: `DpoDistribution::Fixed { value: 1.0 }` and `TargetKfDistribution::Fixed { value: 1.3 }` to match legacy scalar defaults (file: `aglogen_core/engine/src/simulation/dpo_distribution.rs`)
- [x] P1.5 — Write cargo tests covering 22 scenarios from spec: Fixed returns exact value, Normal samples within ±3σ bounds, Uniform within [min, max], reproducibility with fixed seed, validation rejects invalid params (file: `aglogen_core/engine/src/simulation/dpo_distribution.rs`)

---

## Phase P2 — Engine: TunableCcParams integration + result fields (~5 tasks)

- [ ] P2.1 — Add `dpo_distribution: DpoDistribution` and `target_kf_distribution: TargetKfDistribution` fields to `TunableCcParams` struct (file: `aglogen_core/engine/src/simulation/tunable_cc.rs`)
- [ ] P2.2 — Update `Default` impl for `TunableCcParams` to use `Fixed` of existing `radius_min` and `target_kf` values (backward compatibility) (file: `aglogen_core/engine/src/simulation/tunable_cc.rs`)
- [ ] P2.3 — In `run_tunable_cc_internal`: at the start of each run, sample once from each distribution using the run's seeded RNG (`Rng::seed_from_u64(seed)`) and apply to effective_params (override radius_min/radius_max and target_kf) (file: `aglogen_core/engine/src/simulation/tunable_cc.rs`)
- [ ] P2.4 — Add `dpo_used: f64` and `target_kf_used: Option<f64>` fields to `SimulationResult` struct (file: `aglogen_core/engine/src/simulation/result.rs`)
- [ ] P2.5 — Write cargo regression tests: default (Fixed) produces bitwise identical results to baseline; Normal mode -> result.dpo_used within [μ-3σ, μ+3σ]; reproducibility with seed verified (file: `aglogen_core/engine/src/simulation/tunable_cc.rs`)

---

## Phase P3 — Python binding + maturin rebuild (~4 tasks)

- [ ] P3.1 — Add 12 new kwargs to `run_tunable_cc` in `lib.rs`: `dpo_mode, dpo_value, dpo_mean, dpo_std, dpo_min, dpo_max` and the same 6 for kf. All Optional with None defaults (file: `aglogen_core/python/src/lib.rs:1185`)
- [ ] P3.2 — Implement `parse_dpo_distribution()` and `parse_kf_distribution()` helpers following `parse_sintering` pattern at `lib.rs:550-562`. When mode is None or "fixed", fall back to existing scalar param (file: `aglogen_core/python/src/lib.rs`)
- [ ] P3.3 — Add `dpo_used` and `target_kf_used` fields to `PySimulationResult` struct with `From<SimulationResult>` impl (file: `aglogen_core/python/src/lib.rs`)
- [ ] P3.4 — Maturin rebuild into backend venv: `source backend/.venv/bin/activate && cd aglogen_core && PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1 maturin develop --release` (file: `aglogen_core/`)

---

## Phase P4 — Backend: serializer + tasks plumbing (~5 tasks)

- [ ] P4.1 — Add `DistributionField` (DRF custom field) to validate distribution config dict with mode in [fixed, normal, uniform], required keys per mode, value > 0, std > 0, max > min (file: `backend/apps/simulations/serializers.py`)
- [ ] P4.2 — Update `SimulationSerializer` to accept `dpo_distribution` and `target_kf_distribution` fields as optional, falling back to legacy scalar when absent (file: `backend/apps/simulations/serializers.py`)
- [ ] P4.3 — Update `tasks.py::run_tunable_cc_simulation` (or equivalent) to read the distribution config from params and expand to the 12 engine kwargs (file: `backend/apps/simulations/tasks.py`)
- [ ] P4.4 — Write pytest: each mode validation, plumbing assertion, backward compat with no distribution config (file: `backend/apps/simulations/tests/test_serializer.py`)
- [ ] P4.5 — Run backend test suite: `cd backend && pytest` — confirm 0 regressions (file: `backend/`)

---

## Phase P5 — Frontend: form dropdown + conditional inputs (~5 tasks)

- [ ] P5.1 — Create `DistributionSelector` reusable sub-component in `frontend/src/components/forms/DistributionSelector.tsx` mirroring sintering pattern at `SimulationForm.tsx:1006-1133` (file: `frontend/src/components/forms/DistributionSelector.tsx`)
- [ ] P5.2 — In SimulationForm: add `<DistributionSelector>` for dpo (always shown for tunable_cc) and target_kf (only when algorithm is CC tunable). Default mode: deterministic/fixed (file: `frontend/src/components/forms/SimulationForm.tsx`)
- [ ] P5.3 — Update form state to track `{mode, value/mean/std/min/max}` per parameter (file: `frontend/src/components/forms/SimulationForm.tsx`)
- [ ] P5.4 — Update API payload builder to send distribution config when mode != deterministic, fallback to scalar otherwise (file: `frontend/src/lib/api.ts`)
- [ ] P5.5 — Run vitest + tsc: `cd frontend && npm test && npm run type-check` — confirm 0 regressions (file: `frontend/`)

---

## Phase P6 — Tests + docs + CHANGELOG + Jira PYA-15 close (~4 tasks)

- [ ] P6.1 — Cross-cutting integration test: form submit Normal mode → backend serializer validates → tasks.py plumbs → engine samples → result has dpo_used within [μ-3σ, μ+3σ] (file: `backend/apps/simulations/tests/test_integration.py` or similar)
- [ ] P6.2 — Create `docs/parametric-values-dpo-and-kf.md` (~80 lines): why this feature, 3 modes table, sampling timing, reproducibility, backward compat, validation rules (file: `docs/parametric-values-dpo-and-kf.md`)
- [ ] P6.3 — Add CHANGELOG entry under `parametric-values-dpo-and-kf (unreleased)` describing the feature and affected layers (file: `CHANGELOG.md`)
- [ ] P6.4 — Close Jira PYA-15 with comment summarizing completed work and transition to Finalizada (file: Jira PYA-15)