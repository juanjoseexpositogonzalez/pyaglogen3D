# Tasks: cc-tunable-bc-alignment

> SDD Cycle 3 sub-cycle 2 of 2 (PYA-17). Specs: `specs/cc-tunable-aggregation.md` (R29.1–R29.4, R27.5 note MODIFIED). Design D1–D6: `design.md`. Evidence base: obs #9190, docs/box_counting_comparison.md.

## Tasks

| ID | Specs | Route | Commit |
|---|---|---|---|
| T0 | S(scaffold) | Branch `feature/cc-tunable-bc-alignment` (chained off 3.1) + change folder commit | this |
| T1 | D1, D2, design §Phase 0 | Diagnostic `engine/examples/diagnostics/bc_window_alignment_audit.rs` (with its TOML registration stanza in `engine/Cargo.toml`, same pattern as sibling diagnostics): legacy vs candidate windows on Df∈{1.5,2.0,2.5,2.7,2.9}×N∈{100,500,2000}×3 seeds; log2 cross-check; byte-identity assertion of default path after D5 cleanup | 2 |
| T2 | D1, D4 | Lock `(s*, e*)` + R27.5/R29.4 tolerance from T1 evidence into design.md Log | 2 |
| T3 | R29.1, D5 | `morton_core` refactor: default path byte-identical, dead-variable cleanup, windowed path + validation errors; unit tests (hand-computed, bounds) | 3 |
| T4 | R29.3 | Python bindings `box_counting_3d` / `box_counting_agglomerate` optional `fit_window=None` | 3 |
| T5 | R29.2, R29.4 | Integration tests: windowed semantics on fixtures; ±0.20 opt-in test at diagnostic-proven N (or documented band if unreachable) | 4 |
| T6 | R29.1, R29.3 | Full suite non-regression (engine + bindings); all existing tolerance bodies untouched | 4 |
| T7 | R27.5-M, docs | CHANGELOG + doc-comments + `docs/box_counting_comparison.md` alignment note + canonical sync prep | 5 |

## Log

- L1 (2026-10-18): Change opened after sub-cycle 1 closed documentation-only (user decision, design Log L2 of `cc-tunable-rg-fit-fix`): BC alignment is the remaining fixable estimator bias. Scope locked by proposal + design D1–D6.
