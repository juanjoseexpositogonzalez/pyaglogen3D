# Design: distribution-config-wiring

> Decisiones de implementación del contrato. Anclas verificadas sobre `develop` @ `8423c4f`.
>
> **Nomenclatura**: `D1`…`D8` son los **defectos** (ver `proposal.md`); `DD1`…`DD7` son las
> **decisiones de diseño** de este documento. (Corrige la colisión de etiquetas señalada por
> la revisión nativa.)

## DD1 — Un solo validador para distribuciones `{mode}`

**Decisión.** `DistributionField.to_internal_value` (`fields.py:25`) pasa a ser el **único**
validador de forma para `kf_distribution` y `particle_radius_config`.
`validate_distribution_config` (`services/distribution_validation.py:19`) se reescribe como un
envoltorio que (1) delega la forma en `DistributionField`, (2) aplica las restricciones extra
del grid: `allowed_modes` y `max_std_over_mean`.

El parámetro `min_mean` del validador actual **se retira**: ninguna clave lo usa
(`_DISTRIBUTION_GRID_KEYS`, `serializers.py:434`) y un knob sin consumidor es deuda.

**Lo que se almacena es la salida normalizada de `DistributionField`** (floats, claves
desconocidas descartadas), no el dict crudo del request. Así la traducción de DD4 opera
siempre sobre una forma canónica y los escenarios pueden afirmar igualdad exacta.

**Por qué.** `DistributionField` ya valida exactamente la forma que emite el frontend y que
consume `expand_distribution_kwargs`, con rangos (`value > 0`, `std > 0`, `max > min`). Tener
dos validadores para una forma es cómo nació este defecto.

**Alternativa descartada.** Aceptar `distribution_type` como alias de escritura. Rechazada: la
UI siempre recibió 400 (D1), así que ningún estudio creado desde la aplicación contiene esa
forma en estas dos claves. Un cliente directo de la API sí pudo crearla; esos estudios quedan
no editables, y se acepta como fix-forward (declarado en `proposal.md`).

**Coste explícito.** Los tests que fijan `{"distribution_type": …}` se reescriben a `mode`
(lista completa en `tasks.md` T1.3). No es debilitar un test: es corregir la forma que el test
fija, y queda declarado en el contrato y en el Log, como manda AGENTS.md.

## DD2 — `allowed_modes` por clave, y rechazo de claves desconocidas

| Grid key | Modos | Razón |
| --- | --- | --- |
| `kf_distribution` | `fixed`, `normal`, `uniform` | El engine soporta los tres (`parse_target_kf_distribution`, `lib.rs:657`) |
| `particle_radius_config` | `fixed`, `normal` | Es lo que ofrece la UI (`BatchSimulationForm.tsx:522-525`) |

`particle_radius_config` conserva `max_std_over_mean = 0.3`: con el truncado `μ±3σ` del engine
(`dpo_distribution.rs:62-72`) la cota inferior queda en `0.1·mean > 0`, así que evita radios
negativos.

**Simetría con el sinterizado (DD3).** Las tres claves rechazan **claves desconocidas** dentro
del dict. Sin esto, `{mode:"fixed", value:1, distribution_type:"normal"}` sería válido para las
claves de distribución: justo el estado de vocabulario mezclado que el change elimina.

## DD3 — Sinterizado: rechazo explícito, nunca default silencioso

**Regla única, aplicada en las dos capas** (corrige la contradicción que la spec-review marcó
como BLOCKER-2):

1. **API** (`validate_sintering_config`, `serializers.py:360`): un dict de sinterizado no vacío
   DEBE declarar `distribution_type`, DEBE traer los campos que ese tipo requiere, y NO DEBE
   traer claves fuera de `{distribution_type, coefficient, min, max, mean, std}`. Cualquier
   violación → 400.
2. **Helper** (`apply_sintering_config`, `utils.py:236`): ante un dict no vacío que no cumpla
   lo anterior, lanza `ValueError`. `None` y `{}` siguen devolviendo los parámetros intactos
   (ruta legítima, `utils.py:255`).

