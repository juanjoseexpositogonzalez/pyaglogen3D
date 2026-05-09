# Proposal: PYA-14 Phase 3 — CC Tunable Df<2 Convergence Fix

## Intent

The CC tunable algorithm produces mean Df≈1.98 for target Df=1.7 (+16.4% bias). Root cause: random pair selection exhausts 100 retries on infeasible pairs while feasible pairs exist elsewhere in the pool. MATLAB compensates with infinite retries; we compensate with smarter selection + controlled fallback.

## Scope

### In Scope
- **Phase 0**: Verify gamma vs gamma/2 bounding check discrepancy (MATLAB uses `gamma/2`, Rust uses `gamma`) against thesis Section 6.3.2-6.3.4. Fix or document.
- **Phase 1**: Smart Pair Selection (Path D) — pre-screen candidate pairs for geometric feasibility before retry loop. Targets mid-stage (68.9% ballistic → <10%).
- **Phase 2**: Adaptive d fallback (Path B) — when NO feasible pair exists, overshoot to max achievable distance instead of undershooting via ballistic contact.
- **Phase 3**: Regression suite — parametric sweep Df∈{1.4,1.6,1.7,1.8,2.0,2.5}, N=350, kf=1.3.

### Out of Scope
- kf<1.3 behavior (different mechanism, separate frente)
- N sensitivity studies (only N=350 this cycle)
- Other algorithms (CCA, DLA) — CC tunable only
- Frontend/UX changes
- Performance optimization beyond Path D profiling

## Capabilities

### New Capabilities
None — no new spec files needed.

### Modified Capabilities
- `cc-tunable-aggregation`: R3 (retry policy — adding feasibility pre-screen), R5 (convergence bounds — extending to Df<1.8), R7 (metadata — new fields for pair selection stats). Bounding check semantics may change if gamma/2 is correct.

## Approach

| Phase | What | Blocker? |
|-------|------|----------|
| 0 | gamma vs gamma/2 verification against thesis + MATLAB | Yes — affects bounding check used by Phase 1 |
| 1 | Smart Pair Selection: enumerate candidate pairs, rank by `required_d / (br1+br2)`, pick feasible (ratio ≤1.0) first | No |
| 2 | Adaptive d: when no feasible pair exists, relax target to `min(required_d, br1+br2)` — biases Df DOWN to counteract current UP bias | No |
| 3 | Validation: re-run `scripts/validate_pya14.py` + parametric sweep | No |

Feature flag: `USE_SMART_PAIR_SELECTION` (Rust const, default `true`). Flip to `false` for instant revert.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `aglogen_core/engine/src/simulation/tunable_cc.rs` | Modified | Pair selection logic, bounding check, adaptive fallback |
| `aglogen_core/engine/src/simulation/bounding.rs` (or equivalent) | Modified | gamma vs gamma/2 fix if needed |
| `aglogen_core/engine/tests/integration_cc_tunable.rs` | Modified | Parametric convergence tests |
| `scripts/validate_pya14.py` | Unchanged | Re-run for end-to-end validation |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Path D regresses Df≥2 cases | Low | Explicit regression in parametric sweep (Df=2.0, 2.5) |
| Late-stage (N>100) has NO feasible pair even with Path D | High | Path B covers this — adaptive d fallback |
| gamma/2 verification reveals deeper thesis drift | Low | Time-box Phase 0; split to separate frente if it expands |
| O(k²) feasibility scan too slow for large pools | Low | Profile N=350 first; sample candidates if >2x slowdown |
| Adaptive d overshoot biases Df DOWN too aggressively | Med | Tune overshoot factor; parametric sweep catches this |

## Rollback Plan

1. Feature flag `USE_SMART_PAIR_SELECTION = false` → reverts to current random-pair behavior instantly.
2. Git revert on merge commit if catastrophic.

## Dependencies

- Phase 0 (gamma/2) MUST complete before Phase 1 (smart pair selection) — bounding check semantics affect feasibility screening.
- Maturin rebuild required after engine changes (same as Phase 1/2).

## Success Criteria

- [ ] `scripts/validate_pya14.py` returns GREEN for Df=1.7 (5/5 sims pass V1+V2+V3)
- [ ] Parametric sweep Df∈{1.4,1.6,1.7,1.8,2.0,2.5}: all within ±10%
- [ ] Engine + backend test suites green (no regressions)
- [ ] gamma vs gamma/2 resolved with thesis citation
