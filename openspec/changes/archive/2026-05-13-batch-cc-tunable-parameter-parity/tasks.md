# Tasks: Batch CC Tunable — Parameter Grid Parity

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 500–700 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (backend P1-P3) → PR 2 (frontend P4-P6) → PR 3 (integration P7 + docs P8) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Backend validation + grid expansion + bug #634 fix | PR 1 | Phases 1-3; standalone; fully testable without frontend |
| 2 | Frontend components + BatchForm wiring | PR 2 | Phases 4-6; depends on PR 1 API contract |
| 3 | Integration + docs | PR 3 | Phases 7-8; depends on both |

## Phase 1: Distribution Validation Helper [backend]

- [x] 1.1 Create `backend/apps/simulations/services/distribution_validation.py` with `validate_distribution_config(config, allow_types, constraints)` — S
- [x] 1.2 RED→GREEN→TRIANGULATE: fixed/normal/uniform valid configs → R1.1-R1.3, R2.1 — S
- [x] 1.3 RED→GREEN: invalid type, missing field, negative std, std/mean cap → R1.4, R2.2, R2.3 — S
- [x] 1.4 Test file: `backend/apps/simulations/tests/test_distribution_validation.py` — S

## Phase 2: Serializer Validation [backend]

- [x] 2.1 RED→GREEN: `validate()` accepts `parameter_grid.kf_distribution` list of valid configs → R1.1 — M
- [x] 2.2 RED→GREEN: rejects malformed kf_distribution entries → R1.4 — S
- [x] 2.3 RED→GREEN: accepts/rejects `particle_radius_config` with std/mean ≤ 0.3 → R2.2-R2.3 — S
- [x] 2.4 RED→GREEN: accepts/rejects `sintering_config` grid entries → R3.1-R3.2 — S
- [x] 2.5 RED→GREEN: accepts/rejects `seed_type` enum list → R4.1-R4.2 — S
- [x] 2.6 RED→GREEN: old grid shape without new keys passes → R7.1-R7.2 — S
- [x] 2.7 RED→GREEN: >1000 projected sims → 400 rejection → R6.2 — S
- [x] 2.8 RED→GREEN: >200 projected sims → warning in response → R6.1 — S

## Phase 3: Grid Expansion + Bug #634 Fix [backend]

- [x] 3.1 Document current `create_simulation()` + `perform_create` expansion behavior — S
- [x] 3.2 RED→GREEN: cartesian product over mixed keys → correct sim count → R5.1-R5.2 — M
- [x] 3.3 RED→GREEN: child sim params match grid combo values → R5.3 — S
- [x] 3.4 RED→GREEN (FIX #634): seed_type from grid sets model field → R4.3, R17.6 — M
- [x] 3.5 RED→GREEN: seed_type from base_parameters sets model field → R17.7 — S
- [x] 3.6 RED→GREEN: sintering grid entry overrides study-level → R3.3 — S
- [x] 3.7 RED→GREEN: sintering fallback to study-level config → R3.4 — S
- [x] 3.8 RED→GREEN: distribution configs pass through as-is → R1.5 — S
- [x] 3.9 Integration: POST → child sims created with all 4 keys → R5.4-R5.5 — M

## Phase 4: DistributionSelector Extraction [frontend]

- [x] 4.1 Read `SimulationForm.tsx` sintering JSX block (lines 1025-1146) — S
- [x] 4.2 Create `frontend/src/components/forms/DistributionSelector.tsx` skeleton — S (EXISTED from PYA-15)
- [x] 4.3 RED→GREEN: renders type dropdown (fixed/uniform/normal) → R8.1 — S (EXISTED)
- [x] 4.4 RED→GREEN: correct input fields per type → R8.1 — S (EXISTED)
- [x] 4.5 RED→GREEN: onChange emits correct config object → R8.2 — S (EXISTED)
- [x] 4.6 RED→GREEN: validation feedback (red border on invalid) → R8.3 — S (added error prop)
- [x] 4.7 RED→GREEN: allowedTypes filters dropdown → R8.4 — S (added allowedTypes prop)
- [x] 4.8 RED→GREEN: validation constraints prop enforced — S (constraints delegated to caller per design)
- [x] 4.9 Refactor SimulationForm to use DistributionSelector — preserve behavior — M (SKIPPED: design says sintering uses Sliders, different pattern — don't merge)
- [x] 4.10 Regression: existing SimulationForm tests still pass — S (5/5 sintering tests green)
- [x] 4.11 Test file: `frontend/src/components/forms/__tests__/DistributionSelector.test.tsx` — S (extended to 17 tests)

## Phase 5: DistributionGridInput Component [frontend]

- [x] 5.1 Create `frontend/src/components/batch/DistributionGridInput.tsx` — S
- [x] 5.2 RED→GREEN: renders array of DistributionSelector instances → R8.1 — S
- [x] 5.3 RED→GREEN: "+ Add" appends entry → R8.2 — S
- [x] 5.4 RED→GREEN: trash icon removes entry → R8.2 — S
- [x] 5.5 RED→GREEN: min 1 enforced → R8.3 — S
- [x] 5.6 RED→GREEN: onChange emits array → R8.4 — S
- [x] 5.7 RED→GREEN: passes paramName + validation props to children — S
- [x] 5.8 Test file: `frontend/src/components/batch/__tests__/DistributionGridInput.test.tsx` — S

## Phase 6: BatchSimulationForm Wiring [frontend]

- [x] 6.1 Extend parameter-to-vary dropdown with 4 new options → R10.1-R10.3 — S
- [x] 6.2 RED→GREEN: kf_distribution → DistributionGridInput rendered → R10.1 — S
- [x] 6.3 RED→GREEN: particle_radius_config → DistributionGridInput with std/mean constraint → R10.2 — S
- [x] 6.4 RED→GREEN: sintering_config → DistributionGridInput rendered → R10.2 — S
- [x] 6.5 RED→GREEN: seed_type → multi-select chips → R9.1-R9.2 — M
- [x] 6.6 RED→GREEN: payload construction correct per option type — M (covered by T6.2-T6.5 via UI rendering + handleSubmit serialization)
- [x] 6.7 RED→GREEN: live sim count indicator updates → R10.3 — S
- [x] 6.8 RED→GREEN: warning toast at projected > 200 → R6.1 — S (inline warning, no toast lib)
- [x] 6.9 RED→GREEN: hard reject UI at projected > 1000 → R6.2 — S

## Phase 7: Integration Verification [backend + frontend]

- [x] 7.1 Run full backend + frontend test suites — no regressions — M
- [x] 7.2 Document manual smoke test scenario for post-deploy — S

## Phase 8: Docs [docs]

- [x] 8.1 CHANGELOG entry for `batch-cc-tunable-parameter-parity` — S
- [x] 8.2 `openspec/changes/batch-cc-tunable-parameter-parity/SMOKE_TEST.md` — S
- [x] 8.3 Mark spec sync deferred to archive phase — S
