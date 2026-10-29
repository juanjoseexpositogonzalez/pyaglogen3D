# Tasks: pya-14-phase3-df-convergence

## Overview
Fix CC Tunable Df<2 non-convergence (mean Df=1.98 vs target 1.7, +16.4% bias) via smart pair selection + adaptive fallback.

**⚠️ GAMMA VERDICT LOCKED (Phase 0 confirmed)**: Rust bounding check (`bounding_radius1 + bounding_radius2 >= required_distance`, i.e. `gamma`) is the mathematically CORRECT necessary condition for COM-to-COM placement. MATLAB's `gamma/2` is an overly lenient heuristic compensated by infinite retries. DO NOT modify `can_clusters_connect` — the convergence fix is smart pair selection, NOT changing the bounding check.

---

## Phase 0: Gamma Verdict Documentation (NO CODE)

| ID | Task | Size | Stack |
|----|------|------|-------|
| T0.1 | ~~Update `design.md` confirming gamma verdict is locked: "Rust correct, MATLAB lenient, do not change"~~ | S | [docs] | ✅ |
| T0.2 | ~~Document this verdict prominently in `tasks.md` so apply phase doesn't accidentally touch the bounding check~~ | S | [docs] | ✅ |

---

## Phase 1: Data Structures + Scaffolding (Engine, TDD)

| ID | Task | Size | Stack |
|----|------|------|-------|
| T1.1 | ~~RED: Write test for `MergeTraceEntry` with new optional fields~~ | M | [engine] | ✅ |
| T1.2 | ~~GREEN: Add the field + variant. Tests pass.~~ | M | [engine] | ✅ |
| T1.3 | ~~RED: Test `no_feasible_pair` event representation in trace~~ | M | [engine] | ✅ |
| T1.4 | ~~GREEN: Implement minimum.~~ | M | [engine] | ✅ |
| T1.5 | ~~REFACTOR: Tidy serde derives, ensure backward compat~~ | S | [engine] | ✅ |
| T1.6 | ~~Verify Python binding exposes the new fields~~ | S | [engine] | ✅ |

---

## Phase 2: Smart Pair Selection (Path D, TDD per function)

| ID | Task | Size | Stack |
|----|------|------|-------|
| T2.1 | ~~RED: Test `compute_max_achievable_distance(c1, c2)` for trivial geometry~~ | M | [engine] | ✅ |
| T2.2 | ~~GREEN: Implement~~ | M | [engine] | ✅ |
| T2.3 | ~~TRIANGULATE: Edge cases — degenerate clusters, identical positions~~ | S | [engine] | ✅ |
| T2.4 | ~~RED: Test `find_feasible_pairs(pool, df, kf)` with all-feasible pool~~ | M | [engine] | ✅ |
| T2.5 | ~~GREEN: Implement basic O(k²) scan~~ | M | [engine] | ✅ |
| T2.6 | ~~TRIANGULATE: Test partial feasibility, test all-infeasible~~ | M | [engine] | ✅ |
| T2.7 | ~~REFACTOR: Extract pair-evaluation into helper~~ | S | [engine] | ✅ |
| T2.8 | ~~RED: Test `select_pair_smart` returns Feasible when ≥1 feasible~~ | M | [engine] | ✅ |
| T2.9 | ~~GREEN: Implement~~ | M | [engine] | ✅ |
| T2.10 | ~~TRIANGULATE: Returns AllInfeasible when none feasible~~ | S | [engine] | ✅ |
| T2.11 | ~~PERFORMANCE GATE: O(k²) trivial for k≤350 (~61k iterations <1ms in Rust). No sampling needed.~~ | L | [engine] | ✅ |

---

## Phase 3: Adaptive Merge (Path B, TDD)

