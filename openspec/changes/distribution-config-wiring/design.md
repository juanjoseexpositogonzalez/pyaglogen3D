# Design: distribution-config-wiring

> Decisiones de implementación del contrato. Anclas verificadas sobre `develop` @ `8423c4f`.
>
> **Nomenclatura**: `D1`…`D9` son los **defectos** (ver `proposal.md`); `DD1`…`DD9` son las
> **decisiones de diseño** de este documento.

## DD1 — Un solo validador para distribuciones `{mode}`

**Decisión.** `validate_distribution_config` (`services/distribution_validation.py:19`) se
reescribe como envoltorio de `DistributionField.to_internal_value` (`fields.py:25`), con tres
responsabilidades propias **antes** de delegar:

1. Rechazar lo que no sea un dict. Esto incluye `None`: `DistributionField` devuelve `None`
   para `None` (`fields.py:25-26`), así que delegar sin este filtro aceptaría
   `kf_distribution: [null]`. El envoltorio lo rechaza con 400.
2. Rechazar **claves desconocidas** para el modo declarado (no descartarlas). `DistributionField`
   las ignora al normalizar; aquí son un error, porque son la señal de vocabulario mezclado que
   este change elimina.
3. Aplicar `allowed_modes` y `max_std_over_mean`.

El parámetro `min_mean` del validador actual **se retira**: ninguna clave lo usa
(`serializers.py:434-437`).

**Lo que se persiste es la salida normalizada de `DistributionField`** (números en coma
flotante), de modo que la traducción de DD5 opere siempre sobre una forma canónica y los
escenarios puedan afirmar igualdad exacta. Normalizar y rechazar claves desconocidas no se
contradicen: lo desconocido ya ha fallado antes de llegar a la normalización.

**Por qué.** `DistributionField` ya valida exactamente la forma que emite el frontend y que
consume `expand_distribution_kwargs`. Tener dos validadores para una forma es cómo nació este
defecto.

**Alternativa descartada.** Aceptar `distribution_type` como alias de escritura. La UI siempre
recibió 400 (D1), así que ningún estudio creado desde la aplicación contiene esa forma en estas
dos claves. Un cliente directo de la API sí pudo crearla; esos estudios quedan no editables,
aceptado como fix-forward.

**Coste explícito.** Los tests que fijan `{"distribution_type": …}` se reescriben a `mode`
(lista completa en `tasks.md` T1.6).

## DD2 — `allowed_modes` por clave

| Grid key | Modos | Razón |
| --- | --- | --- |
| `kf_distribution` | `fixed`, `normal`, `uniform` | El engine soporta los tres (`parse_target_kf_distribution`, `lib.rs:657`) |
| `particle_radius_config` | `fixed`, `normal` | Es lo que ofrece la UI (`BatchSimulationForm.tsx:522-525`) |

`particle_radius_config` conserva `max_std_over_mean = 0.3`: con el truncado `μ±3σ` del engine
(`dpo_distribution.rs:57-74`) la cota inferior queda en `0.1·mean > 0`, así que evita radios
negativos.

## DD3 — Sinterizado: rechazo explícito, nunca default silencioso

**Regla única, aplicada en las dos capas:**

1. **API** (`validate_sintering_config`, `serializers.py:360`): un config de sinterizado DEBE
   declarar `distribution_type` ∈ `{fixed, uniform, normal}`, DEBE traer **todos** los campos
   que ese tipo requiere, y NO DEBE traer claves fuera de
   `{distribution_type, coefficient, min, max, mean, std}`. Cualquier violación → 400.
2. **Helper** (`apply_sintering_config`, `utils.py:236`): lanza `ValueError` ante un dict no
   vacío que incumpla lo anterior — **incluido un `distribution_type` desconocido**, que hoy
   se propaga hasta `parse_sintering` y cae por su rama `_ =>` a `fixed(1.0)`
   (`lib.rs:600-604`): sin sinterizado, en silencio.

**Entradas de grid vacías (`{}`) se rechazan con 400.** La exención de `None`/`{}` que devuelve
los parámetros intactos es legítima **sólo** para el campo de estudio (`utils.py:255`), donde
significa "este estudio no configura sinterizado". Dentro de `parameter_grid.sintering_config`
un `{}` no significa nada: sería un punto del barrido que corre sin sinterizado sin decirlo, es
decir el defecto D2 reproducido dentro del requisito que lo abole.

