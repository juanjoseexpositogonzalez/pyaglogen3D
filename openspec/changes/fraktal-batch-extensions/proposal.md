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
| C1 | **Comparativa batch ↔ su simulación enlazada** (reencaminada 2026-10-19 tras spec-review r1 B1: el modelo enlaza UNA sim por batch; la persona eligió "C1 contra la sim del batch"): stats de Df de imágenes (población canonical R7: converged→`fractal_dimension`, approximate→`df_estimate`) vs el Df de la sim, Δ, `deltas` por imagen, nota Sorensen a nivel batch | Bloque `study_comparison` en el payload de resumen (helper único para los 3 builders) + tarjeta en la SummaryPage | `fractal_analysis/views.py` (payload), `FraktalBatchSummaryPage` |
| C2 | **Marcador de referencia del Df de la sim** (reencaminada 2026-10-19 tras spec-review r3 BLOCKER-1: con una sim por batch, `n_sim ≤ 1` — el overlay multi-valor era inimplementable): línea vertical en el histograma de Df de imágenes, chip `Sim Df: X.XX`, toggle por batch, sin tocar R2/R5/R-DELTA-M canónicos | Clave `sim_df_value` en payload + render del marcador en `FraktalBatchDistributions.tsx` | frontend + payload |
| C3 | **Re-análisis masivo de fallidas**: acción a nivel batch para re-correr solo las imágenes con `quality: failed` (hoy el reanalyze es por imagen) | Endpoint de acción + botón con progreso | views + task existente + UI |

### Out of Scope (lockeado por la persona)
- Estimador 2D windowed nuevo (engine work explícitamente excluido).
- Cualquier cambio en `aglogen_core/`.
- **ÚNICA excepción de contrato (r3):** MODIFIED R2 de `fraktal-batch-persistence` (columna
  nullable `pixels_per_100nm`, restatement completo — r2 BLOCKER-2). Distributions: SOLO ADDED
  (marcador C2) — R1–R11 / R-DELTA-I..M intactos.
- Enlace imagen→sim por imagen (FK) — rechazado por la persona; la comparativa multi-config
  vive en el tab del Change A.

## Capabilities

### Modified Capabilities
- `fraktal-batch-contract` (ADDED R12/R13), `fraktal-batch-persistence` (MODIFIED R2 — única
  excepción), `fraktal-batch-distributions` (ADDED R-DELTA-C2) — deltas en `specs/`.

## Nota de proceso

Este proposal queda deliberadamente **sin delta spec hasta que la persona elija candidatos**
(C1/C2/C3, subset o todos). El flujo continúa: elección → delta spec + design + tasks →
spec-review → approval.md → apply.
