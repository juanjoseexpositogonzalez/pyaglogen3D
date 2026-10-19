# Tasks: batch-windowed-box-counting

> Specs: `specs/batch-box-counting.md` (R1–R9). Design D1–D8: `design.md`. Pendiente: spec-review → approval.md → apply.

## Tasks

| ID | Specs | Route | Commit |
|---|---|---|---|
| T0 | S(scaffold) | Rama `feature/batch-windowed-box-counting` (desde develop) + change folder | this |
| T1 | R1.1-R1.3, D6 | Serializer `windowed` bool + **rechazo de claves desconocidas (B3)** + **precedencia y `save()` preservando el flag en `views.py:2160-2164` (B2)** + `force` (M5); tests: no-op ausente, 400s, precedencia, re-run/backfill | 2 |
| T1b | D1, R9 | Engine: campo aditivo `effective_levels: usize` en `BoxCountingResult3D` (ambos paths, computado ANTES de la truncation 4b) + espejo `PyFractalResult` (2D → 0) + unit tests: caso normal Y fixture `eff > 6` con plateau que fuerza la truncation 4b (R9.1 acceptance: el campo reporta el conteo PRE-truncation) | 2 |
| T2 | R2.1-R2.3, D2-D4, D6 | Dual-run en view sync path + task `run_box_counting_if_configured`; derivación `(s,e)` desde `effective_levels` (hand-computed tests); fixtures eff=3 (status ok ≡ legacy) y eff<3 (insufficient_levels) | 2 |
| T3 | R3.1-R3.2, D5 | Frontera 30/31 sobre el **work set** (`geometry__isnull=False`, M8) + Celery async con **`AsyncResult`/`update_state` (B1/M1, payload canónico + failed)** + endpoint status — URL `path(".../run-box-counting/<str:task_id>/", ..., name="project-studies-bc-job-status")`; contract tests lifecycle y geometry-less | 3 |
| T4 | R4 | `results` con bloque windowed + `bc_delta` (sin alias `rg_df`, M4); test filas mixtas | 3 |
| T5 | R5 | Endpoint `GET .../fractal-analysis/` — URL `path(".../fractal-analysis/", ..., name="project-studies-fractal-analysis")` — (stats + valores crudos, bucketing client-side); test hand-computed R5.1 | 3 |
| T6 | R6 | CSV con **header gate a nivel study (B5)** + columnas `BC_Win_*` (incl. StdError/Time_ms, m3); test study legacy-only byte-idéntico y study mixto | 3 |
| T7 | R7 | Frontend: api client + `StudyFractalAnalysisSummary` (m4) + FractalAnalysisTab (tabla/distribuciones con herencia real: n=0→R4 no-data, 1≤n<5→"Not enough data", n≥5→single-bar) + vitest (R7.1, R7.2) | 4 |
| T7b | R8 | Backend single-sim GET `windowed` query param (pytest, R8.1 byte-idéntico sin flag) — commit separado del frontend | 4 |
| T8 | todas | Suite completa backend (pytest/ruff/mypy) + frontend (vitest/lint/type-check) + Log de evidencia | 4 |

## Log

- L1 (2026-10-18): Requisito cerrado con la persona: ambos batches, endpoint+UI; P1/P2/P3 lockeadas. Anclaje: Engram `batch-fractal/exploration`.
- L2 (2026-10-18): Spec-review delegada r1 (task mvez5qdn-9-unqz): NECESITA CORRECCIÓN. Corrección r1 (commit 22922fe):
  - B1 job state vía `AsyncResult` (payload canónico); B2 precedencia + preservación del flag en el save(); B3 rechazo de claves como comportamiento NUEVO documentado; B4 clamp con manejo de negativos + R2.2 en eff<3; B5 header gate a nivel study para CSV; B6 campo aditivo `effective_levels` (enmienda D1 — la ventana no es derivable del legacy truncado).
  - M1 payload canónico del job; M2 shape completa de R5 + bucketing client-side; M3 herencia de comportamientos de distribuciones; M4 sin alias `rg_df`; M5 `force` re-run; M6 paridad de claves + call sites clasificados (D8); M7 single-sim R8; M8 work set de la frontera.
  - m1 propuesta alineada a `windowed`; m2 crossref D2; m3 columnas BC_Win_StdError/Time_ms; m4 `StudyFractalAnalysisSummary`; m5 numeración propia de la capability nueva (registrar en archive); m6 sin bloque MODIFIED en csv-export-locale (header gate hace cierta la byte-equivalence); m7 T1 es dueño del parsing del POST; m8 path de types corregido.
- L3 (2026-10-18): Spec-review r2 (task mvezptvj-a-kxc5): correcciones r1 VERIFICADAS (B1-B6 hold; eff=3≡legacy es demostrable, no empírico). 4 contradicciones nuevas + bajas → corrección r2: Out-of-Scope del proposal ya no prohíbe el campo D1; `force` aceptado en el body y nunca persistido; R7.2 reescrito con los umbrales reales del componente (n=0→R4, 1≤n<5→"Not enough data", n≥5→R5 single-bar); D4 con `status: "error"` (nunca aborta el run, contador separado en R5); R1.3 condicionado a sims sin bloque legacy o `force`; persistencia de `windowed:false` explícito definida; R5 `config` anclado a `sim.parameters`; URL names en T3/T5; R8 separado a T7b (backend, pytest); 2D `effective_levels=0` (R9); guard `eff<3` sin llamar al estimador; helper `build_bc_block` normado (paridad por código); R9 añade el requisito del campo del engine; header de tasks R1–R9/D1–D8; proposal alineado a 6 columnas CSV.

- L4 (2026-10-18): Spec-review r3 (task mvf0jncf-b-86n0): sin ALTA/BLOCKER; 1 MEDIA + 11 BAJA. Corrección en DOS commits — lección registrada: la primera tanda de edits (570ca16) falló parcialmente en R2/R2.2/R2.3 y design.md, pero su mensaje y este Log los daban por aplicados; la confirmación dirigida (task mvf1fc7j-c-opxe) lo detectó y r3b completa los faltantes:
  - Aplicado en 570ca16: R4 bc_delta solo con status ok; R8 solo `windowed=true` + referencia al schema de R2; heading "Out of scope call sites" restaurado; fixture plateau en R9.1/T1b; anclas R5 (2010-2011/2065), R7 (MIN_N_SUCCESSFUL 97/241), R2.3 no aplicado (completado en r3b); R1.2 reescrito (con línea duplicada residual); Log L3 itemizado.
  - Completado en r3b (este commit): R2 reescrito con la schema única de 11 claves (`error_message` incluido, nulls cuando status≠ok) — la MEDIA real; R2.2 "claves presentes, valores null"; R2.3 contador `skipped` (no `processed`); design D3/D4 espejan la schema; R1.2 línea duplicada eliminada; R5.1 path corregido (`fractal_analysis/services/batch.py`, no `simulations/`); R1 reconciliado (rechazo aplica a body y persisted vía el validador compartido).

## Pendiente de approval

 approval.md se crea cuando la persona otorga el gate (tras r3 sin MEDIA/ALTA).