**Se retiró la excepción para `{"coefficient": 0.9}` sin `distribution_type`** que figuraba en
la versión r1 de este diseño: era incoherente con la mitad 2 (habría sido un 500 en
`perform_create`) y además infundada — ningún sender la produce
(`grep coefficient frontend/src` → sólo un comentario y una etiqueta).

**Por qué exigir los campos por tipo.** Sin ello, `{"distribution_type":"fixed"}` sin
`coefficient` sobrevive a las dos capas y vuelve a defaultear a 1.0 (`utils.py:263`).

**Por qué el helper lanza aunque la API ya rechace.** Defensa en profundidad: el helper es la
última frontera antes del parámetro que decide la física.

**Adaptador de UI.** `BatchSimulationForm` traduce en el submit `DistributionValue` → forma de
sinterizado en **una** función pura `toSinteringConfig`. La tabla es total:

| `DistributionValue` | Sintering config |
| --- | --- |
| `{mode:'fixed', value}` | `{distribution_type:'fixed', coefficient: value}` |
| `{mode:'normal', mean, std}` | `{distribution_type:'normal', mean, std}` |
| `{mode:'uniform', min, max}` | `{distribution_type:'uniform', min, max}` |

## DD4 — El sinterizado `normal` debe llegar al engine (D5)

**Decisión.** `apply_sintering_config` deja de escribir `sintering_mean` y escribe
`sintering_coeff` para el tipo `normal`.

**Por qué.** La convención de escalares planos del worker es que **`sintering_coeff` hace de
media** cuando `sintering_type == "normal"`: así lo lee el engine (`parse_sintering`,
`lib.rs:602`: `SinteringDistribution::normal(sintering_coeff, sintering_std)`) y así lo envía
el formulario single (`SimulationForm.tsx:690-691`).

**Evidencia.** `grep -rn sintering_mean backend frontend aglogen_core` devuelve **dos**
ocurrencias: la escritura (`utils.py:268`) y una aserción de test
(`tests/test_utils.py:316`). Ningún consumidor de producción la lee: el worker sólo lee
`sintering_coeff/type/min/max/std` (`tasks.py:1592-1598`). El test que la fija se declara en
`tasks.md` T3.2.

**Alcance colateral nulo.** `apply_sintering_config` se invoca únicamente desde
`views.py:1806,1808`; la ruta de la simulación individual no pasa por él.

**Alternativa descartada.** Enseñar al worker a leer `sintering_mean`: tocaría la ruta single,
que hoy funciona, para acomodar una clave que nadie más usa.

**Verificación obligatoria.** Un escenario de borde de engine, simétrico a R11.1/R11.2
(`tasks.md` T3.3). Sin él la suite seguiría ciega igual que lo estuvo con D3.

## DD5 — Cableado grid key → kwargs de engine (D3)

**Decisión.** La traducción ocurre en el helper compartido de DD9, invocado desde
`create_simulation` (`views.py:1784`), donde ya viven las otras dos (`seed_type` → campo de
modelo, `sintering_config` → parámetros):

```text
particle_radius_config  →  dpo_distribution
kf_distribution         →  target_kf_distribution
```

El sim hijo recibe **solo** la clave de engine. Mantener ambas sería duplicar la verdad; la
procedencia del barrido vive en `study.parameter_grid`.

**Precedencia.** La clave de grid **sobrescribe** lo que `base_parameters` traiga para el mismo
concepto (`dpo_distribution`, `radius_min`/`radius_max`, `target_kf`), igual que el sinterizado
de grid sobrescribe al de estudio. Es el único orden coherente: el grid es lo que el usuario
está barriendo. Observable en el escenario R11.6.

**Nota para el futuro lector**: `expand_distribution_kwargs` devuelve `{}` ante un `mode`
desconocido (`tasks.py:48`) — otro no-op silencioso en la costura del worker. Queda inalcanzable
una vez R1 normaliza la entrada, por eso no se toca aquí.

**Coste explícito.** Los tests de passthrough se reescriben para afirmar la traducción
(`tasks.md` T4.5). Esos tests son la razón de que D3 fuera invisible.

## DD6 — Alcance por algoritmo (D6), como lista de permitidos

El modelo tiene **once** algoritmos (`models.py:8-21`), así que la regla se expresa como
**allow-list**; cualquier algoritmo no listado se rechaza. Una denylist dejaba `imported` sin
definir.

