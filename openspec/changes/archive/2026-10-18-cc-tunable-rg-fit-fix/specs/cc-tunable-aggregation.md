# Delta Spec: cc-tunable-rg-fit-fix → capability cc-tunable-aggregation

> SDD Cycle 3 sub-cycle 1 of 2 (PYA-17). RE-SCOPED by design.md Log L2 (user decision 2026-10-18):
> documentation-only close-out. The R28 N-weighted fit delta was RETIRED — Phase 0 diagnostic
> (design.md Log L1, Engram obs #9195) proved no fit variant reaches kf ≥ 1.0 at Df=2.9 and that
> the deficit is genuine R27-guard geometry, not fit methodology.
> Baseline source: `openspec/specs/cc-tunable-aggregation.md` (canonical, synced at Cycle 2 archive).

## MODIFIED Requirements

### Requirement: R27. Physical-Contact Feasibility Guard

Scenario R27.4 is MODIFIED: the `kf ≥ 1.0` enforcement stays at `Df_target ≤ 2.7`, and the
`Df_target = 2.9` band gains an explicit, evidence-backed accepted-deviation clause (supersedes
the informal Cycle 2 D3 CHANGELOG note).

#### Scenario R27.4 — High-Df convergence with fix ON

- **WHEN** `Df_target ∈ {2.5, 2.7, 2.9}` with `N ≥ 100`, `seeds ≥ 3`, high-Df fix ON
- **THEN** `|mean(result.fractal_dimension) − Df_target| ≤ 0.15` for each `Df_target` (absolute tolerance, unchanged)
- **AND** `mean(result.prefactor) ≥ 1.0` for each `Df_target ∈ {2.5, 2.7}` (unchanged)
- **AND** for `Df_target = 2.9`: `mean(result.prefactor) ≥ 0.85` across seeds (ACCEPTED DEVIATION, see note)
- **AND** R27.5 BC sanity holds for every run

#### Accepted deviation note (R27.4, Df_target = 2.9)

`mean(prefactor) ≈ 0.93` at `Df_target = 2.9` (observed 0.929–0.941 for N ∈ {100, 500}) is an
accepted deviation caused by finite-N geometric feasibility at the extreme high-Df edge: the R27
physical-contact guard (correctly) lands fallback merges at `rg_after < rg_target`, so the large-N
tail of the Rg-evolution sits below the ideal `N = kf·(Rg/rp)^Df` line and any global fit inherits
the deficit.

**Evidence** (Phase 0 diagnostic `rg_fit_variants_audit`, Cycle 3.1, commit `6e13c5f`): neither the
current unweighted OLS (0.929/0.941), an N-weighted OLS (0.879/0.941), nor a tail-restricted fit
(0.921/0.990) reaches `kf ≥ 1.0`; the N-weighted variant is strictly worse at Df=2.9. The deficit
is a property of the recorded point cloud, not of the fit methodology; changing the estimator
cannot recover it. Tolerances for R27.4 at Df=2.9 are therefore locked at the observed band
(`≥ 0.85` floor with the existing `±0.15` Df tolerance), pending any future geometry-level change
(out of scope; would relax R27's physical floor and is not planned).

## ADDED Requirements

- None (R28 N-weighted fit retired before implementation; see design.md Log L2).
