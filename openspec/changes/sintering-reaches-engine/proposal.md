# Proposal: sintering-reaches-engine

> SDD change (política AGENTS.md). Primero de los tres contratos encadenados que propone el
> mapa `openspec/changes/_explore-only/distribution-config-surface.md` (§7), consolidado de la
> exploración y de cuatro rondas de spec-review.

## Why

Hoy, un estudio batch con sinterizado **se acepta y se ejecuta sin sinterizado, sin un solo
error**. Este change cierra esa mentira y sólo esa.

Es el primero de la cadena porque es el único de los nueve defectos del mapa que produce
**ciencia incorrecta en silencio**: los demás fallan de forma visible (400) o no hacen nada
observable. Un resultado que parece válido y no lo es es peor que un error.

## Defectos en alcance

Cada afirmación está verificada con probe ejecutada o grep, anclada en el mapa.

| # | Defecto | Evidencia |
| --- | --- | --- |
| **D2** | La UI batch emite `{mode, …}`; el validador del sinterizado espera `{distribution_type, …}`. La forma **se acepta** y `apply_sintering_config` cae a `fixed/1.0` | probe: `apply({mode:'normal',mean:0.8,std:0.05})` → `{'sintering_type':'fixed','sintering_coeff':1.0}` |
| **D5** | Con la forma **correcta**, el `normal` tampoco llega: `apply_sintering_config` escribe `sintering_mean` (`utils.py:268`) y ningún consumidor de producción lo lee; el engine toma `sintering_coeff` como media (`lib.rs:602`), que sigue valiendo 1.0 | `grep -rn sintering_mean backend frontend aglogen_core` → 2 ocurrencias: la escritura y una aserción de test (`tests/test_utils.py:316`) |
| **D5b** | Hay **superficies de entrada sin validar**: `base_parameters.sintering_config` y, sobre todo, los **escalares planos** `sintering_*` tanto en `base_parameters` como en `parameter_grid` | probes: `base_parameters={"sintering_config":{"distribution_type":"fixed"}}` → 201 y `sintering_coeff = 1.0`; `base_parameters={"sintering_coeff":0.6,...}` → ACEPTADO; `parameter_grid={"sintering_coeff":[-5.0, 42.0]}` → ACEPTADO |
| **D6** | La UI ofrece barrido de sinterizado para `fracval`, `gcca` y `box_rfa`, cuyas llamadas al engine **no reciben ningún kwarg de sinterizado** | `tasks.py:1729,1740,1781` sin `sintering_coeff=` |

## Dónde se enuncia la garantía, y por qué

La primera versión de este contrato decía "tres superficies". La segunda decía "cinco". Las
dos eran falsas, y la segunda revisión encontró una **sexta**:
`limiting_cases_config.theoretical_extremes` es un dict del usuario cuyas claves se escriben
**literalmente** en los parámetros de cada hijo (`utils.py:199-203`) y cuyo contenido no mira
ningún validador. Verificado: `{"sintering_coeff":[42.0], "sintering_mean":[0.9]}` → 201, con un
hijo por clave: uno se lleva `sintering_coeff=42.0` y otro `sintering_mean=0.9`.

**Enumerar superficies ha fallado tres veces, así que deja de ser la fuente de la garantía.**
Una lista sólo vale lo que valga la imaginación del siguiente lector.

La tercera revisión refutó además la premisa con la que intenté sustituirla. Afirmé que todos
los hijos se construían en una sola función y lo marqué como **"verificado"**; no lo estaba.
`perform_create` crea hijos en **dos** sitios: `views.py:1826`, dentro del constructor
compartido, y `views.py:1889`, un bloque inline para los extremos de sinterizado que duplica el
bucle, se salta `apply_sintering_config` y omite `seed_type`. El único sitio que se me escapaba
era, precisamente, el de sinterizado — y este mismo documento lo describía dos secciones más
abajo, como una nota sobre `seed_type`.

**Decisión de la persona: unificar los dos sitios** en vez de debilitar la promesa. R11 exige
**un solo constructor** para todo hijo de la expansión, con un modo explícito "el sinterizado
de este hijo ya está decidido" para que un extremo conserve su coeficiente. Así la premisa pasa
a ser cierta en vez de supuesta, y de paso se cierra la violación de `cc-tunable-aggregation`
R17 (esos hijos se crean hoy sin `seed_type`).

Sobre esa base, la garantía se enuncia como **invariante del hijo en el constructor único** — sus claves de sinterizado están dentro del conjunto que el worker lee y forman una
forma completa y en rango, venga de donde venga. La lista de superficies se conserva, pero con
el papel que le corresponde: decir dónde hay que devolver un 400 útil antes de escribir nada
(R3 y R12), no sostener la promesa.