**Se retira la excepción para `{"coefficient": 0.9}` sin `distribution_type`** que figuraba en
la versión anterior de este diseño. Era incoherente —la mitad 2 la habría convertido en un 500
en `perform_create`— y además infundada: verificado que **nadie envía esa forma** (ningún
sender en `frontend/src`, y el `help_text` del modelo documenta `distribution_type` como parte
de la forma, `models.py:140-144`).

**Por qué exigir también los campos por tipo.** Sin ello, `{"distribution_type":"fixed"}` sin
`coefficient` sobrevive a las dos capas y vuelve a defaultear a 1.0 en silencio
(`utils.py:263`) — el defecto D2 por otra puerta. La regla "claves desconocidas" sola no basta.

**Por qué el helper lanza aunque la API ya rechace.** Defensa en profundidad: el helper es la
última frontera antes del parámetro que decide la física, y el fallo silencioso es el defecto
más grave precisamente porque nadie se entera.

**Adaptador de UI.** `BatchSimulationForm` traduce en el submit `DistributionValue` → forma de
sinterizado, en **una** función pura `toSinteringConfig`. La tabla es total: `DistributionValue`
tiene exactamente tres variantes.

| `DistributionValue` | Sintering config |
| --- | --- |
| `{mode:'fixed', value}` | `{distribution_type:'fixed', coefficient: value}` |
| `{mode:'normal', mean, std}` | `{distribution_type:'normal', mean, std}` |
| `{mode:'uniform', min, max}` | `{distribution_type:'uniform', min, max}` |

## DD4 — El sinterizado `normal` debe llegar al engine (D5)

**Decisión.** `apply_sintering_config` deja de escribir `sintering_mean` y escribe
`sintering_coeff` para el tipo `normal`.

**Por qué.** La convención de escalares planos del worker es que **`sintering_coeff` hace de
media** cuando `sintering_type == "normal"`: así lo lee el engine
(`parse_sintering`, `lib.rs:602`: `SinteringDistribution::normal(sintering_coeff, sintering_std)`)
y así lo envía el formulario single (`SimulationForm.tsx:690-691`). `sintering_mean`
(`utils.py:268`) es una clave **sin ningún lector en todo el repositorio** — verificado con
`grep -r sintering_mean backend frontend aglogen_core` → una única ocurrencia, la escritura.

**Alternativa descartada.** Enseñar al worker a leer `sintering_mean`. Rechazada: tocaría la
ruta de la simulación individual, que hoy funciona, para acomodar una clave que nadie más usa.

**Verificación obligatoria.** Un escenario de borde de engine, simétrico a R11.1/R11.2: mock
sobre el binding, afirmando la media que realmente se pasa. Sin él la suite seguiría ciega
exactamente igual que lo estuvo con D3.

## DD5 — Cableado grid key → kwargs de engine (D3)

**Decisión.** La traducción ocurre en `create_simulation` (`views.py:1784`), donde ya viven las
otras dos (`seed_type` → campo de modelo, `sintering_config` → parámetros):

```text
particle_radius_config  →  dpo_distribution
kf_distribution         →  target_kf_distribution
```

El sim hijo recibe **solo** la clave de engine. Mantener ambas sería duplicar la verdad; la
procedencia del barrido vive en `study.parameter_grid`.

**Precedencia.** La clave de grid **sobrescribe** lo que `base_parameters` traiga para el mismo
concepto (`dpo_distribution`, `radius_min`/`radius_max`, `target_kf`), igual que el sinterizado
de grid sobrescribe al de estudio (R3). Es el único orden coherente: el grid es lo que el
usuario está barriendo.

**Coste explícito.** `test_grid_expansion.py:292-313` y los otros tests de passthrough se
reescriben para afirmar la traducción (lista completa en `tasks.md` T3.3). Esos tests son la
razón de que D3 fuera invisible: afirmaban que el parámetro llega a `sim.parameters` y nunca
que llega al engine.

## DD6 — Alcance por algoritmo (D6)

