# Delta Spec: sintering-reaches-engine → capability batch-cc-tunable-parameter-parity

> Los bloques MODIFIED son **restatements completos**: sustituyen al requisito canónico entero.
>
> ## Inventario de cambios respecto al canónico
>
> Esta lista cubre **todo punto en que el canónico y la delta se contradicen**, más los
> endurecimientos y relajaciones deliberados. No inventaría los MUST que la delta añade sin
> contrapartida canónica (campos obligatorios por tipo, rechazo de claves desconocidas, rechazo
> de entrada vacía, validación de `base_parameters`): esos viven en R3 y se leen allí.
>
> **Divergencias que la implementación nunca siguió:**
>
> 1. R3 dice que `fixed` lleva `value`; `apply_sintering_config` lee `coefficient`
>    (`utils.py:263`) y `validate_sintering_config` valida `coefficient`
>    (`serializers.py:374`). Se canoniza lo implementado.
>
> **Endurecimientos y relajaciones deliberados:**
>
> 2. R3 acota con `> 0`; la implementación acota a `0.5 <= … <= 1.0` y `0 < std <= 0.2`
>    (`serializers.py:373-396`). Se canoniza la implementación, más estricta.
> 3. **Relajación declarada**: R3 `uniform` pasa de `min < max` a `min <= max`. No es una
>    debilidad nueva sino la canonización de la validación existente (`serializers.py:386`,
>    `if min_val > max_val: raise`), que ya acepta `min == max`. Un intervalo degenerado de
>    sinterizado equivale a un `fixed` y no produce ningún valor inválido.
> 4. R3 dice que el sistema **MUST accept** la clave sin condición de algoritmo; la delta la
>    restringe a los algoritmos cuya invocación del engine recibe parámetros de sinterizado
>    (R11). Es un endurecimiento de un MUST canónico existente.
> 5. R10 ordena las cuatro opciones del desplegable **sin condición de algoritmo**; la delta
>    condiciona **sólo la de sinterizado**. Las otras tres se restatean literalmente como están
>    en el canónico: las reescribirá el change `distribution-grid-wiring`.
>
> **Escenarios retirados o renumerados:** ninguno. R3.1-R3.4 y R10.1-R10.3 conservan su número
> y su significado; los escenarios nuevos son R3.5-R3.8 y R10.4-R10.5.
>
> **Numeración de los requisitos nuevos.** Este change reserva R11 y R12. Los contratos
> siguientes de la cadena numerarán a partir de R13.

## MODIFIED Requirements

### Requirement: R3 — sintering_config: forma, superficies y rechazo explícito

El sistema DEBE aceptar configuraciones de sinterizado **en la forma de dominio del
sinterizado**, que NO es la forma genérica de distribución (sus rangos están acotados y la
variante fija usa `coefficient`, no `value`):

| `distribution_type` | Campos requeridos | Validación |
|-------------------|----------------|-----------|
| `fixed` | `coefficient` | `0.5 <= coefficient <= 1.0` |
| `uniform` | `min`, `max` | `0.5 <= min,max <= 1.0`, `min <= max` |
| `normal` | `mean`, `std` | `0.5 <= mean <= 1.0`, `0 < std <= 0.2` |

**Las tres superficies de entrada.** Una configuración de sinterizado alcanza a un sim hijo por
tres caminos, y los tres DEBEN validarse con la misma regla:

| Superficie | `None` / `{}` |
| --- | --- |
| `parameter_grid.sintering_config[i]` | **rechazado** (400) |
| `ParametricStudy.sintering_config` | aceptado: "este estudio no configura sinterizado" |
| `base_parameters["sintering_config"]` | aceptado, mismo significado |

Un punto del barrido que no declara nada sería un hijo que corre sin sinterizado sin decirlo.

El sinterizado de grid DEBE SOBRESCRIBIR al de estudio para ese hijo (precedencia:
grid > estudio > default).

