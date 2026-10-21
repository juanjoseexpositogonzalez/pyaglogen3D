# Tasks: sintering-reaches-engine

> Estado del contrato: **spec-review pendiente** (agente fresco) y `approval.md` de la persona.
> **No se escribe código hasta que exista `approval.md`.**
>
> Rama: `feature/sintering-reaches-engine` (base `develop` @ `c3ff055`).
> Mapa de origen: `openspec/changes/_explore-only/distribution-config-surface.md` §7.1.
> Jira: pendiente de crear al aprobar (issue AGLO, transición 21 → En curso).

## T0 — Contrato

- [x] T0.1 Mapa de superficie consolidado y entregado (PR #81)
- [x] T0.2 Contrato escrito: proposal + design + specs + tasks (este commit)
- [ ] T0.3 spec-review en agente fresco
- [ ] T0.4 Correcciones hasta ronda sin hallazgos semánticos
- [ ] T0.5 `approval.md` — **sólo la persona aprueba**
- [ ] T0.6 Crear issue AGLO y pasarla a En curso (transición 21)

## T1 — Regla única de forma, en las tres superficies (D2, D5b, R3)

- [ ] T1.1 `validate_sintering_config` (`serializers.py:360`): exigir `distribution_type`
      conocido, exigir los campos requeridos por tipo, rechazar claves fuera de
      `{distribution_type, coefficient, min, max, mean, std}`
- [ ] T1.2 Distinguir los dos contextos de llamada: como validador del **campo de estudio** y
      de `base_parameters` acepta `None`/`{}`; como validador de una **entrada de grid** los
      rechaza
- [ ] T1.3 Validar `base_parameters["sintering_config"]`, que hoy no valida nadie (D5b)
- [ ] T1.4 Tests R3.3 (rangos), R3.5 (`{mode}` rechazada), R3.6 (campos incompletos, `{}` de
      grid, `{}` de estudio aceptado), R3.7 (`base_parameters`)
- [ ] T1.5 Regresión: R3.1, R3.2 y R3.4 siguen verdes

## T2 — El helper deja de inventar defaults (R3)

- [ ] T2.1 `apply_sintering_config` (`utils.py:236`): lanzar `ValueError` ante dict no vacío que
      incumpla T1.1, incluido `distribution_type` desconocido; `None`/`{}` siguen devolviendo
      los parámetros intactos
- [ ] T2.2 Test R3.8
- [ ] T2.3 **Test existente que esta tarea pone en rojo y se retira** (declaración completa):
      - `backend/tests/test_utils.py:336-344` `test_default_values_used` — afirma que
        `apply_sintering_config({"distribution_type":"uniform"})` rellena `0.85`/`0.95` por
        defecto. Es la forma codificada del defecto D2; R3 exige que lance
- [ ] T2.4 Regresión declarada: `test_none_config_returns_unchanged` y
      `test_empty_config_returns_unchanged` (`backend/tests/test_utils.py:319-334`) **siguen
      verdes sin cambios**

## T3 — El sinterizado llega al engine (D5, R11)

- [ ] T3.1 `apply_sintering_config`: escribir `sintering_coeff` (no `sintering_mean`) para el
      tipo `normal`; retirar `sintering_mean`, que ningún consumidor de producción lee
- [ ] T3.2 **Test existente que esta tarea pone en rojo y se reescribe** (declaración completa):
      - `backend/tests/test_utils.py:304-317` `test_normal_sintering` — afirma
        `result["sintering_mean"] == 0.9`; pasa a afirmar `result["sintering_coeff"] == 0.9`
- [ ] T3.3 Test R11.1 de **borde de engine**: mock sobre el binding, afirmando que la media que
      llega es 0.8 y **no** 1.0
- [ ] T3.4 Tests R11.2 y R11.3 (ninguna clave fuera del conjunto que el worker lee)

## T4 — Alcance por algoritmo (D6, R11)

- [ ] T4.1 Allow-list en la validación: sinterizado completo para los seis algoritmos que lo
      consumen; sólo `fixed` para `limiting`; rechazo para `fracval`/`gcca`/`box_rfa`/`imported`
- [ ] T4.2 Aplicar la regla a las tres superficies (grid, campo de estudio, `base_parameters`)
- [ ] T4.3 Tests R11.4 y R11.5

## T5 — Integridad de la expansión (R12)

- [ ] T5.1 Garantizar que toda la validación de T1 y T4 ocurre en
      `ParametricStudySerializer.validate()`, antes de la primera escritura
- [ ] T5.2 Tests R12.1 y R12.2: 400 con **cero** estudios, cero simulaciones y cero tareas
      encoladas (contar filas antes y después, y mockear `run_simulation_task.delay`)

## T6 — Frontend (R10)

- [ ] T6.1 Función pura `toSinteringConfig(DistributionValue)` y su uso en el submit de
      `BatchSimulationForm`
- [ ] T6.2 `parameterOptions` (`BatchSimulationForm.tsx:313-318`): ofrecer "Sintering
      coefficient distribution" sólo para los seis algoritmos que lo consumen
- [ ] T6.3 Tests R10.4 (opción ausente para `fracval`/`gcca`/`box_rfa`, presente para
      `ballistic`) y R10.5 (forma del payload, y que el default de `uniform` del selector
      produce un payload aceptable sin edición)
- [ ] T6.4 **No se toca** `DistributionSelector.tsx`: su default `min == max` con base `1.0` es
      válido para el sinterizado. Pertenece a `distribution-grid-wiring`

## T7 — Verificación

- [ ] T7.1 `cd backend && pytest && ruff check && mypy .`.
      **Línea base roja preexistente, medida en `develop` @ `c3ff055`: 15 failed, 31 errors,
      1221 passed.** Los 31 errores son de *setup de fixtures*
      (`TypeError: User() got unexpected keyword arguments: 'username'`,
      `apps/accounts/models.py:26`), no de colección. Criterio de aceptación: **los cuatro
      módulos de esta superficie en verde** y la línea base global sin empeorar. Los módulos
      son: `apps/simulations/tests/test_parametric_study_serializer.py`,
      `apps/simulations/tests/test_grid_expansion.py`, `backend/tests/test_utils.py`,
      `backend/tests/test_serializers.py`
- [ ] T7.2 `cd frontend && npm test && npm run type-check` (base: 55 ficheros, 597 tests).
      `npm run lint` existe (`next lint`) pero el repo no tiene configuración de ESLint, así
      que lanza el asistente interactivo: condición preexistente declarada, no la arregla este
      change
- [ ] T7.3 Engine: sin cambios en `aglogen_core/`; se corre la suite como control de
      no-regresión
- [ ] T7.4 Verificación manual: estudio batch `ballistic` con sinterizado normal(0.8, 0.05) →
      comprobar en los parámetros del hijo y en el resultado que la media aplicada es **0.8**

## T8 — Cierre

- [ ] T8.1 judgment-day (revisión adversarial dual, agentes frescos en sesión nueva)
- [ ] T8.2 Fix rounds hasta APPROVED
- [ ] T8.3 Archive + sincronización canónica de `batch-cc-tunable-parameter-parity` (bloques
      MODIFIED/ADDED completos, nunca diferidos) + `state.yaml`
- [ ] T8.4 PR a `develop` con etiqueta `type:bug` enlazando el issue AGLO
- [ ] T8.5 Comentario de entrega en Jira **haciendo constar** que los resultados batch
      anteriores con `sintering_config`, y los de cualquier estudio con sinterizado `normal`,
      se ejecutaron sin el sinterizado declarado; y transición 41
- [ ] T8.6 Arrancar el siguiente contrato de la cadena: `distribution-grid-wiring`

## Log

- L1 (2026-10-21): Contrato escrito a partir del mapa consolidado
  (`_explore-only/distribution-config-surface.md`, PR #81), que a su vez consolida la
  exploración y cuatro rondas de spec-review del change retirado `distribution-config-wiring`.
  Alcance deliberadamente reducido a la familia del sinterizado: D2, D5, D5b y D6. Las claves
  de distribución (D1/D3/D8), la ruta del asistente IA (D9) y el 500 de los casos límite (D7)
  quedan para los contratos siguientes, declarados en `proposal.md`.
- L2 (2026-10-21): Decisiones de diseño con su alternativa descartada: regla única en las tres
  superficies (DD1); el helper lanza pero nunca es el primero en enterarse (DD2); validar antes
  de escribir en vez de `transaction.atomic`, porque una tarea Celety ya despachada no se
  deshace con un rollback (DD3); `sintering_coeff` es la media (DD4); allow-list de once
  algoritmos con `limiting` sólo-`fixed` (DD5).
