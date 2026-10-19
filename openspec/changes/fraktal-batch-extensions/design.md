# Design: fraktal-batch-extensions

> Persona-locked 2026-10-19: C1+C2+C3, sin estimator 2D. Delta: `specs/fraktal-batch.md`.

## Decision Summary (LOCKED)

| # | Decisión | Elección |
|---|---|---|
| D1 | C1 fuente de sim Df | `metrics["fractal_dimension"]` del sim enlazado (misma fuente que `sim_box_counting_df`, `fractal_analysis/views.py:1132`) — NO el bloque `box_counting` (separación de conceptos: Df de la simulación vs análisis BC puntual). |
| D2 | C1 agregación | Bloque único batch-level + `per_config` agrupado por `sim.parameters` (claves de `study.parameter_grid.keys()`, `views.py:2010-2011`). Stats con la misma familia de helpers del R7 (batch stats); sin percentiles en este bloque. |
| D3 | C1 null-safety | Bloque `null` cuando cero imágenes enlazadas; `missing_sim_metrics` cuenta sims sin métrica (excluidos de stats, nunca rompen el bloque). |
| D4 | C2 datos | Backend añade `sim_df_values: […]` aditivo al payload de distribuciones (exclusiones R3 canónicas); el bucketing sigue SIENDO client-side (`sturgesBuckets`). Overlay por serie con gates independientes (n≥5 single-bar; 1≤n<5 "Not enough data"; n=0 oculto). |
| D5 | C3 boundary | Espejo exacto de R4/R5 canónicos: ≤30 fallidas sync, >30 async con el payload canónico de job. Reusa `analyze_fraktal_batch_task` con subset de imágenes fallidas — sin task nueva si el subset es parametrizable; si el task actual no acepta subset, se añade parámetro opcional (aditivo). |
| D6 | C3 idempotencia | Solo `quality: "failed"` se re-encola; passing images jamás. Segunda invocación con 0 fallidas → 400 `no_failed_images`. |
| D7 | Engine | Cero cambios en `aglogen_core/` (el 2D box counting no se toca). |
| D8 | Payloads | Todo aditivo: consumidores que no lean las claves nuevas no ven diferencia. Sin cambios de CSV. |

## Non-Regression Matrix

| Superficie | Garantía | Test |
|---|---|---|
| Resumen batch existente | Claves previas intactas (R12.1) | Contract test payload mixto |
| Batch sin links | `study_comparison: null`, sin ruido | R12.2 |
| Distribuciones existentes | Sin `sim_df_values` vacío-array que rompa el render | Unit componente con toggle oculto |
| Task de análisis | Subset no re-analiza passing (D6) | Task test con fixture mixto |
| CSV | Sin cambios | Suite existente |

## Test Plan Sketch
1. Contract: payload summary con links mixtos (R12.1), sin links (R12.2).
2. C3: boundary 30/31 con fallidas, 400 sin fallidas, subset-exclusivity.
3. C2: componente con overlay sparse (R-DELTA-C2.1) y oculto sin datos.
4. Suite: pytest backend + vitest frontend completos.