**Rechazo explícito, nunca default silencioso.** Una configuración no vacía DEBE declarar
`distribution_type` ∈ `{fixed, uniform, normal}`, traer **todos** los campos requeridos por ese
tipo, y no traer claves fuera de `{distribution_type, coefficient, min, max, mean, std}`.
Cualquier violación DEBE producir 400. El sistema NO DEBE aceptar una configuración incompleta
o de forma desconocida para después aplicar valores por defecto: el resultado sería una
simulación cuyos parámetros declarados no describen lo que se ejecutó.

Complementariamente, `apply_sintering_config` DEBE lanzar un error ante un dict no vacío que
incumpla lo anterior, **incluido un `distribution_type` desconocido**, en lugar de propagarlo
al worker, donde el engine cae por su rama por defecto a `fixed(1.0)` (`lib.rs:600-604`).

Esta clave SOLO es válida para los algoritmos que R11 permite.

#### Scenario R3.1 — El sinterizado de grid sobrescribe al de estudio

- **GIVEN** `sintering_config` de estudio `{distribution_type:"fixed", coefficient:0.9}` Y `parameter_grid = {sintering_config: [{distribution_type:"uniform", min:0.7, max:0.95}]}`
- **WHEN** se crean los sims hijos
- **THEN** cada hijo usa el entry de grid, NO el de estudio

#### Scenario R3.2 — Sin sinterizado de grid se usa el de estudio

- **GIVEN** `sintering_config` de estudio `{distribution_type:"fixed", coefficient:0.9}` Y `parameter_grid` sin clave `sintering_config`
- **WHEN** se crean los sims hijos
- **THEN** cada hijo usa el sinterizado de estudio (comportamiento existente)

#### Scenario R3.3 — Config inválido rechazado

- **GIVEN** `parameter_grid = {sintering_config: [{distribution_type:"uniform", min:0.95, max:0.7}]}`
- **WHEN** el serializer valida
- **THEN** 400 (`min <= max` violado)
- **AND** `{distribution_type:"fixed", coefficient:0.4}` produce 400 (fuera de `0.5..1.0`)
- **AND** `{distribution_type:"normal", mean:0.9, std:0.3}` produce 400 (`std > 0.2`)

#### Scenario R3.4 — `distribution_type` desconocido rechazado

- **GIVEN** `parameter_grid = {sintering_config: [{distribution_type:"lognormal", mean:0.9, std:0.1}]}`
- **WHEN** el serializer valida
- **THEN** 400 (sólo `fixed`/`uniform`/`normal`)

#### Scenario R3.5 — La forma `{mode}` de la UI se rechaza, no se silencia

- **GIVEN** `parameter_grid = {sintering_config: [{mode:"normal", mean:0.8, std:0.05}]}`
- **WHEN** el serializer valida
- **THEN** 400 identificando la clave desconocida `mode`
- **AND** NO se crea ningún sim hijo con `sintering_coeff = 1.0`

#### Scenario R3.6 — Campos incompletos y entrada vacía rechazados

- **GIVEN** `parameter_grid = {sintering_config: [{distribution_type:"fixed"}]}` (sin `coefficient`)
- **WHEN** el serializer valida
- **THEN** 400 identificando el campo `coefficient` ausente
- **AND** lo mismo para `{distribution_type:"uniform"}` sin `min`/`max` y para `{distribution_type:"normal"}` sin `mean`/`std`
- **AND** `parameter_grid = {sintering_config: [{}]}` produce 400
- **AND** un `sintering_config` **de estudio** igual a `{}` o `null` se sigue aceptando

#### Scenario R3.7 — `base_parameters` se valida igual que las otras dos superficies

- **GIVEN** `base_parameters = {"sintering_config": {"distribution_type": "fixed"}}` (sin `coefficient`)
- **WHEN** el serializer valida
- **THEN** 400
- **AND** NO se crea ningún estudio ni ningún sim hijo
- **AND** `base_parameters = {"sintering_config": {"distribution_type":"fixed", "coefficient":0.9}}` se acepta y sus hijos reciben ese sinterizado

#### Scenario R3.8 — El helper no inventa un default

