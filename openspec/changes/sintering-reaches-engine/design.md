# Design: sintering-reaches-engine

> Decisiones de implementación. Anclas verificadas sobre `develop` @ `c3ff055`.
>
> **Nomenclatura**: `D2`, `D5`, `D5b`, `D6` son los **defectos** (ver `proposal.md` y el mapa);
> `DD1`…`DD5` son las **decisiones de diseño** de este documento.

## DD0 — La garantía vive en el cuello de botella, no en la lista

**Decisión.** El invariante de R11 se enuncia y se hace cumplir en la **única función que
construye los parámetros de un hijo**. Verificado que existe: `views.py:1867` pasa los casos
límite por `create_simulation`, igual que las combinaciones del grid, y los extremos teóricos
son casos límite. Todos los hijos de la expansión pasan por ahí.

**Por qué.** Dos rondas de revisión refutaron dos enumeraciones de superficies (tres, luego
cinco, luego una sexta). Una lista de entradas sólo garantiza lo que la lista contiene; el
invariante de salida garantiza también lo que no supe enumerar.

**Qué sigue haciendo la lista.** Dar un 400 útil antes de escribir nada (R12). Un fallo del
invariante en el chokepoint es un error de programación, no de usuario: si el usuario pudo
provocarlo, es que falta una superficie en la capa de entrada, y ese es el síntoma que hay que
arreglar.

**Alternativa descartada.** Seguir alargando la lista. Es lo que ya falló dos veces.

## DD1 — Una sola regla de forma, aplicada en las seis superficies

**Decisión.** `validate_sintering_config` (`serializers.py:360`) pasa a exigir, sobre un dict
**no vacío**:

1. `distribution_type` presente y ∈ `{fixed, uniform, normal}`;
2. **todos** los campos que ese tipo requiere (`fixed`→`coefficient`, `uniform`→`min`,`max`,
   `normal`→`mean`,`std`);
3. ninguna clave fuera de `{distribution_type, coefficient, min, max, mean, std}`.

Se invoca sobre las **seis** superficies de R3: las tres de clave `sintering_config` (grid,
campo de estudio y `base_parameters`), los **escalares planos** en `base_parameters` y en
`parameter_grid`, y los de `limiting_cases_config.theoretical_extremes`. Hoy las cuatro
últimas no las valida nadie.

**Por qué cinco y no tres.** La primera versión de este diseño mapeaba por nombre de clave; el
worker lee escalares planos (`tasks.py:1592-1598`), así que una regla escrita sólo para
`sintering_config` deja la puerta abierta. Verificado: `fracval` +
`base_parameters={"sintering_coeff":0.8}` pasaba todas las reglas de la versión anterior.

**Escalares planos.** Tienen su **propia** tabla de campos requeridos por tipo (R3), no "los
mismos rangos" del dict: `fixed`→`sintering_coeff`; `uniform`→`sintering_min`,`sintering_max`;
`normal`→`sintering_coeff` (que hace de media) y `sintering_std`, con `0 < std <= 0.2`.
Cualquier otra `sintering_*` se rechaza, en particular `sintering_mean`, que no tiene lector.

**Un `sintering_coeff` plano sin `sintering_type` significa `fixed`.** No es una concesión:
es lo que envía el formulario en **todos** los envíos de `limiting` (`BatchSimulationForm.tsx:220`),
y exigir el tipo convertiría cada uno de ellos en un 400.

**Precedencia, por forma.** Entre los **dicts**, `views.py:1804` popea `sintering_config` del
dict ya fusionado (`dict(base_parameters) | combo`), así que el orden es
`grid > base_parameters > estudio > default`. Entre los **planos** gana el último que escribe
en el orden de expansión. Y cualquier dict que aplique gana a todos los planos. La versión
anterior daba un solo orden de cuatro niveles como si valiera para ambas formas: no vale. Cuando un dict de dominio aplica, las claves de sinterizado del hijo son
exactamente las que ese dict produce: cualquier `sintering_*` heredado de `base_parameters` no
sobrevive. **Esa limpieza la hace `apply_sintering_config`**, que es quien sabe que un dict
aplica a ese hijo; no el serializer, porque limpiar en el serializer afectaría también a los
hijos de casos límite, que copian `base_parameters` y nunca reciben el dict del grid
(`utils.py:185-203`) — les cambiaría la física. Eso cierra también el paso del `sintering_mean`
legado.