El error de método original merece quedar escrito: **mapée por nombre de clave
(`sintering_config`) en vez de por lo que lee el consumidor.** El worker lee **escalares
planos** (`tasks.py:1592-1598`).

| # | Superficie | Forma | Validada hoy |
| --- | --- | --- | --- |
| 1 | `parameter_grid.sintering_config[i]` | dict de dominio | sí, laxamente |
| 2 | `ParametricStudy.sintering_config` | dict de dominio | sí, laxamente |
| 3 | `base_parameters["sintering_config"]` | dict de dominio | **no** |
| 4 | `base_parameters["sintering_*"]` | escalares planos | **no** |
| 5 | `parameter_grid["sintering_*"]` | escalares planos, barridos | **no** |
| 6 | `limiting_cases_config.theoretical_extremes["sintering_*"]` | escalares planos, barridos | **no** |
| 7 | `limiting_cases_config.theoretical_extremes["sintering_config"]` | **dict**, barrido | **no** |

Lo que eso significa, verificado con probe propia:

- **La allow-list por algoritmo se burla en una línea**: `fracval` + `base_parameters={"sintering_coeff":0.8}` pasa todas las reglas y aterriza en D6 por la otra puerta.
- **Un `sintering_mean` heredado pasa tal cual**, violando el conjunto de claves con lector.
- Para `limiting` hay **dos** entradas de sinterizado, no una: el barrido plano del desplegable
  (`BatchSimulationForm.tsx:294`) y un campo dedicado "Base Sintering Coeff." (`:409-418`) que
  se envía como `base_parameters.sintering_coeff` en **todos** sus envíos (`:220`). La segunda
  es la que siempre aplica, y ninguna se valida hoy.
- Un `sintering_coeff` plano **sin** `sintering_type` significa `fixed`: así lo envía el
  formulario de `limiting`, y rechazarlo rompería su entrada más usada.
- La superficie 7 reintroduce **D2 entero**: barrer un `sintering_config` con la forma `{mode}`
  por `theoretical_extremes` devuelve 201 hoy y el hijo corre a `sintering_coeff = 1.0`.
- **Los nombres mienten**: hoy un hijo `limiting` llamado `theoretical: sintering_coeff=0.5`
  corre al coeficiente del estudio, porque el dict de estudio gana al valor barrido. Este change
  **no** invierte esa precedencia: la deja como está y la describe. Arreglarla es el contrato de
  seguimiento, por la razón que explica «Fuera de alcance».

**Precedencia real, y es asimétrica.** `views.py:1804` popea `sintering_config` del dict ya
fusionado, así que un **dict** en `base_parameters` gana al campo de estudio. Pero sus claves
**planas** no: `apply_sintering_config` las sobrescribe con las del estudio (`views.py:1808`).
Verificado con probe:

```text
plano en base + dict de estudio -> gana el estudio (0.95)
dict  en base + dict de estudio -> gana base       (0.60)
```

La primera versión de este contrato afirmaba el orden `grid > base_parameters > estudio` sin
más, lo que era una **segunda inversión sin declarar** colada en la misma frase que corregía
la primera. Decisión de la persona: `base_parameters` **gana siempre**, en ambas formas, y el
cambio se declara.

Endurecer el helper sin validar antes **todas ellas** convertiría un fallo silencioso en un fallo
peor: `perform_create` (`views.py:1750`) no tiene `try/except`, el proyecto no define
`ATOMIC_REQUESTS` y los hijos ya están encolados cuando el helper lanzaría. De ahí R12.

## Fuera de alcance

Explícitamente, y cada uno con su contrato en la cadena:

- **D1, D3, D8** (las claves `kf_distribution` y `particle_radius_config`: forma `{mode}`,
  cableado al engine, semántica honesta) → `distribution-grid-wiring`.
- **Las rutas de simulación individual** (`POST`/`PATCH` de `/simulations/`) aceptan claves de
  sinterizado arbitrarias, incluidas `sintering_mean` y valores fuera de rango. R11 acota su
  invariante a los hijos creados por **expansión de estudio**; esas rutas pertenecen al change
  del formulario single.
- **El admin de Django**: `SimulationAdmin` sí define `readonly_fields` (`admin.py:14-22`),
  pero `parameters` no está en la lista, así que permite editar los parámetros de un hijo
  existente saltándose el serializer. No crea hijos, así que no puede producir expansiones.
- **`PATCH` del `sintering_config` de un estudio después de expandirlo**: se acepta (200) y no
  reexpande nada, así que el estudio queda declarando un sinterizado distinto del que corrieron
  sus hijos — y el CSV condiciona las columnas a `study.sintering_config` (`views.py:2206`)
  mientras imprime `sim.parameters` (`:2270-2271`). Misma familia de mentira que este change
  mata, en una ruta que no gobierna.
