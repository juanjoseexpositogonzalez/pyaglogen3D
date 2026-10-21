# Tasks: distribution-config-wiring

> Estado del contrato: **spec-review r4 pendiente** (agente fresco) y `approval.md` de la
> persona. **No se escribe código hasta que exista `approval.md`.**
>
> Rama: `feature/distribution-config-wiring` (base `develop` @ `8423c4f`).
> Jira: pendiente de crear al aprobar (issue AGLO, transición 21 → En curso).

## T0 — Contrato

- [x] T0.1 Explore con probes ejecutadas (`explore.md`, `e44a978`)
- [x] T0.2 Decisiones r1: alcance A (D1+D2+D3), fix-forward
- [x] T0.3 Contrato r1 (`f2956f2`)
- [x] T0.4 spec-review r1 → `CORRECTIONS REQUIRED (3 blockers, 7 majors)`
- [x] T0.5 Decisiones r2: absorber D5, D6, D7, D8; polidispersidad real a seguimiento
- [x] T0.6 Corrección r2 (`b736113`)
- [x] T0.7 spec-review r2 → `CORRECTIONS REQUIRED (3 blockers, 8 majors)`
- [x] T0.8 Corrección r3 (`2875c4a`)
- [x] T0.9 spec-review r3 → `CORRECTIONS REQUIRED (1 blocker, 3 majors)`
- [x] T0.10 Decisión r4 de la persona: la ruta del asistente IA **entra en alcance** (D9)
- [x] T0.11 Corrección r4 (este commit)
- [ ] T0.12 spec-review r4 en agente fresco
- [ ] T0.13 `approval.md` — **sólo la persona aprueba**
- [ ] T0.14 Crear issue AGLO y pasarla a En curso (transición 21)

## T1 — Validador único de distribuciones `{mode}` (D1, R1/R2)

- [ ] T1.1 Reescribir `validate_distribution_config` (`services/distribution_validation.py:19`)
      como envoltorio de `DistributionField.to_internal_value`
- [ ] T1.2 Rechazar antes de delegar: no-dict y `null` (el campo devuelve `None` para `None`,
      `fields.py:25-26`)
- [ ] T1.3 Rechazar claves desconocidas para el modo (no descartarlas)
- [ ] T1.4 Persistir la salida **normalizada**; retirar el parámetro `min_mean` (sin consumidor,
      `serializers.py:434-437`)
- [ ] T1.5 `_DISTRIBUTION_GRID_KEYS`: `kf_distribution` → `allowed_modes = (fixed, normal, uniform)`;
      `particle_radius_config` → `allowed_modes = (fixed, normal)`, `max_std_over_mean = 0.3`
- [ ] T1.6 **Tests existentes que esta tarea pone en rojo y se reescriben a `mode`**
      (declaración completa — AGENTS.md: nunca en silencio):
      - `backend/apps/simulations/tests/test_parametric_study_serializer.py:53-65`
        `test_valid_kf_distribution_accepted`
      - `backend/apps/simulations/tests/test_parametric_study_serializer.py:92-103`
        (`test_valid_particle_radius_accepted`)
      - `backend/apps/simulations/tests/test_parametric_study_serializer.py:105-117`
        (`test_particle_radius_exceeds_cap_rejected`) — **no se pone en rojo**: su aserción es
        laxa y sigue pasando. Se reescribe por **significado**, para que afirme el rechazo de la
        forma `{mode}` y no de la antigua
      - `backend/apps/simulations/tests/test_distribution_validation.py` (todo el fichero usa
        `distribution_type`)
- [ ] T1.7 Tests nuevos: R1.1 (2 configs x 2 semillas → 4 hijos, cada uno con
      `target_kf_distribution` y sin `kf_distribution`), R1.3-R1.7, R2.1-R2.4

## T2 — Sinterizado sin default silencioso (D2, R3)

- [ ] T2.1 `validate_sintering_config` (`serializers.py:360`): exigir `distribution_type`
      conocido, exigir los campos requeridos por tipo, rechazar claves desconocidas, rechazar
      entradas de grid vacías `{}`
