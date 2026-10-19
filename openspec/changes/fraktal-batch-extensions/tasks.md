# Tasks: fraktal-batch-extensions

> Specs: `specs/fraktal-batch.md` (R12, R13, R-DELTA-C2). Design D1-D11: `design.md`.
> Pendiente: spec-review r2 → approval.md → apply. C1 reencaminada por la persona (2026-10-19):
> comparativa contra la sim del batch (una por batch); C2 overlay con bins explícitos; C3 in-place.

## Tasks

| ID | Specs | Route | Commit |
|---|---|---|---|
| T0 | S(scaffold) | Rama `feature/fraktal-batch-extensions` (desde develop, al momento del apply) + este change folder | this |
| T1 | R12, D2-D4 | Backend: migración nullable `pixels_per_100nm` en `FraktalBatchImage` (D7, adelantada por T2) + helper único `_build_study_comparison(batch)` consumido por los 3 builders (`_build_batch_response`, `_serialize_batch_from_db`, inline `batch_detail_view`); contract tests R12.1/R12.2 + triple-builder equality + sentinela 0.0 | 2 |
| T2 | R13, D5-D7, D9 | Backend: servicio `reanalyze_failed_images(batch)` (in-place: delete/reinsert misma clave `(batch,index)`, agregados full-set, solo fallidas) + migración `pixels_per_100nm` + ruta project-nested con `IsProjectOwnerOrShared` + boundary ≤30 sync / >30 wrapper Celery (payload canónico `202 {job_id, status}`); tests R13.1/R13.2 + subset-exclusivity + calibración persistida vs fallback | 3 |
| T3 | R-DELTA-C2, D8 | Backend: `sim_df_values` aditivo en el payload (mismos 3 builders vía el helper de T1); test exclusión sentinela/vacío | 3 |
| T4 | R12 | Frontend: `BatchStudyComparisonCard` NUEVA en SummaryPage (no reutiliza `FraktalComparisonCard`: requiere `comparison` no-opcional y no tiene campos image_df/sim_df/Δ — r1 m3) con nota Sorensen, oculta si null + vitest | 4 |
| T5 | R-DELTA-C2 | Frontend: overlay en FraktalBatchDistributions (xbins unión, gates por serie, chip "Not enough data" de la serie sim, tooltip por serie) + prop `sim_df_values` desde `lib/api.ts` + vitest (R-DELTA-C2.1) | 4 |
| T6 | R13 | Frontend: botón re-análisis masivo con progreso (ResultsView/SummaryPage) + método en `lib/api-fraktal-batch` + vitest | 4 |
| T7 | todas | Suite completa backend (pytest/ruff) + frontend (vitest/lint/type-check) + Log de evidencia | 5 |

## Log

- L1 (2026-10-19): Persona eligió C1+C2+C3 (los tres candidatos) junto al gate del Change A. Contrato v0 escrito sobre el anclaje de la exploración.
- L2 (2026-10-19): Spec-review r1 (task mvf21s3n-f-ztnz): NECESITA CORRECCIÓN — B1-B4/M1-M6/m1-m5. Corrección r1 (este commit):
  - B1: C1 reencaminada por la persona — comparativa contra la sim del batch (una por batch); `per_config` eliminado; FK imagen→sim rechazada (fuera de alcance, documentado).
  - B2: helper único `_build_study_comparison` para los TRES builders (el SummaryPage lee el inline de `batch_detail_view`).
  - B3: modo in-place especificado como servicio nuevo (delete/reinsert misma clave, agregados full-set) — el task existente no soporta subset (crea batch nuevo o IntegrityError).
  - B4: payload canónico `202 {job_id, status: "queued"}` (no `{task_id, total}`).
  - M1 población `image_df` fijada (inclusiva con breakdown); M2 muere con B1; M3 `sim_df_values` en el payload real (no hay "distributions endpoint"); M4 bins por unión explícita + gates por serie; M5 renombrada a `show_sorensen_note`; M6 migración nullable `pixels_per_100nm` + fallback documentado; m1 ruta project-nested con permiso; m2 frase de cuartiles eliminada; m3 targets concretos en tasks (api.ts, urls, card nueva); m4 sentinela 0.0 = ausente; m5 T0 crea la rama al apply.
