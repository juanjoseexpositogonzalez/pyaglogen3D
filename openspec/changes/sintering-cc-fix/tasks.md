# Implementation Tasks: sintering-cc-fix (PYA-11)

**Project**: pyaglogen3D  
**Change**: sintering-cc-fix  
**Cycle**: 11 / frente-11  
**Status**: Ready for implementation

---

## Phase 1 — Engine: `calculate_com_distance` accepts `sintering_coeff`

- [x] T1.1 — Add `sintering_coeff: f64` parameter to `calculate_com_distance` function signature (`aglogen_core/engine/src/simulation/tunable_cc.rs`)
- [x] T1.2 — Implement `rp_effective = rp * sintering_coeff` in the formula; update all `rp` usages to `rp_eff` within the d² computation
- [x] T1.3 — Add cargo tests for regression at coeff=1.0 (snapshot match frente-10), coeff=0.9 PC case (d_sintered = 0.9·d_unsintered), coeff=0.5 extreme (d > 0), coeff=0.0 degenerate (returns None)
- [x] T1.4 — Update existing call sites in `tunable_cc.rs` to pass `params.sintering.sample(rng)` or 1.0 where struct doesn't have it yet

---

## Phase 2 — Engine: `select_contact_particles` + ballistic fallback consistency

- [ ] T2.1 — Fix `select_contact_particles` (~line 512 in `tunable_cc.rs`) to use `sintered_contact_distance(p1.radius, p2.radius, sintering_coeff)` instead of bare `p1.radius + p2.radius`
- [ ] T2.2 — Verify ballistic fallback path (`merge_ballistic`) also uses sintered contact distance; fix if inconsistent (already verified correct per design)
- [ ] T2.3 — Add cargo tests: with sintering_coeff=0.9, verify contact validation accepts pairs at sintered distance; rejects at unsintered distance

---

## Phase 3 — Integration test + backend verification

- [ ] T3.1 — Create cross-cutting integration test in `aglogen_core/engine/tests/integration_cc_tunable.rs`: 5 runs with target Df=2, kf=1, N=350, sintering_coeff=0.9. Assert `result.coordinates.len() == 350` (NOT 1), Df within ±5% of 2.0, kf within ±10% of 1.0
- [ ] T3.2 — Verify backend `tasks.py` already passes `sintering_coeff` to `aglogen_core` call (read `backend/apps/simulations/tasks.py` lines ~1282-1303 to confirm)
- [ ] T3.3 — Verify frontend already has sintering UI control (read `frontend/src/...` to confirm sintering slider/control exists; likely no-op)

---

## Phase 4 — Docs + CHANGELOG + Jira PYA-11 close

- [ ] T4.1 — Documentation: create `pyaglogen3D/docs/sintering-cc-fix.md` (~50-70 lines): why (frente 10 regression), what changed (rp_eff in formula + select_contact), backward compat at coeff=1.0, validation
- [ ] T4.2 — CHANGELOG entry under `sintering-cc-fix (unreleased)` with Fixed/Migration (none)/Backward compat sections
- [ ] T4.3 — Close Jira PYA-11 with comment summarizing fix + commit range; transition to "Finalizada"

---

## Dependencies & Notes

- P1 tests must pass before P2 begins (green phase boundary)
- P2 tests must pass before P3 begins
- P3 tests must pass before P4 begins
- All phases: run `cargo test`, `uv run pytest` to verify green before phase completion
- No DB migration needed — `sintering_config` JSONField already exists on `Simulation` model

## Task Count

Total: 12 tasks (within 10-16 target range)

---

*Generated: 2026-05-05 | SDD Task Breakdown*