# Proposal: fraktal-batch-extensions

> SDD change (política AGENTS.md). Requisito cerrado con la persona 2026-10-18: extensión del
> batch de imágenes FRAKTAL **sin estimator 2D nuevo** (packaging/export/UI sobre lo existente).
> Anclaje: Engram `batch-fractal/exploration`.

## Intent

El change de abril (`fraktal-batch-analysis`) entregó el pipeline completo (ZIP → calibración →
análisis → persistencia → distribuciones → comparación con sims → CSV). La exploración identificó
gaps de empaquetado y comparación que no requieren engine work. Este change cierra esos gaps.

## Scope candidates (ELEGIDOS por la persona 2026-10-19: C1+C2+C3 — pendiente solo approval.md)

| # | Candidato | Qué añade | Superficie |
|---|---|---|---|
| C1 | **Comparativa batch ↔ su simulación enlazada** — ELEGIDOS C1+C2+C3 (2026-10-19); C1 reencaminada tras r1 B1 (una sim por batch): stats de Df de imágenes (población canonical R7) vs Df de la sim, Δ, `deltas`, nota Sorensen | Bloque `study_comparison` (helper único, 3 builders) + `BatchStudyComparisonCard` que REEMPLAZA a `FraktalComparisonCard` en SummaryPage (r4 MAJOR-3) | `fractal_analysis/views.py` (payload), `FraktalBatchSummaryPage` |
| C2 | **Marcador de referencia del Df de la sim** (reencaminada tras r3 BLOCKER-1: escalar, `n_sim ≤ 1`) | Línea vertical + chip sobre el histograma de Df; fuente ÚNICA `study_comparison.sim_df.value` (r4 MAJOR-2, sin clave duplicada) | frontend + payload |
| C3 | **Re-análisis masivo de fallidas**: acción a nivel batch para re-correr solo las imágenes con `quality: failed` (hoy el reanalyze es por imagen) | Endpoint de acción + botón con progreso | views + task existente + UI |

### Out of Scope (lockeado por la persona)
- Estimador 2D windowed nuevo (engine work explícitamente excluido).
- Cualquier cambio en `aglogen_core/`.
- **ÚNICA excepción de contrato (r3):** MODIFIED R2 de `fraktal-batch-persistence` (columna
  nullable `pixels_per_100nm`, restatement completo — r2 BLOCKER-2). Distributions: SOLO ADDED
  (marcador C2) — R1-R5 / R-DELTA-L / R-DELTA-M intactos (r5 minor 5: las distribuciones canónicas no tienen R6-R11 ni R-DELTA-I/J/K).
- Enlace imagen→sim por imagen (FK) — rechazado por la persona; la comparativa multi-config
  vive en el tab del Change A.

## Capabilities

### Modified Capabilities
- `fraktal-batch-contract` (ADDED R12/R13), `fraktal-batch-persistence` (MODIFIED R2 — única
  excepción de contrato), `fraktal-batch-distributions` (ADDED R-DELTA-C2) — deltas en `specs/`.
