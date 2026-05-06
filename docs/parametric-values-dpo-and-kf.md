# Parametric Values: dpo and target_kf Distributions (PYA-15)

Adds polydispersity support for the primary particle diameter (`dpo`)
and the fractal prefactor target (`target_kf`) in the CC tunable
algorithm.  Each parameter independently accepts three distribution
modes — deterministic, Normal, or Uniform.

## Why

Parametric studies require realistic dispersion to replicate
experimental conditions.  Real soot and nanoparticle aggregates
exhibit polydispersity in primary particle size and growth prefactor.
This feature allows users to express that uncertainty directly in
the simulation configuration instead of running multiple manually
varied simulations.

## Three distribution modes

| Mode | Inputs | Use case |
|------|--------|----------|
| Determinista (fixed) | 1 valor | Estudios reproducibles, comportamiento legacy |
| Normal(μ, σ) | mean + std | Dispersión gaussiana truncada a ±3σ |
| Uniforme [min, max] | min + max | Rango uniforme |

Each parameter selects its mode independently — for example, `dpo`
can use Normal while `target_kf` uses Fixed.

## Sampling timing

One sample per simulation run, drawn at the very beginning of
`run_tunable_cc_internal`, using the run's seeded RNG
(`Rng::seed_from_u64(seed)`).  The sampled values are stored in
`result.dpo_used` and `result.target_kf_used`.

**Same seed → same sample** — reproducibility is guaranteed.

## Truncated Normal

For Normal mode, sampling uses a truncated strategy:

- Accept range: `[mean - 3·std, mean + 3·std]`
- Max 10 rejection retries
- If all 10 retries produce out-of-range values, fallback to `mean`

This keeps samples within physically meaningful bounds while
preserving the Gaussian shape.

## Validation rules

- `dpo > 0` (all modes)
- `target_kf > 0` (all modes)
- Normal: `std > 0`
- Uniform: `max > min`

Validation is enforced at two layers: the `DistributionField` custom
DRF field (backend serializer, 400 on bad input) and the engine
enums (panic on invalid construction — defense in depth).

## Backward compatibility

When the distribution config is absent or `mode=fixed`, the
behaviour is **bit-for-bit identical** to the pre-frente-13 baseline.
This is verified by regression tests comparing seeded results.

- API payloads without `dpo_distribution` / `target_kf_distribution`
  → scalar fallback (legacy behaviour preserved)
- `mode=fixed` → produces the same result as the legacy scalar path

## Result fields

- `dpo_used`: the actual dpo value used for the run (after sampling)
- `target_kf_used`: the actual target_kf value used for the run

Both fields are always populated for CC tunable simulations.  They
appear in the API response, CSV exports, and are useful for tracking
which value was sampled in parametric studies.

For algorithms that do not use `target_kf`, the field is `None`.

## Scope

Only the CC tunable algorithm is affected in this cycle.  Other
algorithms that use radii (ballistic, DLA, CCA, etc.) maintain
deterministic `dpo`.  Extending polydispersity to those algorithms
is a separate future cycle.

## Per-particle polydispersity

**Not implemented.**  This feature samples ONE value per simulation
run (monodisperse-per-run).  All particles within a single run share
the same sampled `dpo` and `target_kf`.

This is a conscious design decision: per-particle polydispersity
changes the physical model fundamentally (each monomer has a
different radius) and requires rework of the contact geometry and
fractal analysis.  The current feature addresses run-to-run
variation for parametric studies — the most common user request.

## Migration

No database migration.  Distribution configs live inside the
`parameters` JSONField of the Simulation model.

## Stack

- **Engine (Rust)**: `DpoDistribution` + `TargetKfDistribution`
  enums with `.sample(&mut Rng)` method
- **TunableCcParams**: gains `dpo_distribution` and
  `target_kf_distribution` fields (Default: Fixed with legacy values)
- **Python binding**: 12 new optional kwargs on `run_tunable_cc`
- **Backend**: `DistributionField` custom DRF field +
  `expand_distribution_kwargs` helper in tasks.py
- **Frontend**: `DistributionSelector` reusable component with
  dropdown mode + conditional inputs
