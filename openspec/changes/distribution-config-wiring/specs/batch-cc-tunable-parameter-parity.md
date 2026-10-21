# Delta Spec: distribution-config-wiring → capability batch-cc-tunable-parameter-parity

> Los bloques MODIFIED son **restatements completos** (lección del ciclo 2): sustituyen al
> requisito canónico entero, no sólo a la parte que cambia.
>
> **Cinco divergencias del canónico** se corrigen aquí porque la implementación nunca las
> siguió y la exploración las verificó con probe ejecutada:
>
> 1. R1/R2 dicen `type`; ninguna capa lo implementa (frontend, worker y `DistributionField`
>    usan `mode`; la validación grid usa `distribution_type`).
> 2. R1.2 (atajo escalar) nunca se implementó: `validate_distribution_config` exige dict.
> 3. R3 dice que `fixed` lleva `value`; `apply_sintering_config` lee `coefficient`
>    (`utils.py:263`), y los rangos reales están acotados a 0.5-1.0, no a `> 0`.
> 4. R1 canónica admite `std >= 0`; `DistributionField` exige `std > 0` (`fields.py:49`).
>    Se canoniza `std > 0`: una normal con `std = 0` es una fija disfrazada.
> 5. R2 canónica usa `mean` en la variante fija; las tres capas usan `value`.
>
> **Escenarios canónicos retirados o renumerados** (declarado para que ningún restatement
> borre una garantía en silencio):
>
> - R1.2 canónico (atajo escalar) **se retira**: nunca se implementó y ningún cliente lo emite.
>   Su identificador NO se reutiliza; el escenario nuevo de rechazo de la forma antigua es R1.6.
> - R10.3 canónico (no-regresión de parámetro escalar) **se conserva** con su significado, como
>   R10.3; los escenarios nuevos son R10.5 y R10.6.

## MODIFIED Requirements

### Requirement: R1 — kf_distribution Grid Key

El sistema DEBE aceptar `parameter_grid.kf_distribution` como un array de objetos de
configuración de distribución **en la forma canónica `{mode, …}`**, idéntica a la que ya valida
`DistributionField` para la simulación individual (`fields.py:25`) y a la que consume
`expand_distribution_kwargs` (`tasks.py:33`):

| Forma | Validación |
|-------|-----------|
| `{mode: "fixed", value}` | `value > 0` |
| `{mode: "normal", mean, std}` | `mean > 0`, `std > 0` |
| `{mode: "uniform", min, max}` | `min > 0`, `max > min` |

Un entry DEBE rechazarse con 400 cuando no sea un dict, cuando su `mode` no esté en
`{fixed, normal, uniform}`, cuando falte un campo requerido por ese modo, o cuando contenga
**claves desconocidas** para su modo.

Lo que se persiste es la **salida normalizada** del validador (números en coma flotante, claves
desconocidas ausentes), no el dict crudo del request.

Esta clave SOLO es válida cuando el algoritmo del estudio es `tunable_cc` (ver R11).

La expansión DEBE producir un sim hijo por entry x `seeds_per_combination`, y cada hijo DEBE
recibir la configuración traducida a `target_kf_distribution` (R11).

#### Scenario R1.1 — Happy path: dos normales expanden correctamente

- **GIVEN** `base_algorithm = "tunable_cc"` y `parameter_grid = {kf_distribution: [{mode:"normal",mean:1.2,std:0.05},{mode:"normal",mean:1.3,std:0.05}]}` con `seeds_per_combination = 2`
- **WHEN** se crea el ParametricStudy
- **THEN** se crean 4 sims hijos (2 configs x 2 semillas)
- **AND** los `parameters` de cada hijo contienen `target_kf_distribution` con su objeto correspondiente
- **AND** NO contienen la clave `kf_distribution`

#### Scenario R1.3 — Config inválida rechazada con 400

- **GIVEN** `parameter_grid = {kf_distribution: [{mode:"normal", mean:-1, std:0.1}]}`
- **WHEN** el serializer valida
- **THEN** 400 identificando la restricción `mean > 0`

#### Scenario R1.4 — Campos requeridos ausentes rechazados

- **GIVEN** `parameter_grid = {kf_distribution: [{mode:"uniform", min:1.0}]}` (falta `max`)
- **WHEN** el serializer valida
- **THEN** 400 con error descriptivo

#### Scenario R1.5 — Uniform con min >= max rechazado

- **GIVEN** `parameter_grid = {kf_distribution: [{mode:"uniform", min:1.5, max:1.0}]}`
- **WHEN** el serializer valida
- **THEN** 400

