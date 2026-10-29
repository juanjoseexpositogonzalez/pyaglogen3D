# Proposal: parametric-values-dpo-and-kf

> Cycle 13 / PYA-15 — Polydisperse `dpo` and `target_kf` via Normal/Uniform distributions
> or fixed value, replicating real experimental conditions.

## Why

Today every simulation uses a single fixed `dpo` (primary particle radius range) and
a single fixed `target_kf` (CC tunable prefactor target). This is fine for
deterministic studies but doesn't match experimental reality where samples have
inherent dispersion. The user explicitly asked for parametric studies where each
simulation (single or batch) can sample these from a distribution.

This cycle adds 3 input modes per parameter, independently:

- **Deterministic** — fixed value (current behaviour)
- **Normal(μ, σ)** — Gaussian sampling, truncated at ±3σ for physical sanity
- **Uniform(min, max)** — uniform sampling

The cycle is feature-only (no bug fixes). All decisions are pre-locked by the
orchestrator (see engram `pyaglogen3D/sdd/frente-13-parametric-values`).

## What changes

### In scope

- **Engine (Rust)**: NEW enums `DpoDistribution` and `TargetKfDistribution` mirroring the
  existing `SinteringDistribution` pattern at `aglogen_core/engine/src/simulation/sintering.rs:17-24`.
  Each enum has variants `Fixed`, `Normal`, `Uniform` and a `.sample(&mut Rng)` method.
- **Engine — TunableCcParams**: gain `dpo_distribution: DpoDistribution` and
  `target_kf_distribution: TargetKfDistribution` fields (both have a `Default` that is
  `Fixed` of the existing scalar param so legacy callers are unaffected).
- **Engine — `run_tunable_cc_internal`**: at the start of each run, sample once from
  each distribution using the simulation's seeded RNG. The sampled values become the
  effective `radius_min`/`radius_max` and `target_kf` for the rest of the run.
- **Engine — SimulationResult**: gain `dpo_used: f64` and `target_kf_used: Option<f64>`
  (Option because non-CC algorithms don't use kf).
- **Python binding**: `run_tunable_cc` accepts 10 new kwargs to describe the
  distribution config (5 per parameter): `dpo_mode` (string), `dpo_value`, `dpo_mean`,
  `dpo_std`, `dpo_min`, `dpo_max` plus the same for `kf`. Backward compatibility: when
  the new kwargs are absent, fall back to the existing single-value path.
- **Backend**: `SimulationSerializer` accepts a nested distribution config (e.g.
  `{"dpo_distribution": {"mode": "normal", "mean": 12.5, "std": 1.5}}`); validation
  enforces positivity. `tasks.py` plumbs the config to the engine kwargs.
- **Frontend**: `SimulationForm` gains a "Modo" dropdown for each of `dpo` and
  `target_kf`. Conditional inputs render below: 1 input for `Deterministic`, 2 for
  `Normal`/`Uniform`. Replicates the existing sintering sub-form pattern at
  `frontend/src/components/forms/SimulationForm.tsx:1006-1133`.

### Not in scope (deferred)

- **Polydispersity for other parameters** (`target_df`, `n_particles`) — backlog.
- **Polydispersity in non-CC algorithms** (ballistic, DLA, CCA, etc. that consume
  `radius_min`/`radius_max`) — they will keep deterministic dpo for now. Wired only
  to the CC-tunable params struct in this cycle.
- **Frontend visualisation of the sampled distribution** (e.g. histogram of dpo across
  a batch of sims) — nice-to-have, deferred.
- **PYA-14** (CC tunable Df<1.8 iterative drift) — unrelated, separate cycle.

## Capabilities affected

- **MODIFIED — `cc-tunable-aggregation`**: R-DELTA — `target_kf` can be specified as a
  distribution; new `dpo_distribution` parameter; result struct gains `dpo_used` and
  `target_kf_used`.
- The repository has no canonical spec for the radius input contract (radii are passed
  positionally), so no separate spec change is required.

## Phases

Bottom-up, 6 phases similar to frente 11. Each phase ends with its own tests green.

1. **P1 — Engine enums + sampling**: Define `DpoDistribution` + `TargetKfDistribution`
   enums with a `.sample(&mut Rng)` method. Truncated-Normal logic re-samples up to
   10 times then falls back to the mean. Cargo tests cover sampling statistics
   (mean within tolerance, no out-of-bounds samples, deterministic for fixed seed).
2. **P2 — Engine integration**: Wire the enums into `TunableCcParams` (with default
   `Fixed`). Sample once at the start of `run_tunable_cc_internal` using the run's
   `Rng`. Populate `dpo_used` / `target_kf_used` in the result. Cargo tests for the
   end-to-end behaviour.
3. **P3 — Python binding**: Add 10 kwargs to `run_tunable_cc`. Build the
   distribution enums from the kwargs. Maturin rebuild into the backend venv.
   Existing callers without the new kwargs continue to work (Fixed fallback).
4. **P4 — Backend**: `SimulationSerializer` validates the new nested distribution
   config. `tasks.py` plumbs the config to the engine kwargs. pytest covers the
   serializer schema and the plumbing.
5. **P5 — Frontend**: Add the "Modo" dropdown + conditional inputs to
   `SimulationForm` for both parameters. Update the API client payload type. vitest
   covers the form rendering, validation, and payload shape.
6. **P6 — Integration tests, docs, CHANGELOG, Jira close**: Cross-cutting test from
   form → backend → engine → result. `docs/parametric-values-dpo-and-kf.md`.
   CHANGELOG entry. Jira PYA-15 → Finalizada.

## Risks and mitigations

- **Reproducibility**: each `.sample()` must use the simulation's seeded `Rng` so that
  the same seed yields the same sample. Mitigation: pass `&mut R: Rng` everywhere; do
  not create internal `thread_rng()` calls inside sampling.
- **Scope creep into other algorithms**: only CC tunable in this cycle. Other algos
  keep their fixed dpo. Documented in the proposal.
- **Long Python binding signature** (~10 new kwargs): acceptable given parity with the
  existing sintering pattern. Could be grouped into a dict in a future refactor
  (noted in backlog).
- **Backward compatibility**: `Default` for the distribution enums is `Fixed` of the
  existing scalar param. Legacy callers that don't pass the new kwargs continue to
  work bit-for-bit identical. Regression test in P2 asserts this.

## Estimated magnitude

4-5 days. Smaller than frente 12 (4 spec capabilities) because this cycle touches
only the CC tunable contract. Comparable to frente 11 in scope.
