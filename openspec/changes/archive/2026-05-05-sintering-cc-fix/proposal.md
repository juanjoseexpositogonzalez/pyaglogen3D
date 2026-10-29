# Proposal: Sintering CC Fix (Cycle 11 / PYA-11)

## Intent

CC tunable + sintering (coeff < 1.0) at target Df=2, kf=1 produces a single sphere (n_particles_visible=1, Rg=0). Without sintering, same target produces normal aggregate (Df=1.97, kf=1.18).

Root cause (from exploration): `calculate_com_distance` (added in frente 10) assumes contact at `2*rp`, but sintering reduces effective contact distance below `2*rp`. The fractal-law CoM distance (e.g. 2.0 for monomers) exceeds the sintered contact threshold (e.g. 1.8 at coeff=0.9), so `has_intercluster_contact` always fails for monomer pairs. ALL early merges fall back to ballistic, the algorithm times out, and `clusters[0]` (a single monomer) is returned.

This is a regression from frente 10 -- the prior buggy formula coincidentally tolerated sintering by computing wrong distances.

**Fix**: `calculate_com_distance` gains `sintering_coeff: f64` parameter, uses `rp_effective = rp * sintering_coeff` in the formula. Target Df = sintered shape (matches experimental literature convention). `sintering_coeff=1.0` produces identical output to current frente 10 implementation.

## Scope

### In Scope

- Engine: `calculate_com_distance` gains `sintering_coeff: f64`, uses `rp * sintering_coeff` as effective contact radius
- Engine: merge loop propagates `sintering_coeff` from algorithm config into the formula call
- Engine: ballistic fallback consistency check (must also respect sintering)
- Backend: verify `sintering_coeff` is plumbed from UI/API to engine (likely already exists)
- Tests: regression (coeff=1.0 identical to frente 10 baseline) + integration (coeff=0.9 + Df=2 target -> N~350 aggregate)

### Out of Scope

- PYA-14 (CC tunable Df<1.8 iterative drift) -- separate cycle
- PYA-13 (FRAKTAL bisection UX) -- separate
- PYA-15 / F1+F2 (parametric distributions for dpo and kf) -- backlog
- Sintering as post-processing compaction (Camino C) -- explicitly rejected
- Multi-modal sintering (different coefficients per particle)
- Other algorithms (ballistic, CCA, DLA) sintering issues -- deferred

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cc-tunable-aggregation`: R-DELTA -- `calculate_com_distance` signature gains `sintering_coeff` parameter; positioning respects sintered contact distance; new requirement for sintered convergence target

## Approach

Bottom-up, smaller than frente 10. Engine math first (regression-tested), then orchestration (merge loop), then backend wiring, then validation tests.

| Phase | Description | Depends on |
|-------|-------------|------------|
| P1 | Engine: `calculate_com_distance` accepts `sintering_coeff` + analytic tests (PC equivalence with sintering, regression at coeff=1.0) | -- |
| P2 | Engine: merge loop propagates `sintering_coeff` + ballistic fallback consistency + cargo tests | P1 |
| P3 | Backend: verify wiring, add field if missing + pytest | P2 |
| P4 | Integration tests (5-run convergence with sintering) + docs + CHANGELOG + Jira PYA-11 close | P1-P3 |

Frontend likely no-op -- sintering control already exists in UI from before this cycle. Confirm in P3.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `aglogen_core/engine/src/cc_tunable/tunable_cc.rs` | Modified | `calculate_com_distance` signature + merge loop sintering propagation |
| `aglogen_core/engine/src/simulation/sintering.rs` | Unchanged | Reference only -- already correct |
| `aglogen_core/engine/tests/` | New/Modified | Regression + sintered convergence tests |
| `backend/apps/simulations/tasks.py` | Modified (if needed) | Verify sintering_coeff plumbing to engine |
| `backend/apps/simulations/tests/` | Modified (if needed) | pytest for sintering wiring |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Regression for sintering_coeff=1.0 | Low | Mandatory regression test in P1 asserts identical output to frente 10 baseline |
| Ballistic fallback may not respect sintering today | Medium | P2 explicitly checks and fixes if needed |
| Other algorithms may have sintering issues | N/A | Explicitly deferred -- out of scope |
| Frontend may need changes | Low | P3 verifies UI is unchanged; sintering control pre-exists |

## Rollback Plan

1. Revert `calculate_com_distance` signature to remove `sintering_coeff` parameter
2. Revert merge loop to not propagate sintering into formula call
3. All changes localized to `tunable_cc.rs` + tests -- safe rollback at any phase boundary

## Dependencies

- Frente 10 (`cc-tunable-formula-fix`) must be merged -- already archived 2026-05-04.

## Success Criteria

- [ ] `sintering_coeff=1.0` produces identical output to frente 10 baseline (regression test)
- [ ] 5 runs with Df=2, kf=1, N=350, sintering_coeff=0.9 produce aggregate with N~350 particles (not 1) and Df near target
- [ ] Ballistic fallback respects sintering_coeff
- [ ] All test suites green: `cargo test`, `uv run pytest`, `npm test`
- [ ] Jira PYA-11 closed
