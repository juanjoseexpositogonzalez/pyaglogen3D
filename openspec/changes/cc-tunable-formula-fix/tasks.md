# Implementation Tasks — cc-tunable-formula-fix

## Phase 1 — Engine: corrected COM distance formula

- [x] T1.1 — Rewrite `calculate_com_distance` in `aglogen_core/engine/src/aggregation/tunable_cc.rs` with the derived formula: `d² = (n_po·rp²)/(n_po1·n_po2) · [n_po·(n_po/kf)^(2/Df) − n_po1·(n_po1/kf)^(2/Df) − n_po2·(n_po2/kf)^(2/Df)]` (file: `aglogen_core/engine/src/aggregation/tunable_cc.rs`)
- [x] T1.2 — Add cargo tests with analytic cases: PC equivalence (n_po2=1), asymmetric clusters (n_po1=2,n_po2=1), large symmetric (n_po1=n_po2=175), edge cases (d²≤0 returns None) (file: `aglogen_core/engine/src/aggregation/tunable_cc.rs`)
- [x] T1.3 — Document derivation + thesis-typo note in code comment citing cross-validation with PC case (file: `aglogen_core/engine/src/aggregation/tunable_cc.rs`)
- [x] T1.4 — Update existing cargo tests that asserted the old (buggy) formula; regenerate snapshots if needed (file: `aglogen_core/engine/tests/`)

## Phase 2 — Engine: two-rotation positioning + retry policy

- [x] T2.1 — Replace single-axis rotation with uniform spherical sampling (azimuth φ∈[0,2π), elevation θ=arcsin(U(−1,1))) for initial CoM direction in `position_clusters_for_contact` (file: `aglogen_core/engine/src/aggregation/tunable_cc.rs`)
- [x] T2.2 — Add `max_merge_retries` field (default 100) to `CcTunableConfig` / `TunableCcParams` struct (file: `aglogen_core/engine/src/aggregation/tunable_cc.rs`)
- [x] T2.3 — Refactor merge loop: retry with new pair on geometric failure, ballistic fallback only after exhaustion of retries (file: `aglogen_core/engine/src/aggregation/tunable_cc.rs`)
- [x] T2.4 — Track and log retry statistics in result metadata: `tunable_merges`, `ballistic_merges`, `max_retries_per_merge` (file: `aglogen_core/engine/src/aggregation/tunable_cc.rs`)
- [x] T2.5 — Cargo tests covered inline by T2.1-T2.4 commits: chi² isotropy (commit 66a119f), retry counter + ballistic fallback (commit 3d4559a). 213 engine tests passing (was 206 at P1 close, +7 new in P2).

## Phase 3 — Engine: seed types Monomers/Dimers/Trimers

- [ ] T3.1 — Add `SeedType` enum (Monomers, Dimers, Trimers); grep for `SeedStrategy::TunablePc` and remove if no external refs exist (file: `aglogen_core/engine/src/aggregation/tunable_cc.rs`)
- [ ] T3.2 — Implement Dimers initialization: N/2 touching pairs, leftover monomer if N is odd; inter-particle distance = 2·rp (file: `aglogen_core/engine/src/aggregation/tunable_cc.rs`)
- [ ] T3.3 — Implement Trimers initialization: N/3 linear triplets (3 collinear monomers at 2·rp spacing), leftover handling for N % 3 ≠ 0 (file: `aglogen_core/engine/src/aggregation/tunable_cc.rs`)
- [ ] T3.4 — Cargo tests: each seed type produces correct initial state, edge cases N=1, N=2, N=4, N=7 (file: `aglogen_core/engine/src/aggregation/tunable_cc.rs`)

## Phase 4 — Backend: API + serializer + migration

- [ ] T4.1 — Create migration `0011_add_seed_type_field.py` adding `seed_type CharField(max_length=16, default="monomers")` to Simulation model (file: `backend/apps/simulations/migrations/0011_add_seed_type_field.py`)
- [ ] T4.2 — Update `SimulationParameters` typed dict / serializer to accept `seed_type` with default "monomers" (file: `backend/apps/simulations/serializers.py`)
- [ ] T4.3 — API validation: restrict choices=["monomers", "dimers", "trimers"] in serializer (file: `backend/apps/simulations/serializers.py`)
- [ ] T4.4 — pytest: migration test, serializer test, API integration test for seed_type parameter (file: `backend/apps/simulations/tests/`)

## Phase 5 — Frontend: CC tunable form dropdown

- [ ] T5.1 — Add "Seed type" dropdown in CC tunable simulation form; grep form file location in `frontend/src/components/forms/` (file: `frontend/src/components/forms/SimulationForm.tsx`)
- [ ] T5.2 — Set default selection: Monomers; add tooltip explaining FZR origin (file: `frontend/src/components/forms/SimulationForm.tsx`)
- [ ] T5.3 — Send `seed_type` field in API call; vitest: form renders 3 options, default selected, payload includes field (file: `frontend/src/components/forms/SimulationForm.tsx`, `frontend/src/components/forms/__tests__/`)

## Phase 6 — Tests integration + docs + Jira PYA-10 close

- [ ] T6.1 — Cross-cutting integration test: 5 simulation runs with target=(Df=1.6, kf=1.7, N=350), seed_type=Monomers, assert |mean(Df)−1.6|/1.6 < 0.05 AND |mean(kf)−1.7|/1.7 < 0.10 (file: `aglogen_core/engine/tests/integration_cc_tunable.rs`)
- [ ] T6.2 — Documentation: `docs/cc-tunable-formula-fix.md` (~80-100 lines) covering formula derivation, bugs fixed, thesis-typo footnote, usage (file: `docs/cc-tunable-formula-fix.md`)
- [ ] T6.3 — CHANGELOG entry under `cc-tunable-formula-fix (unreleased)` describing fix, new seed types, convergence improvement (file: `CHANGELOG.md`)
- [ ] T6.4 — Close Jira PYA-10: transition to "Finalizada" with comment summarizing fix + commit range (file: N/A — Jira operation)