| Grid key | Algoritmos permitidos | Evidencia |
| --- | --- | --- |
| `particle_radius_config`, `kf_distribution` | `tunable_cc` | `dpo_*`/`kf_*` sólo existen en esa rama (`tasks.py:1672-1703`) |
| `sintering_config` (los 3 tipos) | `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `tunable_cc` | Únicas ramas que pasan `sintering_coeff=` **y** `sintering_type/min/max/std` (`tasks.py:1608,1623,1636,1650,1665,1695`) |
| `sintering_config` (sólo `fixed`) | `limiting` | Lee `sintering_coeff` (`tasks.py:1800`) y lo pasa a los generadores de geometría, pero **ignora** `sintering_type/min/max/std`: `uniform` y `normal` se descartarían en silencio |
| `sintering_config` | **rechazado** para `fracval`, `gcca`, `box_rfa`, `imported` | Sus ramas no reciben ningún kwarg de sinterizado (`tasks.py:1705,1738,1752`); `imported` no tiene rama de simulación |

**La regla cubre también el `sintering_config` de estudio**, no sólo la clave de grid: el campo
del modelo se aplica a todos los hijos sin mirar el algoritmo (`views.py:1806-1808`), y los
casos extremos de sinterizado se generan igual (`views.py:1869-1877`). Restringir sólo el grid
habría dejado viva exactamente la misma mentira por la otra puerta.

**Alternativa descartada.** Mapear `particle_radius_config` a `radius_min`/`radius_max` para el
resto de algoritmos: defendible para `uniform`, pero `normal` no tiene ruta de engine fuera de
`tunable_cc` y quedaría una excepción muda.

## DD7 — Casos límite con claves de distribución (D7)

**Decisión.** `generate_limiting_cases` (`utils.py:176-190`) ignora, al generar fronteras, las
claves de grid cuyos valores sean `dict` o `list`; `int`, `float`, `bool` y `str` siguen
produciendo fronteras. El hijo de frontera usa para ese concepto el valor de `base_parameters`.

**Por qué la regla se enuncia por tipo y no como "escalares".** `seed_type` tiene valores
**string** y hoy produce fronteras reales (verificado:
`[('boundary_min','seed_type=dimers'), ('boundary_max','seed_type=trimers')]`). Una regla
redactada como "ignorar lo que no sea escalar" invita a implementarla como
`isinstance(v, (int, float))` y borraría ese comportamiento sin que ningún test lo note.
Escenario R13.3 lo fija.

**Por qué ignorar y no rechazar.** Una distribución no tiene frontera natural: ordenar dos
dicts no significa nada. Rechazar la combinación castigaría un uso legítimo (barrer una
distribución y querer además los casos límite de los parámetros escalares).

**Reachability (corregido respecto a r2).** Este 500 **no lo abrimos nosotros**: el 400 de D1
sólo dispara contra la forma `{mode}`, mientras que la forma `{distribution_type}` se acepta
hoy. Verificado: un estudio con dos entradas `{distribution_type:…}` e
`include_limiting_cases=true` pasa la validación actual y revienta en `perform_create`. Es un
defecto preexistente alcanzable por clientes directos de la API, que adoptamos al tocar esta
superficie.

**Alcance verificado.** `generate_limiting_cases` se invoca sólo desde `views.py:1859` (más
tests); la rama de extremos teóricos (`utils.py:194-203`) itera `THEORETICAL_EXTREMES`, nunca
el grid, así que no puede sufrir el fallo. El único punto de caída es `sorted(values)` dentro
del bloque de fronteras (`utils.py:176-192`).

## DD8 — Nombrar lo que la cosa hace (D8)

**Decisión.** La opción de la UI deja de llamarse "Particle radius (polydispersity)" y pasa a
"Primary particle size (dpo)". R2 describe la semántica real: **barrido del tamaño de partícula
primaria entre hijos**, monodisperso dentro de cada agregado.

**Por qué.** `tunable_cc` muestrea un dpo por ejecución y fija `radius_min = radius_max`
(`tunable_cc.rs:1121-1128`, comentario literal `// monodisperse per run`; canónica
`cc-tunable-aggregation.md` R12 en `:573-590`). Llamar polidispersidad a eso es prometer algo
que el engine no hace — la clase exacta de mentira que DD6 condena.

**El nombre de la clave de API no cambia** (`particle_radius_config`): describe correctamente
lo que configura. Lo que miente es el paréntesis de la etiqueta.

**Polidispersidad real**: fuera de alcance por decisión de la persona, con change de
seguimiento. El único algoritmo que la implementa es FracVAL (`fracval.rs:108-121`).

