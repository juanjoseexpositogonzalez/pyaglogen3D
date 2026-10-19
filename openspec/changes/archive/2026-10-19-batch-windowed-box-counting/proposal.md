# Proposal: batch-windowed-box-counting

> SDD change (política AGENTS.md, ciclo completo). Requisito cerrado con la persona 2026-10-18.
> Anclaje: exploración Engram `batch-fractal/exploration` (task mveygv4k-8-rke0, main c8880ea).
> Jira: AGLO-2 (Cycle 3 follow-up) — issue nueva si la persona prefiere.

## Intent

Hoy el BC batch (`POST studies/<pk>/run-box-counting/`, `views.py:2115`) corre **solo el
estimador legacy** y de forma **síncrona en el contenedor web**. El Cycle 3.2 dejó disponible un
estimador windowed opt-in (`box_counting_3d_windowed`, binding ya despachando `fit_window` en
`python/src/lib.rs:755`) con banda documentada ±0.35/±0.45 — pero **ningún caller del backend lo
usa**. Este change expone el estimador windowed en el flujo batch, añade la comparativa
3-way (Rg-evolution vs BC legacy vs BC windowed) y las distribuciones por config, con UI dedicada.

- **Un campo aditivo de solo lectura en `aglogen_core`** (spec-review B6): `effective_levels` en
  `BoxCountingResult3D` (espejado en `PyFractalResult`) — la cantidad de niveles count-valid ANTES
  de la truncation Step 4b; el legacy trunca sus vectores, así que la ventana no es derivable del
  resultado. El dual-run corre legacy primero y lo lee de ahí: cero llamadas extra. Lo demás es
  backend passthrough + agregación + frontend.

## Scope

### In Scope
- Passthrough `windowed` en el flujo run-box-counting (serializer → view → task), con precedencia
  request body > study params > ausente y `save()` que preserva el flag, con la semántica lockeada
  en Cycle 3.2: ventana efectiva `(1, last)` derivada del campo aditivo `effective_levels`,
  auto-clamp `s = max(0, min(1, eff−3))`, `InsufficientLevels` → estado `insufficient_levels`
  registrado (nunca falla el run — Log L4).
- **Dual-estimator**: cuando `fit_window` está presente, cada sim corre legacy Y windowed;
  resultado windowed en `metrics["box_counting_windowed"]` (bloque nuevo; el bloque legacy
  `metrics["box_counting"]` queda intocado — byte-compat).
- **Frontera de ejecución** espejo FRAKTAL R4/R5: estudio ≤30 sims → síncrono en el POST;
  >30 → async Celery (worker, `Dockerfile.worker` ya construye el wheel) con job id, progreso
  y escritura incremental por sim.
- Agregación por config: endpoint de distribuciones (mean/median/cuartiles/min/max/n por
  estimador y por config, bucketing Sturges [3,30] reutilizando la semántica de
  `fraktal-batch-distributions.md` R2).
- Columnas CSV aditivas (`BC_Win_Df, BC_Win_R2, BC_Win_StdError, BC_Win_Time_ms, BC_Win_Delta,
  BC_Win_Status`) tras las BC_* existentes, con header gate a nivel estudio (R6), solo cuando
  exista bloque windowed (R5 de `csv-export-locale.md` intacta).
- UI: **tab dedicado "Fractal Analysis"** por estudio — tabla comparativa por sim
  (Rg Df, BC legacy Df/R², BC windowed Df/R², Δ, estado), distribuciones por config/estimador,
  export.

### Out of Scope
- Cualquier OTRO cambio en `aglogen_core/` (engine o bindings) más allá del campo aditivo
  `effective_levels` de In Scope (B6/D1).
- Estimador 2D windowed (Change B explícitamente sin él).
- Picker de ventana en la UI v1 (la ventana lockeada por diagnóstico es única; un picker sin
  diagnóstico viola la regla Fase 0).
- Cambiar validaciones o formato del bloque legacy existente.

## Capabilities

### New Capabilities
- `batch-box-counting`: contrato observable del BC batch dual-estimator (delta spec adjunta).

### Modified Capabilities
- Ninguna en este change: columnas CSV aditivas documentadas en la nueva capability; el bloque
  legacy y sus consumidores (FRAKTAL lee `metrics.fractal_dimension`, no el bloque BC) no cambian.

## Decisions locked by the person (2026-10-18)

| # | Decisión |
| --- | --- |
| P1 | Vive dentro de ParametricStudy (no standalone) |
| P2 | Frontera sync≤30 / async>30 (patrón FRAKTAL) |
| P3 | UI: tab dedicado por estudio |

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Timeout del POST síncrono en estudios grandes | Frontera P2; el test de frontera usa N=30/31 |
| Doble cómputo duplica latencia de BC | points_per_sphere/precision ya acotados; medir en apply |
| Job state invisible entre workers | `AsyncResult` de Celery (patrón FRAKTAL existente), no Django cache — LocMemCache es per-proceso con Gunicorn --workers 2 (spec-review B1) |
| Campo nuevo del engine rompe consumidores | Aditivo y de solo lectura; PyFractalResult espeja (los campos aditivos son compatibles, obs #9190) |
| Rechazo de claves desconocidas rompe clientes que hoy envían extra keys | Cambio de comportamiento intencional y documentado (R1.2) |
| Filas CSV cambian para consumidores existentes | Columnas SOLO cuando existe bloque windowed; sin bloque, CSV byte-idéntico |