- [ ] T2.2 `apply_sintering_config` (`utils.py:236`): lanzar ante dict no vacío que incumpla lo
      anterior, incluido `distribution_type` desconocido; `None`/`{}` siguen devolviendo los
      parámetros intactos
- [ ] T2.3 **Test existente que esta tarea pone en rojo y se retira** (declaración completa):
      - `backend/tests/test_utils.py:336-344` `test_default_values_used` — afirma que
        `apply_sintering_config({"distribution_type":"uniform"})` rellena `0.85`/`0.95` por
        defecto. Es la forma codificada del defecto D2; R3 exige que lance
- [ ] T2.4 Tests nuevos R3.3 (límites de rango), R3.5, R3.6 (campos incompletos y `{}`), R3.7
- [ ] T2.5 Regresión: R3.1, R3.2, R3.4 siguen verdes; `test_none_config_returns_unchanged` y
      `test_empty_config_returns_unchanged` (`tests/test_utils.py:319-334`) **siguen verdes sin
      cambios**, porque la exención `None`/`{}` sólo se retira dentro del grid

## T3 — El sinterizado llega al engine (D5, R12)

- [ ] T3.1 `apply_sintering_config`: escribir `sintering_coeff` (no `sintering_mean`) para el
      tipo `normal`; retirar `sintering_mean`, que ningún consumidor de producción lee
- [ ] T3.2 **Test existente que esta tarea pone en rojo y se reescribe** (declaración completa):
      - `backend/tests/test_utils.py:304-317` `test_normal_sintering` — afirma
        `result["sintering_mean"] == 0.9`. Pasa a afirmar `result["sintering_coeff"] == 0.9`
- [ ] T3.3 Test R12.1 de borde de engine: mock sobre el binding, afirmando que la media que
      llega es 0.8 y **no** 1.0
- [ ] T3.4 Tests R12.2 (fixed/uniform) y R12.3 (ninguna clave de sinterizado fuera del conjunto
      que el worker lee)

## T4 — Cableado de las grid keys y alcance por algoritmo (D3, D6, D9, R5/R11)

- [ ] T4.0 Extraer `apps/simulations/services/study_expansion.py` (DD9) con
      `validate_grid_for_algorithm(parameter_grid, algorithm, sintering_config)` y
      `build_child_parameters(base_parameters, combo, study_sintering_config)`
- [ ] T4.1 En `create_simulation` (`views.py:1784`): traducir
      `particle_radius_config → dpo_distribution` y `kf_distribution → target_kf_distribution`,
      sin conservar la clave de grid, con precedencia sobre `base_parameters`
- [ ] T4.2 Allow-list por algoritmo (R11): distribuciones sólo `tunable_cc`; sinterizado para
      los seis algoritmos que lo consumen, sólo `fixed` para `limiting`, rechazado para
      `fracval`/`gcca`/`box_rfa`/`imported`
- [ ] T4.3 Aplicar la misma regla al `sintering_config` **de estudio**, no sólo al grid
- [ ] T4.4 Ruta de actualización parcial (R11.5): evaluar la regla contra
      `self.instance.base_algorithm` cuando el `PATCH` no trae el campo
- [ ] T4.5 **Tests existentes que esta tarea pone en rojo y se reescriben** (declaración
      completa):
      - `backend/apps/simulations/tests/test_grid_expansion.py:292-313`
        `test_particle_radius_config_passes_through`
      - `backend/apps/simulations/tests/test_grid_expansion.py:269-290`
        `test_kf_distribution_passes_through` (forma antigua **y**
        `assert sim.parameters.get("kf_distribution") == kf_config`)
      - `backend/apps/simulations/tests/test_grid_expansion.py:324-367`
        `test_all_four_keys_expand_correctly` (forma antigua y
        `assert "kf_distribution" in sim.parameters`)
- [ ] T4.6 Tests nuevos R11.1/R11.2 (borde de engine, mock del binding), R11.3, R11.4, R11.5,
      R11.6 (precedencia), R11.7 (`limiting` sólo `fixed`), y R5.2 (clave de valor único: el
      hijo lleva `target_kf_distribution` y no `kf_distribution`)
