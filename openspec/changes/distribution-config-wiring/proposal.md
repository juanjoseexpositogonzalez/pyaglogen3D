# Proposal: distribution-config-wiring

> SDD change (política AGENTS.md). Origen: el usuario reportó "dos sitios que definen
> polidispersidad en el formulario batch". La exploración (`explore.md`, `e44a978`) encontró
> cuatro defectos; la **spec-review r1** encontró cuatro más; la **spec-review r2**
> (`CORRECTIONS REQUIRED — 3 blockers, 8 majors`) demostró que una de las evidencias de r2 era
> **falsa** y que tres tests rotos seguían sin declarar.
>
> Decisiones de la persona: **alcance A** ampliado a D5, D6, D7 y D8; **fix-forward** sin
> marcado retroactivo; polidispersidad real a **change de seguimiento**.

## Intent

Las cuatro *grid keys* que añadió el change archivado `batch-cc-tunable-parameter-parity`
(2026-05-13) se validan y se almacenan, pero **ninguna de las tres de distribución llega
intacta al engine**. Este change conecta las costuras y elimina los fallos silenciosos: hoy un
estudio batch con sinterizado se acepta y se ejecuta **sin** sinterizado, sin un solo error.

## Defectos en alcance

Cada afirmación está verificada con una probe ejecutada o un grep sobre el repositorio
completo, no por lectura.

| # | Defecto | Evidencia |
| --- | --- | --- |
| **D1** | La UI batch emite `{mode}`; el validador exige `{distribution_type}` → `kf_distribution` y `particle_radius_config` dan **400 siempre** | `400 -> 'distribution_type is required in distribution config.'` |
| **D2** | `sintering_config` con esa misma forma **se acepta** y `apply_sintering_config` cae a `fixed/1.0` | `apply({mode:'normal',mean:0.8,std:0.05}) -> {'sintering_type':'fixed','sintering_coeff':1.0}` |
| **D3** | `particle_radius_config` / `kf_distribution` no los lee nadie en el worker | `grep particle_radius_config backend/apps/simulations/tasks.py` → 0 ocurrencias |
| **D5** | Con la forma **correcta**, el sinterizado `normal` tampoco llega: `apply_sintering_config` escribe `sintering_mean` (`utils.py:268`), que **ningún consumidor de producción lee**; el engine toma `sintering_coeff` como media (`lib.rs:602`), que sigue valiendo 1.0 | `grep -rn sintering_mean backend frontend aglogen_core` → **dos** ocurrencias: la escritura en `utils.py:268` y una aserción de test en `tests/test_utils.py:316` |
| **D6** | La UI ofrece barrido de sinterizado para `fracval`, `gcca` y `box_rfa`, cuyas llamadas al engine **no reciben ningún kwarg de sinterizado**. Lo mismo vale para el `sintering_config` **de estudio**, que se aplica a todos los hijos sin mirar el algoritmo (`views.py:1806-1808`) | `tasks.py:1705,1738,1752` sin `sintering_coeff=` |
| **D7** | Combinar casos límite con entradas de distribución revienta: `generate_limiting_cases` hace `sorted(values)` sobre dicts (`utils.py:178`) | `TypeError: '<' not supported between instances of 'dict' and 'dict'` |
| **D8** | `particle_radius_config` se ofrece como "polidispersidad", pero `tunable_cc` es **monodisperso por construcción** | `tunable_cc.rs:1121-1128`: `radius_min = dpo_used, radius_max = dpo_used, // monodisperse per run` |

**D5 es el hallazgo más grave de la spec-review r1.** Sin él, este contrato bendecía una forma
de sinterizado que seguía produciendo "sin sinterizado" en silencio: el mismo defecto D2 una
capa más abajo.

**La evidencia de D5 estaba mal escrita en la r2** (decía "una única ocurrencia"): el grep se
había limitado a `backend/apps` y se saltó `backend/tests`. Corregido arriba. La segunda
ocurrencia es un test que fija el comportamiento defectuoso y que este change pone en rojo
(declarado en `tasks.md` T3.2).

**D7 ya es alcanzable hoy** por un cliente directo de la API: el 400 de D1 sólo dispara contra
la forma `{mode}`, y la forma `{distribution_type}` del backend se acepta tal cual. Verificado:
un estudio con dos entradas `{distribution_type:…}` e `include_limiting_cases=true` pasa la
validación **ahora mismo** y revienta en `perform_create` con un 500. No es un defecto que
abramos nosotros; es uno preexistente que adoptamos al tocar esta superficie.

**D8 es una mentira de la misma clase que este change condena.** `tunable_cc` muestrea **un**
dpo por ejecución y pone `radius_min = radius_max`; esa clave barre el **tamaño de partícula
primaria entre hijos**, no la dispersión dentro de un agregado (canónica
`cc-tunable-aggregation.md` R12). El único algoritmo con polidispersidad real es **FracVAL**
(lognormal, `geometric_std`).