#### Scenario R1.6 — Forma antigua `distribution_type` rechazada

- **GIVEN** `parameter_grid = {kf_distribution: [{distribution_type:"normal", mean:1.2, std:0.05}]}`
- **WHEN** el serializer valida
- **THEN** 400 identificando que `mode` debe ser uno de `fixed|normal|uniform`

#### Scenario R1.7 — Vocabulario mezclado rechazado

- **GIVEN** `parameter_grid = {kf_distribution: [{mode:"fixed", value:1.3, distribution_type:"normal"}]}`
- **WHEN** el serializer valida
- **THEN** 400 identificando la clave desconocida `distribution_type`

---

### Requirement: R2 — particle_radius_config Grid Key

El sistema DEBE aceptar `parameter_grid.particle_radius_config` como un array de
configuraciones del **tamaño de partícula primaria (dpo)** en la forma canónica `{mode, …}`:

| Forma | Validación |
|-------|-----------|
| `{mode: "fixed", value}` | `value > 0` |
| `{mode: "normal", mean, std}` | `mean > 0`, `std > 0`, `std/mean <= 0.3` |

El modo `uniform` NO se acepta en esta clave. La cota `std/mean <= 0.3` se conserva del
canónico: con el truncado `μ±3σ` del engine (`dpo_distribution.rs:62-72`) garantiza radios
positivos.

**Semántica (alineada con la canónica `cc-tunable-aggregation` R12, que este change NO
modifica):** el engine muestrea **un** valor de dpo por ejecución y fija
`radius_min = radius_max = dpo_muestreado` (`tunable_cc.rs:1122-1129`, *monodisperse per run*).
Por tanto esta clave barre el **tamaño de partícula primaria entre sims hijos**; NO produce
dispersión de tamaños dentro de un mismo agregado. El sistema NO DEBE presentar esta clave
como polidispersidad (ver R10).

Esta clave SOLO es válida cuando el algoritmo del estudio es `tunable_cc` (ver R11). Cada hijo
DEBE recibir la configuración traducida a `dpo_distribution` (R11).

#### Scenario R2.1 — Normal dentro del límite aceptada

- **GIVEN** `base_algorithm = "tunable_cc"` y `parameter_grid = {particle_radius_config: [{mode:"normal", mean:1.0, std:0.2}]}`
- **WHEN** el serializer valida
- **THEN** aceptado (`std/mean = 0.2 <= 0.3`)

#### Scenario R2.2 — Ratio std/mean excesivo rechazado

- **GIVEN** `parameter_grid = {particle_radius_config: [{mode:"normal", mean:1.0, std:0.5}]}`
- **WHEN** el serializer valida
- **THEN** 400 identificando la restricción `std/mean <= 0.3`

#### Scenario R2.3 — Fixed aceptado y traducido

- **GIVEN** `parameter_grid = {particle_radius_config: [{mode:"fixed", value:1.5}]}`
- **WHEN** se crean los sims hijos
- **THEN** los `parameters` de cada hijo contienen exactamente `dpo_distribution = {"mode":"fixed","value":1.5}` (forma normalizada)
- **AND** NO contienen la clave `particle_radius_config`

#### Scenario R2.4 — Modo uniform rechazado

- **GIVEN** `parameter_grid = {particle_radius_config: [{mode:"uniform", min:0.8, max:1.2}]}`
- **WHEN** el serializer valida
- **THEN** 400 indicando que los modos permitidos son `fixed` y `normal`

---

### Requirement: R3 — sintering_config Grid Key

El sistema DEBE aceptar `parameter_grid.sintering_config` como un array de configuraciones de
sinterizado **en la forma de dominio del sinterizado**, que NO es la forma genérica de
distribución:

| `distribution_type` | Campos requeridos | Validación |
|-------------------|----------------|-----------|
| `fixed` | `coefficient` | `0.5 <= coefficient <= 1.0` |
| `uniform` | `min`, `max` | `0.5 <= min,max <= 1.0`, `min <= max` |
| `normal` | `mean`, `std` | `0.5 <= mean <= 1.0`, `0 < std <= 0.2` |

El sinterizado de grid DEBE SOBRESCRIBIR el `sintering_config` de estudio para ese hijo
(precedencia: grid > estudio > default).

