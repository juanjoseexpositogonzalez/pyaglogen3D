# Tasks: cc-tunable-rg-fit-fix

> SDD Cycle 3 sub-cycle 1 of 2 (PYA-17). RE-SCOPED by Log L2 (user decision 2026-10-18): documentation-only close-out, no estimator code change. Specs: `specs/cc-tunable-aggregation.md` (R27.4 deviation amendment). Evidence: design.md Log L1 (diagnostic), Engram obs #9195.

## Tasks

| ID | Specs | Route | Commit |
|---|---|---|---|
| T0 | S(scaffold) | Feature branch + change folder committed | `96301d6` |
| T1 | D5, design §Test Plan 1 | Phase 0 diagnostic `rg_fit_variants_audit.rs` ([[example]] stanza included) | `6e13c5f` |
| T2 | design D1 | Formula verdict from T1 evidence → D1 primary NOT confirmed, fallback NOT met; escalated to parent | `6e13c5f` |
| T3-T8 | R28.x | ~~Helper + flag + wiring + rollback tests + suite + docs~~ — DROPPED (Log L2: estimator change delivers no improvement; evidence in design.md Log L1) | — |
| T9 | R27.4-M (revised) | Documentation-only: canonical amendment (R27.4 keeps kf≥1.0 for Df≤2.7; Df=2.9 documented accepted deviation with diagnostic reference) + CHANGELOG entry + doc-comment pointer on `calculate_fractal_dimension_from_evolution` | this |
| T10 | — | Close change: archive per openspec convention; update state.yaml | — |

## Log

- L1 (2026-10-18): "Sí, vamos a arrancar con eso PYA-17 y actualiza el Jira si puedes" — original request. Decision locked by user: split Cycle 3 into two SDD changes, Rg-fit first (option "Split: Rg-fit primero, BC después"). Exploration evidence: Engram obs #9190.
- L2 (2026-10-18): After T2 verdict (no fit variant reaches kf≥1.0 at Df=2.9; deficit is R27-guard geometry, not fit methodology — design.md Log L1), user selected "Sin cambio: documentar y pasar a BC". Sub-cycle 1 re-scoped to documentation-only; T3-T8 dropped.
