# Tasks: coordination-export-and-histogram

## Overview
Export per-particle coordination data and distribution histogram with simulation results. Unify contact threshold across 4 computation sites. Strict TDD active.

**Total tasks**: 30  
**Phases**: 6  
**Stack**: [backend] primary, [frontend] defensive, [docs]  

---

## Phase 1: Service layer (TDD)

### T1.1 — [x] Skeleton: CoordinationData + compute_coordination_data()
- **Size**: S
- **Stack**: [backend]
- **Description**: Create `backend/apps/simulations/services/coordination.py` skeleton. Define `CoordinationData` dataclass with 6 fields (per_particle, distribution, mean, std, threshold_strategy, tolerance) + `compute_coordination_data()` signature.
- **Acceptance**: Import succeeds, dataclass instantiates, signature matches design.md section 4.

### T1.2 — [x] RED→GREEN→TRIANGULATE: 1-particle case
- **Size**: S
- **Stack**: [backend]
- **Description**: Test n_particles=1, n_contacts=0 → distribution={"0":1}, mean=0, std=0. Use RED first (assert failure), GREEN (implement), TRIANGULATE (add boundary assertion).
- **Acceptance**: Test passes, per_particle=[0 contact], distribution sum = 1.

### T1.3 — [x] RED→GREEN→TRIANGULATE: 2 touching particles
- **Size**: S
- **Stack**: [backend]
- **Description**: Test 2 particles at contact distance (each 1 contact) → distribution={"1":2}, mean=1, std=0. Threshold: r_i+r_j with 1% tolerance.
- **Acceptance**: Test passes, sum(distribution) = 2, per_particle=[1,1].

### T1.4 — [x] RED→GREEN→TRIANGULATE: 2 far particles (0 contacts each)
- **Size**: S
- **Stack**: [backend]
- **Description**: Test 2 particles separated by >threshold → distribution={"0":2}, mean=0, std=0.
- **Acceptance**: Test passes, sum(distribution) = 2, per_particle=[0,0].

### T1.5 — [x] RED→GREEN: symmetry invariant
- **Size**: S
- **Stack**: [backend]
- **Description**: Test that particle order permutation produces identical per_particle (sorted by index). Pairs: [(0,1), (0,2), (1,2)] same as [(2,1), (2,0), (1,0)].
- **Acceptance**: Test passes, symmetric pairs yield same contacts.

### T1.6 — [x] RED→GREEN: distribution sum invariant
- **Size**: S
- **Stack**: [backend]
- **Description**: Test sum(distribution.values()) == n_particles for arbitrary N and contact patterns.
- **Acceptance**: Test passes for N=5, N=10, N=50 random configs.

### T1.7 — [x] RED→GREEN: polydisperse case
- **Size**: M
- **Stack**: [backend]
- **Description**: Test different radii → threshold uses r_i+r_j*(1+tol). Particles with radii [1.0, 1.5, 2.0], tolerance 0.01. Pair (0,1): threshold=2.525, (1,2): threshold=3.535.
- **Acceptance**: Test passes, per_particle counts reflect actual distances vs thresholds.

### T1.8 — [x] RED→GREEN: vectorized implementation
- **Size**: M
- **Stack**: [backend]
- **Description**: Implement using numpy broadcasting per design.md section 3. `coords[np.newaxis, :] - coords[:, np.newaxis]` for pairwise distances.
- **Acceptance**: Test passes, performance <2s for N=100, correctness vs loop version.

### T1.9 — [x] Performance test: N=1000 in <2s
- **Size**: S
- **Stack**: [backend]
- **Description**: Benchmark compute_coordination_data() with N=1000 random positions, ensure runtime <2 seconds.
- **Acceptance**: Test passes, time <2s on CI/local.

### T1.10 — [x] REFACTOR: clean API + metadata fields
- **Size**: S
- **Stack**: [backend]
- **Description**: Ensure returned CoordinationData includes threshold_strategy="unified_r_sum_tol" and tolerance=0.01. Clean up public API, remove internal helpers from namespace.
- **Acceptance**: Dataclass fields match design.md section 4 exactly.

---

## Phase 2: tasks.py refactor (4 sites consolidated)

