# Proposal: sintering-reaches-engine

> SDD change (política AGENTS.md). Primero de los tres contratos encadenados que propone el
> mapa `openspec/changes/_explore-only/distribution-config-surface.md` (§7), consolidado de la
> exploración y de cuatro rondas de spec-review.

## Intent

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
ningún validador. Verificado: `{"sintering_coeff":[42.0], "sintering_mean":[0.9]}` → 201, y el
hijo se lleva ambas.

**Enumerar superficies ha fallado dos veces, así que deja de ser la fuente de la garantía.**
Una lista sólo vale lo que valga la imaginación del siguiente lector. Lo que sí se puede
sostener es que **todos los hijos de la expansión se construyen en una sola función**:
combinaciones del grid, casos límite y extremos teóricos pasan igual por `create_simulation`
(`views.py:1867`). Verificado.

De ahí el reenfoque de R11: la garantía se enuncia como **invariante del hijo en ese cuello de
botella** — sus claves de sinterizado están dentro del conjunto que el worker lee y forman una
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

Lo que eso significa, verificado con probe propia:

- **La allow-list por algoritmo se burla en una línea**: `fracval` + `base_parameters={"sintering_coeff":0.8}` pasa todas las reglas y aterriza en D6 por la otra puerta.
- **Un `sintering_mean` heredado pasa tal cual**, violando el conjunto de claves con lector.
- Para `limiting` hay **dos** entradas de sinterizado, no una: el barrido plano del desplegable
  (`BatchSimulationForm.tsx:294`) y un campo dedicado "Base Sintering Coeff." (`:409-418`) que
  se envía como `base_parameters.sintering_coeff` en **todos** sus envíos (`:220`). La segunda
  es la que siempre aplica, y ninguna se valida hoy.
- Un `sintering_coeff` plano **sin** `sintering_type` significa `fixed`: así lo envía el
  formulario de `limiting`, y rechazarlo rompería su única entrada.

**Precedencia real** (también distinta de lo que decía la primera versión): `views.py:1804`
popea `sintering_config` del dict ya fusionado, así que `base_parameters` **gana al campo de
estudio**. El orden es `grid > base_parameters > estudio > default`.

Endurecer el helper sin validar antes **las tres** convertiría un fallo silencioso en un fallo
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
- **El admin de Django** (`apps/simulations/admin.py:6-31`) expone los JSONField sin
  `readonly_fields`, así que permite editar `parameters` de un hijo existente saltándose el
  serializer. No crea hijos, así que no puede producir expansiones; declarado, no arreglado.
- **D9** (la herramienta del asistente IA crea estudios por ORM sin validar ni traducir) →
  `study-expansion-single-source`. **Este change no la arregla**: un estudio creado por esa
  ruta con sinterizado sigue sin pasar por la validación. Queda declarado, no silenciado.
- **Los casos extremos de sinterizado** (`views.py:1870-1897`) crean hijos **sin** `seed_type=`,
  al contrario que `create_simulation` (`views.py:1833`), lo que contradice `cc-tunable-aggregation`
  R17. Es un bloque hermano dentro de la funcionalidad de sinterizado, pero su arreglo pertenece
  a `study-expansion-single-source`, que es quien unifica la expansión. Declarado aquí para que
  no aparezca después como hallazgo nuevo.
- **El export CSV sólo emite las columnas de sinterizado cuando el estudio tiene
  `study.sintering_config`** (`views.py:2206,2267`): un estudio cuyo sinterizado venga sólo del
  grid no las exporta, ni antes ni después de este change.
- **D7** (casos límite + entradas dict → 500 preexistente, alcanzable por API) →
  `distribution-grid-wiring` o carril corto propio.
- **D4** y la polidispersidad real → changes de seguimiento.
- `cc-tunable-aggregation` **R17** y el helper `create_simulation()` que nombra: este change no
  lo mueve, así que no la toca. La moverá `study-expansion-single-source`.
- `DistributionSelector.tsx`: su default de `uniform` emite `min == max`, que **es válido** para
  el sinterizado (`min <= max`, ambos dentro de `[0.5, 1.0]`). No se toca aquí.

## Capabilities

### Modified Capabilities

- `batch-cc-tunable-parameter-parity`: **MODIFIED** R3 (formas dict y plana, seis superficies
  de entrada, precedencia por forma, rechazo explícito), **R7** (carve-out: la compatibilidad
  hacia atrás no ampara sinterizado malformado) y R10 **sólo en su fila de sinterizado**;
  **ADDED** R11 (invariante del hijo en el cuello de botella, más alcance por algoritmo) y
  R12 (integridad de la expansión). Delta en `specs/`.

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

Efecto secundario deseable: el export CSV (`views.py:2267-2271`) escribe
`Sintering_Type`/`Sintering_Coeff` desde `sim.parameters`; en estudios `normal` hoy imprime el
`1.0` por defecto y pasará a imprimir la media real.

Fix-forward: no se marca ni se reinterpreta ningún estudio ya creado (decisión de la persona).