| ID | Task | Size | Stack |
|----|------|------|-------|
| T3.1 | ~~RED: Test `emit_adaptive_merge_entry` populates trace correctly~~ | M | [engine] | ✅ |
| T3.2 | ~~GREEN: Implement~~ | M | [engine] | ✅ |
| T3.3 | ~~RED: Test no_feasible_pair event emission~~ | M | [engine] | ✅ |
| T3.4 | ~~GREEN: Implement~~ | M | [engine] | ✅ |
| T3.5 | ~~REFACTOR: Consolidate trace-emission code paths~~ | S | [engine] | ✅ |

---

## Phase 4: Integration into Main Loop + Feature Flag (TDD)

| ID | Task | Size | Stack |
|----|------|------|-------|
| T4.1 | ~~RED: Test feature flag defaults to true; flag=false gives Phase 2 behavior~~ | M | [engine] | ✅ |
| T4.2 | ~~GREEN: Wire feature flag (env var read at sim init)~~ | M | [engine] | ✅ |
| T4.3 | ~~Integration test: Df=1.7 + flag=true uses smart selection (±30% structural validation)~~ | L | [engine] | ✅ |
| T4.4 | ~~GREEN: Integrate smart selection + adaptive fallback into main loop~~ | L | [engine] | ✅ |
| T4.5 | ~~REFACTOR: Phase 2 code path readable when flag=false, Phase 3 branch clean~~ | M | [engine] | ✅ |

---

## Phase 5: Parametric Regression Sweep (Engine + Integration)

| ID | Task | Size | Stack |
|----|------|------|-------|
| T5.1 | Write parametric test: Df ∈ {1.4, 1.6, 1.7, 1.8, 2.0, 2.5}, kf=1.3, N=350, 3 seeds. Assert convergence ±10% (or ±5% for Df>=2). | L | [engine] |
| T5.2 | Run; mark failing combinations as expected-failure if physically infeasible (e.g. Df<1.4) and document. | L | [engine] |
| T5.3 | Backend integration test: simulate via the API with target_df=1.7, seed_type=dimers, assert metrics.fractal_dimension within ±10% | L | [backend] |

---

## Phase 6: Frontend Compat Check + Docs

| ID | Task | Size | Stack |
|----|------|------|-------|
| T6.1 | Grep frontend for hardcoded `merge_type` checks (e.g. switch/case on "tunable"/"ballistic"). If "adaptive" would break rendering, add fallback to default to "ballistic"-like display. If no hardcoded check, no frontend change. | S | [frontend] |
| T6.2 | Update `CHANGELOG.md` | S | [docs] |
| T6.3 | Write `openspec/changes/pya-14-phase3-df-convergence/SMOKE_TEST.md`:<br>- Pre-conditions: deploy backend + engine (maturin rebuild required)<br>- Step 1: re-run `scripts/validate_pya14.py` with default Df=1.7 → expect GREEN<br>- Step 2: parametric run from UI with Df=1.4, 1.7, 2.0 → expect within ±10% each<br>- Step 3: rollback test — set env var `CC_TUNABLE_USE_PHASE3_ALGORITHM=false`, re-run, expect Phase 2 behavior (Df bias returns) | M | [docs] |

---

## Summary

- **Total tasks**: 28
- **Phases**: 6
- **Engine tasks**: 23
- **Backend tasks**: 1
- **Frontend tasks**: 1
- **Docs tasks**: 3

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Path D regression on Df≥2 | Low | Medium | Covered by T5.1 sweep |
| Late-stage no feasible pair | High | Medium | Path B adaptive fallback covers this |
| O(k²) scan speed | Low | Low | Profile in T2.11, fallback to sampling if needed |
| Frontend breaking on "adaptive" merge_type | Low | Low | T6.1 grep check + fallback |

## Next Recommended Phase

`apply` — Execute tasks phase-by-phase with TDD (red → green → refactor).

## Constraints

- DO NOT touch bounding check (gamma verdict locked)
- DO NOT run `npm run build` or `cargo build` automatically
- Engine tests: `cd aglogen_core && cargo test`
- Backend tests: `backend/.venv/bin/pytest`
- Conventional commits per phase
- Strict TDD active