### T2.1 — [x] RED: mock test for monodisperse path
- **Size**: S
- **Stack**: [backend]
- **Description**: Test that `compute_metrics()` for monodisperse calls the new service. Mock `compute_coordination_data`, assert called with coords, radii, tolerance.
- **Acceptance**: Test fails (not yet calling service), import error expected.

### T2.2 — [x] GREEN: replace monodisperse loop (lines 811-824)
- **Size**: M
- **Stack**: [backend]
- **Description**: Replace inline loop that computes coordinations for monodisperse with service call. Store result in metrics["coordination"] with all 6 fields.
- **Acceptance**: Test passes, existing behavior preserved (mean, std same for test case).

### T2.3 — [x] RED: test polydisperse path (lines 1079-1090)
- **Size**: S
- **Stack**: [backend]
- **Description**: Test that polydisperse path also uses service. Same pattern as T2.1 but for lines 1079-1090.
- **Acceptance**: Test fails, confirms need for replacement.

### T2.4 — [x] GREEN: replace polydisperse loop
- **Size**: M
- **Stack**: [backend]
- **Description**: Replace polydisperse inline loop with service call. Ensure radii passed correctly.
- **Acceptance**: Test passes, coordinates and radii used correctly.

### T2.5 — [x] Find+replace remaining sites (Rust engine path enriched)
- **Size**: M
- **Stack**: [backend]
- **Description**: Search "coordinations =" in tasks.py, identify 2 remaining sites. Replace both with service calls. Total 4 sites unified.
- **Acceptance**: All 4 sites use service, no inline loops remain.

### T2.6 — [x] Integration test: all 6 fields validated
- **Size**: M
- **Stack**: [backend]
- **Description**: Run simulation with Df=1.7, assert metrics.coordination has all 6 fields (mean, std, per_particle, distribution, threshold_strategy, tolerance). Validate structure.
- **Acceptance**: Test passes, all fields present and non-null.

### T2.7 — [x] Backward-compat: drift from legacy 2.1*r
- **Size**: S
- **Stack**: [backend]
- **Description**: Compute mean for known geometry using new service, compare to legacy 2.1*radius threshold value. Document drift (expected ~1-2%). Add docstring with drift number.
- **Acceptance**: Test passes with documented drift, no crash.

---

## Phase 3: CSV exports

### T3.1 — [x] RED: SimulationViewSet.export_csv test — new sections
- **Size**: S
- **Stack**: [backend]
- **Description**: Test that export_csv emits `# section: coordination_per_particle` and `# section: coordination_distribution` sections. Check headers present.
- **Acceptance**: Test fails, confirms sections not yet present.

### T3.2 — [x] GREEN: implement CSV section emission
- **Size**: M
- **Stack**: [backend]
- **Description**: Add coordination_per_particle section (particle_idx, contacts) and coordination_distribution section (coordination_number, count). Use proper CSV format.
- **Acceptance**: Test passes, sections appear in output.

### T3.3 — [x] TRIANGULATE: existing column order regression
- **Size**: S
- **Stack**: [backend]
- **Description**: Assert existing columns (id, name, created, status, ...) appear in same order before new sections. Regression test.
- **Acceptance**: Test passes, column order preserved.

### T3.4 — [x] RED: ParametricStudyViewSet.export_csv test
- **Size**: S
- **Stack**: [backend]
- **Description**: Test that batch CSV has 4 new columns appended: coord_mean, coord_std, coord_mode, coord_max. Assert column headers present.
- **Acceptance**: Test fails, columns not yet present.

### T3.5 — [x] GREEN: implement column appending
- **Size**: M
- **Stack**: [backend]
- **Description**: Append coord_mean, coord_std, coord_mode, coord_max at end of each row. Compute mode from distribution (smallest if multimodal, per R6 contract).
- **Acceptance**: Test passes, columns appear in CSV.

### T3.6 — [x] TRIANGULATE: mode smallest of multiple modes (R6)
- **Size**: S
- **Stack**: [backend]
- **Description**: Test distribution with multiple modes [0:3, 2:3, 5:2] → mode should be 0 (smallest). Verify R6 contract.
- **Acceptance**: Test passes, mode=0.

### T3.7 — [x] Regression: existing batch CSV consumers
- **Size**: S
- **Stack**: [backend]
- **Description**: If existing tests for batch CSV parsing exist, ensure they still pass. No breaking changes to parser.
- **Acceptance**: Tests pass, backward compat maintained.

---