**Dict vacío y `None`.** Significan "este estudio no configura sinterizado" y se **aceptan** en
el campo de estudio y en `base_parameters`. En una entrada de `parameter_grid` se **rechazan**:
un punto del barrido que no dice nada sería un hijo que corre sin sinterizado sin declararlo,
que es exactamente D2 por otra puerta.

**Por qué exigir los campos por tipo y no sólo el tipo.** Sin ello
`{"distribution_type":"fixed"}` sobrevive y `apply_sintering_config` vuelve a defaultear a
`1.0` (`utils.py:263`). Probado: hoy ese dict **valida** y produce `sintering_coeff = 1.0`.

**Por qué rechazar claves desconocidas.** Es lo único que atrapa la forma `{mode, mean, std}`
que emite la UI (D2), cuyo `distribution_type` sencillamente no existe.

## DD2 — El helper lanza, pero nunca es el primero en enterarse

**Decisión.** `apply_sintering_config` (`utils.py:236`) lanza `ValueError` ante un dict no
vacío que incumpla DD1, en vez de caer a `fixed/1.0`. Pero la validación de DD1 ocurre
**antes de escribir nada** (DD3), de modo que en la práctica el helper nunca lanza desde la
API: es una red de seguridad, no el mecanismo de rechazo.

**Por qué las dos cosas.** El helper es la última frontera antes del parámetro que decide la
física, y el fallo silencioso es el defecto más grave precisamente porque nadie se entera. Pero
un helper que lanza sin validación previa convierte el problema en uno peor: ver DD3.

## DD3 — La expansión no puede dejar estudios a medias

**El riesgo, verificado.** `perform_create` (`views.py:1749`) crea el `ParametricStudy`, y
después, por cada combinación, crea cada `Simulation` y la encola con
`run_simulation_task.delay(...)`. No hay `try/except`, el proyecto **no define
`ATOMIC_REQUESTS`** y no hay `transaction.atomic`. Si `apply_sintering_config` lanzara a mitad
del bucle, quedaría un estudio creado con parte de sus hijos ya encolados y una respuesta 500.
(Sí hay un `try/except` alrededor del `.delay()` en `views.py:1837-1844`, que se traga fallos
del broker; no cubre la expansión ni deshace filas.)

**Decisión.** Toda configuración de sinterizado alcanzable por la expansión — grid, campo de
estudio y `base_parameters` — se valida en `ParametricStudySerializer.validate()`, es decir
**antes de la primera escritura**. Una configuración inválida produce **400 y cero filas**.

**Alternativa descartada.** `transaction.atomic` a secas no basta: una tarea Celery ya
despachada no se deshace con el rollback, así que seguiría habiendo trabajo encolado para un
estudio que no existe. **Sí existe una forma que también funciona**: `transaction.atomic` más
`transaction.on_commit(lambda: run_simulation_task.delay(...))`, que no publica nada hasta que
la transacción confirma. Se descarta no por incorrecta sino por alcance: cambia el modelo de
despacho de toda la expansión, incluidos los casos límite y los extremos de sinterizado, que
este contrato no toca. Validar antes resuelve el problema de este change sin tocar esa
mecánica. (La versión anterior decía "la única opción": era falso.)

## DD4 — `sintering_coeff` es la media (D5)

**Decisión.** `apply_sintering_config` deja de escribir `sintering_mean` y escribe
`sintering_coeff` para el tipo `normal`.

**Por qué.** La convención de escalares planos del worker es que **`sintering_coeff` hace de
media** cuando `sintering_type == "normal"`: así lo lee el engine (`parse_sintering`,
`lib.rs:602`: `SinteringDistribution::normal(sintering_coeff, sintering_std)`) y así lo envía
el formulario de simulación individual (`SimulationForm.tsx:690-691`).

**Evidencia.** `grep -rn sintering_mean backend frontend aglogen_core` → exactamente dos
ocurrencias: la escritura (`utils.py:268`) y una aserción de test (`tests/test_utils.py:316`).
El worker sólo lee `{sintering_type, sintering_coeff, sintering_min, sintering_max,
sintering_std}` (`tasks.py:1592-1598`).

