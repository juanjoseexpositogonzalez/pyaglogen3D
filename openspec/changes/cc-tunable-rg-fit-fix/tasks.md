# Tasks: cc-tunable-rg-fit-fix

> SDD Cycle 3 sub-cycle 1 of 2 (PYA-17). Specs: `specs/cc-tunable-aggregation.md` (R28.1–R28.5, R27.4 MODIFIED). Design decisions D1–D5: `design.md`.

## Tasks

| ID | Specs | Route | Commit |
|---|---|---|---|
| T0 | S(scaffold) | Feature branch `feature/cc-tunable-rg-fit-fix` off main + this change folder committed as work unit 1 | — |
| T1 | D5, design §Test Plan 1 | Phase 0 diagnostic example `engine/examples/diagnostics/rg_fit_variants_audit.rs` (unweighted vs N-weighted vs tail-restricted, Df∈{2.5,2.7,2.9}×N∈{100,500}×3 seeds, no-clamp check) | 2 |
| T2 | design D1 | Lock formula from T1 evidence: N-weighted primary confirmed or tail-restricted fallback; record verdict in design.md Log | 2 |
| T3 | R28.5, design §New flow | `weighted_linear_regression` helper + unit tests (hand-computed values, degenerate cases) + `read_rg_fit_weighted_flag()` (FLAG REGISTRY entry, doc-comment pattern :76-90) | 3 |
| T4 | R28.1, R27.4-M | Wire weighted path into `calculate_fractal_dimension_from_evolution` behind flag; extend `high_df_convergence_band` kf≥1.0 to Df=2.9 | 3 |
| T5 | R28.4 | Coordinates byte-identical ON vs OFF test (serialized coords + merge_trace geometry equality) | 4 |
| T6 | R28.3 | Flag OFF metrics ≡ pre-change (1e-10 rel) test, Df_target ∈ {1.5, 2.0, 2.9} | 4 |
| T7 | R28.2 | Full suite non-regression run (`cargo test -p aglogen-engine --release`); existing tolerance bodies untouched | 5 |
| T8 | docs | CHANGELOG entry + doc-comment on `calculate_fractal_dimension_from_evolution` + `docs/cc-tunable-formula-fix.md` note; update canonical R27.5 note reference (Cycle 3 sub-cycle 1 complete) | 5 |

## Log

- L1 (2026-10-18): "Sí, vamos a arrancar con eso PYA-17 y actualiza el Jira si puedes" — original request. Decision locked by user: split Cycle 3 into two SDD changes, Rg-fit first (option "Split: Rg-fit primero, BC después"). Exploration evidence: Engram obs #9190.
