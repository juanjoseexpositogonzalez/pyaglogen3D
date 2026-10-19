# Tasks: batch-windowed-box-counting

> Specs: `specs/batch-box-counting.md` (R1–R7). Design D1–D7: `design.md`. Pendiente: spec-review → approval.md → apply.

## Tasks

| ID | Specs | Route | Commit |
|---|---|---|---|
| T0 | S(scaffold) | Rama `feature/batch-windowed-box-counting` (desde develop) + change folder | this |
| T1 | R1.1-R1.3, D6 | Serializer `windowed` bool + **rechazo de claves desconocidas (B3)** + **precedencia y `save()` preservando el flag en `views.py:2160-2164` (B2)** + `force` (M5); tests: no-op ausente, 400s, precedencia, re-run/backfill | 2 |
| T1b | D1 | Engine: campo aditivo `effective_levels: usize` en `BoxCountingResult3D` (ambos paths, computado ANTES de la truncation 4b) + espejo `PyFractalResult` + unit test | 2 |
| T2 | R2.1-R2.3, D2-D4, D6 | Dual-run en view sync path + task `run_box_counting_if_configured`; derivación `(s,e)` desde `effective_levels` (hand-computed tests); fixtures eff=3 (status ok ≡ legacy) y eff<3 (insufficient_levels) | 2 |
| T3 | R3.1-R3.2, D5 | Frontera 30/31 sobre el **work set** (`geometry__isnull=False`, M8) + Celery async con **`AsyncResult`/`update_state` (B1/M1, payload canónico + failed)** + endpoint status; contract tests lifecycle y geometry-less | 3 |
| T4 | R4 | `results` con bloque windowed + `bc_delta` (sin alias `rg_df`, M4); test filas mixtas | 3 |
| T5 | R5 | Endpoint `GET .../fractal-analysis/` (stats + valores crudos, bucketing client-side); test hand-computed R5.1 | 3 |
| T6 | R6 | CSV con **header gate a nivel study (B5)** + columnas `BC_Win_*` (incl. StdError/Time_ms, m3); test study legacy-only byte-idéntico y study mixto | 3 |
| T7 | R7, R8 | Frontend: api client + `StudyFractalAnalysisSummary` (m4) + FractalAnalysisTab (tabla/distribuciones heredando R4-R5 de distributions/export) + vitest (R7.1, R7.2); single-sim GET `windowed` query param (R8.1) | 4 |
| T8 | todas | Suite completa backend (pytest/ruff/mypy) + frontend (vitest/lint/type-check) + Log de evidencia | 4 |

## Log

- L1 (2026-10-18): Requisito cerrado con la persona: ambos batches, endpoint+UI; P1/P2/P3 lockeadas. Anclaje: Engram `batch-fractal/exploration`.
- L2 (2026-10-18): Spec-review delegada (task mvez5qdn-9-unqz): NECESITA CORRECCIÓN — B1-B6, M1-M8, m1-m8. Corrección r1 aplicada: job state vía `AsyncResult` (B1), precedencia + preservación del flag (B2), rechazo de claves como comportamiento NUEVO documentado (B3), clamp con manejo de negativos y R2.2 en eff<3 (B4), header gate a nivel study para CSV (B5), campo aditivo `effective_levels` en el engine resolviendo la no-derivabilidad de la ventana (B6 — enmienda a D1), payload canónico del job (M1), shape completa de R5 (M2), herencia de comportamientos de distribuciones (M3), sin alias `rg_df` (M4), `force` re-run (M5), paridad de claves + call sites clasificados (M6/D8), single-sim R8 (M7), work set para la frontera (M8), y los minors m1-m8.
