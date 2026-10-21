# Tasks: distribution-config-wiring

> Estado del contrato: **spec-review r2 pendiente** (agente fresco) y `approval.md` de la
> persona. **No se escribe código hasta que exista `approval.md`.**
>
> Rama: `feature/distribution-config-wiring` (base `develop` @ `8423c4f`).
> Jira: pendiente de crear al aprobar (issue AGLO, transición 21 → En curso).

## T0 — Contrato

- [x] T0.1 Explore con probes ejecutadas (`explore.md`, commit `e44a978`)
- [x] T0.2 Decisiones de alcance r1: A (D1+D2+D3), fix-forward sin marcado retroactivo
- [x] T0.3 Contrato r1 (commit `f2956f2`)
- [x] T0.4 spec-review r1 en agente fresco → `CORRECTIONS REQUIRED (3 blockers, 7 majors)`
- [x] T0.5 Decisiones de alcance r2: absorber D5, D7, D8 y restringir el sinterizado (D6);
      polidispersidad real a change de seguimiento
- [x] T0.6 Corrección r2 del contrato (este commit)
- [ ] T0.7 spec-review r2 en agente fresco
- [ ] T0.8 `approval.md` — **sólo la persona aprueba**
- [ ] T0.9 Crear issue AGLO y pasarla a En curso (transición 21)

## T1 — Validador único de distribuciones `{mode}` (D1, R1/R2)

- [ ] T1.1 Reescribir `validate_distribution_config` (`services/distribution_validation.py`)
      como envoltorio de `DistributionField.to_internal_value`, con `allowed_modes` y
      `max_std_over_mean`. **Retirar el parámetro `min_mean`** (sin consumidor)
- [ ] T1.2 Rechazar claves desconocidas dentro del dict (simetría con R3)
- [ ] T1.3 Persistir la salida **normalizada** del validador, no el dict crudo
- [ ] T1.4 `_DISTRIBUTION_GRID_KEYS` (`serializers.py:434`): `kf_distribution` →
      `allowed_modes = (fixed, normal, uniform)`; `particle_radius_config` →
      `allowed_modes = (fixed, normal)`, `max_std_over_mean = 0.3`
- [ ] T1.5 **Tests existentes que esta tarea pone en rojo y se reescriben a `mode`**
      (declaración completa — AGENTS.md: nunca en silencio):
      - `tests/test_parametric_study_serializer.py:53-65` `test_valid_kf_distribution_accepted`
      - `tests/test_parametric_study_serializer.py:92-104` y `:105-116` (`particle_radius_config`)
      - `tests/test_distribution_validation.py` (todo el fichero usa `distribution_type`)
- [ ] T1.6 Tests nuevos: R1.3-R1.7, R2.1-R2.4

## T2 — Sinterizado sin default silencioso (D2, R3)

- [ ] T2.1 `validate_sintering_config` (`serializers.py:360`): exigir `distribution_type` en
      dict no vacío, exigir los campos requeridos por tipo, rechazar claves fuera de
      `{distribution_type, coefficient, min, max, mean, std}`
- [ ] T2.2 `apply_sintering_config` (`utils.py:236`): lanzar ante dict no vacío que incumpla lo
      anterior; `None`/`{}` siguen devolviendo los parámetros intactos
- [ ] T2.3 Tests R3.5 (400 con `{mode}`, ningún hijo con `sintering_coeff = 1.0`), R3.6
      (campos incompletos) y R3.7 (el helper lanza)
- [ ] T2.4 Regresión: R3.1-R3.4 siguen verdes con la forma de dominio

## T3 — El sinterizado llega al engine (D5, R12)

- [ ] T3.1 `apply_sintering_config`: escribir `sintering_coeff` (no `sintering_mean`) para el
      tipo `normal`; retirar `sintering_mean`, que no tiene ningún lector
- [ ] T3.2 Test R12.1 de borde de engine: mock sobre el binding, afirmando que la media que
      llega es 0.8 y **no** 1.0
