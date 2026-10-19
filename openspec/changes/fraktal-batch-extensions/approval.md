# Approval: fraktal-batch-extensions

> Estado: **APROBADO** (2026-10-19, por la persona en sesión — ver Log). Pendiente: issue Jira + apply.
> Spec-review: 7 rondas — r1 (mvf21s3n-f-ztnz) → r2 (mvf2hiqs-g-x5jy) → r3 (mvf2v5g3-h-bod9) →
> r4 (mvf3tlz3-j-z97z) → r5 (mvf3dtqr-i-7rrr) → r6 (mvf4arvp-k-1jy0) → r7 (mvf4ssiq-m-2wsf).
> La r7 no encontró hallazgos semánticos (solo bookkeeping de las correcciones previas); las
> correcciones de cada ronda están itemizadas en `tasks.md` Log L2-L6, y la r7 en L7 (`c19bea8`).

## Qué aprueba la persona

Tres extensiones **aditivas** del batch de imágenes FRAKTAL (capability `fraktal-batch-contract`,
`fraktal-batch-persistence`, `fraktal-batch-distributions`), **sin cambios en `aglogen_core/`**:

1. **C1 (reencaminada por decisión de la persona, r1 B1): comparativa batch ↔ su simulación
   enlazada.** El modelo enlaza UNA sim por batch (no una por imagen), así que la comparativa
   multi-config original es imposible sin crecer de alcance. Forma final: bloque
   `study_comparison` en el resumen (helper único para los 3 builders), población canonical R7
   (converged→`fractal_dimension`, approximate→`df_estimate`), `deltas` por imagen,
   `show_sorensen_note`, y `BatchStudyComparisonCard` que REEMPLAZA a `FraktalComparisonCard`
   en el swap point compartido (R12.3: una sola tarjeta y una sola nota; sin fallback legacy
   cuando `study_comparison` es null).
2. **C2 (reencaminada por datos, r3 BLOCKER-1 — RATIFICAR EN ESTE GATE): marcador de
   referencia.** Con una sim por batch el Df de la sim es un escalar (`n_sim ≤ 1`) — el overlay
   multi-valor elegido originalmente era inimplementable. Forma final: línea vertical + chip
   `Sim Df: X.XX` sobre el histograma de Df, hover con target, toggle local default ON,
   oculto bajo la misma regla de ausencia que C1 (sentinela 0.0 incluida). Los canónicos
   R2/R5/R-DELTA-M de distribuciones quedan INTACTOS (la delta es ADDED-only).
3. **C3: re-análisis masivo in-place de imágenes fallidas.** Acción project-nested con permiso
   exigible (403), boundary ≤30 sync / >30 async (payload canónico `202 {job_id, status}`),
   UPDATE por pk con 12 campos de análisis + `pixels_per_100nm` preservando PNG bytes
   hash-equal, agregados recomputados sobre el set completo (7 persistidos + read-derived,
   poblaciones R7, sin cuartiles), migración nullable `pixels_per_100nm` (MODIFIED R2 de
   persistence — la ÚNICA excepción de contrato, restatement completo).

## Decisiones de la persona ya registradas

- 2026-10-18: C1+C2+C3 elegidos (los tres) junto al gate del Change A.
- 2026-10-19: C1 reencaminada a "contra la sim del batch" (opción 1 de 3).
- 2026-10-19: sin estimator 2D nuevo (lockeado desde la elección inicial).

## Pendiente de ratificación en este gate

- **C2 como marcador** (en vez del overlay elegido): forzado por `n_sim ≤ 1`; la alternativa
  habría sido crecer el alcance con FK imagen→sim (rechazada por la persona al reencaminar C1).

## Al aprobar

- **APROBADO 2026-10-19**: la persona otorgó el gate ("Pues vamos a seguir") tras el resumen del
  gate — C2-marcador RATIFICADO (acepta la reencaminación forzada por los datos).
- Apply de `tasks.md` T0–T7: rama `feature/fraktal-batch-extensions` desde develop con los
  commits de contrato cherry-picked; issue Jira nueva a En curso.
