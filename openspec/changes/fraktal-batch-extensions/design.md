# Design: fraktal-batch-extensions

> Persona-locked 2026-10-19: C1 reencaminada (una sim por batch), C2 overlay con bins explícitos,
> C3 persistencia in-place. Delta: `specs/fraktal-batch.md`. Spec-review r1: mvf21s3n-f-ztnz
> (B1-B4/M1-M6/m1-m5 — todos resueltos en esta revisión del contrato).

## Decision Summary (LOCKED)

| # | Decisión | Elección |
|---|---|---|
| D1 | C1 fuente | Comparativa batch vs SU sim enlazada (una por batch, `FraktalBatch.sim_id`); sim Df = `metrics["fractal_dimension"]` (`views.py:1132`); sentinela 0.0 = métrica ausente (r1 m4). |
| D2 | C1 builders | UN helper compartido `_build_study_comparison(batch)` consumido por los TRES builders (`_build_batch_response` :531, `_serialize_batch_from_db` :840, inline de `batch_detail_view` :1084-1096) — r1 B2. |
| D3 | C1 población | `image_df` inclusiva (converged + approximate, no-null) con breakdown por calidad (r1 M1); sin porcentaje de tolerancia (Fase 0: no hay tolerancia 2D-vs-3D con evidencia) — se entrega `deltas` por imagen y `mean_delta`. |
| D4 | C1 nota | `show_sorensen_note` boolean (renombrada de `sorensen_note` por colisión con la clave string de R11 — r1 M5). |
| D5 | C3 persistencia | **Modo in-place NUEVO y especificado** (r1 B3): servicio `reanalyze_failed_images(batch)` que re-corre la rutina de análisis por imagen existente sobre las fallidas, borra/reinserta bajo la MISMA clave `(batch, index)` y recalcula agregados del batch sobre el set COMPLETO. Sin `FraktalBatch` nuevo; sin `bulk_create` de subset sobre agregados viejos. |
| D6 | C3 async | ≤30 fallidas sync; >30 wrapper Celery fino del mismo servicio, payload canónico `202 {job_id, status: "queued"}` + endpoint de status existente (r1 B4). |
| D7 | C3 calibración | Campo nullable `pixels_per_100nm` en `FraktalBatchImage` (migración aditiva) poblado en cada análisis; re-análisis usa el escala persistida si existe, si no la del batch, con `calibration_source` registrado (r1 M6). Limitación legacy documentada. |
| D8 | C2 render | Overlay en el MISMO histograma con `xbins` explícito calculado de la UNIÓN de ambas series (reemplaza el `nbinsx` único derivado de imágenes — r1 M4); gates por serie: imágenes per-metric gate existente; sim: n≥5 render, 1≤n<5 chip "Not enough data", n=0 oculto; gate global solo si ambas series vacías. Datos vía `sim_df_values` aditivo en el mismo payload (mismos tres builders). |
| D9 | C3 ruta | `projects/<project_pk>/fraktal/batches/<pk>/reanalyze-failed/` con `IsProjectOwnerOrShared` (r1 m1 — familia project-nested canónica). |
| D10 | Engine | Cero cambios en `aglogen_core/` (el 2D box counting no se toca). |
| D11 | Payloads | Todo aditivo salvo la migración nullable de D7; CSV sin cambios. Sin `per_config` (una sim por batch — r1 M2; la multi-config vive en el tab del Change A). |

## Non-Regression Matrix

| Superficie | Garantía | Test |
|---|---|---|
| Resumen batch existente | Claves previas intactas, 3 builders consistentes (R12.1) | Contract test payload mixto + triple-builder equality |
| Batch sin sim/métrica | `study_comparison: null` (R12.2) | R12.2 |
| Re-análisis | Mismo batch, mismas filas-índice, agregados full-set (R13.1) | Task/service test con fixture mixto |
| Calibración | Escala persistida usada; fallback documentado | Unit con/sin `pixels_per_100nm` |
| Distribuciones | Series independientes + bins unión (R-DELTA-C2.1) | Vitest con sim sparse (3 valores) |
| CSV | Sin cambios | Suite existente |

## Test Plan Sketch
1. Contract: helper único contra los 3 builders (igualdad de `study_comparison`), con links, sin sim, sentinela 0.0.
2. C3: boundary 30/31, 400 `no_failed_images`, in-place (filas/índices preservados), agregados full-set, subset-exclusivity (passing nunca re-encolada), calibración persistida vs fallback.
3. C2: overlay sparse (3 sims), bins unión, chips por serie, gate global bilateral.
4. Suite: pytest backend + vitest frontend completos.