## DD9 — Una sola expansión para las dos puertas de entrada (D9)

**Problema.** Hay dos caminos que crean estudios y sus hijos:

| Camino | Validación | Traducción |
| --- | --- | --- |
| API REST: `ParametricStudyViewSet.perform_create` → `create_simulation` (`views.py:1784`) | `ParametricStudySerializer.validate()` | sí (tras DD5) |
| Asistente IA: `create_parametric_study_handler` (`study_tools.py:144,165`) | **ninguna** | **ninguna** |

El segundo escribe en el ORM directamente. Arreglar sólo el primero dejaría D3 vivo en una
ruta alcanzable.

**Decisión.** Extraer a `apps/simulations/services/study_expansion.py` dos funciones puras,
consumidas por **ambos** caminos:

1. `validate_grid_for_algorithm(parameter_grid, algorithm, sintering_config)` — la allow-list
   de R11 y las reglas de forma de R1/R2/R3. La invoca `ParametricStudySerializer.validate()`
   y la invoca el handler de la herramienta.
2. `build_child_parameters(base_parameters, combo, study_sintering_config)` — la traducción de
   DD5, `apply_sintering_config` y el pop de `seed_type`, devolviendo los parámetros del hijo
   y el valor de `seed_type`.

**Por qué extraer y no duplicar.** Dos copias de la regla es precisamente el mecanismo que
produjo D1 (dos validadores de forma) y D3 (dos vocabularios). Una regla, un sitio.

**Precedente del propio repositorio.** `study_tools.py:103-118` ya enruta
`box_counting_params` por `validate_box_counting_params_dict`, el validador compartido de la
API, tras el hallazgo JD-A-006: *"so a tool call cannot persist junk straight to the ORM"*.
DD9 aplica el mismo patrón a las claves de distribución.

**Efecto colateral declarado.** Al pasar por `build_child_parameters`, la ruta del asistente
gana también el pop de `seed_type` → campo de modelo, que hoy se salta (el hijo queda con el
`seed_type` por defecto y la clave suelta en `parameters`). Es un defecto preexistente de esa
ruta, distinto de los nuestros; se corrige por venir incluido en el helper compartido, y se
declara aquí en vez de aparecer sin explicación en el diff.

**Fuera de esta decisión.** El tope de 10 000 simulaciones del handler frente a los 1 000 del
serializer, y su `_generate_parameter_combinations` propio. Unificar toda la superficie de la
herramienta es otro trabajo.

## Riesgos

- **Cambio de comportamiento deliberado (D2, D5).** Un estudio batch que "funcionaba" con
  sinterizado silenciosamente desactivado ahora sinteriza o falla en validación.
- **Estudios almacenados por clientes directos de la API.** Pueden contener la forma antigua y
  quedan no editables (revalidación en PUT/PATCH → 400). Fix-forward. Nota: un estudio antiguo
  cuyo `sintering_config` de estudio no cumpla DD3 haría lanzar al helper si se reexpandiera;
  la expansión sólo ocurre en la creación, así que no se reexpande ninguno.
- **Actualización parcial.** `ParametricStudyViewSet` es un `ModelViewSet` (`views.py:1733`):
  en `PATCH` sin `base_algorithm`, la regla de DD6 se evalúa contra
  `self.instance.base_algorithm`. Especificado en R11.5.
- **Componente compartido.** T6.4 toca `DistributionSelector.tsx`, usado también por el
  formulario single; declarado como excepción explícita en `proposal.md`. El rango que
  proponga por defecto para `uniform` debe cumplir **a la vez** `min < max` (exigido por
  `fields.py:59` para dpo/kf) y `0.5 <= min,max <= 1.0` (exigido por `serializers.py:382-385`
  para el sinterizado), porque el mismo componente alimenta las tres opciones y su valor base
  es `1.0` (`DistributionGridInput.tsx:17`). Un `max = base * 1.2` cumpliría lo primero y
  produciría un 400 en el sinterizado sin que el usuario tocase nada: el fallo exacto que este
  change abole.
- **Dos puertas de entrada.** Tras DD9 la regla vive en un helper compartido; cualquier tercer
  camino que cree hijos por ORM volvería a abrir el mismo agujero.
- **Sin CI.** `.github/workflows/` está vacío; toda la verificación es local, y la suite de
  backend tiene un rojo preexistente documentado en T7.1.
