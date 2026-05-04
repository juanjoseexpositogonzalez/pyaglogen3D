# Proposal: CC Tunable Formula Fix (Cycle 10 / PYA-10)

## Intent

3 user runs with target Df=1.6, kf=1.7, N=350 produced Df 1.87-2.07 / kf 1.25-1.51 -- all clustered near the ballistic limit (Df~1.91). This is systematic bias, not noise.

Root cause: `calculate_com_distance` has 3 bugs in the formula that make the algorithm degenerate to ballistic merge:
1. Missing `n_po` factor in the outer product
2. Wrong exponent application (applied to `rp` instead of the `(n_po/kf)^(2/Df)` term)
3. Denominator uses `n_po` instead of `n_po1 * n_po2`

The thesis printed equation has a typo. The correct formula (derived from first principles and validated against the working PC monomer case) is:

```
d^2 = (n_po * rp^2) / (n_po1 * n_po2) * [n_po*(n_po/kf)^(2/Df) - n_po1*(n_po1/kf)^(2/Df) - n_po2*(n_po2/kf)^(2/Df)]
```

## Scope

### In Scope

- **Engine**: rewrite `calculate_com_distance` with derived formula
- **Engine**: two-rotation positioning (azimuth + elevation, FZR canonical) replaces single-axis
- **Engine**: retry policy on geometric merge failure (up to N attempts, default 100); ballistic only after retries exhausted
- **Engine**: seed type modes (Monomers / Dimers / Trimers) -- user-configurable
- **Backend**: expose `seed_type` param in CC tunable simulation API + serializers
- **Frontend**: "Seed type" dropdown in CC tunable simulation form
- **Tests**: integration test with 5 seeded runs validates |mean(Df)-1.6|/1.6 < 0.05 and |mean(kf)-1.7|/1.7 < 0.10

### Out of Scope

- PYA-11 (CC tunable + sintering = 1 sphere) -- separate cycle, distinct issue
- PYA-13 (FRAKTAL bisection UX) -- unrelated cycle B
- Engine synthetic-geometry bug (frente 9 backlog) -- unrelated
- Re-running history of past simulations -- additive only, no migration of old data
- Diagnostic counters (cosmetic, not behavioral)

## Capabilities

### New Capabilities

- `cc-tunable-aggregation`: Full spec for the CC tunable cluster-cluster aggregation algorithm -- formula, positioning, fallback policy, seed types, convergence criteria

### Modified Capabilities

None (no existing canonical spec for this capability)

## Approach

Bottom-up: engine math first (testable analytically), then orchestration (positioning, retry, seed types), then API plumbing, then UI.

| Phase | Description | Depends on |
|-------|-------------|------------|
| P1 | Engine: corrected formula + cargo tests with analytic cases (n_po1=n_po2=1 -> known PC) | -- |
| P2 | Engine: two-rotation positioning + retry policy + cargo tests | P1 |
| P3 | Engine: seed types Monomers/Dimers/Trimers + cargo tests | P1 |
| P4 | Backend: API param `seed_type` + serializers + pytest | P3 |
| P5 | Frontend: "Seed type" dropdown + form validation + vitest | P4 |
| P6 | Integration tests (5-run convergence) + docs + CHANGELOG + Jira PYA-10 close | P1-P5 |

P2 and P3 are independent after P1. P4 needs P3. P5 needs P4. P6 is tail.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `aglogen_core/engine/src/cc_tunable/` | Modified | Corrected formula, two-rotation, retry policy, seed types |
| `aglogen_core/engine/tests/` | New/Modified | Analytic tests, convergence integration test |
| `backend/apps/simulations/serializers.py` | Modified | Expose `seed_type` param |
| `backend/apps/simulations/tasks.py` | Modified | Pass `seed_type` to engine |
| `backend/apps/simulations/tests/` | Modified | pytest for new param |
| `frontend/src/components/simulations/` | Modified | Seed type dropdown in CC tunable form |
| `frontend/src/components/simulations/__tests__/` | New | vitest for dropdown |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Derived formula NOT in printed thesis | N/A (accepted) | Comment in code with full derivation + cite PC case as cross-validation; user approved |
| Two-rotation breaks reproducibility of seed-based regression tests | High | Document: existing snapshot tests that check Df/kf for fixed seed need updating |
| Default `seed_type=Monomers` must NOT break existing workflows | Low | Default matches current behavior; new param is optional |
| Convergence might still drift after fix | Medium | 5-run integration test validates upfront; if >5% off, second iteration needed |
| Retry loop adds runtime | Low | Default 100 attempts is conservative; bench if latency matters |

## Rollback Plan

1. Engine: revert `calculate_com_distance` to previous formula -- single function.
2. Engine: revert to single-axis rotation -- positioning module.
3. Engine: remove retry loop, restore direct ballistic merge.
4. Backend: remove `seed_type` from serializer; param ignored if present.
5. Frontend: remove dropdown; form submits without `seed_type`.

All changes are localized. Rollback safe at any phase boundary.

## Dependencies

- None. No external cycle dependency. Engine formula fix is self-contained.

## Success Criteria

- [ ] 5 seeded CC tunable runs with target Df=1.6, kf=1.7, N=350 produce |mean(Df)-1.6|/1.6 < 0.05
- [ ] Same runs produce |mean(kf)-1.7|/1.7 < 0.10
- [ ] Two-rotation positioning (azimuth + elevation) replaces single-axis
- [ ] Retry-then-ballistic fallback (default 100 attempts) implemented
- [ ] Seed type (Monomers/Dimers/Trimers) configurable via API and UI
- [ ] All test suites green: `cargo test`, `uv run pytest`, `npm test`
- [ ] Jira PYA-10 closed