- [ ] T4.7 **D9**: enrutar `create_parametric_study_handler`
      (`apps/ai_assistant/tools/study_tools.py:103-172`) por los dos helpers de T4.0, igual que
      ya hace con `validate_box_counting_params_dict` tras JD-A-006. Incluye el pop de
      `seed_type` → campo de modelo, que esa ruta hoy se salta (efecto colateral declarado en
      DD9)
- [ ] T4.8 Tests R11.8: la herramienta traduce, rechaza por algoritmo y coloca `seed_type` en
      el campo de modelo
- [ ] T4.9 Regresión de la ruta IA: los tests existentes de
      `apps/ai_assistant/tests/` que usan `create_parametric_study` siguen verdes, o se
      declaran aquí si cambian

## T5 — Casos límite (D7, R13)

- [ ] T5.1 `generate_limiting_cases` (`utils.py:176-190`): ignorar las claves cuyos valores sean
      `dict` o `list`, antes del `sorted(values)`; `int`/`float`/`bool`/`str` siguen generando
      fronteras
- [ ] T5.2 Tests R13.1, R13.2 y R13.3 (`seed_type`, valores string, conserva sus fronteras)

## T6 — Frontend (D6, D8, R10)

- [ ] T6.1 `parameterOptions` (`BatchSimulationForm.tsx:310-318`): aplicar la allow-list de R10
- [ ] T6.2 Renombrar la etiqueta a "Primary particle size (dpo)"
      (`BatchSimulationForm.tsx:315`)
- [ ] T6.3 Función pura `toSinteringConfig(DistributionValue)` y su uso en el submit
- [ ] T6.4 `frontend/src/components/forms/DistributionSelector.tsx:57`: el default de `uniform`
      emite `min == max`, inválido para `fields.py:59` (`max > min`); proponer un rango válido
      que cumpla **a la vez** `max > min` y `0.5 <= min,max <= 1.0`, porque el mismo componente
      alimenta `sintering_config` (`serializers.py:382-385`) y su valor base es `1.0`. Un
      `max = base * 1.2` daría `{min:1.0, max:1.2}` → 400 en un default sin tocar.
      **Componente compartido con el formulario single** — excepción declarada en `proposal.md`
- [ ] T6.5 Tests nuevos R10.3 (no regresión escalar), R10.4, R10.5, R10.6, R10.7 y **R10.8**
      (el default de `uniform` también válido para `sintering_config`, rango `[0.5, 1.0]`)
- [ ] T6.6 **Test existente que T6.4 pone en rojo y se reescribe** (declaración completa):
      - `frontend/src/components/forms/__tests__/DistributionSelector.test.tsx:124-142`
        `switching from fixed to uniform…` — afirma `min === 2.0 && max === 2.0`

## T7 — Verificación

- [ ] T7.1 `cd backend && pytest && ruff check && mypy .`.
      **Línea base roja preexistente, medida en `b736113` (rama sólo-docs): 15 failed, 31
      errors, 1221 passed** — `tests/test_api.py` (403), `tests/test_aglogen_core.py`
      (TypeError del binding) y errores de colección en `apps/ai_assistant/*`. El criterio de
      aceptación es: **los nueve módulos afectados en verde (base: 154 passed)** y la línea
      base global sin empeorar. Los nueve módulos y sus conteos actuales son:
      `apps/simulations/tests/test_distribution_validation.py` (18),
      `.../test_parametric_study_serializer.py` (13), `.../test_grid_expansion.py` (10),
      `.../test_distribution_field.py` (24), `.../test_distribution_plumbing.py` (10),
      `.../test_distribution_serializer.py` (8), `tests/test_utils.py` (33),
      `tests/test_serializers.py` (30), `tests/integration/test_parametric_values_pipeline.py` (8)