- **D9** (la herramienta del asistente IA crea estudios por ORM sin validar ni traducir) →
  `study-expansion-single-source`. **Este change no la arregla**: un estudio creado por esa
  ruta con sinterizado sigue sin pasar por la validación. Queda declarado, no silenciado.
- **El export CSV sólo emite las columnas de sinterizado cuando el estudio tiene
  `study.sintering_config`** (`views.py:2206,2267`): un estudio cuyo sinterizado venga sólo del
  grid no las exporta, ni antes ni después de este change.
- **D7** (casos límite + entradas dict → 500 preexistente, alcanzable por API) →
  `distribution-grid-wiring` o carril corto propio.
- **D4** y la polidispersidad real → changes de seguimiento.
- `cc-tunable-aggregation` **R17**: este change no reubica el helper `create_simulation()` que
  R17 nombra ni modifica el texto de la capability — sí cambia su firma y le encamina un
  segundo llamante, y hace que empiece a cumplirse para los hijos de extremos de sinterizado.
  (El ancla de R17, `views.py:1761-1802`, ya está obsoleta hoy: el helper vive en `1784-1845`.)
- `DistributionSelector.tsx`: su default de `uniform` emite `min == max`, que **es válido** para
  el sinterizado (`min <= max`, ambos dentro de `[0.5, 1.0]`). No se toca aquí.

## What Changes

### Modified Capabilities

- `batch-cc-tunable-parameter-parity`: **MODIFIED** R3 (formas dict y plana, siete superficies
  de entrada, la precedencia de hoy descrita y no cambiada, rechazo explícito), **R7** (carve-out: la compatibilidad
  hacia atrás no ampara sinterizado malformado, ni el cambio de la media `normal`) y R10
  **sólo en su fila de sinterizado**; **ADDED** R11 (un solo constructor, invariante del hijo y
  alcance por algoritmo) y R12 (integridad de la expansión). Delta en `specs/`.

El change **sí** toca ahora el bloque de extremos de sinterizado (`views.py:1869-1906`): al
unificarlo con el constructor común, esos hijos pasan a llevar `seed_type`, lo que cierra una
violación existente de `cc-tunable-aggregation` R17. Esa capability no se modifica: se empieza
a cumplir.

El restatement de R10 conserva literalmente lo que el canónico dice de las otras tres opciones:
`distribution-grid-wiring` las reescribirá sobre el canónico ya archivado por este change.

## Por qué no hay Fase 0

El contrato no fija ninguna hipótesis numérica ni estadística. Los rangos `0.5 <= … <= 1.0` y
`0 < std <= 0.2` **no se heredan del canónico** (que dice `> 0`): provienen de la validación
existente `serializers.py:373-396` y se canonizan tal cual, sin cambiarlos.

## Impacto en comportamiento ya desplegado

Deliberado y declarado: los estudios batch cuyo sinterizado se descartaba en silencio
empezarán a sinterizar o a fallar en validación. **Los resultados batch anteriores con
`sintering_config`, y los de cualquier estudio con sinterizado `normal`, no son lo que sus
parámetros dicen.** Consta en el comentario de entrega de Jira.

Cambios de comportamiento adicionales, declarados:

- **La precedencia no cambia, y eso es deliberado.** Hoy **cualquier dict gana a cualquier clave
  plana**, venga de donde venga: `views.py:1804` popea `sintering_config` del dict ya fusionado y
  `apply_sintering_config` sobrescribe los planos; entre dicts el orden es grid, luego
  `base_parameters`, luego el campo de estudio. Este change **valida** esos ajustes y **no los
  reordena**. Seis rondas de revisión sobre este contrato produjeron tres inversiones de
  precedencia sin declarar, cada una descubierta al arreglar la anterior, y ninguno de los cuatro
  defectos en alcance necesita tocarla: se cierran validando la forma y mandando la media donde
  el engine la lee.
- **El payload `fixed` que documenta la propia canónica pasa a dar 400.**
  `{distribution_type:"fixed", value:0.9}` devuelve 201 hoy y el hijo corre **sin sinterizar**,
  porque nadie lee `value`. Canonizar `coefficient` lo convierte en un rechazo visible.
- **Hijos de extremos de sinterizado.** Al unificarlos con el constructor común pasan a llevar
  `seed_type` en el campo de modelo y dejan de llevarlo dentro de `parameters`. Para
  `tunable_cc` el worker lee el campo de modelo (`tasks.py:1676`), así que esos hijos pasan a
  correr con el tipo de semilla declarado en vez de con `monomers` por defecto.

Efecto secundario deseable: el export CSV (`views.py:2267-2271`) escribe
`Sintering_Type`/`Sintering_Coeff` desde `sim.parameters`; en estudios `normal` hoy imprime el
`1.0` por defecto y pasará a imprimir la media real.

Fix-forward: no se marca ni se reinterpreta ningún estudio ya creado (decisión de la persona).