## Fuera de alcance

- **D4** — el toggle `Size Distribution / Polydisperse` del formulario single está muerto para
  `tunable_cc` (`SimulationForm.tsx:716-718` y, si el modo no es `fixed`, el propio engine).
  Change de seguimiento `polydispersity-single-source`.
- **Polidispersidad real en batch** — change de seguimiento (decisión de la persona).
- **Asimetrías del formulario single**, ambas gemelas de defectos que aquí sí se corrigen:
  `SimulationSerializer` acepta `dpo_distribution`/`target_kf_distribution` para cualquier
  algoritmo (`serializers.py:101-110`), y `SimulationForm.tsx:688-695` envía `sintering_*` para
  todo algoritmo no-`limiting`, incluidos `fracval`/`gcca`/`box_rfa` donde se ignoran. Van con
  el change del formulario single.
- Cualquier cambio en `aglogen_core/`. **Este change no toca el engine.**
- Marcado retroactivo de estudios ya creados (decisión de la persona).

### Excepción declarada al "formulario single fuera de alcance"

`DistributionSelector.tsx` vive en `src/components/forms/` y lo **comparten** el formulario
batch y el single. La tarea T6.4 (default de `uniform` con `min == max`, inválido para
`fields.py:59`) lo toca, y por tanto corrige también el formulario single. Es un arreglo de un
default roto compartido, no un cambio de semántica del single: se declara aquí en vez de
esconderlo, y su test compartido se declara en T6.6.

## Decisión de vocabulario

Hoy conviven **cinco** deletreos del mismo concepto repartidos en cuatro capas:

| Capa | Clave discriminadora |
| --- | --- |
| Frontend (`DistributionValue`, ambos formularios) | `mode` |
| Worker → engine (`expand_distribution_kwargs`) | `mode` |
| API single (`DistributionField`, `fields.py:25`) | `mode` |
| Validación grid batch (`distribution_validation.py:49`) | `distribution_type` |
| Spec canónica R1/R2 | `type` (no lo implementa nadie) |

**Se canoniza `{mode, …}`** para las distribuciones de dpo y kf: es lo que ya usan tres de las
cuatro capas, incluido el único validador que funciona de verdad. Se mueve una sola función de
backend, no el frontend ni el engine.

**El sinterizado conserva su propia forma de dominio** `{distribution_type, coefficient|min,max|mean,std}`:
no es una distribución genérica (rangos acotados a 0.5-1.0, variante fija con `coefficient` en
vez de `value`) y esa forma la comparten el campo `ParametricStudy.sintering_config` y su
`help_text` (`models.py:140-144`). Quien se adapta es la UI batch, no el dominio. La simulación
individual usa **escalares planos** (`sintering_type`, `sintering_coeff`, …) — por eso existe
D5: `apply_sintering_config` es el puente entre el dict de dominio y esos escalares, y lo
cruzaba mal.

## Capabilities

### Modified Capabilities

- `batch-cc-tunable-parameter-parity`: **MODIFIED** R1, R2, R3, R10; **ADDED** R11 (cableado
  grid key → kwargs de engine y alcance por algoritmo), R12 (el sinterizado llega al engine),
  R13 (casos límite con claves de distribución). Delta en `specs/`.

### Referenced, not modified

- `cc-tunable-aggregation` R12 (`openspec/specs/cc-tunable-aggregation.md:573-590`) fija que el
  muestreo de dpo es **monodisperso por ejecución**. Este change **cita** esa semántica y alinea
  su lenguaje con ella; no la modifica.

## Por qué no hay Fase 0

La lección del ciclo 3 obliga a un diagnóstico numérico antes de lockear una hipótesis
estadística. **Este contrato no contiene ninguna**: no fija fórmulas, tolerancias ni sesgos de
estimador. La cota `std/mean <= 0.3` y los rangos 0.5-1.0 se heredan literalmente del canónico
y están corroborados por el truncado `μ±3σ` del engine (`dpo_distribution.rs:57-74`). El hilo
que sí requiere Fase 0 es `cc-tunable-df-fidelity`, y la exploración descarta que estos
defectos lo expliquen.

## Impacto en comportamiento ya desplegado

D2 y D5 cambian el comportamiento a propósito. **Los resultados batch anteriores con
`sintering_config`, y los de cualquier estudio con sinterizado `normal`, no son lo que sus
parámetros dicen**; consta en el comentario de entrega de Jira.

Para `kf_distribution` y `particle_radius_config` no hay datos históricos creados desde la
aplicación: la UI nunca consiguió crearlos (400). Un cliente que llame a la API directamente sí
pudo almacenarlos con la forma antigua; esos estudios quedarán no editables (cualquier
PUT/PATCH revalida y devuelve 400). Se acepta como fix-forward.
