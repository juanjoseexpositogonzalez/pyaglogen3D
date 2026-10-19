# Design: fraktal-batch-extensions

> Persona-locked 2026-10-19: C1 reencaminada (una sim por batch), C2 = marcador de referencia
> (SOLO ADDED R-DELTA-C2, sin MODIFIED de distributions), C3 in-place por UPDATE. Deltas:
> `specs/fraktal-batch-contract.md`, `specs/fraktal-batch-persistence.md` (MODIFIED R2 completo),
> `specs/fraktal-batch-distributions.md`.
> Reviews: r1 (mvf21s3n-f-ztnz) → r2 (mvf2hiqs-g-x5jy) → r3 (mvf2v5g3-h-bod9) → r4
> (mvf3tlz3-j-z97z) → r5 (mvf3dtqr-i-7rrr) — correcciones aplicadas por ronda, itemizadas en
> tasks.md Log L2-L6.

## Decision Summary (LOCKED)

| # | Decisión | Elección |
|---|---|---|
| D1 | C1 población (r2 BLOCKER-1) | Valor de Df por imagen: `fractal_dimension` si `quality=="converged"`, `df_estimate` si `quality=="approximate"` (canonical R7; approximate lleva `fractal_dimension=null`). `image_df` stats sobre los contribuyentes con breakdown por calidad. **Regla de ausencia de la sim (idéntica en R12, R-DELTA-C2 y este D-row, r3 minor 6):** sim ausente, fila borrada, métrica ausente o sentinela `0.0` → sin valor. |
| D2 | C1 helper (r2 MAJOR) | `_build_study_comparison(sim_id, image_rows)` **pura, con primitivas** — builder 1 corre ANTES de que exista la fila de batch (`views.py:666→672`, `tasks.py:718→740`), así que NO recibe un `FraktalBatch`. Builders 2/3 ya producen `image_rows`; builder 1 tiene `images_out`. |
| D3 | C1 null-safety (r2 minor) | Bloque `null` si: sin sim, sim borrada, métrica ausente/sentinela 0.0, o cero contribuyentes. `mean_delta: null` si `deltas` vacío. `target_df` de `sim.parameters` si existe. |
| D4 | C1 nota + reemplazo de tarjeta (r4 MAJOR-3) | `show_sorensen_note` boolean (sin colisión con la clave string de R11 — r1 M5). En SummaryPage, `BatchStudyComparisonCard` REEMPLAZA a `FraktalComparisonCard` (que hoy pinta el mismo Df de la sim SIN la regla de sentinela): una sola tarjeta y la nota R11 EXACTAMENTE UNA vez; drill-downs conservan la legacy (fuera de alcance). |
| D5 | C3 persistencia (r2 MAJOR) | **UPDATE por pk** de cada fila fallida (no delete/reinsert): campos de análisis nuevos + `quality` + `pixels_per_100nm`; **preservados intactos** `png_bytes`, `png_scientific_bytes` (sin re-rasterización — endpoint immutable + hash-equality canónica), `analysis_input_variant` (reutilizado), `filename/azimuth/elevation/index`. Inputs: `dpo = batch.dpo_used`, `autocalibrate_dpo = false`. |
| D6 | C3 agregados (r2 MAJOR / r4-r5 MAJOR-1, r6 MAJOR) | Recompute sobre el set COMPLETO. Persistidos: EXACTAMENTE los 7 de `persist_batch_results` (`n_images, n_successful, mean_df, std_df, median_df, min_df, max_df`; `batch.py:519-520,537-546`). Read-derived: `q1_df, q3_df` los emite SOLO el builder 1 (`compute_batch_statistics`, `batch.py:293-341`, percentiles `:339-340`) — `compute_metric_stats` NO tiene cuartiles (r6 MAJOR: `batch.py:346-371` solo mean/std/median/min/max); NO se persisten, NO los emiten los builders 2/3 (`views.py:895-908`, `:1055-1071`), NO los escribe ni recalcula el servicio (el 200 sync NO lleva cuartiles). `mean_df_inclusive` se computa en lectura (`views.py:889-892`, `:1050-1052`). Poblaciones R7, `ddof=0`; `n_successful` = no-null `fractal_dimension` (semántica persist; el `n_successful` del histograma Df, converged+approximate, es OTRA cantidad y no se toca). PROHIBIDO subset→`persist_batch_results` (machaca `n_images`, `batch.py:519`). |
| D7 | C3 async | ≤30 sync (200 con summary actualizado); >30 wrapper Celery fino, `202 {job_id, status: "queued"}` canónico + `fraktal_status_view` reutilizable (wrapper reporta `{"batch_id": …}` como `tasks.py:770-775`). 400 `{"detail": …, "code": "no_failed_images"}`. |
| D8 | C3 calibración (r2 minor) | Campo nullable `pixels_per_100nm` en `FraktalBatchImage` (migración aditiva reversible, sin backfill); re-análisis usa el valor persistido si existe, si no la escala del batch. `calibration_source` queda a NIVEL BATCH y SIN CAMBIOS — la procedencia por imagen solo es observable vía el campo nuevo. |
| D9 | C2 render (r3 BLOCKER-1 → marcador; r4 MAJOR-2 fuente única) | Con UNA sim por batch, el Df de la sim es un ESCALAR — C2 = **marcador de referencia**: línea vertical discontinua en `x = study_comparison.sim_df.value` (FUENTE ÚNICA — sin clave top-level duplicada; target del hover = `sim_df.target_df`), chip `Sim Df: {value}`, toggle local del componente default ON sin persistencia, oculto si `study_comparison` null (misma regla de ausencia que R12, sentinela 0.0 incluida) o si el panel está en no-data / "Not enough data" (`n_successful < 5`). SIN MODIFIED de R2/R5/R-DELTA-M — binning/gates/tooltips canónicos intactos. |
| D10 | C3 ruta/permiso (r2 MAJOR) | `projects/<project_pk>/fraktal/batches/<pk>/reanalyze-failed/`; el decorator solo NO alcanza (`IsProjectOwnerOrShared` no implementa `has_permission`, y la familia es function views con `IsAuthenticated`): la vista hace fetch del `Project` y llama `IsProjectOwnerOrShared().has_object_permission(request, None, project)` explícitamente; no-compartido autenticado → 403. |
| D11 | Engine | Cero cambios en `aglogen_core/`. |
| D12 | Alcance de specs (r3) | Aditivo salvo la migración nullable (MODIFIED R2 de persistence, **restatement completo** — regla de archive del repo). Distributions: SOLO ADDED R-DELTA-C2 (marcador) — sin MODIFIED de R2/R5/R-DELTA-M; fuera del marcador, los requisitos canónicos se aplican sin cambios. |

