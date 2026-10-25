# distribution-grid-wiring

## Why

Las otras dos rejillas de distribución de un estudio batch —`kf_distribution` y
`particle_radius_config`— **no funcionan por ninguna de las dos vías posibles**: la forma que
envía la interfaz se rechaza siempre, y la forma que el backend acepta no la lee nadie.

Fase 0 (2026-10-25, sonda `_fase0_dgw_probe.py`) lo mide contra el código de hoy:

| Lo que se envía | Qué pasa | Medido |
| --- | --- | --- |
| Lo que manda la interfaz: `{mode:"fixed", value:1.5}` | **400 siempre** | `distribution_type is required in distribution config.` |
| Lo que acepta el backend: `{distribution_type:"fixed", value:1.5}` | **201**, y el hijo guarda el dict… que nadie lee | el worker lee `target_kf_distribution` y `radius_min`/`radius_max`, no estas claves |
| Lo que documenta la spec canónica: `{type:"fixed", value:1.5}` | **400** | R1 describe una forma que nadie implementa |

Son **tres nombres para la misma idea** (`mode`, `distribution_type`, `type`) y **dos nombres
distintos para la misma magnitud** (`kf_distribution` en batch frente a `target_kf_distribution`
en el engine; `particle_radius_config` frente a `dpo_distribution`).

La consecuencia es la misma familia que cerró `sintering-reaches-engine`: **un estudio pide una
variación y corre sin ella**. Con una diferencia que lo hace menos urgente y más barato: por la
interfaz hoy se ve un 400, no un resultado falso. El resultado falso solo lo obtiene quien use la
API directamente con la forma correcta.

La ruta single **ya tiene resuelto** el problema: `SimulationSerializer` declara
`dpo_distribution` y `target_kf_distribution` como `DistributionField` y los traduce a
`parameters` antes de encolar. Batch no hace esa traducción. Esto no es añadir validación: es
cablear batch a los nombres que el engine ya lee.

### Dos afirmaciones del mapa de exploración que Fase 0 ha refutado

El mapa `_explore-only/distribution-config-surface.md` es del 2026-10-21 y el contrato de
sinterizado cambió el código debajo. **No se copian sus afirmaciones sin volver a medirlas**:

- **D7 ya no ocurre.** «Casos límite + entradas dict → `sorted()` sobre dicts» devuelve hoy 201.
  Lo cerró `add_case` en `utils.py`, que salta las listas con `Mapping` y captura el `TypeError`.
  Queda fuera de alcance por estar cerrado, no por decisión.
- **D8 es falso tal y como está escrito.** Decía que `tunable_cc` es «monodisperso por
  construcción»; hoy `random_radius` se llama por partícula y el engine declara
  `dpo_distribution` y `target_kf_distribution` como entradas propias. Lo que sí hay que decidir
  es **qué significa** cada una (muestreo por partícula frente a por ejecución), y decirlo en la
  interfaz, porque hoy no lo dice.

## What Changes

**Una sola forma, de punta a punta, y los nombres que el engine lee.**

1. **La interfaz emite la forma del dominio.** `DistributionSelector` y `DistributionGridInput`
   dejan de emitir `{mode}` y emiten `{distribution_type}`, en una función pura de traducción
   como la que T6 dejó para el sinterizado (`lib/sinteringShape.ts`), reutilizada para las tres
   rejillas.
2. **Batch traduce a los nombres del engine**, como ya hace la ruta single: `kf_distribution` →
   `target_kf_distribution`, `particle_radius_config` → `dpo_distribution`, en el único sitio que
   expande el estudio.
3. **La spec canónica deja de mentir.** R1 y R2 documentan `{type}`, la clave `mean` para radio
   fijo y un atajo escalar: las tres cosas dan 400 hoy. Se reescriben contra el comportamiento
   real, con el escenario que sí se cumple (`std/mean <= 0.3`) intacto.
4. **La tabla de resultados sigue funcionando.** `BatchResultsTable` pinta una columna por
   `Object.keys(parameter_grid)` y `FractalAnalysisTab` compone etiquetas igual: traducir la
   clave sin más **rompe la tabla y ninguna prueba lo detecta**. El contrato exige testigo de eso.
5. **Tres defectos derivados de #115 que caen en esta superficie**: el objeto desnudo barrido en
   extremos que guarda nombres de clave como valores (punto 1, hoy `xfail(strict=True)`), la
   lista de tipos mezclados que guarda `"abc"` (punto 2, `xfail`), y el 500 por valor inhashable
   en `seed_type` (punto 4).

### Fuera de alcance, dicho para que nadie lo asuma

- **La puerta del asistente IA** (`study_tools.py`, ORM directo sin validación): es D9 y va en
  `study-expansion-single-source`, el tercer contrato de la cadena.
- **Polidispersidad real en batch para FracVAL** (único algoritmo que la implementa): seguimiento.
- **El `onError` de la página batch** (#115 punto 6): sigue sin dueño, y con este contrato pasa a
  importar más, porque un 400 bien formado seguirá siendo invisible.
- **#130** (`state.yaml` declara 10 archivados de 29): carril propio, ya tiene issue.
