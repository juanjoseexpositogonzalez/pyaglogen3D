# Design: distribution-config-wiring

> Decisiones de implementación del contrato. Anclas verificadas sobre `develop` @ `8423c4f`.

## D1 — Un solo validador para distribuciones `{mode}`

**Decisión.** `DistributionField.to_internal_value` (`backend/apps/simulations/fields.py:25`)
pasa a ser el **único** validador de forma para `kf_distribution` y `particle_radius_config`.
`validate_distribution_config` (`services/distribution_validation.py:19`) se reescribe como un
envoltorio que: (1) delega la forma en `DistributionField`, (2) aplica las restricciones extra
del grid (`max_std_over_mean`, `min_mean`, `allowed_modes`).

**Por qué.** `DistributionField` ya valida exactamente la forma que emite el frontend y que
consume `expand_distribution_kwargs`, con rangos (`value > 0`, `std > 0`, `max > min`). Tener
dos validadores para una forma es cómo nació este defecto.

**Alternativa descartada.** Aceptar `distribution_type` como alias de escritura. Rechazada: no
existe ni puede existir dato histórico con esa forma en estas dos claves — la UI siempre
recibió 400 (D1), así que ningún estudio creado desde la aplicación la contiene. Aceptar un
alias sería preservar un vocabulario que nadie usó nunca.

**Coste explícito.** Los tests archivados que escriben `{"distribution_type": "normal", …}`
(`tests/test_parametric_study_serializer.py:97,110`, `tests/test_distribution_validation.py`)
**se reescriben a `mode`**. No es debilitar un test: es corregir la forma que el test fija,
y queda declarado en el contrato (R1/R2 MODIFIED) y en el Log, como manda AGENTS.md.

## D2 — `allowed_modes` por clave

| Grid key | Modos | Razón |
| --- | --- | --- |
| `kf_distribution` | `fixed`, `normal`, `uniform` | El engine soporta los tres (`parse_target_kf_distribution`, `python/src/lib.rs:657`) |
| `particle_radius_config` | `fixed`, `normal` | Es lo que ya ofrece la UI (`BatchSimulationForm.tsx:522-525`); `uniform` no se añade en este change |

`particle_radius_config` conserva además `max_std_over_mean = 0.3` (R2 canónica, evita radios
negativos).

## D3 — Sinterizado: rechazo explícito, nunca default silencioso

**Decisión en dos mitades:**

1. **API.** `validate_sintering_config` (`serializers.py:360`) rechaza con 400 cualquier dict
   con **claves desconocidas**. El conjunto permitido es
   `{distribution_type, coefficient, min, max, mean, std}`.
2. **Helper.** `apply_sintering_config` (`utils.py:236`) deja de hacer
   `.get("distribution_type", "fixed")` sobre un dict no vacío: si el dict no declara
   `distribution_type`, lanza `ValueError`. Un config vacío o `None` sigue devolviendo los
   parámetros intactos (ruta legítima, `utils.py:255`).

**Por qué "claves desconocidas" y no "distribution_type obligatorio".** La regla más estricta
rompería a cualquier cliente que hoy envíe `{"coefficient": 0.9}` a nivel de estudio, que es
una forma válida y documentada (`utils.py:244-250`). Rechazar claves desconocidas atrapa
`{mode, mean, std}` —el bug real— sin tocar lo que ya funciona.

**Por qué el helper lanza aunque la API ya rechace.** Defensa en profundidad: el helper es la
última frontera antes del parámetro que decide la física. El fallo silencioso es el defecto
más grave de los tres precisamente porque nadie se entera.

**Adaptador de UI.** `BatchSimulationForm` traduce en el submit la entrada
`DistributionValue` → forma de sinterizado, en **una** función pura
(`toSinteringConfig`), no esparcida por el componente:

