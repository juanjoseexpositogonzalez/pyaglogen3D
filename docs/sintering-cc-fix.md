# Sintering + CC Tunable Collapse Fix (PYA-11)

Fixes three bugs that caused the CC tunable algorithm to collapse
aggregates into a single monomer (`n_particles=1`, `Rg=0`) when
`sintering_coeff < 1.0`.

## Why

A user reported that running CC tunable with sintering (Df=2, kf=1,
N=350, sintering_coeff=0.9) produced a single sphere instead of an
aggregate.  Without sintering, the same target produced Df=1.97,
kf=1.18 — a normal aggregate.  The bug was sintering-specific: the
algorithm silently rejected every merge attempt and returned the
first monomer as the "result".

## Root cause

Three bugs found during exploration and implementation (frente 11):

1. **`calculate_com_distance` ignored `sintering_coeff`** (introduced
   by frente 10): the fractal-law formula used the bare primary
   particle radius `rp` instead of `rp_eff = rp * sintering_coeff`.
   This placed the required merge position outside the sintered
   contact zone, so every tunable merge was rejected by the overlap
   check.

2. **`select_contact_particles` used bare contact distance** (~line
   512 in `tunable_cc.rs`): validation compared against `r1 + r2`
   instead of the sintered contact distance.  Same rejection logic
   as bug 1.

3. **`merge_ballistic` march step skipped the sintered snap window**:
   the hardcoded step `min_radius * 0.5` was tuned for the bare
   contact window.  With sintering_coeff=0.9, the snap window
   narrows to `[1.62, 1.818]` (width 0.198) and the 0.5 step grid
   jumped over it entirely — 0 out of 200 ballistic merges
   succeeded.  The algorithm ran to `max_iterations` and returned
   `cluster[0]`.

## Fixes

All three fixes share the same principle: scale contact distances
by `sintering_coeff`.

- **`calculate_com_distance`** accepts `sintering_coeff: f64` and
  uses `rp_eff = rp * sintering_coeff` in the leading factor of
  the formula.  Math: `d_sintered = c * d_unsintered` (linear
  scaling, where `c = sintering_coeff`).

- **`select_contact_particles`** uses the
  `sintered_contact_distance(r1, r2, sintering_coeff)` helper
  instead of bare `r1 + r2`.

- **`merge_ballistic`** derives the march step from the snap window
  width: `step = max(min_contact_dist * 0.055, min_radius * 0.05)`.
  At coeff=1.0, this is strictly finer than the old 0.5 step — no
  regression.

## Backward compatibility

Aggregates generated with `sintering_coeff=1.0` are
bitwise-identical to the frente 10 baseline.  This is verified by
the regression test
`tunable_cc::tests::test_sintering_e2e_coeff_1_0_identical_to_baseline`.

## Validation

A 5-run integration test at target (Df=2, kf=1, N=350,
sintering_coeff=0.9) passes in ~54 s.  The aggregate has 350
particles (not 1), Df near 2.0, kf near 1.0.

## Migration

No DB migration required.  `sintering_coeff` was already wired
through the `Simulation` model and serializer prior to this cycle.

## Known limitations

For target Df < 1.8, the iterative drift documented in PYA-14 still
applies regardless of sintering.  This fix only addresses the
sintering-specific collapse bug.