| Grid key | Algoritmos válidos | Evidencia |
| --- | --- | --- |
| `particle_radius_config`, `kf_distribution` | sólo `tunable_cc` | `dpo_*`/`kf_*` sólo existen en esa rama del worker (`tasks.py:1672-1703`) |
| `sintering_config` | `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `tunable_cc` | Son las únicas ramas que pasan `sintering_coeff=` (`tasks.py:1608,1623,1636,1650,1665,1695`); `fracval`, `gcca` y `box_rfa` no pasan ninguno (`:1705,:1738,:1752`) |

Con cualquier otro algoritmo → 400, y el desplegable de "parámetro a variar" deja de ofrecer la
opción. Ofrecer un barrido que el engine no puede ejecutar es la misma mentira que este change
elimina.

**Alternativa descartada.** Mapear `particle_radius_config` a `radius_min`/`radius_max` para el
resto de algoritmos. Es defendible para el modo `uniform`, pero el modo `normal` no tiene ruta
de engine fuera de `tunable_cc` y quedaría una excepción muda. Si se quiere, es un change
aditivo posterior.

## DD7 — Casos límite con claves de distribución (D7)

**Decisión.** `generate_limiting_cases` (`utils.py:176-190`) **ignora** las claves de grid cuyos
valores no son escalares comparables al generar fronteras; el hijo de frontera usa el valor de
`base_parameters` para ese concepto.

**Por qué ignorar y no rechazar.** Una distribución no tiene "frontera" natural: ordenar dos
dicts no significa nada. Rechazar con 400 la combinación
`include_limiting_cases + distribución` castigaría un uso legítimo (barrer una distribución y
además querer los casos límite de los parámetros escalares). Ignorar es lo que ya hace
implícitamente el resto del generador para claves sin extremos teóricos.

**Por qué entra en este change.** No es un defecto preexistente que estemos adoptando: hoy esa
ruta es **inalcanzable** porque D1 devuelve 400 antes. Al arreglar D1 la abrimos nosotros, con
un `TypeError` no capturado → 500 en la creación del estudio. Verificado:
`TypeError: '<' not supported between instances of 'dict' and 'dict'`.

## DD8 — Nombrar lo que la cosa hace (D8)

**Decisión.** La opción de la UI deja de llamarse "Particle radius (polydispersity)" y pasa a
"Primary particle size (dpo)". R2 describe la semántica real: **barrido del tamaño de
partícula primaria entre hijos**, monodisperso dentro de cada agregado.

**Por qué.** `tunable_cc` muestrea un dpo por ejecución y fija `radius_min = radius_max`
(`tunable_cc.rs:1122-1129`, comentario literal `// monodisperse per run`; canónica
`cc-tunable-aggregation.md` R12). Llamar polidispersidad a eso es prometer algo que el engine
no hace — la clase exacta de mentira que DD6 condena.

**El nombre de la clave de API no cambia** (`particle_radius_config`): describe correctamente
lo que configura (el radio de partícula), y renombrarla ampliaría la superficie sin ganar
honestidad. Lo que miente es el paréntesis de la etiqueta.

**Polidispersidad real**: fuera de alcance por decisión de la persona, con change de
seguimiento. El único algoritmo que la implementa es FracVAL (lognormal, `geometric_std`,
`fracval.rs:108-121`), hoy no expuesto en batch.

## Riesgos

- **Cambio de comportamiento deliberado (D2, D5).** Un estudio batch que "funcionaba" con
  sinterizado silenciosamente desactivado ahora sinteriza o falla en validación. Es el
  objetivo, y se declara en Jira.
- **Estudios creados por clientes directos de la API.** Pueden contener la forma antigua y
  quedan no editables (revalidación en PUT/PATCH → 400). Fix-forward.
- **Actualización parcial.** `ParametricStudyViewSet` es un `ModelViewSet` (`views.py:1733`):
  en `PATCH` sin `base_algorithm`, la regla de DD6 se evalúa contra
  `self.instance.base_algorithm`; si no hay instancia ni campo, se rechaza. Especificado en
  R11.5.
- **Sin CI.** `.github/workflows/` está vacío; toda la verificación es local.