**Rechazo explícito, nunca default silencioso.** Un config de sinterizado no vacío DEBE:
declarar `distribution_type`; traer **todos** los campos requeridos por ese tipo; y no traer
claves fuera de `{distribution_type, coefficient, min, max, mean, std}`. Cualquier violación
DEBE producir 400. El sistema NO DEBE aceptar un config incompleto o de forma desconocida para
después aplicar valores por defecto: el resultado sería una simulación cuyos parámetros
declarados no describen lo que se ejecutó.

Complementariamente, `apply_sintering_config` DEBE lanzar un error ante un dict no vacío que
incumpla lo anterior, en lugar de caer a `fixed/1.0`. Un config ausente o vacío sigue
devolviendo los parámetros intactos.

Esta clave SOLO es válida para los algoritmos cuya invocación del engine recibe parámetros de
sinterizado (ver R11).

#### Scenario R3.1 — El sinterizado de grid sobrescribe al de estudio

- **GIVEN** `sintering_config` de estudio `{distribution_type:"fixed", coefficient:0.9}` Y `parameter_grid = {sintering_config: [{distribution_type:"uniform", min:0.7, max:0.95}]}`
- **WHEN** se crean los sims hijos
- **THEN** cada hijo usa el entry de grid, NO el de estudio

#### Scenario R3.2 — Sin sinterizado de grid se usa el de estudio

- **GIVEN** `sintering_config` de estudio `{distribution_type:"fixed", coefficient:0.9}` Y `parameter_grid` sin clave `sintering_config`
- **WHEN** se crean los sims hijos
- **THEN** cada hijo usa el sinterizado de estudio (comportamiento existente)

#### Scenario R3.3 — Config de sinterizado inválido rechazado

- **GIVEN** `parameter_grid = {sintering_config: [{distribution_type:"uniform", min:0.95, max:0.7}]}`
- **WHEN** el serializer valida
- **THEN** 400 (`min <= max` violado)

#### Scenario R3.4 — `distribution_type` desconocido rechazado

- **GIVEN** `parameter_grid = {sintering_config: [{distribution_type:"lognormal", mean:0.9, std:0.1}]}`
- **WHEN** el serializer valida
- **THEN** 400 (sólo `fixed`/`uniform`/`normal`)

#### Scenario R3.5 — Forma `{mode}` rechazada, no silenciada

- **GIVEN** `parameter_grid = {sintering_config: [{mode:"normal", mean:0.8, std:0.05}]}`
- **WHEN** el serializer valida
- **THEN** 400 identificando la clave desconocida `mode`
- **AND** NO se crea ningún sim hijo con `sintering_coeff = 1.0`

#### Scenario R3.6 — Campos incompletos rechazados

- **GIVEN** `parameter_grid = {sintering_config: [{distribution_type:"fixed"}]}` (sin `coefficient`)
- **WHEN** el serializer valida
- **THEN** 400 identificando el campo `coefficient` ausente
- **AND** lo mismo para `{distribution_type:"uniform"}` sin `min`/`max` y `{distribution_type:"normal"}` sin `mean`/`std`

#### Scenario R3.7 — El helper no inventa un default

- **GIVEN** `apply_sintering_config(params, {"mode": "normal", "mean": 0.8, "std": 0.05})`
- **WHEN** se invoca el helper directamente
- **THEN** lanza error
- **AND** NO devuelve `{"sintering_type": "fixed", "sintering_coeff": 1.0}`

---

### Requirement: R10 — Frontend: Parameter-to-Vary Dropdown Extension

El desplegable de parámetro a variar de `BatchSimulationForm.tsx` DEBE ofrecer las 4 opciones
añadidas, **cada una sólo para los algoritmos que pueden consumirla**:

