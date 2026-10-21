# Proposal: distribution-config-wiring

> SDD change (política AGENTS.md). Origen: el usuario reportó "dos sitios que definen
> polidispersidad en el formulario batch". La exploración (`explore.md`, commit `e44a978`)
> encontró cuatro defectos; la spec-review r1 (agente fresco, veredicto
> `CORRECTIONS REQUIRED — 3 blockers, 7 majors`) encontró **cuatro más**, uno de ellos fatal
> para la tesis de este contrato.
>
> Decisiones de la persona: **alcance A** (2026-10-21), ampliado tras la spec-review r1 a los
> tres hallazgos obligatorios **más** la restricción del sinterizado; **fix-forward** sin
> marcado retroactivo; y para la polidispersidad real, **renombrar aquí + change de
> seguimiento**.

## Intent

Las cuatro *grid keys* que añadió el change archivado `batch-cc-tunable-parameter-parity`
(2026-05-13) se validan y se almacenan, pero **ninguna de las tres de distribución llega
intacta al engine**. Este change conecta las costuras y elimina los fallos silenciosos: hoy
un estudio batch con sinterizado se acepta y se ejecuta **sin** sinterizado, sin un solo
error.

## Defectos en alcance

Cada afirmación está verificada con una probe ejecutada contra el código real, no por lectura.

| # | Defecto | Evidencia |
| --- | --- | --- |
| **D1** | La UI batch emite `{mode}`; el validador exige `{distribution_type}` → `kf_distribution` y `particle_radius_config` dan **400 siempre** | `400 -> 'distribution_type is required in distribution config.'` |
| **D2** | `sintering_config` con esa misma forma **se acepta** y `apply_sintering_config` cae a `fixed/1.0` | `apply({mode:'normal',mean:0.8,std:0.05}) -> {'sintering_type':'fixed','sintering_coeff':1.0}` |
| **D3** | `particle_radius_config` / `kf_distribution` no los lee nadie en el worker | `grep particle_radius_config backend/apps/simulations/tasks.py` → 0 ocurrencias |
| **D5** | Con la forma **correcta**, el sinterizado `normal` tampoco llega: `apply_sintering_config` escribe `sintering_mean` (`utils.py:268`) y **nadie lo lee**; el engine usa `sintering_coeff` como media (`lib.rs:602`), que sigue valiendo 1.0 | `grep -r sintering_mean backend frontend aglogen_core` → 1 sola ocurrencia, la escritura |
| **D6** | La UI ofrece barrido de sinterizado para `fracval`, `gcca` y `box_rfa`, cuyas llamadas al engine **no reciben ningún kwarg de sinterizado** | `tasks.py:1705,1738,1752` sin `sintering_coeff=` |
| **D7** | Arreglar D1 hace **alcanzable un 500**: `generate_limiting_cases` hace `sorted(values)` sobre entradas dict (`utils.py:178`) | `TypeError: '<' not supported between instances of 'dict' and 'dict'` |
| **D8** | `particle_radius_config` se ofrece como "polidispersidad", pero `tunable_cc` es **monodisperso por construcción** | `tunable_cc.rs:1124-1127`: `radius_min = dpo_used, radius_max = dpo_used, // monodisperse per run` |

**D5 es el hallazgo más grave de la spec-review**: sin él, este contrato bendecía una forma de
sinterizado que seguía produciendo "sin sinterizado" en silencio — el mismo defecto D2 una
capa más abajo, y la tesis del proposal habría sido falsa.

**D8 es una mentira de la misma clase que este change condena.** `tunable_cc` muestrea **un**
dpo por ejecución y pone `radius_min = radius_max`; esa clave barre el **tamaño de partícula
primaria entre hijos**, no la dispersión de tamaños dentro de un agregado (canónica
`cc-tunable-aggregation.md` R12). El único algoritmo con polidispersidad real es **FracVAL**
(lognormal, `geometric_std`).

## Fuera de alcance

- **D4** — el toggle `Size Distribution / Polydisperse` del formulario single está muerto para
  `tunable_cc` (`SimulationForm.tsx:716-718` y, si el modo no es `fixed`, el propio engine en
  `tunable_cc.rs:1124`). Change de seguimiento `polydispersity-single-source`.
