# Tasks: fraktal-batch-extensions

> Specs (3 deltas): `specs/fraktal-batch-contract.md` (R12, R13), `specs/fraktal-batch-persistence.md`
> (MODIFIED R2), `specs/fraktal-batch-distributions.md` (MODIFIED R2/R5/R-DELTA-M + ADDED R-DELTA-C2).
> Design D1-D12: `design.md`. Pendiente: spec-review r3 → approval.md → apply.
> Provenance: contract commits (1c1bef7, d9b2e79, +this) viven en `feature/batch-windowed-box-counting`
> (misma sesión de trabajo); al aplicar, T0 crea `feature/fraktal-batch-extensions` desde develop y
> la rama de applyporta los cambios de contrato (o el apply va sobre esta rama tras el merge de A).

## Tasks

| ID | Specs | Route | Commit |
|---|---|---|---|
| T0 | S(scaffold) | Rama `feature/fraktal-batch-extensions` desde develop al aplicar (provenance arriba) + este change folder | this |
| T1 | R12, D1-D4 | Backend: helper puro `_build_study_comparison(sim_id, image_rows)` consumido por los 3 builders; contract tests R12.1 (población converged/approximate con df_estimate), R12.2 (edges D3: sin sim, sim borrada, sentinela 0.0, cero contribuyentes) + triple-builder equality | 2 |
| T2 | R13, persistence-MOD-R2, D5-D8, D10 | Backend: migración nullable `pixels_per_100nm` (ÚNICA tarea con la migración) + servicio `reanalyze_failed_images` (UPDATE por pk, campos preservados, agregados full-set R7/ddof=0, prohibido subset→persist_batch_results) + ruta project-nested con permiso explícito (403) + boundary ≤30 sync (200) / >30 wrapper Celery (202 canónico) + 400 `no_failed_images`; tests R13.1/R13.2 + PNG hash-equal + subset-exclusivity + calibración | 3 |
| T3 | R-DELTA-C2, D9 | Backend: `sim_df_value` escalar aditivo (null con la MISMA regla de ausencia que R12 — sentinela 0.0 incluida, r3 minor 6) vía el helper de T1; test exclusión en los 4 casos de ausencia | 3 |
| T4 | R12 | Frontend: `BatchStudyComparisonCard` NUEVA en SummaryPage (no reutiliza `FraktalComparisonCard` — requiere `comparison` no-opcional y carece de image_df/sim_df/Δ, r1 m3) con nota Sorensen, oculta si null + vitest | 4 |
| T5 | R-DELTA-C2 | Frontend: marcador de referencia en FraktalBatchDistributions (línea vertical + chip `Sim Df: X.XX` + hover con target + toggle default ON; sin tocar bins/gates/tooltips canónicos) + prop `sim_df_value` desde `src/lib/api.ts` + vitest (R-DELTA-C2.1 visible, R-DELTA-C2.2 oculto en los 4 casos) | 4 |
| T6 | R13 | Frontend: botón re-análisis masivo con progreso (ResultsView/SummaryPage) + método en `src/lib/api.ts` + vitest | 4 |
| T7 | todas | Suite completa backend (pytest/ruff) + frontend (vitest/lint/type-check) + Log de evidencia | 5 |

## Log

- L1 (2026-10-19): Persona eligió C1+C2+C3. Contrato v0 (1c1bef7).
- L2 (2026-10-19): Spec-review r1 (mvf21s3n-f-ztnz): NECESITA CORRECCIÓN — B1-B4/M1-M6/m1-m5 → corrección r1 (d9b2e79):
  - B1 C1 reencaminada por la persona (una sim por batch; per_config eliminado; FK imagen→sim fuera de alcance). B2 helper único para los 3 builders. B3 modo in-place especificado (el task existente no soporta subset). B4 payload canónico 202. M1 población de image_df. M2 muere con B1. M3 sim_df_values en el payload real. M4 bins unión + gates por serie. M5 show_sorensen_note. M6 migración pixels_per_100nm. m1 ruta project-nested. m2 frase cuartiles eliminada. m3 targets concretos. m4 sentinela 0.0. m5 T0 provenance.
- L3 (2026-10-19): Spec-review r2 (mvf2hiqs-g-x5jy): correcciones r1 verificadas (B3/B4/M5/m2/m4 y ruta OK); 2 BLOCKER + 4 MAJOR + minors → corrección r2 (este commit):
  - BLOCKER-1: población de R12 fijada por R7 canónica (approximate → df_estimate; fractal_dimension=null en approximate — R12.1 era inalcanzable tal cual).
  - BLOCKER-2: delta de persistence añadida (MODIFIED R2: columna nullable, dos fuentes, sin backfill, reversible) — el archive ya no dejará canonical contradiciendo código.
  - MAJOR: helper con primitivas (builder 1 corre antes de existir la fila); recompute full-set con poblaciones R7/ddof=0 y prohibición explícita de subset→persist_batch_results; MODIFIED R2/R5/R-DELTA-M con excepción overlay-activa + permiso exigible (has_object_permission explícito, 403).
  - minors: sync 200 con summary; 400 body `{"detail", "code"}`; UPDATE por pk con campos preservados (PNG immutable, variant, dpo=batch, autocalibrate=false); calibration_source batch-level sin cambios; caso mixto de gates por serie; k=Sturges sobre unión; edges R12 (sin contribuyentes, mean_delta null, sim borrada); T6 → src/lib/api.ts; migración solo en T2; T0 provenance documentado.

- L4 (2026-10-19): Spec-review r3 (task mvf2v5g3-h-bod9): 2 BLOCKER + 4 MAJOR + minors → corrección r3:
  - BLOCKER-1: C2 reencaminada a MARCADOR de referencia (una sim por batch ⇒ `sim_df_value` escalar, `n_sim ≤ 1`: overlay/gates/escenarios de unión inalcanzables). Distributions delta = SOLO ADDED R-DELTA-C2 (marcador); MODIFIED R2/R5/R-DELTA-M eliminados — los canónicos quedan intactos y la Out-of-Scope vuelve a ser cierta.
  - BLOCKER-2: MODIFIED R2 de persistence RESTATEADO COMPLETO por script (R2 canónico verbatim: enumeración exhaustiva + AND-clauses + scenarios 2.1-2.8 + cláusula nueva de uso en re-análisis + `pixels_per_100nm` en la lista de `(Previously:)` + scenario 2.9) — el archive ya no puede dejar canonical contradiciendo código.
  - MAJOR-3: UPDATE list += `df_estimate`, `bisection_iterations`, `bisection_residual`, `failure_reason` (stale `df_estimate` en `mean_df_inclusive`). MAJOR-4: agregados fijados a EXACTAMENTE los campos que escribe `persist_batch_results` (lista completa) sobre el set completo. MAJOR-5: proposal Out-of-Scope + filas C1/C2 reescritas (las únicas excepciones nombradas). MAJOR-6: regla de sentinela `0.0` idéntica en R12, R-DELTA-C2 y D1.
  - minors: anclas corregidas (`services/batch.py:264`, canonical contract `:178`); T3 → D9 con sentinela; persistence header honesto (restatement, no "espeja R-DELTA"); `images_without_df` definida e `image_df.n == images_with_df`; gate global restated (component-global); tooltip del marcador propio (R-DELTA-M canónico intacto).
