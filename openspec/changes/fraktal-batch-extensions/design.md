# Design: fraktal-batch-extensions

> Persona-locked 2026-10-19: C1 reencaminada (una sim por batch), C2 overlay con MODIFIED R2/R5/
> R-DELTA-M, C3 in-place por UPDATE. Deltas: `specs/fraktal-batch-contract.md`,
> `specs/fraktal-batch-persistence.md`, `specs/fraktal-batch-distributions.md`.
> Reviews: r1 (mvf21s3n-f-ztnz, B1-B4/M1-M6/m1-m5) → r2 (mvf2hiqs-g-x5jy, 2 BLOCKER + 4 MAJOR +
> minors) resueltos aquí (r2).

## Decision Summary (LOCKED)

| # | Decisión | Elección |
|---|---|---|
| D1 | C1 población (r2 BLOCKER-1) | Valor de Df por imagen: `fractal_dimension` si `quality=="converged"`, `df_estimate` si `quality=="approximate"` (canonical R7; approximate lleva `fractal_dimension=null`). `image_df` stats sobre los contribuyentes con breakdown por calidad. **Regla de ausencia de la sim (idéntica en R12, R-DELTA-C2 y este D-row, r3 minor 6):** sim ausente, fila borrada, métrica ausente o sentinela `0.0` → sin valor. |
| D2 | C1 helper (r2 MAJOR) | `_build_study_comparison(sim_id, image_rows)` **pura, con primitivas** — builder 1 corre ANTES de que exista la fila de batch (`views.py:666→672`, `tasks.py:718→740`), así que NO recibe un `FraktalBatch`. Builders 2/3 ya producen `image_rows`; builder 1 tiene `images_out`. |
| D3 | C1 null-safety (r2 minor) | Bloque `null` si: sin sim, sim borrada, métrica ausente/sentinela 0.0, o cero contribuyentes. `mean_delta: null` si `deltas` vacío. `target_df` de `sim.parameters` si existe. |
| D4 | C1 nota | `show_sorensen_note` boolean (sin colisión con la clave string de R11 — r1 M5). |
| D5 | C3 persistencia (r2 MAJOR) | **UPDATE por pk** de cada fila fallida (no delete/reinsert): campos de análisis nuevos + `quality` + `pixels_per_100nm`; **preservados intactos** `png_bytes`, `png_scientific_bytes` (sin re-rasterización — endpoint immutable + hash-equality canónica), `analysis_input_variant` (reutilizado), `filename/azimuth/elevation/index`. Inputs: `dpo = batch.dpo_used`, `autocalibrate_dpo = false`. |
| D6 | C3 agregados (r2 MAJOR) | Recompute sobre el set COMPLETO con poblaciones R7 canónicas (`mean_df` converged-only, `mean_df_inclusive` inclusivo con `df_estimate`), `ddof=0`. PROHIBIDO pasar el subset a `persist_batch_results` tal cual (machaca `n_images`, `services/batch.py:~470-546`): modo `rows_scope="full"` o recompute explícito en el servicio — el contrato fija el resultado observable. |
| D7 | C3 async | ≤30 sync (200 con summary actualizado); >30 wrapper Celery fino, `202 {job_id, status: "queued"}` canónico + `fraktal_status_view` reutilizable (wrapper reporta `{"batch_id": …}` como `tasks.py:770-775`). 400 `{"detail": …, "code": "no_failed_images"}`. |
| D8 | C3 calibración (r2 minor) | Campo nullable `pixels_per_100nm` en `FraktalBatchImage` (migración aditiva reversible, sin backfill); re-análisis usa el valor persistido si existe, si no la escala del batch. `calibration_source` queda a NIVEL BATCH y SIN CAMBIOS — la procedencia por imagen solo es observable vía el campo nuevo. |
| D9 | C2 render (r3 BLOCKER-1 → marcador) | Con UNA sim por batch, `sim_df_value` es un ESCALAR (`n_sim ≤ 1`) — el overlay multi-valor era inimplementable. C2 = **marcador de referencia**: línea vertical discontinua en `x = sim_df_value` sobre el Df histograma, chip `Sim Df: {value}`, hover con target, toggle por batch (default ON), oculto si null (misma regla de ausencia que R12, palabra por palabra) o si el histograma está en no-data (R4 canónico). SIN MODIFIED de R2/R5/R-DELTA-M — binning/gates/tooltips canónicos intactos. |
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
| Distribuciones overlay OFF | R2/R5/R-DELTA-M canónicos intactos | Vitest toggle OFF |
| Distribuciones | Marcador sin tocar R2/R5/R-DELTA-M (R-DELTA-C2.1/C2.2) | Vitest marcador visible/oculto + histograma idéntico al pre-change con marcador OFF |
| CSV | Sin cambios | Suite existente |

## Test Plan Sketch
1. Contract: helper puro contra los 3 builders; población converged/approximate (df_estimate); sentinela 0.0; edges D3.
2. C3: boundary 30/31, 200/202/400/403, UPDATE preserva PNG bytes y variant, agregados R7 full-set, subset-exclusivity, calibración persistida vs fallback.
3. C2: marcador visible sobre histograma normal (R-DELTA-C2.1), oculto en los 4 casos de ausencia (R-DELTA-C2.2), toggle OFF = canónico.
4. Suite: pytest backend + vitest frontend completos.