| Etiqueta | Clave | Algoritmos |
| --- | --- | --- |
| "kf distribution (normal/uniform/fixed)" | `kf_distribution` | sólo `tunable_cc` |
| "Primary particle size (dpo)" | `particle_radius_config` | sólo `tunable_cc` |
| "Sintering coefficient distribution" | `sintering_config` | `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `tunable_cc` |
| "Seed type (monomer/dimer/trimer)" | `seed_type` | sin cambios |

La etiqueta de `particle_radius_config` NO DEBE contener la palabra "polydispersity": el
engine es monodisperso por ejecución (R2), y la opción barre el tamaño de partícula primaria
entre hijos.

Cada opción DEBE cambiar el input de valor al componente correspondiente
(`DistributionGridInput` para distribuciones, chips multi-select para `seed_type`).

El payload enviado DEBE usar la forma que acepta la API: `{mode, …}` para `kf_distribution` y
`particle_radius_config`, y la forma de dominio de sinterizado para `sintering_config`
(traducción en una única función pura).

Los valores por defecto que proponga la UI DEBEN ser válidos para la API sin edición previa
del usuario.

#### Scenario R10.1 — Seleccionar kf distribution muestra DistributionGridInput

- **GIVEN** el algoritmo es `tunable_cc` y el usuario abre el desplegable
- **WHEN** selecciona "kf distribution (normal/uniform/fixed)"
- **THEN** un `DistributionGridInput` sustituye al input escalar

#### Scenario R10.2 — Seleccionar seed_type muestra chips multi-select

- **GIVEN** el usuario abre el desplegable
- **WHEN** selecciona "Seed type (monomer/dimer/trimer)"
- **THEN** un multi-select de chips con 3 opciones sustituye al input escalar

#### Scenario R10.3 — Parámetro escalar conserva el comportamiento anterior (no regresión)

- **GIVEN** el usuario abre el desplegable
- **WHEN** selecciona un parámetro escalar como "Number of Particles"
- **THEN** el input discreto/rango existente se mantiene sin cambios

#### Scenario R10.4 — Etiqueta honesta para el tamaño de partícula

- **GIVEN** el algoritmo es `tunable_cc` y el usuario abre el desplegable
- **WHEN** lee la opción correspondiente a `particle_radius_config`
- **THEN** la etiqueta es "Primary particle size (dpo)"
- **AND** no aparece la palabra "polydispersity" en esa opción

#### Scenario R10.5 — Opciones no ofrecidas para algoritmos sin ruta de engine

- **GIVEN** el algoritmo seleccionado es `ballistic`
- **WHEN** el usuario abre el desplegable de parámetro a variar
- **THEN** NO aparecen "kf distribution" ni "Primary particle size (dpo)"
- **AND** sí aparece "Sintering coefficient distribution"
- **AND** con `fracval`, `gcca` o `box_rfa` tampoco aparece "Sintering coefficient distribution"

#### Scenario R10.6 — El payload de sinterizado usa la forma de dominio

- **GIVEN** el usuario configura una variación `sintering_config` normal con media 0.8 y std 0.05
- **WHEN** envía el formulario
- **THEN** `parameter_grid.sintering_config[0]` es `{distribution_type:"normal", mean:0.8, std:0.05}`
- **AND** no contiene la clave `mode`

#### Scenario R10.7 — El default de la UI es aceptable por la API

- **GIVEN** el usuario añade una variación de distribución y cambia el modo a `uniform`
- **WHEN** envía el formulario sin editar los valores propuestos
- **THEN** el payload cumple `max > min` y la API lo acepta

---

## ADDED Requirements

### Requirement: R11 — Cableado de las grid keys hasta el engine

Las claves de grid de distribución DEBEN traducirse a los nombres de parámetro que el worker
lee, en el momento de la expansión del estudio:

| Grid key | Parámetro del sim hijo | Lo lee |
| --- | --- | --- |
| `particle_radius_config` | `dpo_distribution` | `tasks.py:1680-1682` → `dpo_mode/dpo_value/dpo_mean/dpo_std/dpo_min/dpo_max` |
| `kf_distribution` | `target_kf_distribution` | `tasks.py:1683-1685` → `kf_mode/kf_value/kf_mean/kf_std/kf_min/kf_max` |

El sim hijo DEBE recibir **solo** el parámetro de engine; la clave de grid NO DEBE persistirse
también en `parameters` (verdad única; la procedencia del barrido vive en
`study.parameter_grid`).

El valor traducido DEBE tener precedencia sobre cualquier valor del mismo concepto presente en
`base_parameters` (`dpo_distribution`, `radius_min`, `radius_max`, `target_kf`).

`particle_radius_config` y `kf_distribution` DEBEN rechazarse con 400 cuando el algoritmo del
estudio no sea `tunable_cc`. `sintering_config` DEBE rechazarse con 400 cuando el algoritmo sea
`fracval`, `gcca`, `box_rfa` o `limiting`.

#### Scenario R11.1 — particle_radius_config llega al engine

- **GIVEN** un estudio `tunable_cc` con `parameter_grid = {particle_radius_config: [{mode:"normal", mean:1.0, std:0.2}]}`
- **WHEN** se ejecuta la tarea del sim hijo
- **THEN** el binding del engine se invoca con `dpo_mode="normal"`, `dpo_mean=1.0`, `dpo_std=0.2`

#### Scenario R11.2 — kf_distribution llega al engine

- **GIVEN** un estudio `tunable_cc` con `parameter_grid = {kf_distribution: [{mode:"uniform", min:1.2, max:1.4}]}`
- **WHEN** se ejecuta la tarea del sim hijo
- **THEN** el binding del engine se invoca con `kf_mode="uniform"`, `kf_min=1.2`, `kf_max=1.4`

#### Scenario R11.3 — Grid key rechazada para un algoritmo sin ruta

- **GIVEN** `base_algorithm = "ballistic"` y `parameter_grid = {particle_radius_config: [{mode:"fixed", value:1.0}]}`
- **WHEN** el serializer valida
- **THEN** 400 indicando que la clave sólo aplica a `tunable_cc`
- **AND** con `base_algorithm = "gcca"` y `parameter_grid = {sintering_config: [...]}`, 400 indicando que ese algoritmo no consume sinterizado

#### Scenario R11.4 — Sin grid key, el comportamiento legado no cambia

- **GIVEN** un estudio `tunable_cc` sin `particle_radius_config` ni `kf_distribution`
- **WHEN** se ejecuta la tarea del sim hijo
- **THEN** el binding se invoca sin kwargs `dpo_*` ni `kf_*`
- **AND** el engine usa el escalar legado `radius_min` como valor fijo de dpo y `target_kf` como kf

#### Scenario R11.5 — Actualización parcial del estudio

- **GIVEN** un estudio existente con `base_algorithm = "ballistic"`
- **WHEN** se hace `PATCH` con sólo `parameter_grid = {kf_distribution: [...]}`
- **THEN** la regla de algoritmo se evalúa contra el `base_algorithm` de la instancia
- **AND** la petición se rechaza con 400

---

### Requirement: R12 — El sinterizado llega al engine

La configuración de sinterizado DEBE alcanzar el engine con los valores que el usuario
declaró. En concreto, para `distribution_type: "normal"` la media DEBE viajar en el parámetro
que el worker envía y el engine interpreta como media (`sintering_coeff`, leído en
`parse_sintering`, `lib.rs:602`).

El sistema NO DEBE escribir parámetros de sinterizado que ningún consumidor lea.

#### Scenario R12.1 — El sinterizado normal llega con su media

- **GIVEN** un estudio con `parameter_grid = {sintering_config: [{distribution_type:"normal", mean:0.8, std:0.05}]}`
- **WHEN** se ejecuta la tarea del sim hijo
- **THEN** el binding del engine se invoca con `sintering_type="normal"` y la media 0.8
- **AND** NO se invoca con la media 1.0

#### Scenario R12.2 — Fixed y uniform siguen llegando

- **GIVEN** estudios con `{distribution_type:"fixed", coefficient:0.9}` y con `{distribution_type:"uniform", min:0.7, max:0.95}`
- **WHEN** se ejecutan las tareas de los sims hijos
- **THEN** el binding recibe `sintering_coeff=0.9` en el primero, y `sintering_min=0.7`/`sintering_max=0.95` en el segundo

#### Scenario R12.3 — Ningún parámetro de sinterizado sin lector

- **GIVEN** cualquier `sintering_config` válido
- **WHEN** se expande a los parámetros del sim hijo
- **THEN** cada clave de sinterizado escrita es leída por el worker al invocar el engine

---

### Requirement: R13 — Casos límite con claves de distribución

La generación de casos límite DEBE ignorar las claves de `parameter_grid` cuyos valores no sean
escalares comparables (las claves de distribución y `sintering_config`); el hijo de frontera
usa para ese concepto el valor de `base_parameters`.

El sistema NO DEBE fallar con un error no capturado al combinar casos límite con claves de
distribución.

#### Scenario R13.1 — Casos límite junto a una distribución no revientan

- **GIVEN** un estudio `tunable_cc` con `include_limiting_cases = true`, `parameter_grid = {n_particles: [100, 500], kf_distribution: [d1, d2]}`
- **WHEN** se crea el estudio
- **THEN** la creación termina correctamente (ningún 500)
- **AND** se generan fronteras para `n_particles` (100 y 500)
- **AND** NO se genera ninguna frontera para `kf_distribution`

#### Scenario R13.2 — Sólo claves de distribución, sin fronteras

- **GIVEN** `include_limiting_cases = true` y `parameter_grid = {kf_distribution: [d1, d2]}`
- **WHEN** se crea el estudio
- **THEN** la creación termina correctamente y no se genera ningún caso de frontera
