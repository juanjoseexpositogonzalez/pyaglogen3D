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
| **D5b** | Hay una **tercera superficie de entrada sin validar**: `base_parameters.sintering_config`, que `views.py:1804` consume igual que las otras dos | probe: estudio con `base_parameters = {"sintering_config": {"distribution_type":"fixed"}}` **valida hoy** y produce `sintering_coeff = 1.0` |
| **D6** | La UI ofrece barrido de sinterizado para `fracval`, `gcca` y `box_rfa`, cuyas llamadas al engine **no reciben ningún kwarg de sinterizado** | `tasks.py:1729,1740,1781` sin `sintering_coeff=` |

## Las tres superficies de entrada

El sinterizado llega a un sim hijo por tres caminos, y hoy **sólo dos se validan**, con un
validador laxo que acepta `{}`, claves desconocidas y campos ausentes:

| Superficie | Validada hoy | Consumida en |
| --- | --- | --- |
| `parameter_grid.sintering_config[i]` | sí, laxamente | `views.py:1804` |
| `ParametricStudy.sintering_config` | sí, laxamente | `views.py:1806` |
| `base_parameters.sintering_config` | **no** | `views.py:1804`, vía `dict(base_parameters) \| combo` |

Endurecer el helper sin validar antes **las tres** convertiría un fallo silencioso en un fallo
peor: `perform_create` (`views.py:1750`) no tiene `try/except`, el proyecto no define
`ATOMIC_REQUESTS` y los hijos ya están encolados cuando el helper lanzaría. De ahí R12.

## Fuera de alcance

Explícitamente, y cada uno con su contrato en la cadena:

- **D1, D3, D8** (las claves `kf_distribution` y `particle_radius_config`: forma `{mode}`,
  cableado al engine, semántica honesta) → `distribution-grid-wiring`.
- **D9** (la herramienta del asistente IA crea estudios por ORM sin validar ni traducir) →
  `study-expansion-single-source`. **Este change no la arregla**: un estudio creado por esa
  ruta con `sintering_config` sigue sin pasar por la validación. Queda declarado, no
  silenciado.
- **D7** (casos límite + entradas dict → 500 preexistente, alcanzable por API) →
  `distribution-grid-wiring` o carril corto propio.
- **D4** y la polidispersidad real → changes de seguimiento.
- `cc-tunable-aggregation` **R17** y el helper `create_simulation()` que nombra: este change no
  lo mueve, así que no la toca. La moverá `study-expansion-single-source`.
- `DistributionSelector.tsx`: su default de `uniform` emite `min == max`, que **es válido** para
  el sinterizado (`min <= max`, ambos dentro de `[0.5, 1.0]`). No se toca aquí.

## Capabilities

### Modified Capabilities

- `batch-cc-tunable-parameter-parity`: **MODIFIED** R3 (forma del sinterizado, rechazo
  explícito, las tres superficies) y R10 **sólo en su fila de sinterizado** (alcance por
  algoritmo y forma del payload); **ADDED** R11 (el sinterizado llega al engine) y R12
  (integridad de la expansión). Delta en `specs/`.

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
