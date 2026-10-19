# Proposal: fraktal-batch-extensions

> SDD change (política AGENTS.md). Requisito cerrado con la persona 2026-10-18: extensión del
> batch de imágenes FRAKTAL **sin estimator 2D nuevo** (packaging/export/UI sobre lo existente).
> Anclaje: Engram `batch-fractal/exploration`.

## Intent

El change de abril (`fraktal-batch-analysis`) entregó el pipeline completo (ZIP → calibración →
análisis → persistencia → distribuciones → comparación con sims → CSV). La exploración identificó
gaps de empaquetado y comparación que no requieren engine work. Este change cierra esos gaps.

## Scope candidates (LA PERSONA ELIGE EN approval.md — ninguno está lockeado aún)

| # | Candidato | Qué añade | Superficie |
|---|---|---|---|
| C1 | **Comparativa agregada batch ↔ estudio** a nivel batch (hoy la comparación sim↔imágenes es por imagen, R9; falta el agregado: media/mediana de Df de imágenes vs media de `sim_box_counting_df` por config, Δ, y el estado de la nota Sorensen a nivel batch) | Nuevo bloque en el payload de resumen + tarjeta en la SummaryPage | `fractal_analysis/views.py` (payload), `FraktalBatchSummaryPage` |
| C2 | **Overlay de distribuciones cruzadas**: histograma de Df de imágenes vs histograma de `sim_box_counting_df` de las sims enlazadas, en el mismo gráfico (reutiliza la maquinaria R-DELTA de overlays) | Toggle en `FraktalBatchDistributions.tsx` + campo agregado en payload | frontend + payload |
| C3 | **Re-análisis masivo de fallidas**: acción a nivel batch para re-correr solo las imágenes con `quality: failed` (hoy el reanalyze es por imagen) | Endpoint de acción + botón con progreso | views + task existente + UI |

### Out of Scope (lockeado por la persona)
- Estimador 2D windowed nuevo (engine work explícitamente excluido).
- Cualquier cambio en `aglogen_core/`.
- Cambios de contrato en las especificaciones R1–R8 existentes (solo extensiones aditivas).

## Capabilities

### Modified Capabilities
- `fraktal-batch-contract` (payloads aditivos de C1/C3), `fraktal-batch-distributions` (overlay C2)
  — delta spec se escribe tras la elección de candidatos en approval.md.

## Nota de proceso

Este proposal queda deliberadamente **sin delta spec hasta que la persona elija candidatos**
(C1/C2/C3, subset o todos). El flujo continúa: elección → delta spec + design + tasks →
spec-review → approval.md → apply.