- [ ] T3.3 Tests R12.2 (fixed/uniform) y R12.3 (ninguna clave de sinterizado sin lector)

## T4 — Cableado de las grid keys (D3, R11)

- [ ] T4.1 En `create_simulation` (`views.py:1784`): traducir
      `particle_radius_config → dpo_distribution` y `kf_distribution → target_kf_distribution`,
      sin conservar la clave de grid, con precedencia sobre `base_parameters`
- [ ] T4.2 Validación de alcance por algoritmo (R11.3): distribuciones sólo `tunable_cc`;
      sinterizado no para `fracval`/`gcca`/`box_rfa`/`limiting`
- [ ] T4.3 Ruta de actualización parcial (R11.5): evaluar la regla contra
      `self.instance.base_algorithm` cuando el `PATCH` no trae el campo
- [ ] T4.4 **Tests existentes que esta tarea pone en rojo y se reescriben** (declaración
      completa):
      - `tests/test_grid_expansion.py:292-313` `test_particle_radius_config_passes_through`
      - `tests/test_grid_expansion.py:269-290` `test_kf_distribution_passes_through`
        (forma antigua **y** `assert sim.parameters.get("kf_distribution") == kf_config`)
      - `tests/test_grid_expansion.py:324-369` `test_all_four_keys_expand_correctly`
        (forma antigua y `assert "kf_distribution" in sim.parameters`)
- [ ] T4.5 Tests nuevos R11.1/R11.2 (borde de engine, mock del binding), R11.3, R11.4, R11.5

## T5 — Casos límite (D7, R13)

- [ ] T5.1 `generate_limiting_cases` (`utils.py:176-190`): ignorar claves cuyos valores no sean
      escalares comparables, antes del `sorted(values)`
- [ ] T5.2 Tests R13.1 y R13.2 (ningún 500; fronteras sólo para los escalares)

## T6 — Frontend (D6, D8, R10)

- [ ] T6.1 `parameterOptions` (`BatchSimulationForm.tsx:310-318`): `kf_distribution` y
      `particle_radius_config` sólo para `tunable_cc`; `sintering_config` sólo para
      `dla`/`cca`/`ballistic`/`ballistic_cc`/`tunable`/`tunable_cc`
- [ ] T6.2 Renombrar la etiqueta a "Primary particle size (dpo)" (`BatchSimulationForm.tsx:315`)
- [ ] T6.3 Función pura `toSinteringConfig(DistributionValue)` y su uso en el submit
- [ ] T6.4 `DistributionSelector.tsx:57`: el default de `uniform` emite `min == max`, inválido
      para la API (`max > min`); proponer un rango válido
- [ ] T6.5 Tests R10.3 (no regresión escalar), R10.4 (etiqueta), R10.5 (opciones ausentes),
      R10.6 (payload de sinterizado), R10.7 (default válido)

## T7 — Verificación

- [ ] T7.1 `cd backend && pytest && ruff check && mypy .`
- [ ] T7.2 `cd frontend && npm test && npm run type-check`.
      `npm run lint` **existe** en `package.json` (`next lint`) pero el repo no tiene ninguna
      configuración de ESLint (ni `.eslintrc*` ni clave `eslintConfig`), así que `next lint`
      lanza el asistente interactivo. Condición preexistente, declarada; no la arregla este
      change
- [ ] T7.3 Engine: sin cambios en `aglogen_core/`; se corre la suite igualmente como control
      de no-regresión
- [ ] T7.4 Verificación manual en UI, con criterio observable: crear un estudio batch
      `tunable_cc` con `particle_radius_config` normal(1.0, 0.2) y 3 semillas, y comprobar que
      **el `dpo` efectivo difiere entre sims hijos** y que **dentro de cada hijo todos los
      radios son iguales** (monodisperso por ejecución, R2)