| `DistributionValue` | Sintering config |
| --- | --- |
| `{mode:'fixed', value}` | `{distribution_type:'fixed', coefficient: value}` |
| `{mode:'normal', mean, std}` | `{distribution_type:'normal', mean, std}` |
| `{mode:'uniform', min, max}` | `{distribution_type:'uniform', min, max}` |

## D4 — Cableado grid key → kwargs de engine

**Decisión.** La traducción ocurre en `create_simulation`
(`backend/apps/simulations/views.py:1785`), donde ya viven las otras dos traducciones
(`seed_type` → campo de modelo, `sintering_config` → parámetros):

```text
particle_radius_config  →  dpo_distribution
kf_distribution         →  target_kf_distribution
```

El sim hijo recibe **solo** la clave de engine, no las dos. Mantener ambas sería duplicar la
verdad y abrir la puerta a que diverjan, que es exactamente el defecto que este change cierra.
La procedencia del barrido sigue viviendo donde corresponde: en `study.parameter_grid`.

**Coste explícito.** `tests/test_grid_expansion.py:292-313`
(`test_particle_radius_config_passes_through`) fija el passthrough tal cual; se reescribe para
afirmar la traducción. Ese test es la razón de que D3 fuera invisible a la suite: afirmaba que
el parámetro llega a `sim.parameters` y nunca que llega al engine.

**Verificación anti-regresión del propio defecto.** Un test nuevo afirma la cadena completa
hasta el borde del engine: creado el estudio, el `run_simulation_task` del hijo invoca
`aglogen_core.run_tunable_cc` con `dpo_mode`/`dpo_mean`/`dpo_std` (mock sobre el binding). Sin
ese test, cualquier refactor futuro vuelve a cortar la costura sin que nadie lo note.

## D5 — Alcance por algoritmo

**Decisión.** `particle_radius_config` y `kf_distribution` solo son válidas cuando
`base_algorithm == "tunable_cc"`. Con cualquier otro algoritmo → 400; y el desplegable de
"parámetro a variar" deja de ofrecerlas (`BatchSimulationForm.tsx:310-318`, que hoy las añade
incondicionalmente para todo lo que no sea `limiting`).

**Por qué.** `dpo_distribution`/`target_kf_distribution` solo existen en la ruta `tunable_cc`
del worker (`tasks.py:1672-1703`). Ofrecerlas para `ballistic` o `dla` es prometer un barrido
que el engine no puede ejecutar — el mismo tipo de mentira que estamos arreglando. El nombre
del change que las introdujo (`batch-cc-tunable-parameter-parity`) dice que su propósito era
precisamente la paridad con el formulario CC tunable.

**Alternativa descartada.** Mapear `particle_radius_config` a `radius_min`/`radius_max` para
el resto de algoritmos. Es defendible (el modo `uniform` encaja de forma natural), pero el
modo `normal` no tiene ruta de engine fuera de `tunable_cc` y quedaría una excepción muda.
Si se quiere, es un change aditivo posterior con su propio contrato.

`sintering_config` **no** se restringe: `sintering_coeff`/`sintering_type` los consumen todos
los algoritmos no-`limiting` (`tasks.py:1601-1610` y siguientes).

## Riesgos

- **Estudios ya almacenados.** Ninguno puede contener `kf_distribution` ni
  `particle_radius_config` creados desde la UI (siempre 400). Los que contengan
  `sintering_config` con `{mode}` ya se ejecutaron sin sinterizado; no se reinterpretan ni se
  vuelven a expandir (la expansión ocurre solo en la creación). Fix-forward, por decisión de
  la persona.
- **Cambio de comportamiento deliberado (D2).** Un estudio batch que "funcionaba" con
  sinterizado silenciosamente desactivado ahora sinteriza o falla en validación. Es el
  objetivo, y se declara en Jira.
- **Sin CI.** `.github/workflows/` está vacío; toda la verificación es local
  (`pytest` + `vitest` + `mypy` + `ruff`).