- **GIVEN** `apply_sintering_config(params, {"mode": "normal", "mean": 0.8, "std": 0.05})`
- **WHEN** se invoca el helper directamente
- **THEN** lanza error
- **AND** NO devuelve `{"sintering_type": "fixed", "sintering_coeff": 1.0}`
- **AND** `{"distribution_type":"lognormal", "mean":0.9, "std":0.1}` lanza igualmente
- **AND** `None` y `{}` siguen devolviendo los parámetros intactos

---

### Requirement: R10 — Frontend: Parameter-to-Vary Dropdown Extension

El desplegable de `BatchSimulationForm.tsx` DEBE ofrecer las 4 opciones añadidas:

- "kf distribution (normal/uniform/fixed)"
- "Particle radius (polydispersity)"
- "Sintering coefficient distribution" — **sólo para los algoritmos que consumen sinterizado**
  (R11): `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `tunable_cc`
- "Seed type (monomer/dimer/trimer)"

Cada opción DEBE cambiar el input de valor al componente correspondiente
(`DistributionGridInput` para distribuciones, chips multi-select para `seed_type`).

El payload de `sintering_config` DEBE enviarse en la **forma de dominio del sinterizado** (R3),
no en la forma `{mode, …}` del componente selector; la traducción DEBE vivir en una única
función pura.

#### Scenario R10.1 — Seleccionar kf distribution muestra DistributionGridInput

- **GIVEN** el usuario abre el desplegable de parámetro a variar
- **WHEN** selecciona "kf distribution (normal/uniform/fixed)"
- **THEN** un `DistributionGridInput` sustituye al input escalar

#### Scenario R10.2 — Seleccionar seed_type muestra chips multi-select

- **GIVEN** el usuario abre el desplegable de parámetro a variar
- **WHEN** selecciona "Seed type (monomer/dimer/trimer)"
- **THEN** un multi-select de chips con 3 opciones sustituye al input escalar

#### Scenario R10.3 — Parámetro escalar conserva el comportamiento anterior

- **GIVEN** el usuario abre el desplegable de parámetro a variar
- **WHEN** selecciona `n_particles` (clave escalar existente)
- **THEN** se muestra el input de array escalar original (sin regresión)

#### Scenario R10.4 — La opción de sinterizado no se ofrece donde el engine la ignora

- **GIVEN** el algoritmo seleccionado es `fracval`, `gcca` o `box_rfa`
- **WHEN** el usuario abre el desplegable de parámetro a variar
- **THEN** NO aparece "Sintering coefficient distribution"
- **AND** con `ballistic` sí aparece

#### Scenario R10.5 — El payload de sinterizado usa la forma de dominio

- **GIVEN** el usuario configura una variación de sinterizado normal con media 0.8 y std 0.05
- **WHEN** envía el formulario
- **THEN** `parameter_grid.sintering_config[0]` es `{distribution_type:"normal", mean:0.8, std:0.05}`
- **AND** no contiene la clave `mode`
- **AND** el modo `uniform` por defecto del selector produce un payload que la API acepta, sin edición previa del usuario

---

## ADDED Requirements

### Requirement: R11 — El sinterizado llega al engine, y sólo donde lo consumen

La configuración de sinterizado DEBE alcanzar el engine con los valores que el usuario declaró.
Para `distribution_type: "normal"` la media DEBE viajar en el parámetro que el worker envía y
el engine interpreta como media: `sintering_coeff`, leído en `parse_sintering`
(`lib.rs:602`).

El conjunto de parámetros de sinterizado que el worker lee es exactamente
`{sintering_type, sintering_coeff, sintering_min, sintering_max, sintering_std}`
(`tasks.py:1592-1598`). El sistema NO DEBE escribir en los parámetros del hijo ninguna clave de
sinterizado fuera de ese conjunto.

**Alcance por algoritmo, como lista de permitidos** (el modelo tiene once algoritmos,
`models.py:8-21`; cualquiera no listado se rechaza con 400):

| Configuración | Permitida para |
| --- | --- |
| Sinterizado con cualquier `distribution_type` | `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `tunable_cc` |
| Sinterizado con `distribution_type: "fixed"` únicamente | `limiting` (lee `sintering_coeff` en `tasks.py:1800` pero ignora `sintering_type/min/max/std`) |
| Ninguna | `fracval`, `gcca`, `box_rfa`, `imported` |

