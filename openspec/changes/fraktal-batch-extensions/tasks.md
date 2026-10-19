# Tasks: fraktal-batch-extensions

> Specs: `specs/fraktal-batch.md` (R12, R13, R-DELTA-C2). Design D1-D8: `design.md`.
> Pendiente: spec-review → approval.md → apply. Persona eligió C1+C2+C3 (2026-10-19).

## Tasks

| ID | Specs | Route | Commit |
|---|---|---|---|
| T0 | S(scaffold) | Rama `feature/fraktal-batch-extensions` (desde develop) + este change folder | this |
| T1 | R12, D1-D3 | Backend: bloque `study_comparison` en `_build_batch_response`/`_serialize_batch_from_db` (aditivo, null-safe); contract tests R12.1/R12.2 | 2 |
| T2 | R13, D5, D6 | Backend: acción `reanalyze-failed` (boundary ≤30 sync / >30 async con payload canónico, subset solo fallidas, 400 `no_failed_images`); tests R13.1/R13.2 + task subset-exclusivity | 3 |
| T3 | R-DELTA-C2, D4 | Backend: `sim_df_values` aditivo en payload de distribuciones; test exclusión/exclusión-cero | 3 |
| T4 | R12 | Frontend: ComparisonCard a nivel batch en SummaryPage (con nota Sorensen, oculto si null) + vitest | 4 |
| T5 | R-DELTA-C2 | Frontend: overlay toggle en FraktalBatchDistributions (serie sim con gates independientes, tooltip por serie) + vitest (R-DELTA-C2.1) | 4 |
| T6 | R13 | Frontend: botón re-análisis masivo con progreso en ResultsView/SummaryPage + vitest | 4 |
| T7 | todas | Suite completa backend (pytest/ruff) + frontend (vitest/lint/type-check) + Log de evidencia | 5 |

## Log

- L1 (2026-10-19): Persona eligió C1+C2+C3 (los tres candidatos) junto al gate del Change A. Delta spec + design escritos sobre el anclaje de la exploración (Engram `batch-fractal/exploration`). Sin estimator 2D (lockeado).
