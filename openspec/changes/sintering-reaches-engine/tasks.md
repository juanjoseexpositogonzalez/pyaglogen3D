# Tasks: sintering-reaches-engine

> Estado del contrato: **spec-review pendiente** (agente fresco) y aprobación de la persona.
> Desde el 2026-10-22 (issue #82) el gate es una **issue de GitHub con la etiqueta
> `status:approved`**, no un `approval.md`. **No se escribe código hasta que exista.**
>
> Rama: `feature/sintering-reaches-engine`, con `develop` @ `f586946` ya fusionado (el merge
> es `f5c93b4`, que sólo existe en esta rama). La base original era `c3ff055`; dos merges de
> `develop` la movieron, y con ella la línea base de frontend.
> Mapa de origen: `openspec/changes/_explore-only/distribution-config-surface.md` §7.1.
> Jira: pendiente de crear al aprobar (issue AGLO, transición 21 → En curso).

## T0 — Contrato

- [x] T0.1 Mapa de superficie consolidado y entregado (PR #81)
- [x] T0.2 Contrato r1 (`95d41ca`)
- [x] T0.3 spec-review r1 → `CORRECTIONS REQUIRED (2 blockers, 3 majors)`
- [x] T0.4 Decisión de la persona: las superficies planas **entran** en alcance
- [x] T0.5 Corrección r2 (este commit)
- [x] T0.6 spec-review r2 → `CORRECTIONS REQUIRED (1 blocker, 7 majors)`
- [x] T0.7 Decisión de la persona: **invariante donde se escriben los parámetros del hijo**
      + validación de entrada (dicho antes «el chokepoint», en singular, cuando son dos sitios)
- [x] T0.8 Corrección r3 (este commit)
- [x] T0.9 spec-review r3 → `CORRECTIONS REQUIRED (1 blocker, 8 majors)`
- [x] T0.10 Decisión de la persona: **unificar los dos sitios de creación**
      — **revocada** por el recorte de 14d0b13: no se unifican. El bloque inline ya escribe el
      sinterizado donde el engine lo lee; sólo se le retira el `sintering_config` heredado (R11.7)
- [x] T0.11 Corrección r4 (este commit)
- [x] T0.12 spec-review r4 → `CORRECTIONS REQUIRED (1 blocker, 4 majors)`
- [x] T0.13 Decisión de la persona: `base_parameters` **gana siempre**, inversión declarada
      — **revocada** por el recorte de 14d0b13: no hay ninguna inversión y el orden de hoy se
      conserva tal cual
- [x] T0.14 Corrección r5 (este commit)
- [x] T0.15 spec-review r5 → `CORRECTIONS REQUIRED (1 blocker, 2 majors)`
- [x] T0.16 Corrección r6 (este commit)
- [x] T0.17 spec-review r6 en agente fresco
- [x] T0.18 Correcciones hasta ronda sin hallazgos semánticos → **criterio de parada
      redefinido por la persona (2026-10-22): los blockers.** Cumplido desde la r10: r10, r11 y
      r12 dieron **cero**. El criterio original no convergía, y no por el contrato: desde la
      r11, los majors y buena parte de los minors los introducía la corrección de la ronda
      anterior, así que cada ronda generaba el material de la siguiente. Blockers 3, 2, 1, 0,
      0, 0; majors clavados en 2 cuatro rondas; minors subiendo 3, 2, 6, 6, 8, 9
- [x] T0.19 Issue con `status:approved` — **sólo la persona aprueba**. **#97 aprobada por la
      persona el 2026-10-22**; etiqueta `status:needs-approval` retirada
- [x] T0.20 **AGLO-10** creada y pasada a **En curso** (transición 21, confirmada por la API)
- [x] T0.21 Recorte de alcance (14d0b13): fuera la precedencia **y** la unificación de los dos
      sitios; la superficie 7 conserva el camino que funciona hoy
- [x] T0.22 spec-review r7 → `CORRECTIONS REQUIRED (3 blockers, 3 majors, 3 minors)`; corregida
      en 1d8b4fb tras alinear sólo media parte del recorte en 6f52d05
- [x] T0.23 spec-review r8 → `CORRECTIONS REQUIRED (2 blockers, 3 majors, 2 minors)`
- [x] T0.24 spec-review r9 → `CORRECTIONS REQUIRED (1 blocker, 2 majors, 6 minors)`
- [x] T0.25 spec-review r10 → `CORRECTIONS REQUIRED (0 blockers, 2 majors, 6 minors)`
- [x] T0.26 spec-review r11 → `0 blockers, 2 majors, 8 minors`; primera ronda que pudo correr
      las suites, tras destrackear `tsconfig.tsbuildinfo` (PR #96)
- [x] T0.27 spec-review r12 → `CORRECTIONS REQUIRED (0 blockers, 2 majors, 9 minors)`; la
      barrida de residuos del recorte salió **vacía** por primera vez en seis rondas
- [~] T0.28 spec-review r13 — **no se hace**: criterio de parada cumplido (T0.18)

## T1 — Regla única de forma, en las siete superficies (D2, D5b, R3)

- [x] T1.1 `validate_sintering_config` (`serializers.py:360`): exigir `distribution_type`
      conocido, exigir los campos requeridos por tipo, rechazar claves fuera de
      `{distribution_type, coefficient, min, max, mean, std}`
- [x] T1.2 Distinguir los dos contextos de llamada: como validador del **campo de estudio** y
      de `base_parameters` acepta `None`/`{}`; como validador de una **entrada de grid** los
      rechaza
- [x] T1.3 Validar `base_parameters["sintering_config"]`, que hoy no valida nadie (D5b)
- [x] T1.4 Validar los **escalares planos** `sintering_*` en `base_parameters`, como claves de
      `parameter_grid` y dentro de `limiting_cases_config.theoretical_extremes` (superficies 4,
      5 y 6): tabla propia de campos requeridos por tipo, rangos, `sintering_coeff` sin tipo =
      `fixed`, y rechazo de cualquier otra `sintering_*` — en particular `sintering_mean`
- [x] T1.5 **No tocar la precedencia** (R3): el orden de hoy se conserva tal cual. En el camino
      que pasa por `create_simulation`, cualquier dict gana a cualquier clave plana, y entre
      dicts manda grid, luego `base_parameters`, luego el campo de estudio. El bloque de
      extremos (`views.py:1869-1906`) está **exento de ese orden** y sigue estándolo: ahí el
      plano sobrevive al dict. La tarea es **validar** los ajustes sin reordenarlos; si al
      implementar aparece la tentación de invertir algo, es señal de que pertenece al contrato
      de seguimiento
- [x] T1.5a Verificar con un test de regresión que el orden **no cambia**, en los dos caminos:
      el mismo payload que hoy resuelve a un ganador debe seguir resolviendo al mismo, y el
      hijo de extremos debe seguir corriendo a su propio plano. No lo respalda ningún escenario
      de la delta, y es deliberado: lo que se protege es la ausencia de cambio
- [x] T1.5b Superficie 7: un dict **bien formado** barrido por `theoretical_extremes` funciona
      hoy y **debe seguir funcionando** (R3.9); lo que se rechaza es la forma `{mode, …}`
      malformada, como en cualquier otra superficie
- [x] T1.5c En las superficies barridas (5 y 6) la comprobación de campos requeridos se hace
      sobre la **proyección fusionada** del hijo (base + valor barrido); rango y claves
      desconocidas, por clave
- [x] T1.6 Tests R3.3, R3.5, R3.6, R3.7, **R3.8** (planos, `-5.0`/`42.0`, `sintering_mean`,
      `coeff` sin tipo, `uniform` incompleto), **R3.9** (extremos teóricos, incluido el dict
      bien formado que se acepta) y **R3.10** (el helper no inventa ningún default)
- [x] T1.7 Regresión: R3.1, R3.2 y R3.4 siguen verdes
- [~] T1.7a Regresión de los escenarios canónicos restituidos verbatim y sin tarea propia:
      R7.1, R7.2, R10.1, R10.2 y R10.3 siguen verdes. **A medias**: R7.1 y R7.2 cubiertos en
      `tests/test_sintering_precedence_regression.py`; R10.1-R10.3 son de **frontend** y no se
      pueden cubrir con pytest, así que van con `npm test` en T6
- [x] T1.8 **Ningún test existente pasa a rojo por esta tarea** (verificado: los tests de
      sinterizado de `tests/test_serializers.py:209-341`, `test_grid_expansion.py:216-260` y
      `test_parametric_study_serializer.py:126-152` usan configuraciones completas y algoritmos de la allow-list)

## T2 — El helper deja de inventar defaults (R3)

- [x] T2.1 `apply_sintering_config` (`utils.py:236`): lanzar `ValueError` ante dict no vacío que
      incumpla T1.1, incluido `distribution_type` desconocido; `None`/`{}` siguen devolviendo
      los parámetros intactos
- [x] T2.2 Test **R3.10** (el helper no inventa default: lanza en vez de rellenar)
- [x] T2.3 **Test existente que esta tarea pone en rojo y se retira** (declaración completa):
      - `backend/tests/test_utils.py:336-344` `test_default_values_used` — afirma que
        `apply_sintering_config({"distribution_type":"uniform"})` rellena `0.85`/`0.95` por
        defecto. Es la forma codificada del defecto D2; R3 exige que lance
- [x] T2.3b Test **R7.3**, el carve-out: la compatibilidad hacia atrás no ampara el
      sinterizado malformado ni el cambio de la media `normal`, incluido el payload `value`
      que la canónica documenta
- [x] T2.4 Regresión declarada: `test_none_config_returns_unchanged` y
      `test_empty_config_returns_unchanged` (`backend/tests/test_utils.py:319-334`) **siguen
      verdes sin cambios**

## T3 — El invariante del hijo y el engine (D5, R11)

- [x] T3.0 **No unificar los sitios de creación**, pero sí cerrar R11 en el bloque inline.
      No se unifica: `generate_sintering_extreme_cases` (`utils.py:227-231`) ya escribe
      `sintering_type` y `sintering_coeff` planos, claves que el worker lee
      (`tasks.py:1592-1598`). Lo que sí hay que arreglar es que copia `base_parameters` entera
      (`utils.py:228`) y el pop de `sintering_config` vive sólo en `create_simulation`
      (`views.py:1804`), así que esos hijos almacenan un `sintering_config` que **contradice** el
      coeficiente al que corren. Retirarlo (R11.7). Verificado con probe: base con
      `coefficient: 0.7` produce un hijo que corre a `0.5` y guarda `0.7`
- [x] T3.0a Implementar el **invariante de R11** donde se escriben los parámetros del hijo:
      claves **contenidas** en el conjunto que el worker lee. Eso es todo lo que R11 exige en
      la escritura: la completitud de campos y el rango son de **R3**, en la validación de
      entrada, y no se recomprueban aquí. «Contenidas», no «exactamente
      las del dict»: eso último lo exigía la regla de limpieza que el recorte eliminó, y
      ningún requisito vigente lo pide. **No confundirla con la R11.7 actual**, que es otra
      cosa: retirar `sintering_config` de los hijos de extremos
- [x] T3.0b **Dueño de cada limpieza, que son dos y distintas.** En el camino por
      `create_simulation` ya la hace el pop de `views.py:1804`: no hay nada que añadir. En el
      bloque de extremos la hace **`generate_sintering_extreme_cases`** (`utils.py:227-231`),
      que es quien construye esos parámetros; no `apply_sintering_config`, que ese bloque no
      llama a propósito (`views.py:1875-1876`) y que no debe llamar, porque le aplicaría el
      dict de estudio y le borraría su coeficiente. Tampoco el serializer: un hijo de caso
      límite hereda los planos de `base_parameters` (`utils.py:185-203`) y limpiar ahí se los
      quitaría aunque no aplique ningún dict
- [x] T3.0c Test **R11.3** (grid, caso límite, extremo teórico y extremo de sinterizado en la
      misma expansión)
- [x] T3.0d Alcance de esa retirada (la orden está en T3.0, aquí sólo su límite): lo que se
      retira es `sintering_config`, porque R11 prohíbe escribir claves de sinterizado fuera del
      conjunto del worker. **No** se retiran las `sintering_*` planas heredadas: están dentro
      del conjunto y ningún requisito vigente pide quitarlas
- [x] T3.0e **Ningún test existente pasa a rojo por T3** (verificado: ningún test cubre los
      hijos creados en `views.py:1889`; `grep -rn sintering_extreme` sobre el backend devuelve
      también `views.py:1766,1871` y, en `tests/test_utils.py`, la clase
      `TestGenerateSinteringExtremeCases` (`:15,234,240,252,255,267`) más `:369`. Esa clase sí
      cubre la función que T3.0 pasa a modificar: comprobado que sus tres tests usan
      `base_params` **sin** `sintering_config`, así que retirarlo los deja verdes;
      `include_limiting_cases` aparece en tests en `tests/test_serializers.py:412,431` y en
      `tests/test_models.py:132,138,186`, ninguno con sinterizado; los de `test_models` crean el
      estudio por ORM (`:126`) sin pasar por `perform_create`, así que no pueden ponerse en rojo)
- [x] T3.0f Test **R11.7**: ningún hijo de extremos lleva `sintering_config`, y cada uno
      conserva el plano de su propio extremo
- [x] T3.0g **Que esos hijos se creen sin `seed_type`** viola `cc-tunable-aggregation` R17, pero
      **no** es uno de los cuatro defectos: va al contrato de seguimiento, no aquí
- [x] T3.1 `apply_sintering_config`: escribir `sintering_coeff` (no `sintering_mean`) para el
      tipo `normal`; retirar `sintering_mean`, que ningún consumidor de producción lee
- [x] T3.2 **Test existente que esta tarea pone en rojo y se reescribe** (declaración completa):
      - `backend/tests/test_utils.py:304-317` `test_normal_sintering` — afirma
        `result["sintering_mean"] == 0.9`; pasa a afirmar `result["sintering_coeff"] == 0.9`
- [x] T3.3 Test R11.1 de **borde de engine**: mock sobre el binding, afirmando que la media que
      llega es 0.8 y **no** 1.0
- [x] T3.4 Tests R11.2 y R11.3 (ninguna clave fuera del conjunto que el worker lee)

## T4 — Alcance por algoritmo (D6, R11)

- [x] T4.1 Allow-list en la validación: sinterizado completo para los seis algoritmos que lo
      consumen; sólo `fixed` para `limiting`; rechazo para `fracval`/`gcca`/`box_rfa`/`imported`
- [x] T4.2 Aplicar la regla a las **siete** superficies de R3, incluidos los extremos teóricos
- [x] T4.2a En un **update parcial** que omita `base_algorithm`, evaluar la allow-list contra el
      `base_algorithm` guardado en la instancia, no contra el ausente (R11, R11.6)
- [x] T4.3 Tests R11.4 (incluidos `fracval` + `base_parameters={"sintering_coeff":0.8}` y
      `fracval` + `theoretical_extremes`), R11.5 (barrido plano de `limiting` y sus extremos
      por defecto del servidor) y R11.6 (actualización parcial contra el
      `base_algorithm` de la instancia)
- [x] T4.4 **Ningún test existente pasa a rojo por esta tarea** (verificado: todos los tests de
      la suite usan `tunable`, `tunable_cc` o `dla`, los tres dentro de la allow-list)

## T5 — Integridad de la expansión (R12)

- [x] T5.1 Garantizar que toda la validación de T1 y T4 ocurre **antes de la primera
      escritura**. Enunciado corregido tras el judgment-day: la redacción original decía
      «en `ParametricStudySerializer.validate()`» y es **falsa**, porque la forma de la
      superficie 2 la valida `validate_sintering_config` (`serializers.py:366`), un validador
      **de campo** que DRF ejecuta en `to_internal_value`, antes de `validate()`. Lo que el
      contrato exige es la propiedad —nada se escribe sin validar—, no el método, y dejar el
      enunciado viejo invitaba a mover comprobaciones que hoy funcionan
- [x] T5.2 Tests R12.1 y R12.2: 400 con **cero** estudios, cero simulaciones y cero tareas
      encoladas (contar filas antes y después, y mockear `run_simulation_task.delay`)
- [x] T5.3 **Ningún test existente pasa a rojo por esta tarea**

## T6 — Frontend (R10)

- [x] T6.1 Función pura `toSinteringConfig(DistributionValue)` y su uso en el submit de
      `BatchSimulationForm`
- [x] T6.2 `parameterOptions` (`BatchSimulationForm.tsx:313-318`): ofrecer "Sintering
      coefficient distribution" sólo para los seis algoritmos que lo consumen
- [x] T6.3 Limpiar o marcar las variaciones que el nuevo algoritmo no acepta al cambiar de
      algoritmo (`setAlgorithm`, `BatchSimulationForm.tsx:358`, hoy no resetea `variations`)
- [x] T6.3b El campo "Base Sintering Coeff." de `limiting` (`BatchSimulationForm.tsx:409-418`,
      enviado siempre en `:220`) no puede emitir `NaN`/`null` cuando se vacía
- [x] T6.4 Tests R10.4 (opción ausente para `fracval`/`gcca`/`box_rfa`, presente para
      `ballistic`), R10.5 (forma del payload, y que el default de `uniform` del selector
      produce un payload aceptable sin edición) y R10.6 **entera**: el payload tras cambiar de
      algoritmo no lleva `sintering_coeff`, o lleva uno válido, nunca `null` ni `NaN` (primer
      THEN), y el cambio limpia o marca lo que ya no aplica (el AND)
- [x] T6.5 **Ningún test existente pasa a rojo por esta tarea** (verificado: los **nueve** casos
      de `BatchSimulationForm.test.tsx` seleccionan `tunable_cc`, ninguno afirma
      la forma del payload enviado y ninguno cambia de algoritmo tras configurar una variación)
- [x] T6.6 **No se toca** `DistributionSelector.tsx`: su default `min == max` con base `1.0` es
      válido para el sinterizado. Pertenece a `distribution-grid-wiring`

## T7 — Verificación

- [ ] T7.1 Gates de backend, **cada uno con su línea base medida** en este árbol. NO se
      encadenan con `&&`: así encadenados nunca llegan a `mypy` y el criterio sería
      insatisfacible.
      - `pytest` → base **15 failed, 31 errors, 1221 passed**. Los 31 errores son de *setup de
        fixtures* (`TypeError: User() got unexpected keyword arguments: 'username'`,
        `apps/accounts/models.py:26`), no de colección. Aceptación: los **cinco** módulos de esta
        superficie en verde y la base global sin empeorar
      - `ruff check` → base **296 errores**. Aceptación: **cero nuevos** en los ficheros tocados
      - `mypy .` → base **1740 errores en 133 ficheros**. Aceptación: **cero nuevos** en los
        ficheros tocados
      Los cinco módulos son `apps/simulations/tests/test_parametric_study_serializer.py`,
      `apps/simulations/tests/test_grid_expansion.py`, `backend/tests/test_utils.py`,
      `backend/tests/test_serializers.py` y
      `apps/simulations/tests/test_sintering_plumbing.py` (base conjunta: **89 passed**). Los otros cinco del mapa
      (`test_distribution_validation`, `test_distribution_field`, `test_distribution_plumbing`,
      `test_distribution_serializer`, `tests/integration/test_parametric_values_pipeline.py`)
      quedan fuera porque no tocan sinterizado (`test_distribution_plumbing.py:7` sólo lo
      menciona en un docstring). **Sí entra** `apps/simulations/tests/test_sintering_plumbing.py`,
      que es justo quien afirma los kwargs worker→engine de sinterizado. (La "guarda declarada"
      de la ronda anterior era **falsa**: ese test sí aporta `sintering_min`/`sintering_max`
      en `:142-143` y no postea nada, escribe por ORM. No hay riesgo que declarar.)
- [ ] T7.2 Gates de frontend, con su línea base:
      - `npm test` → base **58 ficheros, 624 tests**, medida sobre la rama con `f586946` dentro. La base anterior
        (55/597) era la de `c3ff055`: los merges de `develop` (hasta `f586946`) añadieron
        `chart-theme.test.ts`
        (16), `globals-tokens.test.ts` (6) y `tailwind-config.test.ts` (5), que son los 3
        ficheros y 27 tests de diferencia. Nota sobre `FraktalBatchImageDetail.test.tsx >
        comprehensive variant toggle (T6.5)`: una ronda anterior declaró **dos** tests
        inestables en la corrida completa, pero **dos corridas completas consecutivas sobre
        `f5c93b4` dieron 624/624 verdes**. Queda como aviso, no como hecho reproducible: si
        aparece, no atribuirlo a este change
      - `npm run type-check` → base **13 errores TS preexistentes**, salida **2**. Aceptación:
        cero nuevos
      - `npm run lint` existe (`next lint`) pero el repo no tiene configuración de ESLint, así
        que lanza el asistente interactivo: condición preexistente declarada
      - Nota: `frontend/tsconfig.tsbuildinfo` **ya no está trackeado** (PR #96), así que correr
        los gates no ensucia el árbol. Antes sí, y por eso cuatro rondas de revisión no
        pudieron reproducir estas cifras.
- [ ] T7.3 Engine: este change **no toca `aglogen_core/`** (`git diff c3ff055..HEAD --
      aglogen_core` sale vacío), pero la línea base **sí** se declara, porque medirla no cuesta
      nada y cuatro rondas la arrastraron como duda. Medida sobre `39207e0` con
      `PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1 cargo test -p aglogen-engine --release`, salida
      **0**: **374 passed, 0 failed, 5 ignored** en seis binarios — `src/lib.rs` 329 de 330
      (1 ignorado), `bc_windowed_test` 11 de 12 (1), `cc_tunable_high_df_test` 9, 
      `cc_tunable_low_df_test` 12, `integration_cc_tunable` 13 de 14 (1) y doc-tests 0 de 1 (1).
      Aceptación: **cero nuevos fallos**. Tarda unos 7 minutos en release; tres tests de
      rollback pasan de 60 s cada uno, así que no es un gate para correr a cada commit
- [ ] T7.4 Verificación manual: estudio batch `ballistic` con sinterizado normal(0.8, 0.05) →
      comprobar en los parámetros del hijo y en el resultado que la media aplicada es **0.8**

## T8 — Cierre

- [ ] T8.1 judgment-day (revisión adversarial dual, agentes frescos en sesión nueva)
- [ ] T8.2 Fix rounds hasta APPROVED
- [x] T8.2b Estilo de encabezado: ya no hay dos estilos. `bb54fae` (PR #86) migró la canónica a
      `### Requirement: R3 — …`, el mismo que usa la delta, así que copiarla es directo
- [ ] T8.3 Archive + sincronización canónica de `batch-cc-tunable-parameter-parity` (bloques
      MODIFIED/ADDED completos, nunca diferidos) + `state.yaml`
- [ ] T8.4 PR a `develop` con etiqueta `type:bug` enlazando el issue AGLO
- [ ] T8.5 Comentario de entrega en Jira **haciendo constar** que los resultados batch
      anteriores con `sintering_config`, y los de cualquier estudio con sinterizado `normal`,
      se ejecutaron sin el sinterizado declarado; y transición 41
- [ ] T8.6 Arrancar el siguiente contrato de la cadena: `distribution-grid-wiring`

## Log

> **Sobre los huecos L5, L9, L13, L17 y L20.** No falta nada. Eran los números que fue
> ocupando, y vacando, el resumen de decisiones de diseño: mientras fue la última entrada,
> cada ronda insertaba las suyas antes y lo renumeraba (L5 en `89079e0`, L9 en `fa0563c`,
> L13 en `f977d3a`, L17 en `4ec9b5e`, L20 en `c82cb77`). Dejó de serlo en `262e08d`, y desde
> entonces no se abrió ningún hueco más. Recuperable entero con
> `git show 89079e0:openspec/changes/sintering-reaches-engine/tasks.md`. Ahora vive **sin
> número**, porque no es un suceso con fecha: eso es lo que debió ser desde el principio,
> aunque llevara número desde `89079e0`.
>
> Los huecos se quedan. Las entradas numeradas son **21**, con L26 como número más alto —
> confundir el número más alto con el recuento es justo el error que los creó. Renumerarlas
> reescribiría la historia de un registro cuyo valor es ser inmutable, y los mensajes de
> commit de este change ya citan rondas por su número; dentro del repositorio no hay ninguna
> referencia cruzada a estos L.

- **Decisiones de diseño vigentes** (resumen permanente, sin número de entrada: no es un
  suceso con fecha sino el estado actual de las decisiones, y se actualiza en el sitio).
  Cada una con su alternativa descartada: regla única en las siete superficies (DD1); el helper
  lanza pero nunca es el primero en enterarse (DD2); validar antes de escribir en vez de
  `transaction.atomic`, porque una tarea Celery ya despachada no se deshace con un rollback
  (DD3); `sintering_coeff` es la media (DD4); allow-list de once algoritmos con `limiting`
  sólo-`fixed` (DD5).

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
- L10 (2026-10-21): **spec-review r3**: `CORRECTIONS REQUIRED (1 blocker, 8 majors)`. Las seis
  líneas base declaradas se reprodujeron exactas.
  - **BLOCKER: la premisa del chokepoint era falsa.** `perform_create` crea hijos en **dos**
    sitios: `views.py:1826` (dentro de `create_simulation`) y `views.py:1889` (inline, extremos
    de sinterizado). Confirmado por mí. Lo afirmé como "verificado" tras leer sólo `:1867`, y
    este mismo contrato describía el segundo sitio en su sección de fuera de alcance.
  - Majors: la cláusula 2 del invariante era insatisfacible para los hijos sin sinterizado; la
    superficie 6 también admite **dict** (y eso reintroduce D2 entero); el bullet 2 de
    precedencia era falso y contradecía al bullet 3; la canónica R7.2 se retiraba en silencio
    mientras el inventario decía "ninguno"; R7.2 chocaba con el cambio de la media `normal`;
    el alcance de R11 vivía sólo en `proposal.md`, que **no se archiva**; el rationale de la
    limpieza era medio falso; y la forma plana no decía qué pasa con claves extra del conjunto.
- L11 (2026-10-21): Decisión de la persona: **unificar los dos sitios de creación**.
- L12 (2026-10-21): **Corrección r4** (este commit). R11 exige **un solo constructor** y lo
  convierte en requisito en vez de premisa; el bloque de extremos de sinterizado entra en
  alcance y gana `seed_type` (cierra R17). Añadidos: superficie 7 (dict por extremos teóricos,
  R3.12), precedencia **por niveles** con la inversión declarada, cláusula 2 con guarda, R7.2
  canónica restaurada verbatim con las nuevas como R7.3/R7.4, alcance de R11 con sus
  exclusiones **dentro de la spec**, regla de claves extra del conjunto, y R11.7. Anclas
  corregidas (`views.py:1750`, `tsx:294`, R7 canónica en `:213-227`).
- L14 (2026-10-21): **spec-review r4**: `CORRECTIONS REQUIRED (1 blocker, 4 majors)`. Dos
  cierres importantes: la **enumeración de superficies por fin aguanta** (el revisor enumeró
  *escritores* de parámetros, no claves, y no encontró una octava) y el **blocker del
  constructor único queda cerrado**. Las seis líneas base se reprodujeron exactas.
  - **BLOCKER: una segunda inversión de precedencia sin declarar, mía.** Afirmé que
    `base_parameters` gana al campo de estudio; cierto en forma dict, **falso en forma plana**
    (`apply_sintering_config` la pisa, `views.py:1808`). Confirmado con probe propia. Y el
    único escenario de precedencia que escribí ejercitaba sólo el caso dict, así que habría
    pasado antes y después.
  - Majors: `sintering_config` es también una clave `sintering_*`, así que mi regla plana
    contradecía las superficies 1 y 3; el cuarto bullet de R11.7 no tenía dueño implementable;
    el título de R12 prometía más de lo que su cuerpo exige (D7 sigue abriendo estudios a
    medias y sólo estaba declarado en `proposal.md`, que no se archiva); y la unidad de
    validación plana quedaba indefinida en las superficies barridas.
  - **Rechazado tras verificarlo**: la "guarda declarada" de T7.1 era falsa por mi parte, no
    del revisor — él la desmontó: ese test sí trae `min`/`max` y escribe por ORM.
- L15 (2026-10-21): Decisión de la persona: `base_parameters` **gana siempre**.
- L16 (2026-10-21): **Corrección r5** (este commit). Declarada la segunda inversión (inventario
  11, R3 y R3.10); `sintering_config` excluida de la regla de claves planas; el constructor
  retira `sintering_config` y las claves heredadas en ambos modos (R11.7 con regla ejecutable);
  R12 renombrado a lo que de verdad exige, con D7 nombrado **dentro** de la spec; unidad de
  validación fijada para las superficies barridas; añadidos al inventario la canónica R4 y la
  divergencia del desplegable de `limiting`; y corregidos conteos, anclas y la nota del flaky.
- L18 (2026-10-22): **spec-review r5**: `CORRECTIONS REQUIRED (1 blocker, 2 majors)`. Seis
  líneas base exactas; la enumeración de superficies **vuelve a aguantar**.
  - **BLOCKER: tercera inversión de precedencia.** La encontré yo con una probe mientras la r5
    corría, y ella la confirmó: hoy cualquier dict gana a cualquier plano, así que un dict en
    `base_parameters` pisa un valor barrido para ese hijo. Declaraba dos cambios y producía tres.
  - **MAJOR: el modelo no era implementable donde lo ponía.** Dos payloads distintos llegan al
    constructor como el mismo dict fusionado y exigen resultados opuestos: falta la procedencia.
  - **MAJOR: los hijos de frontera de rango** no estaban en el nivel 1 y sufren la misma mentira
    de nombre: hoy `boundary_min: sintering_coeff=0.6` corre a 0.95.
  - Minors: el payload `{distribution_type:"fixed", value:0.9}` que la **propia canónica
    documenta** pasa a dar 400 (hoy 201 y el hijo corre sin sinterizar); y mi afirmación de que
    un hijo "se lleva ambas" claves era falsa, `add_case` emite un hijo por clave.
- L19 (2026-10-22): **Corrección r6**. Inventario 14 (tercera inversión) y 15 (payload
  `value`); los hijos de frontera entran en el nivel 1; R11 exige que el **llamante resuelva**
  la precedencia y pase el ajuste ganador; cuatro cláusulas nuevas en R3.10 y una en R7.4;
  corregidos el ancla `utils.py:180`, la evidencia de T1.8/T3.0e y los conteos.
- L21 (2026-10-22): **Recorte de alcance** (`14d0b13`): fuera la precedencia y la unificación de
  los dos sitios de creación. `6f52d05` alineó sólo la precedencia, porque el último párrafo de
  `14d0b13` sólo avisaba de ella: un mensaje que infradescribe su propio alcance envenena el
  commit siguiente.
- L22 (2026-10-22): **spec-review r7** (`1d8b4fb`): `CORRECTIONS REQUIRED (3 blockers, 3 majors,
  3 minors)`. B1 fue el recorte a medias. Comprobado que no dejaba agujero en D5: el bloque
  inline ya escribe los planos que lee el worker (`utils.py:227-231`). El `seed_type` que le
  falta viola `cc-tunable-aggregation` R17, pero no es uno de los cuatro defectos: al
  seguimiento, que acumula ya tres puntos.
- L23 (2026-10-22): **spec-review r8**: `CORRECTIONS REQUIRED (2 blockers, 3 majors, 2 minors)`.
  Declaró limpios el formato, las referencias a escenarios y lo derivado al seguimiento. Su M3
  no era residuo sino defecto nuevo: el `pop` de `sintering_config` vive sólo en
  `create_simulation`, así que los hijos de extremos almacenan un dict que **contradice** el
  coeficiente al que corren. Probe: base con `coefficient: 0.7` → hijo que corre a `0.5` y
  guarda `0.7`. Decisión de la persona: arreglarlo aquí, no derivarlo. De ahí R11.7.
- L24 (2026-10-22): **spec-review r9** (`663a7b5`): `1 blocker, 2 majors, 6 minors`. El blocker
  fue una frase que sobrevivió intacta a la reescritura de su propio párrafo y seguía nombrando
  a `apply_sintering_config` como dueño de una limpieza que no puede hacer.
- L25 (2026-10-22): **spec-review r10** (`27afba1`): `0 blockers, 2 majors, 6 minors`. Mismo
  patrón una capa más abajo: *"eso cierra también el `sintering_mean` legado"*, cierta cuando se
  escribió y falsa tras dos estrechamientos de la regla que la precedía.
- L26 (2026-10-22): **spec-review r11**: `0 blockers, 2 majors, 8 minors`, y la primera que pudo
  **correr las suites**. Las cinco cifras de backend salieron exactas; la de frontend estaba
  obsoleta por los merges de `develop`. Su M2 fue un superviviente de `95d41ca`: DD3 seguía
  enumerando tres superficies cuando el contrato exige siete desde hace cinco commits.
- L27 (2026-10-22): **spec-review r12**: `0 blockers, 2 majors, 9 minors`. Primer dato nuevo en
  seis rondas: la barrida de residuos del recorte de `14d0b13` salió **vacía**, declarada así de
  forma explícita. Los dos majors son el patrón del superviviente por sexta vez, y ambos los
  introduje o los dejé yo: una orden sin objeto en T7.2 (*"Restaurarlo tras correr el gate"*),
  superviviente de `89079e0` bajo el párrafo que `79d2e87` reescribió para decir lo contrario; y
  la clave de **Nomenclatura** de `design.md`, que seguía diciendo `DD1…DD5` cuando `DD0` nació
  en `1d8b4fb` y es la decisión que carga el recorte. Cuatro de los nueve minors eran errores de
  la nota de huecos que yo mismo escribí en `39207e0`, incluido confundir el número más alto
  (L26) con el recuento (21) — el mismo error que creó los huecos.
- L28 (2026-10-22): **Criterio de parada, decisión de la persona**: los blockers, no «ronda sin
  hallazgos semánticos». Seis rondas de revisión (r7-r12) con agente fresco: los blockers se
  extinguieron (3, 2, 1, 0, 0, 0) pero los majors se quedaron en 2 durante cuatro rondas y los
  minors crecieron (3, 2, 6, 6, 8, 9). La causa no es el contrato: desde la r11 los hallazgos
  eran defectos **de las correcciones**, no del contrato — el patrón del superviviente, frases
  que quedan justificando la versión anterior del párrafo que las rodea. Un bucle que se
  alimenta de sí mismo no converge. Se cierra la fase de revisión y el contrato pasa al gate
  humano.
- L29 (2026-10-22): **Contrato aprobado**. La persona puso `status:approved` en **#97** y
  **AGLO-10** pasó a En curso. Queda autorizada la implementación del contrato tal y como está.
  A partir de aquí el contrato **no se cambia por el camino**: si la implementación obliga a
  tocar `proposal.md`, `specs/` o una decisión de `design.md`, se para y se pide nueva
  aprobación. `tasks.md` sí se actualiza al avanzar, con su evidencia en este Log.
- L30 (2026-10-22): **T1 implementada** (D2, D5b, R3). Test-first: 14 rojos antes, 27 verdes
  después, en `tests/test_sintering_shape.py` y `tests/test_sintering_precedence_regression.py`.
  La forma vive en un módulo propio, `apps/simulations/sintering_shape.py`, y se cablea en las
  siete superficies. Gates: `pytest` 15 failed / 1248 passed / 31 errors — fallos y errores
  **idénticos** a la línea base, los 27 de más son los tests nuevos; `ruff` 296, igual;
  `mypy` **1739 en 133**, uno menos que la base. Ese −1 no es ruido y queda explicado: el
  camino de grid llamaba a `self.validate_sintering_config`, sin anotar, y pasa a llamar a
  `validate_dict_shape`, que sí lo está, así que desaparece el `no-untyped-call` de
  `serializers.py:484`. Medido aislando el fichero: 15 errores antes, 14 después.
- L31 (2026-10-22): **T2 implementada** (R3.10, R7.3). `apply_sintering_config` deja de inventar
  defaults: delega en `validate_dict_shape` y lanza. Test-first: 9 rojos antes, 12 verdes
  después. El test que T2.3 declaraba retirar, `test_default_values_used`, se confirmó **en
  rojo primero** —`ValueError: ... 'uniform' requires: min, max`— y se retiró con esa evidencia,
  no sólo por estar declarado. Los dos de T2.4 siguen verdes **sin tocarlos**.
  Gates: `pytest` 15 failed / **1259** passed / 31 errors, con fallos y errores idénticos a la
  base; `ruff` 296, igual; `mypy` **1738 en 133**, dos por debajo de la base.
  Sobre ese −2: la comparación A/B con `git stash` da −1 para T2 (1739 → 1738), limpia. Lo que
  **no** cierra es la descomposición por fichero: `tests/test_utils.py` baja 2 al retirar el
  test, `utils.py` se queda en 11 y mis ficheros aportan 0. Queda dicho en vez de maquillado;
  el criterio de aceptación es no superar la base, y 1738 < 1740.
- L32 (2026-10-23): **T3 completa** (D5, R11.1, R11.2, R11.3, R11.7). El núcleo salió en
  `ef72aef`, `f28cf95` y `3e0a0be`: la media viaja en `sintering_coeff` y el hijo de extremos
  deja de almacenar el `sintering_config` heredado que contradecía su coeficiente. Lo que
  cierra T3 son las tres tareas que quedaban abiertas —**T3.3**, **T3.4** y **T3.0c**—, en
  `apps/simulations/tests/test_sintering_r11_expansion.py` (**11 tests**). De ellos, **3**
  recorren la cadena entera hasta el borde del engine —POST del estudio → expansión de
  producción → hijo → worker → binding mockeado—, que son los de R11.1 y R11.2; los **8**
  de R11.3 paran en los parámetros almacenados del hijo, que es donde R11.3 pone su
  obligación. Dicho así porque la primera redacción de esta entrada atribuía el recorrido
  completo a los ocho, y era falso.
  **Evidencia de rojo, no sólo de verde** (lección de L-método: un gate verde sólo dice que el
  gate pasó). Con los 8 tests tal cual y `utils.py` restaurado a su versión pre-T3 (`18efce7`):
  **5 fallan** — T3.3 con `assert 1.0 == 0.8`, que es exactamente D5 (1.0 es el default: *no
  sinterizar*), y los cuatro de R11.3 porque se escribía `sintering_mean`. Con el fix, 8/8
  verdes. Los **3 que pasan en ambos lados son los de R11.2** (`fixed` y `uniform`) y el barrido
  plano: son guardas de no-regresión, no prueban el arreglo, y se declaran como tales en vez de
  contarse como cobertura nueva.
  **T3.0c** monta una sola expansión con los cuatro tipos de hijo —grid, frontera de rango,
  extremo teórico y extremo de sinterizado— y lleva el dict también en `base_parameters`, así
  que ejercita **R11.7 por API** y no sólo contra el helper.
  **Judgment-day antes del merge** (dos jueces ciegos, PRs #102 y #103). Un solo hallazgo
  severo, corroborado por los dos: R11.3 dice «cualquier superficie» y la primera versión
  cubría **4 de las 7** (1, 2, 3 y 5). Peor: el caso etiquetado «base_parameters flat sweep»
  pasaba `parameter_grid`, o sea la superficie 5 — **la etiqueta mentía**, el patrón que este
  mismo Log lleva registrando desde L-método, cometido en el fichero cuyo commit presume de
  no cometerlo. Corregido: las siete superficies cubiertas y cada id del parametrize nombra su
  número de superficie.
  **Qué guarda de verdad cada test, medido rompiendo el código a propósito**, no deducido:
  quitar el `pop` de `views.py:1804` pone **4 en rojo, incluida la superficie 7**, que es el
  sitio donde las claves del usuario se escriben verbatim en el hijo (`utils.py:199-203`).
  Neutralizar `check_flat_keys` **no pone ninguno de los 11 en rojo** y en cambio tumba **6 de
  T1** (`tests/test_sintering_shape.py`): el guard del serializer lo cubre T1, no este fichero,
  porque estos tests entran con valores válidos. Las superficies **4 y 6 quedan verdes en los
  dos experimentos**: son cobertura declarativa, no guardas, y se declaran como tales.
  **T3.0a**: su invariante no se implementa como una comprobación en los sitios de escritura.
  Hoy se sostiene **transitivamente**, por la validación de entrada de T1/T2
  (`sintering_shape.check_flat_keys`), y los tres sitios de escritura —`utils.py:204`,
  `utils.py:230-239` y `views.py:1804-1808`— no llevan aserción propia. Queda marcada porque
  el invariante se cumple y está medido, pero quien lea la casilla no encontrará código suyo.
  **T3.0g** queda registrado aquí, no implementado: los hijos de extremos se crean sin
  `seed_type` y eso viola `cc-tunable-aggregation` R17, pero no es uno de los cuatro defectos de
  este contrato — va al contrato de seguimiento, junto con la precedencia y la unificación de
  los dos sitios de creación.
  El fichero nuevo va en **LF**, que es la convención de `apps/simulations/tests/` (43 de 43
  ficheros), no la CRLF de `backend/tests/`.
  Gates: `pytest` 15 failed / **1276** passed / 31 errors — fallos y errores **idénticos** a la
  línea base, los 11 de más son los tests nuevos; `ruff` **296**, igual; `mypy` **1727 en 132**,
  la base de L31 ya corregida por `ef72aef`. El fichero nuevo aporta **0** errores de mypy,
  medido aislándolo: los 103 que salen al comprobarlo vienen todos de módulos importados
  preexistentes (`tasks.py` 80, `accounts/models.py` 5). Para llegar a ese 0 hubo que anotar
  las fixtures y los parámetros de test, incluida una ligadura intermedia en la fixture `user`
  porque `UserManager.create_user` no está anotado y mypy marcaba `no-any-return`.
- L33 (2026-10-23): **T4 implementada** (D6, R11.4, R11.5, R11.6). Allow-list por algoritmo:
  `check_algorithm_scope` en `apps/simulations/sintering_shape.py`, con las tres listas
  —los seis que consumen sinterizado, `limiting` sólo-`fixed`, y los cuatro que no consumen
  nada— cableada en `ParametricStudySerializer.validate()` sobre **las siete superficies a la
  vez**, no superficie a superficie: la función recibe todos los dicts y todos los mapas con
  claves planas y decide una sola vez.
  Test-first, medido: **32 rojos antes, 37 verdes después** en la primera vuelta, y **53
  tests** tras las dos rondas de judgment-day, en
  `tests/test_sintering_algorithm_scope.py` (CRLF, la convención de `backend/tests/`). Los 5
  que ya estaban verdes son los casos de **aceptación** —los seis algoritmos que sí consumen,
  el dict `fixed` de `limiting`, su barrido plano, los extremos por defecto del servidor y el
  PATCH sobre un algoritmo permitido—: están para que la allow-list no cierre puertas que debe
  dejar abiertas, y no prueban el rechazo.
  **T4.2a**: en un PATCH que omite `base_algorithm`, la regla cae a
  `self.instance.base_algorithm`. Sin eso, un PATCH era el rodeo a la allow-list; el test que
  lo cubre fallaba con 200 antes del cambio.
  **Una lectura que declaro porque el contrato no la deletrea**: para `limiting`, «acepta sólo
  la forma `fixed`» lo aplico también a las claves planas `sintering_min`, `sintering_max` y
  `sintering_std`, que el worker **ignora** en ese camino (`tasks.py:1800`). Aceptarlas sería
  justo la ciencia silenciosa que este contrato existe para cerrar: parámetros almacenados que
  no describen lo que corrió. Ninguno de los casos que R11.5 declara aceptables las incluye.
  **T4.4 verificado midiendo, no citando** la declaración del contrato: con `git stash` sobre
  la implementación, los **46** FAILED/ERROR preexistentes salen **idénticos** antes y después,
  y la única diferencia son mis 32, de rojo a verde.
  Gates finales, tras el arreglo del judgment-day: `pytest` 15 failed / **1329** passed / 31
  errors — fallos y errores idénticos a la línea base, los 53 de más son los tests nuevos;
  `ruff` **296**, igual; `mypy` **1727 en 132**, la base, con los tres ficheros tocados
  aportando **0** errores propios. Diff de T4: **426 líneas** (421 inserciones y 5 borrados), **por encima** del techo
  de 400: 387 de implementación y tests, 39 de este registro. La excepción de tamaño está
  publicada en la issue #97 antes de abrir el PR, como exige AGENTS.md. La primera redacción de
  esta línea decía «387 líneas, por debajo del techo» — medía un subconjunto del propio PR,
  excluyendo el registro que la contiene, y un juez la cazó: el error exacto que este Log lleva
  anotando desde L-método, una cifra que mide algo distinto de lo que su nombre promete.
  **Judgment-day sobre T4** (dos jueces ciegos, PR #104). Un **CRITICAL**, real y mío:
  la allow-list era **burlable cambiando de algoritmo**. Yo la evaluaba sobre el *payload*, así
  que una actualización que sólo cambia `base_algorithm` y no manda sinterizado nunca se
  contrastaba con el que el estudio **ya guarda**. Reproducido por mí antes de tocar nada:
  POST `tunable` + `normal` → 201; PATCH `base_algorithm=limiting` → **200**; PATCH
  `base_algorithm=fracval` → **200**, con el estudio almacenado como `fracval` llevando
  `sintering_config` `normal`. Y el comentario que yo mismo había escrito decía que el PATCH
  ya no era un rodeo. Arreglado evaluando el **estudio efectivo tras la petición**: cuando el
  payload omite un campo, tanto el algoritmo como el sinterizado caen a la instancia. Cuatro
  tests nuevos lo fijan —PATCH a no-consumidor, PATCH a `limiting` con forma `normal`, el mismo
  rodeo por la superficie 4, y PUT— más uno que impide la trampa contraria: **limpiar el ajuste
  en la misma petición sigue permitido**, para no dejar estudios atrapados.
  **Dos huecos de cobertura, también ciertos**: mi lectura declarada (la rama plana de
  `limiting`) tenía **cero tests** —borrarla dejaba los 37 verdes— y R11.5 sólo se ejercitaba en
  la superficie 2. Cerrados y **medidos rompiendo el código**: neutralizar esa rama pone ahora
  **3 en rojo**, y desconectar las superficies del allow-list pone **15**, tres de ellos de
  R11.5 por superficie. Reforzados además dos tests que pasaban con cualquier implementación: el
  de los extremos por defecto ahora **lee los hijos** y exige `{0.5, 0.75, 0.9, 1.0}`, y el de
  R11.4 exige el texto «does not consume sintering» y el nombre del algoritmo, no un mero
  «sintering» que la propia clave de error ya satisfacía.
  **El segundo juez llegó al mismo CRITICAL por su cuenta**, con la misma reproducción, y
  coincidió en los dos huecos de cobertura. Aportó además dos cosas que el primero no vio.
  **Consecuencia de mi lectura declarada, medida y registrada**: un estudio `limiting` con
  `sintering_min`/`sintering_max`/`sintering_std` planos devolvía 201 y ahora devuelve 400,
  así que un *read-modify-write* que reenvíe esas claves de una fila antigua falla hasta que se
  retiren. Comprobado por mí en el código, no citando al juez: el payload de `limiting` que
  construye `BatchSimulationForm.tsx:214-221` es `{n_particles, geometry_type,
  configuration_type, packing, sintering_coeff}` y **no** lleva esas tres claves; quien sí las
  manda es `SimulationForm.tsx:692-694`, que es la simulación individual y está **fuera** del
  alcance de R11. Queda un test con ese payload real para que nadie lo rompa sin enterarse.
  **Cobertura del camino de actualización**: R11.6 sólo se ejercitaba por la superficie 4 y
  nunca con `base_algorithm` en el payload — que es justo donde vivía el CRITICAL. Añadidos
  PATCH por superficie 2 y por superficie 1 sobre estudios ya almacenados.
  Además, el juez B señala que la página batch no tiene `onError` en su mutación de creación
  (`app/projects/[id]/batch/page.tsx:60-70`), así que **cualquier 400 de esta regla se ve como
  un envío que no hace nada**. Eso agrava (a) de abajo y refuerza que T6/R10 es su cierre.
  **Dos hallazgos registrados y no implementados aquí**, por alcance: (a) el formulario batch
  sigue ofreciendo el sinterizado para algoritmos que ahora dan 400 —es **T6/R10** del mismo
  contrato, y hasta entonces la UI invita a una combinación que el servidor rechaza—; (b) todo
  rechazo de la allow-list se reporta bajo la clave `sintering_config` venga de la superficie
  que venga, mientras el resto de R3 usa claves por superficie: va al contrato de seguimiento,
  que acumula ya cuatro puntos.
  Esta tarea cierra además la ventana que el judgment-day de T3 señaló (JD-A-003): entre T3 y
  T4, un estudio `limiting` con sinterizado `normal` almacenaba `normal` + `std` y corría a un
  0.8 constante. La persona decidió mergear T3 y encadenar T4 seguido, y esto es ese cierre.
- L34 (2026-10-23): **T5 completa** (R12). **Aviso para quien lea sólo esta entrada: T5 acabó cambiando comportamiento en cinco sitios** —500→400 en escalares de las superficies 5 y 6, 201→400 en un `theoretical_extremes` mal tipado, 400→201 en listas mixtas de grid y en claves que no son de sinterizado, y la regla de los hijos de frontera—. Nació como tarea sin código de producción y ocho rondas de revisión la convirtieron en otra cosa; esta línea lo dice porque durante seis correcciones nadie releyó la primera frase de una entrada de 200 líneas. Lo que sigue es su historia, y el punto de partida fue: su trabajo es
  demostrar que la barrera está donde el contrato exige, **antes de la primera escritura**, y
  dejarla fijada. Lo demostrado, con evidencia propia: `perform_create` (`views.py:1750`) **no
  valida nada**, `config/` **no define `ATOMIC_REQUESTS`**, y DRF llama `is_valid()` antes de
  `perform_create`.
  **Corrección de un juez, y la acepto**: la primera redacción decía que *toda* la validación
  ocurre en `ParametricStudySerializer.validate()`, «la única barrera». Es **falso**. La forma
  de la superficie 2 se valida en `validate_sintering_config` (`serializers.py:366`), un
  validador **de campo** que DRF ejecuta en `to_internal_value`, es decir **antes** de
  `validate()`. La propiedad que R12 exige se sostiene igual —ambos corren antes de la primera
  escritura—, pero T5.1 enunciado como «todo en `validate()`» invitaba al siguiente auditor a
  mover comprobaciones que hoy funcionan, o a leer como infracción un validador de campo que no
  lo es. Lo que T5 garantiza es la propiedad, no el método.
  **Qué pasa si esa barrera no está, medido en vez de supuesto** (probe con las cuatro funciones
  de validación anuladas y el payload de R12.1): la expansión revienta a media faena con
  `ValueError: unknown sintering_config keys: mode` y deja **1 estudio, 1 simulación y 1 tarea
  encolada**. Esa tarea es la que ningún rollback deshace, y es la razón por la que el contrato
  prohíbe apoyarse en que `apply_sintering_config` lance durante la expansión.
  Los primeros seis tests de `tests/test_sintering_expansion_integrity.py` (CRLF) cuentan **filas y
  despachos** antes y después: los cuatro ajustes inválidos que R12.1 y R12.2 nombran, uno por
  superficie, más dos controles de que un ajuste **válido sí escribe y sí encola** — sin ellos,
  un serializer que rechazara todo pasaría los cuatro primeros.
  Los seis salieron **verdes de entrada**, porque T1 y T4 ya habían puesto la barrera; se
  declara así en vez de venderlos como rojo-a-verde. Lo que los hace guardas es el probe de
  arriba: en el mundo sin barrera, los cuatro fallan. **Pero no «por las tres aserciones a la
  vez», como escribí**: los dos jueces lo midieron y es falso. Los dos casos de forma dict
  revientan dentro de `_post`, así que las aserciones de filas y de despachos **ni se ejecutan**,
  y el caso de `base_parameters` deja +1 estudio pero 0 despachos. La fuerza de la guarda varía
  por caso, y el registro lo dice ahora en vez de redondearlo.
  **Judgment-day sobre T5: cero severos en lo que escribí, tres defectos vivos en el código.**
  T5 nació como tarea sin código de producción; deja de serlo por decisión de la persona, porque
  los jueces encontraron tres caminos que **violan R12 hoy** y que ninguno de mis seis tests
  tocaba. Reproducidos por mí antes de arreglar nada:
  1. **Superficie 6 con un escalar** (`theoretical_extremes: {sintering_coeff: 0.7}`, sin lista):
     `TypeError` en `utils.py:202` → **500**, con +1 estudio, +1 simulación y **+1 tarea
     encolada**.
  2. **Superficie 5 con un escalar** (`parameter_grid: {sintering_coeff: 0.7}`): `TypeError` en
     `itertools.product` (`views.py:1777`) → **500** y un estudio huérfano en RUNNING.
  3. **Barrido cuyo segundo elemento es inválido**
     (`{sintering_type: ["fixed","uniform"], sintering_coeff: [0.6]}`): **201**, y el segundo
     hijo queda almacenado como `uniform` **sin min/max**, que el worker corre como uniform
     0.85-0.95 (`tasks.py:1596-1598`). El peor de los tres: no falla, miente.
  Arreglados: `check_flat_keys` exige **lista** en las superficies barridas, y
  `check_flat_required_over_sweeps` proyecta **cada hijo** que el barrido produce en vez de sólo
  el primero — producto cartesiano para el grid, un hijo por par clave/valor para los extremos,
  que es como los expande `add_case`. Tres tests nuevos en rojo antes, verdes después, más dos
  controles de que un barrido **bien especificado** sigue aceptándose.
  **Tests débiles, corregidos**: el sexto test era un duplicado byte a byte del control y no
  podía fallar solo (retirado); los cuatro casos inválidos sólo exigían «400», así que cualquier
  400 ajeno los dejaba verdes (ahora exigen que el 400 hable del sinterizado); y faltaban las
  superficies 2, 5 y 7, que R12.2 cubre con su «lo mismo para las demás superficies».
  **Derivado, no arreglado**: el bloque de extremos (`views.py:1869-1906`) con un `n_particles`
  en forma de dict revienta tras crear **8 hijos y encolar 8 tareas** (medido). No lo gobierna
  R12 —no es un ajuste de sinterizado—, así que va al contrato de seguimiento, que suma cinco
  puntos.
  **Fuera de alcance cuando se escribió esto, y ya no**: un `parameter_grid.sintering_config`
  con dos o más entradas junto a `include_limiting_cases` reventaba a media expansión por el
  `sorted` de `generate_limiting_cases` (la referencia llevaba número de línea, y era la tercera cita que envejecía: ahora se nombra la función). El
  contrato lo declara defecto ajeno, de `distribution-grid-wiring`. La ronda 4 lo cerró de
  hecho, porque el preview obligó a mirarlo: hoy ese estudio **se crea**.
  **El texto canónico de la spec sigue diciendo que está abierto, y no lo toco**: cambiar la
  spec exige nueva aprobación, y este Log no es sitio para hacerlo por la puerta de atrás.
  Queda señalado para que la persona decida si la nota de R12 se actualiza o se queda como
  historia.
  **Segunda ronda de judgment-day, y aquí los jueces me cazaron a mí.** El arreglo anterior
  cerró tres agujeros y abrió **dos regresiones propias** más un riesgo de coste, las tres
  reproducidas por mí antes de tocar nada:
  1. **Una lista vacía desactivaba la comprobación entera.** `{sintering_coeff: []}` sigue
     siendo una clave barrida, así que entraba por la rama del producto, `product()` no daba
     ninguna combinación y no se comprobaba nada. El mismo payload daba **400 antes** de mi
     arreglo y **201 después**: la guarda desapareció en silencio.
  2. **Un dict manda sobre los planos, y yo proyectaba los planos igual.** Con un
     `sintering_config` en el estudio o en el grid, `apply_sintering_config` pisa las claves
     planas antes de guardar el hijo, así que rechazaba con 400 payloads cuyos hijos reales son
     válidos. Corregido distinguiendo **qué hijo recibe dict**: el del grid lo recibe de una
     entrada de grid; los de límites y extremos sólo de `base_parameters` o del campo del
     estudio (`views.py:1804-1808`).
  3. **El producto cartesiano corría antes del tope de lote**: 4 claves × 40 valores = 2,56 M
     combinaciones, **4,69 s** medidos, con un cuerpo de ~1,2 KB que el tope iba a rechazar de
     todos modos. Acotado al tope (1000): por encima, el rechazo es suyo y sólo cuesta el
     producto de las longitudes.
  **Y una tercera regresión la cazó el gate, no yo ni los jueces**: al añadir la comprobación
  de la proyección base la puse **incondicional**, y eso rompió
  `tests/test_sintering_shape.py::test_r3_8_swept_value_completes_the_shape`, que afirma
  exactamente lo contrario — el valor barrido **puede** completar la forma que falta en
  `base_parameters`. Se vio porque la suite pasó de 15 a **16** fallos. La base sólo se comprueba
  sola cuando ningún barrido de sinterizado la completa.
  Lección, y es la misma que este Log lleva repitiendo: **añadir validación a una ruta común es
  más peligroso que el defecto que arregla**. Tres de los cuatro problemas de esta ronda los
  introdujo el arreglo anterior, no el código original.
  Gates finales, ya con el dry run: `pytest` 15 failed / **1362** passed / 31 errors; `ruff`
  **296**; `mypy`
  **1727 en 132**, con los ficheros tocados aportando **0** errores propios. **T5.3 ya no es
  trivial** — T5 cambia código de producción en la validación por la que pasan todos los
  estudios— así que se midió comparando **los nombres** de los 46 fallos y errores
  preexistentes con `git stash`, no su recuento: idénticos antes y después.
  **Ronda 2b: el segundo juez revisó el árbol congelado y encontró un CRITICAL más**, que mi
  arreglo anterior no tocaba. La guarda de forma barrida que añadí cubría sólo las claves
  **planas** y se saltaba `sintering_config`, su hermana dict en la misma superficie. Un dict
  **desnudo** (sin lista) en `theoretical_extremes.sintering_config` pasaba la validación, y la
  expansión entonces **iteraba las claves del propio dict** (`utils.py:201-203`), escribiendo
  `sintering_config="distribution_type"` en cada hijo hasta que `apply_sintering_config` lanzó.
  Medido por mí en el árbol actual: **500 con +1 estudio, +4 simulaciones y +4 tareas
  encoladas** — el peor saldo de todo el contrato. Arreglado exigiendo lista también ahí.
  Segundo hallazgo suyo: un `sintering_type` **inhashable** (un dict, o una lista anidada)
  reventaba el `in` contra el frozenset con `TypeError` → **500**, donde R12 pide 400. Sin
  filas, pero un 500 no es un rechazo útil. Guardado con una comprobación de tipo.
  Tercero: la rama de **extremos** de la proyección **no la fijaba ningún test** —borrarla
  dejaba los 13 verdes—, así que su comportamiento correcto de hoy no estaba clavado. Ya lo
  está, con un segundo elemento inválido en la superficie 6.
  **Al seguimiento, no aquí** (JD-B-008): `parameter_grid={"n_particles": 100}` y
  `{"n_particles": ["abc"]}` revientan igual con +1 estudio, y el `int()` sin guarda del bloque
  de extremos (`views.py:1878-1880`, que sí está guardado en su copia de `views.py:1812-1815`)
  deja +1 estudio, +1 simulación y 1 tarea. No son ajustes de sinterizado, así que R12 no los
  gobierna; el seguimiento suma ya seis puntos.
  **Nota de método del mismo juez**: revisó `git archive d8f45d0` y avisó de que el árbol de
  trabajo tenía cambios posteriores. Tenía razón y conviene retenerlo: **un juez debe revisar
  el commit, no el directorio**, o mide código que nadie ha entregado.
  **Ronda 3: los dos jueces llegaron por separado a la misma raíz, y la raíz era el enfoque.**
  Mi validación **simulaba** en un segundo sitio cómo se construyen los hijos, y divergía del
  generador real una y otra vez: los hijos de **frontera de rango** (`utils.py:179-194`) y los
  **extremos por defecto del servidor** (`utils.py:198-200`, que el serializer ni siquiera ve)
  no se proyectaban nunca. Medido: un estudio con `sintering_type: uniform` en base y un barrido
  de `min`/`max` entraba con **201** y guardaba **7 de 11 hijos** con `uniform` y sin min/max,
  que el worker corre a 0.85-0.95. El daño central del contrato, **aceptado**. Y mi docstring
  afirmaba cubrir «cada hijo que el barrido produce»: era falso.
  Más hallazgos de esa ronda, todos reproducidos por mí: `null` en la superficie 7 → 500 con +1
  estudio, +1 simulación y +1 tarea; un escalar en una clave **no** de sinterizado de los
  extremos → lo mismo; `distribution_type` inhashable y un `limiting_cases_config` que no es un
  objeto → 500 en vez de 400; y un **falso 400** preexistente cuando un dict de grid cubre un
  plano incompleto de `base_parameters`.
  **Decisión de la persona: dejar de parchear y validar con la expansión real.** Nace
  `apps/simulations/expansion_preview.py`, que **no modela nada**: ejecuta las mismas funciones
  que `perform_create` —`generate_limiting_cases`, `generate_sintering_extreme_cases`,
  `apply_sintering_config`— sobre los mismos datos, replica su cast `int()` con la asimetría
  real (guardado en `create_simulation`, sin guardar en el bloque de extremos) y mira los
  parámetros que llevarían los hijos. No escribe: esas funciones son puras. La proyección
  paralela y sus dos banderas se **retiran**; la precedencia ya no hay que reenunciarla, porque
  lo que `create_simulation` le hace a un hijo es lo que el preview ve.
  **Lo que cierra de rebote, medido y no reclamado como alcance**: lo que antes reventaba a
  media expansión ahora revienta **antes de escribir** y es un 400 con cero filas. Eso incluye
  los tres caminos que esta misma entrada había derivado al contrato de seguimiento
  (`n_particles` escalar y no numérico, y el `int()` sin guarda de `views.py:1878-1880`, que
  dejaba +1 estudio, +8 simulaciones y 8 tareas). El seguimiento baja de seis puntos a tres.
  **Y aquí escribí algo falso que la ronda 4 me tumbó, así que queda corregido en el sitio.**
  Afirmé que el dry run «cerraba» la exención del contrato —dos dicts en
  `parameter_grid.sintering_config` con casos límite, el `sorted` de `utils.py:182`— porque
  pasaba de 500 a 400 sin escribir filas. **Confundí «ya no revienta» con «ya se acepta»**: un
  400 sigue siendo un rechazo, y R3 exige **aceptar** ese array. Peor, lo clavé con un test que
  fijaba ese 400 como deseable: un test que protege un defecto. Y bloqueaba de paso
  `kf_distribution` y `particle_radius_config` con dos entradas, que no son sinterizado.
  Cerrado de verdad en la ronda 4: `generate_limiting_cases` **salta** los valores que no sabe
  ordenar —un dict no tiene orden, así que esa clave no aporta caso de frontera— en vez de
  romper la expansión. Esos estudios se crean con 201. El test falso, retirado; en su lugar hay
  uno de aceptación por cada una de las dos claves.
  **Ronda 5: tercer CRITICAL seguido introducido por mi propio arreglo.** La rama que añadí en
  la ronda 4 para validar la superficie 6 con `include_limiting_cases` apagado quedó **fuera del
  try/except**, así que un `theoretical_extremes: {n_particles: [null]}` daba **500**. Y al
  medirla entera resultó peor que eso: validaba hijos **que no existen ni con la bandera
  encendida**, porque `include_theoretical: false` hace ese mapa inalcanzable — un 400 falso
  cuya única salida era borrar una clave que no hace nada. **Retirada la rama, no parcheada.**
  La regla que la sustituye, escrita en el módulo: **la completitud se le exige a los hijos que
  van a existir; los valores de una superficie se comprueban siempre**. Un mapa sin consumir
  sigue rechazando `sintering_coeff: 42.0` o el legado `sintering_mean`, pero no se le exige
  completar la forma de un hijo que nadie creará. Esto **revierte** lo que la ronda 4 había
  fijado en un test, y se dice aquí en vez de cambiarlo en silencio.
  Cerrados además: una base incompleta ya no se cuela tras un barrido vacío (si la expansión no
  produce ningún hijo, la base es la única forma del estudio y se valida), y las superficies 6 y
  7 exigen **listas** para sus claves de sinterizado.
  **Dos reglas que este párrafo afirmaba se revirtieron en la ronda 6, y el párrafo siguió
  diciendo lo contrario hasta que un juez lo leyó contra el código.** Corregido aquí, no
  reescrito en silencio:
  - La exigencia de listas cubre **sólo las claves de sinterizado**. Rechazar un `packing` o un
    `kf_distribution` es autoridad que R3 y R12 no dan a este contrato.
  - La lista mixta `[100, "200"]` **no se reporta**: se acepta, sus hijos corren, y lo que esa
    clave pierde son sus casos de frontera. Rechazarla rompía estudios que funcionan, y la
    guarda podía desactivarse con `include_boundaries`.
  **Lo que ese límite de alcance deja abierto, medido y derivado**: un `theoretical_extremes`
  con `{"target_df": {"mode": "fixed", "value": 1.8}}` entra con **201** y crea hijos que
  guardan `target_df: "mode"` y `target_df: "value"`; el worker recibe esas cadenas y lanza.
  Hijos que no pueden completarse nunca, en un estudio marcado RUNNING. No es un ajuste de
  sinterizado, así que este contrato no lo cierra — pero **es el mismo daño**, y el contrato de
  seguimiento tiene que existir para que no sea permanente.
  **Y ya existe: la issue #115.** Hasta la octava ronda, «va al contrato de seguimiento» fue una
  promesa sin destinatario — un juez comprobó que no hay tal change en `openspec/changes/` y que,
  al archivar, un Log de 800 líneas habría sido su única casa. #115 recoge los **nueve** defectos
  derivados con su evidencia medida, incluida la nota de R12 que esta entrada deja sin tocar.
  El recuento que esta entrada fue llevando a mano («baja de seis a tres», «suma seis») queda
  obsoleto a propósito: contar defectos en prosa fue otra cifra que envejecía sola.
  Y una contradicción entre dos tests míos, encontrada al corregir: el del barrido vacío usaba
  una base incompleta, así que afirmaba a la vez que eso se acepta y que se rechaza. Reescrito
  con una base completa, y la guarda que le había debilitado vive ahora en su propio test
  nombrando la clave que falta.
  Gates de la ronda 5: `pytest` 15 failed / **1372** passed / 31 errors, con los nombres de los
  46 preexistentes idénticos; `ruff` **296**; `mypy` **1727 en 132**.
  **Esa suma no cuadra con los tests colectados en ese commit, y mi primera explicación era
  falsa**: dije que se había medido con un fichero de probe en el árbol, y un juez demostró que
  un probe sólo puede **añadir** tests, nunca restar. **No sé de dónde sale el desajuste de
  uno.** Decirlo es mejor que inventar una causa plausible: una explicación que no se sostiene
  es peor que un número sin explicar, porque cierra la pregunta.
  **Ronda 7: ningún CRITICAL, y por primera vez un juez confirma que el arreglo anterior queda
  fijado** — mover la proyección base fuera del `try` rompe exactamente su test, y borrarla
  rompe dos. Lo que sí trajo la ronda:
  - **El predicado de alcance no era el del módulo.** Escribí `startswith("sintering")`, así que
    gobernaba una clave `sintering` pelada y dejaba pasar `sinterfoo`. Ninguna de las dos es un
    ajuste de sinterizado para `check_flat_keys`. Corregido al mismo predicado que usa el resto
    (`sintering_config` o prefijo `sintering_`), con un test de las tres claves.
  - **`theoretical_extremes` vacío daba ocho hijos.** Mi guarda de tipo sólo saltaba con valores
    *truthy*, y el serializer colapsa los falsy a `{}` antes, así que pedir **ningún** extremo
    caía en el mapa por defecto del servidor. Ahora mira el valor crudo.
  - **Mi justificación para revertir el rechazo de listas mixtas no generalizaba.** Dije «esos
    hijos corren» y es cierto **sólo para `n_particles`**, el único de `INTEGER_PARAMS`: un
    `target_df: [1.8, "abc"]` guarda la cadena y el binding del engine la rechaza.
  **Dos huecos derivados pasan a fijarse como `xfail(strict=True)`, no como 201 deseable.** Un
  test que afirma el 201 de un defecto obliga a quien lo arregle a editar una aserción que
  pasaba; un `xfail` estricto falla hoy a propósito y **avisa el día que alguien lo cierre**.
  Son el `target_df` mixto y el extremo no-sinterizado que guarda nombres de clave.
  **Derivados nuevos, medidos**: `parameter_grid={"seed_type": [["monomers"]]}` da **500** por
  un `in` contra un conjunto con valor inhashable. Preexistente, fuera de R12, y va al
  seguimiento en vez de arreglarse estirando este contrato.
  **Y aquí me equivoqué de dueño**: llamé «preexistente» también al 500 de un PATCH sobre una
  fila cuyo `theoretical_extremes` no es un objeto. Un juez lo rastreó con `git log -S` y lo
  confirmé: lo introdujo **`fb984fb`, la rebanada anterior de este mismo contrato**, mergeada
  ayer en el PR #104. No era herencia, era mío y de anteayer. Arreglado aquí, no derivado,
  porque la regla que necesitaba es la que esta misma tarea ya aplica al payload — y porque
  dejaba un estudio **imposible de actualizar para siempre**, ni siquiera para renombrarlo.
  Gates de la ronda 7: `pytest` 15 failed / **1383** passed / 31 errors **y 2 xfailed**, con los
  nombres de los 46 preexistentes idénticos; `ruff` **296**; `mypy` **1727 en 132**.
  **Tamaño: aquí ya no hay cifra, porque esta es la tercera que envejece.** Se escribió una,
  se quedó fija mientras el PR crecía, la corrigió un juez, y la corrección nació vieja; al
  reescribir el párrafo puse otra y también estaba desfasada en el commit que la publicaba.
  La fuente de verdad es la página del PR, que se recalcula sola. Lo único que no cambia, y es
  lo que importa: **ninguna línea viene de alcance nuevo** — todas vienen de defectos hallados
  en revisión adversarial, y una parte sustancial de defectos que introduje al arreglar los
  anteriores. La excepción de tamaño sigue pendiente de decisión de la persona en la issue.
- L35 (2026-10-24): **T6 completa** (R10). Frontend, y por fin el otro lado del desajuste que
  T4 y T5 dejaron abierto: el backend rechaza desde T4 el sinterizado para `fracval`, `gcca` y
  `box_rfa`, y el formulario **seguía ofreciéndolo**.
  Test-first, medido: **6 rojos de 12** antes de tocar producción, y los seis por el motivo
  correcto, verificado uno a uno —la opción presente en los tres algoritmos que no la consumen,
  el payload saliendo con `{mode:'fixed', value:1}` (la forma del selector llegando a la API,
  que es D2 visto desde el navegador), `Number.isFinite` en falso al vaciar el campo de
  `limiting`, y la variación de sinterizado **sobreviviendo** al cambio a `fracval`—. Final:
  **19 verdes** entre el módulo nuevo y el formulario.
  **Lo que se entrega**: `lib/sinteringShape.ts` con `toSinteringConfig` —la traducción
  `{mode,…}` → forma dict de R3 en **un solo sitio**, que es lo que T6.1 pedía— y la lista de
  los seis algoritmos que consumen sinterizado; la opción del desplegable acotada a esos seis;
  el campo de `limiting` que **omite la clave** en vez de mandar `NaN`; y el cambio de
  algoritmo que **limpia** las variaciones que el nuevo no acepta.
  **R10.6 dice «limpiar o marcar», y limpiar en silencio cumple la mitad de la frase**: la
  regla termina con «sin decirle al usuario por qué». Así que el formulario avisa con
  `kit/Callout` —tokenizado, sin literales de color, como exige la ola 1 de la peer— nombrando
  la variación retirada y el algoritmo que la rechaza.
  **Dos errores míos en los tests, encontrados antes de que los viera nadie**: el botón de
  envío no se llama «Create Study» sino `Run N Simulations` y se deshabilita con cero
  simulaciones; y `/fracval/i` casaba también con el `<option>` del desplegable, no sólo con el
  aviso. Los dos eran test mal escrito, no defecto: separarlos del rojo real fue lo primero.
  **Fuera de alcance a propósito**: el `onError` que falta en la página batch, que hace que
  cualquier 400 se vea como un envío que no hace nada. T6.1-T6.6 no lo piden y R10 se satisface
  en el formulario; estirar el contrato por el camino es justo lo que ocho rondas de jueces me
  castigaron en T5. Queda como punto 6 de la issue **#115**.
  Gates de frontend: **801 tests en 71 ficheros, todos verdes**; `tsc` **13 errores**, y
  comprobado con `git stash` que son **exactamente los mismos 13** de `develop`, por nombre y
  no por recuento — ni uno nuevo ni uno resuelto por accidente.
  **Y la trampa del CRLF, que este repositorio ya tenía documentada desde T1 y volví a pisar.**
  `BatchSimulationForm.tsx` tenía **714 líneas CRLF de 746**, y reescribirlo desde Python las
  normalizó todas a LF: el commit declaraba **1508 líneas tocadas** cuando el cambio real eran
  **116**. Reconstruido línea a línea conservando el final original de cada línea intacta, el
  diff queda en 116 y con `-w` en 114. La comprobación que lo caza es contrastar `git diff
  --stat` con `git diff -w --stat` **antes** de commitear; yo la hice después, al extrañarme
  la cifra. Un diff con 700 líneas de ruido no se revisa: se hojea.
  **Judgment-day sobre T6: sin CRITICAL, y una regresión mía de las que no deja rastro.**
  Mi limpieza al cambiar de algoritmo usaba como autoridad **el desplegable**, no R11. Resultado
  medido: pasar de `limiting` a `ballistic` borraba un barrido de `sintering_coeff` que el
  backend **sí acepta**, y de `dla` a `tunable` borraba `sticking_probability`, también
  aceptado — y en ambos casos el aviso decía *«X does not accept it»*, que es **falso**. Borrar
  en silencio lo que el servidor habría tomado es peor que no limpiar. Acotado a R11 con
  `rejectsVariation`, con tres tests de supervivencia que estaban en rojo.
  **El aviso, además, no servía a todo el mundo**: sin `aria-live`, quien usa lector de pantalla
  perdía cada variación configurada sin enterarse — exactamente el «sin decirle al usuario por
  qué» que R10.6 prohíbe, cumplido sólo para quien ve la pantalla. Ahora va en `role="status"`
  con `aria-live`, nombra las **etiquetas** que el usuario eligió en vez de claves `snake_case`,
  y concuerda en plural.
  **Dos huecos de test que un juez demostró mutando el código**: traducir sólo `fixed` dejaba
  los 19 verdes (el escenario de R10.5 con media 0.8 y desviación 0.05 no se enviaba nunca
  desde el formulario), y los negativos de R10.4 seguían verdes si un algoritmo dejaba de ser
  seleccionable, porque nada comprobaba que el `select` hubiera cambiado. Cerrados los dos.
  **Y una copia a mano que nadie ataba**: `SINTERING_ALGORITHMS` del cliente replica la lista
  del backend, y la deriva silenciosa es justo el fallo que T6 arregla. Hay ahora un test que
  **lee la constante de `sintering_shape.py`** y compara los dos conjuntos.
  **Corregido también un comentario mío que afirmaba un contrato inexistente**: escribí que
  `kf_distribution` y `particle_radius_config` «mantienen la forma que su contrato espera», y
  el backend las rechaza igual que rechazaba el sinterizado. No se arregla aquí —es de
  `distribution-grid-wiring`— pero el comentario ya no lo bendice, y el caso queda en #115.
  Coordinación: la peer confirmó que `BatchSimulationForm.tsx` y la página batch son míos (los
  tenía reservados), y pidió aviso al mergear para arrancar su ola 2 desde un `develop` con
  esto dentro.