**Alcance colateral nulo.** `apply_sintering_config` se invoca únicamente desde
`views.py:1806,1808` (más tests): la ruta de la simulación individual no pasa por él y no
cambia.

**Verificación obligatoria.** Un escenario de borde de engine: mock sobre el binding,
afirmando que la media que llega es la declarada y **no** `1.0`. Sin él, la suite seguiría tan
ciega como lo estuvo con D5 durante meses.

## DD5 — Alcance por algoritmo, como lista de permitidos (D6)

El modelo tiene **once** algoritmos (`models.py:8-21`), así que la regla se expresa como
allow-list: lo no listado se rechaza. Una denylist dejaba `imported` sin definir.

| Configuración | Algoritmos permitidos | Evidencia |
| --- | --- | --- |
| Sinterizado, los tres tipos | `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `tunable_cc` | Únicas ramas que reciben los cinco kwargs (`tasks.py:1608,1623,1636,1650,1665,1695`) |
| Sinterizado, sólo `fixed` | `limiting` | Lee `sintering_coeff` (`tasks.py:1800`) y lo pasa a los generadores de geometría, pero **ignora** `sintering_type/min/max/std`: `uniform` y `normal` se descartarían en silencio |
| Rechazado | `fracval`, `gcca`, `box_rfa`, `imported` | Sus ramas no reciben ningún kwarg de sinterizado (`tasks.py:1729,1740,1781`); `imported` no tiene rama (`:1971` lanza `Unknown algorithm`) |

La regla se aplica a las **cinco** superficies: ofrecer o aceptar un sinterizado que el engine
va a ignorar es la misma mentira que este change elimina. En particular, el barrido plano
`sintering_coeff` que el formulario ofrece para `limiting` (`BatchSimulationForm.tsx:293`) es
una de sus dos entradas de sinterizado — la otra es el campo "Base Sintering Coeff."
(`:409-418`), que se envía siempre (`:220`) — y ambas pasan a validarse.

**Cambio de algoritmo en el formulario.** `setAlgorithm` (`BatchSimulationForm.tsx:358`) no
resetea `variations`: tras T6.2 un usuario puede configurar sinterizado en `ballistic`, cambiar
a `fracval` y quedarse con una variación que el backend rechazará con un 400 que la UI no sabe
explicar. R10.6 exige limpiarla o marcarla.

**Adaptador de UI.** `BatchSimulationForm` traduce en el submit `DistributionValue` → forma de
dominio del sinterizado, en **una** función pura `toSinteringConfig`. La tabla es total:
`DistributionValue` tiene exactamente tres variantes (`types.ts:90-93`).

| `DistributionValue` | Sintering config |
| --- | --- |
| `{mode:'fixed', value}` | `{distribution_type:'fixed', coefficient: value}` |
| `{mode:'normal', mean, std}` | `{distribution_type:'normal', mean, std}` |
| `{mode:'uniform', min, max}` | `{distribution_type:'uniform', min, max}` |

El default actual de `uniform` en `DistributionSelector.tsx:57` emite `min == max` con base
`1.0`, que **es válido** para el sinterizado (`min <= max`, ambos en `[0.5, 1.0]`). Este change
no toca ese componente.

## Riesgos

- **Cambio de comportamiento deliberado.** Un estudio que "funcionaba" con sinterizado
  silenciosamente desactivado ahora sinteriza o falla en validación. Es el objetivo.
- **Estudios antiguos no editables.** Uno cuyo `sintering_config` almacenado no cumpla DD1
  devolverá 400 en cualquier PUT/PATCH posterior. La expansión sólo ocurre en la creación, así
  que ninguno se reexpande. Fix-forward.
- **La ruta del asistente IA sigue sin validar.** `study_tools.py:144,166` escribe por ORM: un
  estudio creado por ahí con sinterizado malformado conserva el comportamiento actual. Está
  declarado en `proposal.md` y es el objeto de `study-expansion-single-source`.
- **Sin CI.** `.github/workflows/` está vacío; la verificación es local, con una línea base
  roja preexistente del backend documentada en las tareas.