- [ ] T7.2 `cd frontend && npm test && npm run type-check` (base: 597 passed / 55 ficheros).
      `npm run lint` **existe** en `package.json` (`next lint`) pero el repo no tiene ninguna
      configuración de ESLint (ni `.eslintrc*` ni clave `eslintConfig`), así que lanza el
      asistente interactivo. Condición preexistente, declarada; no la arregla este change
- [ ] T7.3 Engine: sin cambios en `aglogen_core/`; se corre la suite como control de
      no-regresión
- [ ] T7.4 Verificación manual en UI, con criterio observable: estudio batch `tunable_cc` con
      `particle_radius_config` normal(1.0, 0.2) y 3 semillas → **el dpo efectivo difiere entre
      hijos** y **dentro de cada hijo todos los radios son iguales** (monodisperso por
      ejecución, R2)
- [ ] T7.5 Verificación manual: estudio con sinterizado normal(0.8, 0.05) → la media aplicada en
      los parámetros del hijo y en el resultado es 0.8

## T8 — Cierre

- [ ] T8.1 judgment-day (revisión adversarial dual, agentes frescos en sesión nueva)
- [ ] T8.2 Fix rounds hasta APPROVED
- [ ] T8.3 Archive + sincronización canónica de `batch-cc-tunable-parameter-parity`
      (bloques MODIFIED/ADDED completos, nunca diferidos) + `state.yaml`
- [ ] T8.4 PR a `develop` con etiqueta `type:bug` enlazando el issue AGLO
- [ ] T8.5 Comentario de entrega en Jira **haciendo constar** que los resultados batch
      anteriores con `sintering_config`, y los de cualquier estudio con sinterizado `normal`,
      se ejecutaron sin el sinterizado declarado; y transición 41
- [ ] T8.6 Abrir los changes de seguimiento: `polydispersity-single-source` (D4 y las
      asimetrías gemelas del formulario single) y el de polidispersidad real en batch

## Log

- L1 (2026-10-21): Explore con 4 probes ejecutadas contra el serializer real. D1 y D3
  confirmados por probe + grep; D2 por probe sobre `apply_sintering_config`; D4 por anclas.
- L2 (2026-10-21): Decisiones r1: alcance A (D1+D2+D3; D4 aparte) y fix-forward.
- L3 (2026-10-21): Contrato r1 (`f2956f2`). Revisión nativa RDD: APPROVED, 12 avisos no
  bloqueantes.
- L4 (2026-10-21): **spec-review r1** (`mvi4mz7y-1-f6qb`):
  `CORRECTIONS REQUIRED (3 blockers, 7 majors, 7 minors, 3 nits)`. D1/D2/D3 confirmados
  exactos. Nuevos: **D5** (BLOCKER-1), **D8** (BLOCKER-3: `tunable_cc.rs` *monodisperse per
  run*), contradicción interna del diseño sobre `{coefficient}` (BLOCKER-2), **D6** (MAJOR-2) y
  **D7** (MAJOR-3).
- L5 (2026-10-21): Decisiones r2: absorber D5, D6, D7, D8; polidispersidad real a seguimiento.
- L6 (2026-10-21): **Corrección r2** (`b736113`). Revisión nativa RDD: APPROVED, 15 avisos.
- L7 (2026-10-21): **spec-review r2** (`mvi671yj-2-qwr9`):
  `CORRECTIONS REQUIRED (3 blockers, 8 majors, 6 minors, 3 nits)`. Confirmó que D8 quedó
  genuinamente cerrado y que el remedio de D5 es correcto, pero encontró:
  - **BLOCKER-1: una evidencia mía era FALSA.** Afirmé "una única ocurrencia" de
    `sintering_mean` porque mi grep se limitó a `backend/apps` y se saltó `backend/tests`. Hay
    **dos**: la escritura y `tests/test_utils.py:316`. Verificado por mí tras el aviso.
  - **BLOCKER-2: tres tests rotos sin declarar** en listas que se anunciaban "completas"
    (`tests/test_utils.py:304-317` y `:335-344`, y
    `DistributionSelector.test.tsx:124-142`), más una fuga de alcance: `DistributionSelector`
    es compartido con el formulario single.
  - **BLOCKER-3: dos caminos de default silencioso seguían vivos** en mi propio R3: la entrada
    de grid `{}` y un `distribution_type` desconocido que llega al helper y cae por la rama `_`
    del engine a `fixed(1.0)`.
  - MAJORS: `limiting` SÍ consume sinterizado fijo (`tasks.py:1800`), `imported` sin definir,
    el `sintering_config` de estudio seguía sin restringir, preámbulo de divergencias
    incompleto, R13 ambiguo (habría borrado las fronteras de `seed_type`), **la reachability de
    D7 que yo afirmaba era falsa** (ya es alcanzable hoy vía API), línea base de tests roja sin
    declarar, y DD1 contradictorio sobre `None` y claves desconocidas.
