# Design: batch-windowed-box-counting

> Persona-locked: P1 (ParametricStudy), P2 (sync≤30/async>30), P3 (tab dedicado).
> Anclaje: Engram `batch-fractal/exploration`. Cycle 3.2: window semantics Log L2/L4.

## Decision Summary (LOCKED)

| # | Decisión | Elección |
|---|---|---|
| D1 | Alcance engine | **UN campo aditivo de solo lectura**: `effective_levels: usize` en `BoxCountingResult3D` (espejado en `PyFractalResult`) — la cantidad de niveles count-valid ANTES de la truncation Step 4b (el legacy trunca sus vectores, así que NO es derivable del resultado: spec-review B6). Sin cambio de comportamiento ni de firmas. El dual-run corre legacy primero y lee `effective_levels` de ahí: cero llamadas extra. |
| D2 | Ventana | La lockeada por diagnóstico Cycle 3.2: efectiva `(1, last)`, calculada en backend desde `effective_levels` del resultado legacy (D1): `s = max(0, min(1, eff−3))`, `e = eff−1`. Con eff=3 → ventana (0,2) → status ok (≡ legacy, Log L4); con eff<3 → `InsufficientLevels` → `status: insufficient_levels` (R2.2). Sin picker en v1 (Fase 0). |
| D3 | Storage | Windowed en bloque nuevo `metrics["box_counting_windowed"]` con **paridad de claves del legacy** + `status` + `fit_window_used` (spec-review M6); legacy `metrics["box_counting"]` intocado (byte-compat). |
| D4 | `InsufficientLevels` | Estado `insufficient_levels` registrado; el run completo NUNCA falla por la mitad windowed (Log L4). Con el clamp de D2 solo ocurre con eff<3. |
| D5 | Ejecución | P2: ≤30 sims del work set (`completed` AND `geometry__isnull=False` — spec-review M8) sync (POST actual, extendido); >30 async Celery. Job state con **Celery `AsyncResult` + `update_state(meta=…)`** (patrón `fractal_analysis/views.py:719-777`; payload canónico `status/progress/current/total/error`, spec-review M1/B1 — NO Django cache: LocMemCache es per-proceso y invisible entre los 2 workers de Gunicorn). Escritura incremental por sim. Sin modelo nuevo ni migración. |
| D6 | Param key | `windowed: bool` con precedencia request body > study params > ausente, y el `save()` de `views.py:2160-2164` conserva el flag (spec-review B2). Validación de claves desconocidas AÑADIDA en `validate_box_counting_params` (spec-review B3 — cambio de comportamiento intencional, R1.2). `force: bool` para re-run/backfill (M5). El passthrough calcula `(s,e)` en backend desde `effective_levels` (D1/D2). |
| D7 | UI | P3: tab "Fractal Analysis" en `app/projects/[id]/batch/`, componente nuevo `FractalAnalysisTab` (tipos `StudyFractalAnalysisSummary`, distintos de `FraktalAnalysisSummary` existente — m4) consumiendo los endpoints R4/R5; histogramas CLIENT-side con `sturgesBuckets` (R5), heredando los comportamientos empty-data/single-value de `fraktal-batch-distributions.md` (M3). |
| D8 | Call sites | En scope: loop del study (`views.py:2194`), auto-run (`tasks.py:944`), single-sim GET (`views.py:1502`, R8). Fuera de scope documentado: `analysis_tools.py:89` (AI) y `compute_import_metrics` (`tasks.py:1139`) — legacy-only. |

## Architecture

### Backend

```text
aglogen_core (UN campo aditivo, D1):
  box_counting_3d.rs   + effective_levels: usize en BoxCountingResult3D (ambos paths)
  python/src/lib.rs    + espejo en PyFractalResult

serializers.py validate_box_counting_params   + windowed bool + rechazo de claves desconocidas (B3)
views.py run_box_counting                     + precedencia windowed (B2) + dispatch por work set (D5) + force (M5)
  ├─ ≤30: dual-run inline loop (legacy + windowed por sim, ventana desde effective_levels)
  └─ >30: celery task + AsyncResult meta
tasks.py run_box_counting_if_configured       + windowed branch (misma ventana lockeada)
tasks.py run_box_counting_async (NEW celery)  + escritura incremental + update_state(meta)
views.py box_counting_job_status (NEW GET)    + payload canónico status/progress/current/total/error (M1)
views.py fractal_analysis_summary (NEW GET)   + agregados R5 (valores crudos; bucketing client-side)
export_csv                                    + R6 con header gate a nivel study (B5)
```

Single-sim action (`views.py:1502`): query param `windowed=true` añade la clave `box_counting_windowed` al dict plano (R8); sin el flag, respuesta byte-idéntica (M7).

### Frontend

```text
app/projects/[id]/batch/page.tsx        + Tab bar: Results | Fractal Analysis
components/batch/FractalAnalysisTab.tsx (NEW: table + distributions + export)
lib/api.ts studiesApi                   + runBoxCountingJob / jobStatus / fractalAnalysisSummary
types.ts                                + WindowedBlock, StudyFractalAnalysisSummary (aditivos; distinto de FraktalAnalysisSummary existente — m4)
```

## Non-Regression Matrix

| Superficie | Garantía | Test |
|---|---|---|
| Bloque legacy `metrics["box_counting"]` | Bit-idéntico con `windowed` ON u OFF | Unit: dual-run vs fixtures existentes (R2.1) |
| CSV sin bloque windowed | Byte-idéntico | Test CSV filas mixtas (R6) |
| POST ≤30 | Misma forma de respuesta + windowed aditivo | Contract test |
| Validaciones existentes | Intactas | Test 400s |
| FRAKTAL (lee `metrics.fractal_dimension`) | Sin cambio | Suite backend existente |

## Test Plan Sketch (en tasks.md el detalle)

1. Contract tests de frontera (30/31), job lifecycle async, R2.1/R2.2 storage.
2. CSV mixto (con y sin windowed) contra writer locale.
3. Aggregates R5 sobre fixtures con valores hand-computed.
4. Frontend: vitest del tab (render con/sin windowed, estados de job, distribución).

## Fase 0 (pre-approval)

La ventana y su banda vienen del diagnóstico Cycle 3.2 (`bc_window_alignment_audit`) ya
ejecutado y archivado. El único cómputo nuevo en backend es la derivación `(s,e)` desde
`effective_levels` — aritmética de enteros determinista (D2), verificada con tests
hand-computed (T2), no una hipótesis numérica nueva.
