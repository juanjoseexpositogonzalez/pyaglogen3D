# Approval: batch-windowed-box-counting

> Estado: **APROBADO** (2026-10-19, por la persona en sesión — ver Log). Pendiente: issue Jira + apply.
> Spec-review: r1 (mvez5qdn-9-unqz) → r2 (mvezptvj-a-kxc5) → r3 (mvf0jncf-b-86n0) →
> confirmaciones r3b (mvf1na34-d-xuh7) y r3c aplicadas. Sin ALTA/BLOCKER/MAJOR abiertos;
> las 2 BAJA restantes de la r3b se cerraron en r3c (`887385b`).

## Qué aprueba la persona

Construir el capability `batch-box-counting` (R1–R9) según `specs/batch-box-counting.md` y
`design.md` D1–D8:

1. **Passthrough windowed** en el BC batch de estudios paramétricos (`windowed` bool con
   precedencia request > estudio > ausente; `force` para backfill; rechazo de claves
   desconocidas como comportamiento nuevo documentado).
2. **Un campo aditivo de solo lectura en el engine**: `effective_levels` en
   `BoxCountingResult3D` + espejo `PyFractalResult` (2D → 0), con fixture plateau en tests.
3. **Storage dual** con schema única de 11 claves (`box_counting_windowed`, estados
   `ok | insufficient_levels | error`, helper `build_bc_block`); bloque legacy intocado.
4. **Frontera sync≤30/async>30** (work set con geometry) con Celery `AsyncResult` y payload
   canónico; sin modelos nuevos ni migraciones.
5. **API**: `results` con bloque windowed + `bc_delta`; `GET .../fractal-analysis/` con stats
   por config (valores crudos, bucketing client-side).
6. **CSV aditivo** con header gate a nivel estudio (study legacy-only → byte-idéntico).
7. **Frontend**: tab dedicado "Fractal Analysis" por estudio (tabla comparativa, histogramas
   con herencia real de umbrales, export).

## Decisiones lockeadas por la persona (2026-10-18)

- P1: dentro de ParametricStudy · P2: sync≤30/async>30 · P3: tab dedicado.
- Change B (`fraktal-batch-extensions`): sin estimator 2D nuevo; candidatos C1/C2/C3 a elegir.

## Evidencia de revisión

| Ronda | Task | Resultado |
|---|---|---|
| r1 | mvez5qdn-9-unqz | NECESITA CORRECCIÓN: B1–B6, M1–M8, m1–m8 → r1 (`22922fe`) |
| r2 | mvezptvj-a-kxc5 | r1 verificada; 4 contradicciones nuevas → r2 (`b46af79`) |
| r3 | mvf0jncf-b-86n0 | sin ALTA; 1 MEDIA + 11 BAJA → r3 (`570ca16`, parcial) + r3b (`b188ab1`) |
| confirm r3b | mvf1fc7j-c-opxe | detectó sobreafirmación del 570ca16 → r3b completo + Log honesto |
| confirm r3c | mvf1na34-d-xuh7 | MEDIA resuelta; 2 BAJA → r3c (`887385b`) |

## Al aprobar

- **APROBADO 2026-10-19**: la persona seleccionó "Aprobado — a implementar" en el gate del
  turno; simultáneamente eligió C1+C2+C3 (los tres candidatos) para el Change B.
- Apply de `tasks.md` T0–T8+T1b por el flujo Git de la política; issue Jira nueva a En curso.