- [ ] T7.5 Verificación manual: estudio con sinterizado normal(0.8, 0.05) y comprobar en los
      parámetros del hijo y en el resultado que la media aplicada es 0.8

## T8 — Cierre

- [ ] T8.1 judgment-day (revisión adversarial dual, agentes frescos en sesión nueva)
- [ ] T8.2 Fix rounds hasta APPROVED
- [ ] T8.3 Archive + sincronización canónica de `batch-cc-tunable-parameter-parity`
      (bloques MODIFIED/ADDED completos, nunca diferidos) + `state.yaml`
- [ ] T8.4 PR a `develop` con etiqueta `type:bug` enlazando el issue AGLO
- [ ] T8.5 Comentario de entrega en Jira **haciendo constar** que los resultados batch
      anteriores con `sintering_config`, y los de cualquier estudio con sinterizado `normal`,
      se ejecutaron sin el sinterizado declarado; y transición 41
- [ ] T8.6 Abrir los changes de seguimiento: `polydispersity-single-source` (D4) y el de
      polidispersidad real en batch (FracVAL / dpo por partícula)

## Log

- L1 (2026-10-21): Explore con 4 probes ejecutadas contra el serializer real (no lectura).
  D1 y D3 confirmados por probe + grep; D2 por probe sobre `apply_sintering_config`
  (`{mode:...}` → `{'sintering_type':'fixed','sintering_coeff':1.0}`); D4 por anclas en
  `SimulationForm.tsx:716-718` y la nota del engine en `tunable_cc.rs:2621`.
- L2 (2026-10-21): Decisiones r1 de la persona: alcance A (D1+D2+D3; D4 aparte) y fix-forward.
- L3 (2026-10-21): Contrato r1 (`f2956f2`). Revisión nativa RDD: APPROVED, 12 hallazgos no
  bloqueantes (colisión de etiquetas D*, reutilización del id R1.2, afirmación sobre datos
  históricos, hueco de precedencia en R11, knob `min_mean` sin consumidor).
- L4 (2026-10-21): **spec-review r1** (agente fresco, `mvi4mz7y-1-f6qb`):
  `CORRECTIONS REQUIRED (3 blockers, 7 majors, 7 minors, 3 nits)`. D1/D2/D3 confirmados
  exactos. Hallazgos nuevos: **D5** (BLOCKER-1: `sintering_mean` sin lectores → la media
  normal nunca llega; verificado por mí con `grep -r sintering_mean` → 1 ocurrencia y
  `lib.rs:602`), **D8** (BLOCKER-3: `tunable_cc.rs:1124` *monodisperse per run* → la opción
  "polydispersity" miente), contradicción interna del diseño sobre `{coefficient}`
  (BLOCKER-2, verificado: ningún sender), **D6** (MAJOR-2: `tasks.py:1705,1738,1752` sin
  kwargs de sinterizado) y **D7** (MAJOR-3: `sorted()` sobre dicts → 500 alcanzable al
  arreglar D1).
- L5 (2026-10-21): Decisiones r2 de la persona: absorber D5, D7, D8 y la restricción del
  sinterizado (D6); polidispersidad real a change de seguimiento.
- L6 (2026-10-21): **Corrección r2** (este commit). Cerrados los 3 blockers (R12 nueva + DD4;
  regla única de sinterizado en DD3; semántica y etiqueta honestas en R2/R10/DD8), los 7
  majors (tests declarados en T1.5/T4.4; R11.3 con la lista real de algoritmos; R13 nueva;
  R11.4 corregido —`radius_max` se ignora en `tunable_cc` incluso en la ruta legada—; R10.3
  canónico conservado; R3.6 de campos incompletos; corregida la justificación falsa del
  proposal sobre la simulación individual), los 7 minors y los 3 nits (anclas
  `tasks.py:1591-1598` y `:1683-1685`, preámbulo con 5 divergencias, asimetría del single
  declarada fuera de alcance). Nomenclatura: defectos `D*`, decisiones de diseño `DD*`.
