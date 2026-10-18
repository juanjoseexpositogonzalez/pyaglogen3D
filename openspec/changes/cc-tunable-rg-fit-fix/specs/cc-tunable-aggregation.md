# Delta Spec: cc-tunable-rg-fit-fix → capability cc-tunable-aggregation

> SDD Cycle 3 sub-cycle 1 of 2 (PYA-17). Builds on canonical R26/R27 (Cycle 2, archived 2026-06-05).
> Baseline source: `openspec/specs/cc-tunable-aggregation.md` (canonical, synced at Cycle 2 archive).

## MODIFIED Requirements

### Requirement: R27. Physical-Contact Feasibility Guard

The scenario R27.4 is MODIFIED: with the Rg-fit fix ON (R28), the `kf ≥ 1.0` enforcement
extends from `Df_target ≤ 2.7` to the full high-Df band `Df_target ≤ 2.9`.

#### Scenario R27.4 — High-Df convergence with fix ON

- **WHEN** `Df_target ∈ {2.5, 2.7, 2.9}` with `N ≥ 100`, `seeds ≥ 3`, high-Df fix ON, Rg-fit fix ON
- **THEN** `|mean(result.fractal_dimension) − Df_target| ≤ 0.15` for each `Df_target` (absolute tolerance, per R27.4)
- **AND** `mean(result.prefactor) ≥ 1.0` for each `Df_target ∈ {2.5, 2.7, 2.9}` (TIGHTENED: was `≤ 2.7`)
- **AND** R27.5 BC sanity holds for every run
- **AND** R28.1 (N-weighted fit active) holds

## ADDED Requirements

### Requirement: R28. N-Weighted Rg-Evolution Fit

The CC-tunable generator SHALL compute `fractal_dimension` and `prefactor` from the
Rg-evolution via an **N-weighted log-space OLS** (`w_i = N_i / ΣN` over points
`(ln(Rg_i/rp), ln(N_i))`), gated by flag `CC_TUNABLE_RG_FIT_WEIGHTED` (default ON).
The estimator is strictly post-hoc: it consumes the already-recorded `rg_evolution`/`n_values`
vectors and MUST NOT alter merge geometry, RNG consumption, or any recorded trace.

#### Scenario R28.1 — Weighted fit recovers kf at high Df (default ON)

- **GIVEN** `Df_target = 2.9`, `N = 100`, `seeds ≥ 3`, `CC_TUNABLE_RG_FIT_WEIGHTED` unset (default ON)
- **WHEN** simulations run to completion
- **THEN** `mean(result.prefactor) ≥ 1.0` across seeds
- **AND** `|mean(result.fractal_dimension) − 2.9| ≤ 0.15` (R19/R27.4 unchanged)
- **AND** no `prefactor` value sits at the clamp boundary `100.0` (D5 no-clamp check)

#### Scenario R28.2 — Df convergence non-regression (full band)

- **GIVEN** the existing convergence sweeps for `Df_target ∈ [1.4, 2.9]` (R19.1–R19.8, R22, R26, R27)
- **WHEN** all existing sweep and non-regression tests run with the Rg-fit fix ON (default)
- **THEN** every existing tolerance holds UNMODIFIED (no test body changes to tolerances)

#### Scenario R28.3 — Flag OFF restores legacy metrics

- **GIVEN** `CC_TUNABLE_RG_FIT_WEIGHTED=false` (or `"0"` / `"no"`)
- **WHEN** simulations run with any fixed seed
- **THEN** `result.fractal_dimension` and `result.prefactor` match pre-change (unweighted) values
  within `1e-10` relative tolerance
- **AND** this holds for `Df_target ∈ {1.5, 2.0, 2.9}` (low / mid / high band sample)

#### Scenario R28.4 — Coordinates byte-identical ON vs OFF (post-hoc invariant)

- **GIVEN** the same seed and parameters, run once with `CC_TUNABLE_RG_FIT_WEIGHTED=true` and once with `=false`
- **WHEN** the resulting monomer coordinate lists are serialized and compared
- **THEN** they are **byte-identical**
- **AND** every `merge_trace` geometry field (positions, distances, merge types) is identical
- **AND** only `fractal_dimension` and `prefactor` (and any field derived solely from them) may differ

#### Scenario R28.5 — Flag parsing

- **GIVEN** values `unset`, `"true"`, `"1"`, `"yes"` → flag ON; `"false"`, `"0"`, `"no"` → flag OFF
- **WHEN** `read_rg_fit_weighted_flag()` is called
- **THEN** the flag resolves per the R26 parsing precedent (`read_high_df_fix_flag`, `tunable_cc.rs:141`)

## Requirement Ordering Note

R28 is inserted after R27 and before R22 in the canonical file (matching the R26/R27 insertion
convention from Cycle 2).
