# Tasks: sintering-reaches-engine

> Estado del contrato: **spec-review pendiente** (agente fresco) y `approval.md` de la persona.
> **No se escribe código hasta que exista `approval.md`.**
>
> Rama: `feature/sintering-reaches-engine` (base `develop` @ `c3ff055`).
> Mapa de origen: `openspec/changes/_explore-only/distribution-config-surface.md` §7.1.
> Jira: pendiente de crear al aprobar (issue AGLO, transición 21 → En curso).

## T0 — Contrato

- [x] T0.1 Mapa de superficie consolidado y entregado (PR #81)
- [x] T0.2 Contrato r1 (`95d41ca`)
- [x] T0.3 spec-review r1 → `CORRECTIONS REQUIRED (2 blockers, 3 majors)`
- [x] T0.4 Decisión de la persona: las superficies planas **entran** en alcance
- [x] T0.5 Corrección r2 (este commit)
- [x] T0.6 spec-review r2 → `CORRECTIONS REQUIRED (1 blocker, 7 majors)`
- [x] T0.7 Decisión de la persona: **invariante en el chokepoint** + validación de entrada
- [x] T0.8 Corrección r3 (este commit)
- [ ] T0.9 spec-review r3 en agente fresco
- [ ] T0.10 Correcciones hasta ronda sin hallazgos semánticos
- [ ] T0.11 `approval.md` — **sólo la persona aprueba**
- [ ] T0.12 Crear issue AGLO y pasarla a En curso (transición 21)

## T1 — Regla única de forma, en las seis superficies (D2, D5b, R3)

- [ ] T1.1 `validate_sintering_config` (`serializers.py:360`): exigir `distribution_type`
      conocido, exigir los campos requeridos por tipo, rechazar claves fuera de
      `{distribution_type, coefficient, min, max, mean, std}`
- [ ] T1.2 Distinguir los dos contextos de llamada: como validador del **campo de estudio** y
      de `base_parameters` acepta `None`/`{}`; como validador de una **entrada de grid** los
      rechaza
- [ ] T1.3 Validar `base_parameters["sintering_config"]`, que hoy no valida nadie (D5b)
- [ ] T1.4 Validar los **escalares planos** `sintering_*` en `base_parameters`, como claves de
      `parameter_grid` y dentro de `limiting_cases_config.theoretical_extremes` (superficies 4,
      5 y 6): tabla propia de campos requeridos por tipo, rangos, `sintering_coeff` sin tipo =
      `fixed`, y rechazo de cualquier otra `sintering_*` — en particular `sintering_mean`
- [ ] T1.5 Precedencia **por forma** (R3): dicts `grid > base_parameters > estudio > default`;
      planos, el último que escribe; cualquier dict gana a todos los planos
- [ ] T1.6 Tests R3.3, R3.5, R3.6, R3.7, **R3.8** (planos, `-5.0`/`42.0`, `sintering_mean`,
      `coeff` sin tipo, `uniform` incompleto), **R3.9** (extremos teóricos) y **R3.10**
      (precedencia)
- [ ] T1.7 Regresión: R3.1, R3.2 y R3.4 siguen verdes
- [ ] T1.8 **Ningún test existente pasa a rojo por esta tarea** (verificado: los tests de
      sinterizado de `tests/test_serializers.py:209-341` y `test_grid_expansion.py:216-260`
      usan configuraciones completas y algoritmos de la allow-list)

## T2 — El helper deja de inventar defaults (R3)

- [ ] T2.1 `apply_sintering_config` (`utils.py:236`): lanzar `ValueError` ante dict no vacío que
      incumpla T1.1, incluido `distribution_type` desconocido; `None`/`{}` siguen devolviendo
      los parámetros intactos
- [ ] T2.2 Test **R3.11** (el helper lanza)
- [ ] T2.3 **Test existente que esta tarea pone en rojo y se retira** (declaración completa):
      - `backend/tests/test_utils.py:336-344` `test_default_values_used` — afirma que
        `apply_sintering_config({"distribution_type":"uniform"})` rellena `0.85`/`0.95` por
        defecto. Es la forma codificada del defecto D2; R3 exige que lance
- [ ] T2.4 Regresión declarada: `test_none_config_returns_unchanged` y
      `test_empty_config_returns_unchanged` (`backend/tests/test_utils.py:319-334`) **siguen
      verdes sin cambios**

## T3 — El invariante del hijo y el engine (D5, R11)

- [ ] T3.0 Implementar el **invariante de R11** en la función que construye los parámetros del
      hijo, por la que pasan grid, casos límite y extremos teóricos (`views.py:1867`): claves
      dentro del conjunto que el worker lee, forma completa y en rango, y exactamente las que
      produjo el dict cuando un dict aplica
- [ ] T3.0b La limpieza de `sintering_*` heredadas la hace `apply_sintering_config`, no el
      serializer: limpiar en el serializer cambiaría la física de los hijos de casos límite,
      que copian `base_parameters` y nunca reciben el dict del grid (`utils.py:185-203`)
- [ ] T3.0c Test **R11.3**: el invariante se cumple para hijos de grid, de caso límite y de
      extremo teórico en la misma expansión

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
- [ ] T4.2 Aplicar la regla a las **seis** superficies de R3, incluidos los extremos teóricos
- [ ] T4.3 Tests R11.4 (incluidos `fracval` + `base_parameters={"sintering_coeff":0.8}` y
      `fracval` + `theoretical_extremes`), R11.5 (barrido plano de `limiting` y sus extremos
      por defecto del servidor) y R11.6 (actualización parcial contra el
      `base_algorithm` de la instancia)
- [ ] T4.4 **Ningún test existente pasa a rojo por esta tarea** (verificado: todos los tests de
      la suite usan `tunable`, `tunable_cc` o `dla`, los tres dentro de la allow-list)

## T5 — Integridad de la expansión (R12)

- [ ] T5.1 Garantizar que toda la validación de T1 y T4 ocurre en
      `ParametricStudySerializer.validate()`, antes de la primera escritura
- [ ] T5.2 Tests R12.1 y R12.2: 400 con **cero** estudios, cero simulaciones y cero tareas
      encoladas (contar filas antes y después, y mockear `run_simulation_task.delay`)
- [ ] T5.3 **Ningún test existente pasa a rojo por esta tarea**

## T6 — Frontend (R10)

- [ ] T6.1 Función pura `toSinteringConfig(DistributionValue)` y su uso en el submit de
      `BatchSimulationForm`
- [ ] T6.2 `parameterOptions` (`BatchSimulationForm.tsx:313-318`): ofrecer "Sintering
      coefficient distribution" sólo para los seis algoritmos que lo consumen
- [ ] T6.3 Limpiar o marcar las variaciones que el nuevo algoritmo no acepta al cambiar de
      algoritmo (`setAlgorithm`, `BatchSimulationForm.tsx:358`, hoy no resetea `variations`)
- [ ] T6.3b El campo "Base Sintering Coeff." de `limiting` (`BatchSimulationForm.tsx:409-418`,
      enviado siempre en `:220`) no puede emitir `NaN`/`null` cuando se vacía
- [ ] T6.4 Tests R10.4 (opción ausente para `fracval`/`gcca`/`box_rfa`, presente para
      `ballistic`), R10.5 (forma del payload, y que el default de `uniform` del selector
      produce un payload aceptable sin edición) y R10.6 (cambio de algoritmo)
- [ ] T6.5 **Ningún test existente pasa a rojo por esta tarea** (verificado: los seis casos de
      `BatchSimulationForm.test.tsx` (son **9**, no 6) seleccionan `tunable_cc`, ninguno afirma
      la forma del payload enviado y ninguno cambia de algoritmo tras configurar una variación)
- [ ] T6.6 **No se toca** `DistributionSelector.tsx`: su default `min == max` con base `1.0` es
      válido para el sinterizado. Pertenece a `distribution-grid-wiring`

## T7 — Verificación

- [ ] T7.1 Gates de backend, **cada uno con su línea base medida** en este árbol. NO se
      encadenan con `&&`: así encadenados nunca llegan a `mypy` y el criterio sería
      insatisfacible.
      - `pytest` → base **15 failed, 31 errors, 1221 passed**. Los 31 errores son de *setup de
        fixtures* (`TypeError: User() got unexpected keyword arguments: 'username'`,
        `apps/accounts/models.py:26`), no de colección. Aceptación: los cuatro módulos de esta
        superficie en verde y la base global sin empeorar
      - `ruff check` → base **296 errores**. Aceptación: **cero nuevos** en los ficheros tocados
      - `mypy .` → base **1740 errores en 133 ficheros**. Aceptación: **cero nuevos** en los
        ficheros tocados
      Los cuatro módulos son `apps/simulations/tests/test_parametric_study_serializer.py`,
      `apps/simulations/tests/test_grid_expansion.py`, `backend/tests/test_utils.py` y
      `backend/tests/test_serializers.py`. Los otros cinco del mapa
      (`test_distribution_validation`, `test_distribution_field`, `test_distribution_plumbing`,
      `test_distribution_serializer`, `tests/integration/test_parametric_values_pipeline.py`)
      quedan fuera porque no tocan sinterizado (`test_distribution_plumbing.py:7` sólo lo
      menciona en un docstring). **Sí entra** `apps/simulations/tests/test_sintering_plumbing.py`,
      que es justo quien afirma los kwargs worker→engine de sinterizado
- [ ] T7.2 Gates de frontend, con su línea base:
      - `npm test` → base **55 ficheros, 597 tests**, en verde
      - `npm run type-check` → base **13 errores TS preexistentes**, salida **2**. Aceptación:
        cero nuevos
      - `npm run lint` existe (`next lint`) pero el repo no tiene configuración de ESLint, así
        que lanza el asistente interactivo: condición preexistente declarada
      - Nota: `npm run type-check` ensucia `frontend/tsconfig.tsbuildinfo`, que está trackeado.
        Restaurarlo tras correr el gate
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
- L2 (2026-10-21): **spec-review r1**: `CORRECTIONS REQUIRED (2 blockers, 3 majors)`. Los dos
  blockers eran míos y de fondo:
  - **"Tres superficies" era falso: son cinco.** Mapé por nombre de clave (`sintering_config`)
    en vez de por lo que lee el consumidor; el worker lee escalares planos. Confirmado con
    probe propia: `base_parameters={"sintering_coeff":0.6,...}` ACEPTADO,
    `parameter_grid={"sintering_coeff":[-5.0,42.0]}` ACEPTADO, `fracval` + flat ACEPTADO (burla
    la allow-list), `sintering_mean` legado ACEPTADO. Y el desplegable de `limiting` ofrece ese
    barrido plano como su única entrada de sinterizado.
  - **La precedencia que escribí era falsa**: `views.py:1804` popea del dict ya fusionado, así
    que es `grid > base_parameters > estudio`, no `grid > estudio`.
  Majors: la delta estaba **en español** y las canonicas son 100% inglés (habría dejado
  `openspec/specs/` bilingüe); el gate `pytest && ruff && mypy` es insatisfacible (296 / 1740 /
  13 errores preexistentes, y el `&&` corta antes); y "validar antes es la única opción" era
  falso (`transaction.on_commit` también sirve).
- L3 (2026-10-21): Decisión de la persona: las superficies planas **entran** en alcance.
- L4 (2026-10-21): **Corrección r2** (este commit): delta reescrita **en inglés** con las cinco
  superficies, precedencia de cuatro niveles, R3.8/R3.9 nuevos, R10.6 (cambio de algoritmo),
  R11.4 extendido a las cinco superficies, R11.6 (actualización parcial); líneas base de los
  cinco gates declaradas; `on_commit` nombrado como alternativa descartada por alcance;
  declaraciones de "ningún test a rojo" en T1/T4/T5/T6; y declarados como fuera de alcance el
  bloque hermano de extremos de sinterizado (R17) y la condición del CSV.
- L6 (2026-10-21): **spec-review r2**: `CORRECTIONS REQUIRED (1 blocker, 7 majors)`. Las cinco
  líneas base declaradas se verificaron exactas (salvo que `type-check` sale con 2, no 1).
  - **BLOCKER: hay una sexta superficie.** `limiting_cases_config.theoretical_extremes` escribe
    sus claves verbatim en cada hijo (`utils.py:199-203`) y su validador sólo mira los tres
    nombres de primer nivel. Confirmado por mí: `{"sintering_coeff":[42.0],"sintering_mean":[0.9]}`
    → 201. Falsificaba cinco afirmaciones normativas de la delta a la vez.
  - Majors: precedencia distinta por forma; exigir `sintering_type` rompería **todos** los
    envíos de `limiting`; los planos no tenían tabla de campos requeridos; `limiting` tiene dos
    entradas de sinterizado, no una; la limpieza de claves heredadas no tenía dueño
    implementable; el MUST "venga de donde venga" lo falsifican las rutas de simulación
    individual; y la canónica **R7** prometía comportamiento idéntico para grids sin claves
    nuevas, lo que contradice el rechazo de `{"sintering_coeff":[42.0]}`.
  - **Rechazado tras verificarlo**: m8 ("los proposal archivados están en inglés") es falso —
    los dos archivados de 2026-10-19 los tienen en español. Y `perform_create` está en
    `views.py:1750`, no `:1749`: la r1 me había corregido hacia el error.
- L7 (2026-10-21): Decisión de la persona: **cambiar el enfoque**. La garantía deja de
  enunciarse como lista de superficies.
- L8 (2026-10-21): **Corrección r3** (este commit). R11 pasa a ser un **invariante del hijo en
  el cuello de botella** (`create_simulation`, por donde pasan grid, casos límite y extremos
  teóricos), acotado a la expansión de estudios; las seis superficies quedan como capa de 400
  antes de escribir (R3/R12). Añadidos: tabla propia para la forma plana, `coeff` sin tipo =
  `fixed`, precedencia por forma, dueño explícito de la limpieza (`apply_sintering_config`,
  no el serializer, para no cambiar la física de los casos límite), **R7 MODIFIED** con
  carve-out, y las dos entradas de sinterizado de `limiting`.
- L9 (2026-10-21): Decisiones de diseño con su alternativa descartada: regla única en las tres
  superficies (DD1); el helper lanza pero nunca es el primero en enterarse (DD2); validar antes
  de escribir en vez de `transaction.atomic`, porque una tarea Celety ya despachada no se
  deshace con un rollback (DD3); `sintering_coeff` es la media (DD4); allow-list de once
  algoritmos con `limiting` sólo-`fixed` (DD5).
