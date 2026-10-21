# Tasks: distribution-config-wiring

> Estado del contrato: **pendiente de spec-review** (delegada a agente fresco) y de
> `approval.md` de la persona. **No se escribe código hasta que exista `approval.md`.**
>
> Rama: `feature/distribution-config-wiring` (base `develop` @ `8423c4f`).
> Jira: pendiente de crear al aprobar (issue AGLO, transición 21 → En curso).

## T0 — Contrato

- [x] T0.1 Explore con probes ejecutadas (`explore.md`, commit `e44a978`)
- [x] T0.2 Decisiones de alcance con la persona: A (D1+D2+D3), fix-forward sin marcado retroactivo
- [x] T0.3 `proposal.md`, `design.md`, `specs/batch-cc-tunable-parameter-parity.md`
- [ ] T0.4 spec-review en agente fresco (sin la conversación autora)
- [ ] T0.5 Correcciones de spec-review hasta ronda sin hallazgos semánticos
- [ ] T0.6 `approval.md` — **sólo la persona aprueba**
- [ ] T0.7 Crear issue AGLO y pasarla a En curso (transición 21)

## T1 — Validador único de distribuciones (D1, R1/R2)

- [ ] T1.1 Reescribir `validate_distribution_config` (`services/distribution_validation.py`)
      como envoltorio de `DistributionField.to_internal_value`, con parámetros
      `allowed_modes`, `max_std_over_mean`, `min_mean`
- [ ] T1.2 `_DISTRIBUTION_GRID_KEYS` (`serializers.py:433`): `kf_distribution` →
      `allowed_modes = (fixed, normal, uniform)`; `particle_radius_config` →
      `allowed_modes = (fixed, normal)`, `max_std_over_mean = 0.3`
- [ ] T1.3 Reescribir a forma `mode` los tests que fijan `distribution_type`
      (`test_parametric_study_serializer.py:97,110`, `test_distribution_validation.py`) —
      **cambio declarado en el contrato, no silencioso**
- [ ] T1.4 Tests R1.2 (forma antigua rechazada), R1.3-R1.5, R2.1-R2.4

## T2 — Sinterizado sin default silencioso (D2, R3)

- [ ] T2.1 `validate_sintering_config` (`serializers.py:360`): rechazar claves fuera de
      `{distribution_type, coefficient, min, max, mean, std}`
- [ ] T2.2 `apply_sintering_config` (`utils.py:236`): lanzar ante dict no vacío sin
      `distribution_type`; `None`/`{}` siguen devolviendo los parámetros intactos
- [ ] T2.3 Tests R3.5 (400 con `{mode}`, ningún hijo con `sintering_coeff = 1.0`) y R3.6
      (el helper lanza)
- [ ] T2.4 Regresión: R3.1-R3.4 siguen verdes con la forma de dominio

## T3 — Cableado hasta el engine (D3, R11)

- [ ] T3.1 En `create_simulation` (`views.py:1785`): traducir
      `particle_radius_config → dpo_distribution` y `kf_distribution → target_kf_distribution`,
      sin conservar la clave de grid
- [ ] T3.2 Validación de alcance por algoritmo: 400 cuando `base_algorithm != "tunable_cc"`
- [ ] T3.3 Reescribir `test_particle_radius_config_passes_through`
      (`test_grid_expansion.py:292`) para afirmar la traducción — **declarado**
- [ ] T3.4 Test de cadena completa R11.1/R11.2: mock sobre el binding
      `aglogen_core.run_tunable_cc`, afirmando los kwargs `dpo_*`/`kf_*`
- [ ] T3.5 Test R11.4: sin grid keys, ningún kwarg `dpo_*`/`kf_*` (no regresión del legado)

## T4 — Frontend (R10)

- [ ] T4.1 `parameterOptions` (`BatchSimulationForm.tsx:310-318`): ofrecer
      `kf_distribution` y `particle_radius_config` sólo para `tunable_cc`
- [ ] T4.2 Función pura `toSinteringConfig(DistributionValue)` y su uso en el submit para
      `sintering_config`
- [ ] T4.3 Tests R10.3 (opciones ausentes para `ballistic`) y R10.4 (forma del payload de
      sinterizado)

## T5 — Verificación

- [ ] T5.1 `cd backend && pytest && ruff check && mypy .`
- [ ] T5.2 `cd frontend && npm test && npm run type-check`
      (`npm run lint` no está configurado en el repo — condición preexistente)
- [ ] T5.3 Engine: sin cambios en `aglogen_core/`; se corre la suite igualmente como
      control de no-regresión
- [ ] T5.4 Verificación manual en UI: crear un estudio batch `tunable_cc` con
      `particle_radius_config` normal y comprobar que los hijos salen con radios distintos

## T6 — Cierre

- [ ] T6.1 judgment-day (revisión adversarial dual, agentes frescos en sesión nueva)
- [ ] T6.2 Fix rounds hasta APPROVED
- [ ] T6.3 Archive + sincronización canónica de `batch-cc-tunable-parameter-parity`
      (bloques MODIFIED/ADDED completos, nunca diferidos) + `state.yaml`
- [ ] T6.4 PR a `develop` con etiqueta `type:bug` enlazando el issue AGLO
- [ ] T6.5 Comentario de entrega en Jira **haciendo constar** que los resultados batch
      anteriores con `sintering_config` se ejecutaron sin sinterizado, y transición 41
- [ ] T6.6 Abrir el change de seguimiento `polydispersity-single-source` (D4)

## Log

- L1 (2026-10-21): Explore con 4 probes ejecutadas contra el serializer real (no lectura).
  D1 y D3 confirmados por probe + grep; D2 confirmado por probe sobre `apply_sintering_config`
  (`{mode:...}` → `{'sintering_type':'fixed','sintering_coeff':1.0}`); D4 confirmado por
  anclas en `SimulationForm.tsx:716-718` y la nota del engine en `tunable_cc.rs:2621`.
- L2 (2026-10-21): Decisiones de la persona: alcance A (D1+D2+D3; D4 a change aparte) y
  fix-forward sin marcado retroactivo de estudios afectados.
- L3 (2026-10-21): Contrato escrito. Tres divergencias del canónico declaradas en la delta
  (`type` vs `mode`, atajo escalar R1.2 nunca implementado, `value` vs `coefficient` en el
  sinterizado). Sin Fase 0: el contrato no contiene ninguna hipótesis numérica.