La regla DEBE aplicarse a las tres superficies de R3.

#### Scenario R11.1 — El sinterizado normal llega con su media

- **GIVEN** un estudio `ballistic` con `parameter_grid = {sintering_config: [{distribution_type:"normal", mean:0.8, std:0.05}]}`
- **WHEN** se ejecuta la tarea del sim hijo
- **THEN** el binding del engine se invoca con `sintering_type="normal"` y `sintering_coeff=0.8`
- **AND** NO se invoca con `sintering_coeff=1.0`

#### Scenario R11.2 — Fixed y uniform siguen llegando

- **GIVEN** estudios con `{distribution_type:"fixed", coefficient:0.9}` y con `{distribution_type:"uniform", min:0.7, max:0.95}`
- **WHEN** se ejecutan las tareas de los sims hijos
- **THEN** el binding recibe `sintering_type="fixed"` y `sintering_coeff=0.9` en el primero
- **AND** `sintering_type="uniform"` con `sintering_min=0.7` y `sintering_max=0.95` en el segundo

#### Scenario R11.3 — Ninguna clave de sinterizado sin lector

- **GIVEN** cualquier configuración de sinterizado válida, de cualquiera de los tres tipos
- **WHEN** se expande a los parámetros del sim hijo
- **THEN** el conjunto de claves de sinterizado escritas está contenido en
  `{sintering_type, sintering_coeff, sintering_min, sintering_max, sintering_std}`
- **AND** en particular NO se escribe `sintering_mean`

#### Scenario R11.4 — Rechazo para algoritmos que no consumen sinterizado

- **GIVEN** `base_algorithm` ∈ `{fracval, gcca, box_rfa, imported}` y una configuración de sinterizado en cualquiera de las tres superficies
- **WHEN** el serializer valida
- **THEN** 400 indicando que ese algoritmo no consume sinterizado

#### Scenario R11.5 — `limiting` sólo admite el tipo fijo

- **GIVEN** `base_algorithm = "limiting"` y un sinterizado `{distribution_type:"normal", mean:0.8, std:0.05}`
- **WHEN** el serializer valida
- **THEN** 400 indicando que `limiting` sólo admite `distribution_type: "fixed"`
- **AND** `{distribution_type:"fixed", coefficient:0.9}` sí se acepta

---

### Requirement: R12 — La expansión no deja estudios a medias

Toda configuración de sinterizado alcanzable por la expansión DEBE validarse **antes de la
primera escritura en base de datos**. Una configuración inválida DEBE producir 400 **y cero
filas**: ni `ParametricStudy`, ni `Simulation`, ni tareas encoladas.

El sistema NO DEBE depender de que el helper lance durante la expansión como mecanismo de
rechazo: en ese punto el estudio ya existe y parte de sus hijos ya están encolados
(`views.py:1750` no tiene manejo de excepciones, el proyecto no define `ATOMIC_REQUESTS`, y una
tarea Celery ya despachada no se deshace con un rollback).

#### Scenario R12.1 — Un sinterizado inválido no crea nada

- **GIVEN** una petición de creación de estudio con `parameter_grid = {n_particles: [100, 200], sintering_config: [{distribution_type:"fixed", coefficient:0.9}, {mode:"normal", mean:0.8, std:0.05}]}` (la segunda entrada es inválida)
- **WHEN** se procesa la petición
- **THEN** la respuesta es 400
- **AND** el número de `ParametricStudy` en base de datos no ha cambiado
- **AND** el número de `Simulation` en base de datos no ha cambiado
- **AND** no se ha encolado ninguna tarea

#### Scenario R12.2 — Lo mismo cuando el sinterizado inválido viene de base_parameters

- **GIVEN** una petición con `base_parameters = {"sintering_config": {"distribution_type":"uniform"}}` (sin `min`/`max`)
- **WHEN** se procesa la petición
- **THEN** 400, cero estudios creados, cero simulaciones creadas, cero tareas encoladas