## Non-Regression Matrix

| Superficie | Garantía | Test |
|---|---|---|
| Resumen batch existente | Claves previas intactas; 3 builders consistentes (R12.1) | Contract test mixto + triple-builder equality |
| Batch sin sim/métrica/vacíos | `study_comparison: null` (R12.2, D3) | R12.2 + edges |
| Re-análisis | UPDATE por pk, PNG hash-equal, `n_images` constante, agregados R7 full-set (R13.1) | Service/task test fixture mixto |
| Permisos | 403 no-compartido autenticado (D10) | Contract test |
| Distribuciones | Marcador sin tocar R2/R5/R-DELTA-M (R-DELTA-C2.1/C2.2) | Vitest marcador visible/oculto + histograma idéntico al pre-change con marcador OFF |
| CSV | Sin cambios | Suite existente |

## Test Plan Sketch
1. Contract: helper puro contra los 3 builders; población converged/approximate (df_estimate); sentinela 0.0; edges D3.
2. C3: boundary 30/31, 200/202/400/403, UPDATE preserva PNG bytes y variant, agregados R7 full-set, subset-exclusivity, calibración persistida vs fallback.
3. C2: marcador visible sobre histograma normal (R-DELTA-C2.1), oculto en los 4 casos de ausencia (R-DELTA-C2.2), toggle OFF = canónico.
4. Suite: pytest backend + vitest frontend completos.
