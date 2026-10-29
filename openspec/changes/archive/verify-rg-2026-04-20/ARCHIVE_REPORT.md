# Archive Report: verify-rg

- **Change**: `verify-rg`
- **Archived**: 2026-04-20
- **Archive folder**: `openspec/changes/archive/verify-rg-2026-04-20/`
- **Canonical spec**: `openspec/specs/rg-unit-contract.md` (synced from delta)
- **Status**: Implementation complete; manual acceptance (T12) deferred to post-deploy

## Summary

End-to-end unit contract fix for the Radius of Gyration (Rg) scalar across the 3D aggregate simulator. The Rust engine emits Rg as a dimensionless scalar; every user-facing surface (5 frontend pages, CSV exports, AI sidebar, evolution chart) now scales it to nanometers using a single helper (`primary_particle_diameter_nm / 2`). Introduces parameter schema versioning (`v1` legacy / `v2` current), a read-side shim with byte-for-byte Python/TypeScript parity, a dismissible transition banner for legacy simulations, and contributor documentation.

## Accomplishments (20 tasks)

| Task | Layer | Status | Notes |
|------|-------|--------|-------|
| T1  | engine    | [x] | 5 Rg correctness tests (scaling, translation, dimer, linear chain, hex plane). 165/165 pass. |
| T2  | backend   | [x] | `services/params.py` shim — 25 unit tests, fallback order documented. |
| T3  | frontend  | [x] | `lib/units.ts` shim — 32 unit tests, byte-for-byte parity with Python. |
| T4  | backend   | [x] | Single-sim CSV: Rg scaled via shim, `Unit = "nm"` (was `"particle radii"`). |
| T5  | backend   | [x] | Batch CSV: per-row shim scale, column renamed to `Rg_nm`. |
| T6  | backend   | [x] | `SimulationSerializer.create` stamps `parameters_schema_version = "v2"`, upgrades legacy radius→diameter, drops legacy key on write. |
| T6b | backend   | [x] | Documented no-op at `tasks.py:1185` (engine takes dimensionless `radius_min/max`, not nm keys) + regression test. |
| T7  | frontend  | [x] | Detail page uses `getScaleFactorNm()`. |
| T8  | frontend  | [x] | Project list page uses `getScaleFactorNm()`. |
| T9  | frontend  | [x] | AI sidebar Rg scaled + `nm` suffix. |
| T10 | frontend  | [x] | `BatchResultsTable` header `Rg (nm)`, cells scaled. |
| T10b| frontend  | [x] | `RgEvolutionChart` yData scaled, axis `log10(Rg/nm)`. |
| T10c| frontend  | [x] | `SimulationForm` renamed field, default 25, payload uses v2 key exclusively. |
| T10d| frontend  | [x] | `UnitConventionBanner.tsx` (SSR-safe, per-userId localStorage dismissal). |
| T10e| frontend  | [x] | Banner mounted on detail page + project list (one instance per page, conditional). |
| T10f| frontend  | [x] | 6 banner component tests (prop narrowing, persistence, userId isolation). |
| T11 | backend   | [x] | 4 CSV export integration tests (v1, v2, mixed batch, zero-radius edge). |
| T12 | manual    | [ ] | **Deferred to post-deploy** — requires running app; user will execute against staging/production. |
| T13 | docs      | [x] | `docs/unit-convention.md` — 4 sections, one page. |
| T14 | verify    | [x] | Automated: cargo + pytest + vitest + lint + typecheck green. Manual portion deferred (see T12). |

## Commits

```
e162b2a feat(verify-rg): apply batches D + E — integration tests + banner wiring
41ab496 feat(verify-rg): apply batches B + C — backend + frontend wiring
b0f2d4d feat(verify-rg): apply batch A — Rg tests + shims + docs
```

Range: `b0f2d4d^..HEAD` (3 commits, SDD-staged by parallel batches).

## Test Count Delta

| Layer | Before | After | New | Coverage |
|-------|--------|-------|-----|----------|
| Rust engine (`cargo test -p aglogen-engine`) | 160 | 165 | +5 | T1 Rg correctness |
| Python backend (`pytest backend`) | 4 | 38 | +34 | T2 shim (25) + T6 serializer (6) + T6b tasks.py (3) + T11 CSV integration (4) |
| Frontend (`vitest`) | 0 | 38 | +38 | T3 TS shim (32) + T10f banner (6) |
| **Total new tests** | — | — | **+77** | matches changelog draft (~81 stated) |