- L8 (2026-10-21): **Corrección r3** (este commit). Cerrados los 3 blockers y los 8 majors:
  evidencia de D5 corregida y los 3 tests declarados (T2.3, T3.2, T6.6); R3 rechaza `{}` de
  grid y tipo desconocido en el helper; R11 pasa a **allow-list** de once algoritmos con
  `limiting` sólo-`fixed` y cubre el campo de estudio; preámbulo convertido en inventario
  exhaustivo de 8 entradas, con la relajación `min <= max` justificada contra
  `serializers.py:386`; R13 enunciado por tipo con escenario de no-regresión de `seed_type`;
  DD7 corregido (defecto preexistente, no abierto por nosotros); T7.1 declara la línea base
  roja; DD1 resuelto (rechazar `None` y claves desconocidas antes de normalizar). Añadidos los
  escenarios R11.6 (precedencia) y R11.7, y el conjunto enumerado de lectores en R12.3.
- L9 (2026-10-21): **spec-review r3** (`mvi85zra-3-7sj1`):
  `CORRECTIONS REQUIRED (1 blocker, 3 majors, 9 minors, 5 nits)`. Confirmó cerrados los once
  items de r2 salvo el inventario. Hallazgos:
  - **BLOCKER: el canónico R5.2 contradice mi R11** ("cada hijo con `kf_distribution = d1`")
    y R5 no estaba en MODIFIED; al archivar, `openspec/specs/` habría quedado contradiciéndose
    a sí mismo. Es la lección del ciclo 2, y se me escapó dos rondas.
  - **MAJOR: segunda puerta de entrada (D9)**. `study_tools.py:144,165` crea estudios e hijos
    por ORM sin serializer ni expansión: D3 sobrevivía intacto en una ruta alcanzable.
    Verificado por mí.
  - MAJOR: el inventario que se declaraba exhaustivo no lo era (etiqueta de R10, condición por
    algoritmo, MUSTs nuevos de R1/R3/R10).
  - MAJOR: el default compartido de `uniform` arreglado "obviamente" (`max = base*1.2`)
    produciría un 400 en `sintering_config`, cuyo rango es `[0.5, 1.0]`.
- L10 (2026-10-21): Decisión de la persona: **la ruta del asistente IA entra en alcance**.
- L11 (2026-10-21): **Corrección r4** (este commit). R5 entra como MODIFIED con restatement
  completo (R5.1-R5.5, sólo cambia la cláusula final de R5.2) e inventario ampliado a 9
  entradas y reencuadrado (cubre contradicciones, endurecimientos y relajaciones; los MUST
  aditivos viven en sus requisitos). DD9 extrae `services/study_expansion.py` como regla
  única para las dos puertas, con el precedente JD-A-006 del propio repo; R11/R12 obligan a
  ambas y R11.8 lo fija. R10.8 nuevo para el default de sinterizado. Corregidos además los 9
  minors y 5 nits: declaración inversa de T1.6, los nueve módulos de T7.1 enumerados, dueño
  para R1.1, `{}` de estudio explicitado, R13 por entrada, impacto del CSV y de `uniform`
  declarados, cuenta de vocabulario corregida a tres deletreos en cinco sitios, anclas de DD7
  y de T2.3.