- **Polidispersidad real en batch** — change de seguimiento (decisión de la persona): estudiar
  si se expone `geometric_std` de FracVAL o si el engine aprende dpo por partícula. Aquí sólo
  se renombra lo que miente.
- **Asimetría del single** — `SimulationSerializer` acepta `dpo_distribution` /
  `target_kf_distribution` para cualquier algoritmo (`serializers.py:101-110`, el `help_text`
  dice "CC tunable only" pero nada lo impone), mientras R11 lo restringe en batch. Pertenece al
  change del formulario single.
- Cualquier cambio en `aglogen_core/`. **Este change no toca el engine**: `run_tunable_cc` ya
  acepta `dpo_*` y `kf_*` desde PYA-15, y `parse_sintering` ya lee `sintering_coeff`.
- Marcado retroactivo de estudios ya creados (decisión de la persona).

## Decisión de vocabulario

Hoy conviven **cuatro** deletreos del mismo concepto:

| Capa | Clave discriminadora |
| --- | --- |
| Frontend (`DistributionValue`, ambos formularios) | `mode` |
| Worker → engine (`expand_distribution_kwargs`) | `mode` |
| API single (`DistributionField`, `fields.py:25`) | `mode` |
| Validación grid batch (`distribution_validation.py:49`) | `distribution_type` |
| Spec canónica R1/R2 | `type` (no lo implementa nadie) |

**Se canoniza `{mode, …}`** para las distribuciones de dpo y kf: es lo que ya usan tres de las
cuatro capas, incluido el único validador que funciona de verdad (`DistributionField`). Se
mueve una sola función de backend, no el frontend ni el engine.

**El sinterizado conserva su propia forma de dominio** `{distribution_type, coefficient|min,max|mean,std}`:
no es una distribución genérica (rangos acotados a 0.5-1.0, variante fija con `coefficient` en
vez de `value`) y esa forma la comparten el campo `ParametricStudy.sintering_config` y su
`help_text` del modelo (`models.py:140-144`). Quien se adapta es la UI batch, no el dominio.
La simulación individual, en cambio, usa **escalares planos** (`sintering_type`,
`sintering_coeff`, …) — por eso D5 existe: `apply_sintering_config` es el puente entre el dict
de dominio y esos escalares, y lo cruzaba mal.

## Capabilities

### Modified Capabilities

- `batch-cc-tunable-parameter-parity`: **MODIFIED** R1, R2, R3, R10; **ADDED** R11 (cableado
  grid key → kwargs de engine), R12 (el sinterizado llega al engine), R13 (casos límite con
  claves de distribución). Delta en `specs/`.

### Referenced, not modified

- `cc-tunable-aggregation` R12 (`openspec/specs/cc-tunable-aggregation.md:573-590`) fija que el
  muestreo de dpo es **monodisperso por ejecución**. Este change **cita** esa semántica y
  alinea su propio lenguaje con ella; no la modifica.

## Por qué no hay Fase 0

La lección del ciclo 3 obliga a un diagnóstico numérico antes de lockear una hipótesis
estadística. **Este contrato no contiene ninguna**: no fija fórmulas, tolerancias ni sesgos de
estimador. La cota `std/mean <= 0.3` y los rangos 0.5-1.0 se heredan literalmente del canónico
y están corroborados por el truncado `μ±3σ` del engine (`dpo_distribution.rs:62-72`). El hilo
que sí requiere Fase 0 es `cc-tunable-df-fidelity` (Df=2.7/N=100 → 2.533), y la exploración
descarta que estos defectos lo expliquen.

## Impacto en comportamiento ya desplegado

D2 y D5 cambian el comportamiento a propósito. Los estudios batch cuyo sinterizado se descartó
en silencio empezarán a sinterizar o a fallar en validación. **Los resultados batch anteriores
con `sintering_config`, y los de cualquier estudio con sinterizado `normal`, no son lo que sus
parámetros dicen**; eso se hace constar en el comentario de entrega de Jira.

Para `kf_distribution` y `particle_radius_config` no hay datos históricos creados desde la
aplicación: la UI nunca consiguió crearlos (400). Un cliente que llame a la API directamente sí
pudo almacenarlos con la forma antigua; esos estudios quedarán no editables (cualquier
PUT/PATCH revalida y devuelve 400). Se acepta como fix-forward.