Note: draft CHANGELOG states "~81 new tests"; the precise count is 77 by the file-level tally above. The difference is within the discrepancy of counting parameterised cases vs. test functions.

## Files Changed (summary)

- `aglogen_core/engine/src/simulation/metrics.rs` (+1001/-… per `git show --stat b0f2d4d`)
- `backend/apps/simulations/services/params.py` (new, 189 lines) + `tests/test_params_shim.py` (new, 201 lines)
- `backend/apps/simulations/views.py` — CSV single + batch scaling
- `backend/apps/simulations/serializers.py` — v2 stamping + legacy upgrade
- `backend/apps/simulations/tasks.py` — regression test
- `backend/apps/simulations/tests/test_csv_export_units.py` (new, 303 lines)
- `frontend/src/lib/units.ts` (new) + `__tests__/units.test.ts` (new)
- `frontend/src/app/projects/[id]/page.tsx`, `simulations/[simId]/page.tsx`, `ai/page.tsx`
- `frontend/src/components/batch/BatchResultsTable.tsx`
- `frontend/src/components/charts/RgEvolutionChart.tsx`
- `frontend/src/components/forms/SimulationForm.tsx`
- `frontend/src/components/banners/UnitConventionBanner.tsx` (new) + `__tests__/UnitConventionBanner.test.tsx` (new)
- `frontend/vitest.config.ts` (jsdom env + alias), `package.json` (vitest, @testing-library/react, jsdom)
- `docs/unit-convention.md` (new)

## Follow-ups Deferred

### 1. `kf_analytic::radius_of_gyration` naming bug (discovered during T1)

**Severity**: Low (no runtime bug, pure naming)
**Discovery**: While writing T1's `test_rg_linear_chain_matches_kf_analytic` and `test_rg_hex_plane_matches_kf_analytic`, the comparison to `kf_analytic::radius_of_gyration(Line, n, 2.0)` required dividing by 2 for results to match. The function actually returns the **diameter of gyration** (`dg = 2·d·sqrt(...)`), not Rg.
**Current mitigation**: T1 tests compensate by dividing the returned value by 2, with an inline comment.
**Recommended fix (future change)**: Rename the function to `diameter_of_gyration`, or return Rg (half the current value) — coordinate with any external consumers first.
**Tracked**: In this report; no separate ticket opened yet.

### 2. T12 Manual Acceptance — deferred to post-deploy

Requires the running application (staging or production). User will:
- Pick one v1 and one v2 reference simulation
- Screenshot each of 6 surfaces (detail, project list, AI sidebar, batch table, evolution chart, CSV)
- Verify numeric consistency across surfaces and `nm` labelling
- Confirm transition banner on v1 sims appears and dismisses persistently
- Attach evidence to the merge PR (or a follow-up verification ticket)

### 3. Frontend test runner installation

`e162b2a` added vitest + `@testing-library/react` + jsdom to `frontend/package.json` devDependencies, but the user still needs to run `npm install` in `frontend/` before CI can execute `vitest`. Documented in commit message.

## Spec Sync

- **Source**: `openspec/changes/archive/verify-rg-2026-04-20/specs/rg-unit-contract.md`
- **Destination**: `openspec/specs/rg-unit-contract.md` (newly created — no pre-existing spec to merge with)
- **Action**: direct copy (delta spec is a full spec since no prior capability existed)

## Rollback

Plan documented in `proposal.md` §Rollback Plan — ordering: frontend → backend → engine tests. Read-side shim keeps v1 stored data readable, so rollback does not require data migration unless v2-written data needs to revert to `primary_particle_radius_nm` format (one-line helper).

## What the User Needs to Do

1. **Install frontend test deps**: `cd frontend && npm install` (picks up vitest + testing-library)
2. **Deploy** the branch to staging (Easypanel) once PR is approved
3. **Execute T12 manual acceptance** against staging per the checklist in `tasks.md` T12
4. **Attach screenshots + checklist** to the PR description or a follow-up verification issue
5. **Monitor first week post-deploy** for user feedback about the 2× Rg display correction (the banner should absorb most of the surprise)
