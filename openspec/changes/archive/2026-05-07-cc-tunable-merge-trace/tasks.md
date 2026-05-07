# Tasks: cc-tunable-merge-trace (Cycle 14 / PYA-14 Phase 1)

## Phase P1 — Engine: MergeTraceEntry struct + populate in main loop

- [x] T1.1 — Define `MergeTraceEntry` struct in `aglogen_core/engine/src/simulation/result.rs` (or sibling `merge_trace.rs`) with all 10 fields per spec R16. Derive `Debug, Clone, Serialize`.
- [x] T1.2 — Add `pub merge_trace: Vec<MergeTraceEntry>` field to `SimulationResult`. Default `Vec::new()`. Update Default impl.
- [x] T1.3 — Update all OTHER algorithms that construct `SimulationResult` (ballistic, DLA, CCA, fracval, gcca, box_rfa, voxel) to either use Default or explicitly set `merge_trace: Vec::new()`. They emit empty traces.
- [x] T1.4 — Instrument `run_tunable_cc_internal` in `aglogen_core/engine/src/simulation/tunable_cc.rs`: build local `merge_trace: Vec<MergeTraceEntry>`, push entry after each successful tunable merge AND each ballistic fallback merge. Capture all 10 fields per spec. Move into `SimulationResult` at end.
- [x] T1.5 — Cargo tests in `tunable_cc.rs::tests`: trace length matches merge count for monomers seed (R16.1), tunable merges produce `merge_type=tunable, bounding_check_passed=true` (R16.2), ballistic fallback flagged correctly (R16.3), `actual_distance` within 10% of `required_distance` (R16.4), `rg_after`/`rg_target` populated (R16.5), retries reflect actual attempts (R16.9).
- [x] T1.6 — Cargo test in another algorithm's test module (e.g. `dla.rs::tests`): non-CC simulation produces empty `merge_trace` (R16.6).

## Phase P2 — Python binding: surface trace + maturin rebuild

- [x] T2.1 — In `aglogen_core/python/src/lib.rs::result_to_pydict` (or wherever `SimulationResult` is converted to Python), add `merge_trace` as a `PyList<PyDict>` with the 10 fields per spec. Each `MergeTraceEntry` becomes one dict.
- [x] T2.2 — Cargo test for the conversion (smoke test asserting dict structure).
- [x] T2.3 — Maturin rebuild into backend venv: `source backend/.venv/bin/activate && cd aglogen_core && PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1 maturin develop --release`. Verify with `python -c "import aglogen_core; help(aglogen_core.run_tunable_cc)"` showing the new field in the result.

## Phase P3 — Backend: persistence + drill-down

- [x] T3.1 — Verify `Simulation.metrics` JSONField persists `merge_trace` transparently. Added `merge_trace` extraction in `tasks.py::run_simulation_task` (line ~1722). 6 pytest tests covering model persistence, task wiring, and 10-field round-trip.
- [x] T3.2 — Verify `SimulationDetailView` returns `merge_trace` in the response. Confirmed: `metrics` is a JSONField exposed as-is by `SimulationSerializer`/`SimulationDetailSerializer` — no whitelist blocks inner keys. Tested via API round-trip.
- [x] T3.3 — Legacy backward compat: legacy `metrics` without `merge_trace` key serialises without error (200 OK). Also tested `metrics=None` (queued simulations).

## Phase P4 — Tests integration + docs + CHANGELOG

- [x] T4.1 — Cross-cutting integration test in `backend/tests/integration/test_merge_trace_pipeline.py`: run a CC tunable sim end-to-end (mock or real engine), fetch via API, assert trace structure correct (R16.7 + R16.8).
- [x] T4.2 — Documentation `docs/cc-tunable-merge-trace.md` (~50-80 lines): why (PYA-14 Phase 1), the 10 trace fields, how to consume programmatically, storage size note (~80 KB for N=1000), Phase 2 preview.
- [x] T4.3 — CHANGELOG entry under `cc-tunable-merge-trace (unreleased)`: Added trace, Changed `SimulationResult` shape (additive), Backward compat (legacy results emit `[]`), no Jira close (PYA-14 stays open for Phase 2).