## Phase 4: neighbor_graph refactor (optional optimization)

### T4.1 — [x] RED: cached per_particle test
- **Size**: S
- **Stack**: [backend]
- **Description**: Test that neighbor_graph action returns cached per_particle data when available in metrics (no recomputation).
- **Acceptance**: Test fails initially, cache not yet checked.

### T4.2 — [x] GREEN: add cache check
- **Size**: M
- **Stack**: [backend]
- **Description**: Add cache check at top of neighbor_graph action. If metrics["coordination"]["per_particle"] exists, return it directly. Fall back to compute on miss.
- **Acceptance**: Test passes, cache hit avoids recomputation.

### T4.3 — [x] Integration: legacy sim fallback
- **Size**: S
- **Stack**: [backend]
- **Description**: Test that a simulation created before this change (no per_particle in metrics) still returns correct data via fallback computation.
- **Acceptance**: Test passes, legacy sim works.

### T4.4 — [x] Equality: cached vs recomputed
- **Size**: S
- **Stack**: [backend]
- **Description**: Assert cached per_particle list equals recomputed list for same simulation (deterministic coords).
- **Acceptance**: Test passes, identical results.

---

## Phase 5: Frontend graceful absence (defensive)

### T5.1 — [x] grep frontend for metrics.coordination usage
- **Size**: S
- **Stack**: [frontend]
- **Description**: Search frontend code for `metrics.coordination` usage. Find any place that reads `.mean` or `.std` fields.
- **Acceptance**: List of usage sites documented.
- **Result**: Found 2 sites reading `coordination.mean` and `.std` (page.tsx:482-488). NeighborGraph.tsx reads `node.coordination` from API response, not metrics. No code reads per_particle/distribution yet.

### T5.2 — [x] IF found: add Optional handling
- **Size**: M
- **Stack**: [frontend]
- **Description**: If T5.1 finds code, add defensive Optional handling for new fields (per_particle, distribution). Treat as undefined/empty for legacy sims.
- **Acceptance**: No crash on legacy sims, new fields Optional.
- **Result**: Added optional type declarations for per_particle, distribution, threshold_strategy, tolerance to types.ts coordination type. Frontend only reads mean/std so new fields are safely ignored on legacy sims.

### T5.3 — [x] IF not found: no change + document
- **Size**: S
- **Stack**: [docs]
- **Description**: If no code reads coordination data, document that no frontend change needed. Skip T5.2.
- **Acceptance**: Documented in tasks.md.
- **Result**: No runtime code reads new fields. Type-level Optional declarations added for future consumers (F2 cycle). 397 frontend tests passing.

---

## Phase 6: Docs

### T6.1 — CHANGELOG entry
- **Size**: S
- **Stack**: [docs]
- **Description**: Add entry per design.md section 9. Include: new per-particle + distribution export, threshold unification (4 sites → unified), ~4% drift from old 2.1*r, new columns in batch CSV.
- **Acceptance**: Entry present in CHANGELOG.md.

### T6.2 — SMOKE_TEST.md examples
- **Size**: S
- **Stack**: [docs]
- **Description**: Add curl examples to verify per-sim and batch exports include new fields. Query SimViewSet and ParametricStudyViewSet export endpoints.
- **Acceptance**: Examples working, verify output contains coordination data.

### T6.3 — Mark spec sync deferred
- **Size**: S
- **Stack**: [docs]
- **Description**: Note in tasks.md that spec sync to canonical is deferred to archive phase. Delta specs remain in change folder until complete.
- **Acceptance**: Deferred status documented.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-------------|
| Threshold change causes historical comparability issues | Medium | Medium | Document ~4% drift in CHANGELOG; R3 spec accepts formula change not value |
| O(N^2) perf degradation on large sims | Low | High | Vectorized numpy (T1.8); chunked threshold deferred to T1.9 |
| JSONField storage growth (~40KB/sim) | High | Low | TOAST compression in Postgres; no historical backfill |
| Frontend crashes on legacy sims without per_particle | Low | Medium | T5.1-5.3 defensive Optional handling |

---

## Skill Resolution

- **go-testing**: Not applicable (Django/pytest, not Go)
- **sdd-tasks**: This phase — tasks created

---

## Next Recommended

`apply` — Launch sdd-apply to execute tasks in phase order. Start with Phase 1 (service layer TDD).