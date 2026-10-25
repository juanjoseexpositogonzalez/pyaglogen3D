# Tasks: distribution-grid-mode

> Estado del contrato: **redactado; tres spec-reviews pasadas (5, 4 y 4 CRITICAL), reparadas;
> pendiente de una cuarta sobre el diff de la última reparación y de la aprobación de la
> persona**.
> El gate es una issue de GitHub con `status:approved`. **No se escribe código de producción
> hasta que exista.**
>
> Sustituye a `distribution-grid-wiring` (issue #136, AGLO-11), **refutado antes de
> implementarse**: elegía `distribution_type` creyendo que era la forma de la ruta single, y la
> tubería que llega al engine habla `mode`. Lo medido entonces está en el §10 del mapa
> `_explore-only/distribution-config-surface.md`.

## T0 — Fase 0, dos rondas

- [x] T0.1 Ronda 1, por API: `tests/diagnostics/fase0_distribution_grid_wiring.py`.
- [x] T0.2 **Ronda 2, contra el engine**: `tests/diagnostics/fase0_distribution_engine_truth.py`.
  La ronda 1 solo medía la API, y ahí se me coló una refutación falsa de D8.
- [x] T0.3 **La frontera del engine es plana**: `run_tunable_cc` recibe `kf_mode`, `kf_value`,
  `kf_mean`, `kf_std`, `kf_min`, `kf_max` y los `dpo_*`. Ningún diccionario.
- [x] T0.4 **Un `mode` declarado sí cambia la física**: `target_kf_used` pasa de 1.3000 a
  1.9000, y el prefactor de 1.2204 a 1.0435.
- [x] T0.5 **D8 confirmado con medición, no con lectura**: `dpo` uniforme 0.5–2.0 deja las 60
  partículas con radio idéntico (0.5008). Es variación por corrida, no polidispersidad.
- [x] T0.6 **`radius_max` se ignora** en `tunable_cc`: `radius_min=0.5, radius_max=2.0` →
  `dpo_used=0.5000`.
- [x] T0.7 **Las dos puertas no mapeadas funcionan hoy**, y una falla en silencio:
  `{mode:"lognormal"}` entra con 201 y el engine recibe `{}`.

## T1 — Spec-review (agente fresco, antes de pedir aprobación)

- [x] T1.1 R8 y R10 canónicos: **resuelto**, ambos entran como MODIFIED. R8.4 pasa de `type` a
  `mode`; R10 cambia la etiqueta y añade R10.7. Original: R8 y R10 canónicos: R8.4 documenta la grafía `type`. Con la convergencia a `mode`
  queda desalineado; entra como MODIFIED o se declara fuera con motivo.
- [x] T1.2 Títulos de escenario de los bloques MODIFIED **verbatim** contra los canónicos.
- [x] T1.3 **Resuelto**: R1 ya exige los dos nombres en el hijo, que es la dirección que R5.2 toma, así que no hace falta MODIFICAR R5. Original: R5.2 canónico exige hoy que el hijo guarde `kf_distribution = d1`. Comprobar que R1 y
  R13.3 no lo contradicen, y si lo hacen, modificar R5 explícitamente.
- [x] T1.3a **Releer cada bloque MODIFIED contra el canónico entero**, no solo los títulos de
  escenario: un MODIFIED reemplaza el requisito completo (ver L9).
- [ ] T1.6 Alinear el formulario batch con R2: hoy restringe `particle_radius_config` a `fixed` y
  `normal`, y la API acepta `uniform`.
- [ ] T1.4 R7 (compatibilidad): **declarar el carve-out de cada 400 nuevo** en la propia R7, como
  hizo #97. Un 400 no declarado contradice su promesa de comportamiento idéntico.
- [ ] T1.5 `openspec validate --strict` y `show --json --deltas-only`, con la salida al Log,
  **antes** del PR: archivar los vuelve irreproducibles.

## T2 — Backend: validar lo que hoy pasa en silencio (lo urgente)

- [ ] T2.1 400 en **todas** las superficies que enumera R13: las cuatro claves (dos de paridad y
  dos con nombre de engine) en `parameter_grid`, las cuatro en `base_parameters`, y las cuatro
  barridas por `theoretical_extremes`. Cubre `mode` desconocido, **rangos fuera de límite**
  (`value <= 0`, `std <= 0`, `min <= 0`, `max <= min`) y config que no es objeto.
- [ ] T2.1e **Alcance por algoritmo (R13.12)**: estas cuatro claves solo se aceptan para un
  algoritmo que las consuma —hoy solo `tunable_cc`—, en create **y** en update. Es el mismo D6
  que cerró #97 para el sinterizado con `check_algorithm_scope`, y hay que reutilizar ese
  precedente en vez de inventar otro.
- [ ] T2.1a Los rangos no son cosmética: `kf_value=-1`, `kf_mean=-1` y `kf uniform` invertido
  **revientan el worker** con `PanicException`, que deriva de `BaseException` y escapa al único `except
  Exception`. La simulación se queda en `RUNNING` para siempre.
- [ ] T2.1c **Precedencia**: cuando una clave de rejilla y `base_parameters` declaran la misma
  magnitud, gana la rejilla (R13.9), y lo mismo para el par `particle_radius_config` /
  `base_parameters.dpo_distribution`. Hoy **no** es así: `create_simulation` parte de
  `dict(base_parameters)` y el worker acaba leyendo el valor de base.
- [ ] T2.1d **Entregar, no solo validar**, las cuatro superficies que hoy se aceptan y se
  descartan: las dos claves de paridad en `base_parameters` y las dos barridas por
  `theoretical_extremes` (R13.10).
- [ ] T2.1b Alinear con `cc-tunable-aggregation` R11 y R12, que ya exigen esos rechazos para
  estas mismas entradas del engine. No se inventa regla nueva: se cumple la que hay.
- [ ] T2.2 Testigo de que el engine recibe los kwargs, con espía del binding (R13.1, R13.2).
- [ ] T2.3 Las claves de paridad aceptan `mode` y se traducen a `target_kf_distribution` /
  `dpo_distribution`. Ojo: **dos sitios expanden**, `create_simulation` y
  `expansion_preview._as_child`; si divergen, la validación previa valida una forma que la ruta
  real nunca escribe.
- [ ] T2.4 Los tres tests de expansión (`test_kf_distribution_passes_through`,
  `test_particle_radius_config_passes_through`, `test_all_four_keys_expand_correctly`) **se
  extienden, no se invierten**: lo que afirman —que el hijo conserva la clave de rejilla— es
  justo lo que R5.2 y R13.3 exigen que siga siendo verdad. Lo que cambia es la grafía (`mode`) y
  que además aparezca el nombre de engine. Ojo con el tercero: mezcla `kf_distribution`, que pasa
  a `mode`, con `sintering_config`, que sigue en `distribution_type`.

## T3 — Lo que se rompería sin que nadie se entere

- [ ] T3.1 Testigo del **valor**, no de la columna, en las **cuatro** vistas:
  `fractal_analysis_summary`, `export_csv`, `formatConfigLabel` y `varyingParams`. La cuarta se
  me había caído al reescribir el contrato, y el §5 del mapa sí la listaba.
- [ ] T3.2 La etiqueta de la interfaz deja de decir «polidispersidad»: es variación por
  ejecución (T0.5).
- [ ] ~~T3.3 `radius_max` deja de ofrecerse~~ **RETIRADA**: el formulario batch no lo ofrece, así
  que el testigo habría pasado antes del cambio. La medición (el engine lo ignora) vale para el
  formulario de simulación individual, declarado fuera de alcance.

## T4 — Verificación y cierre

- [ ] T4.1 Los cinco gates, con cada deriva explicada contra la base.
- [ ] T4.2 Verificación con el **engine real**, no solo con espía: un hijo con `kf` declarado
  produce `target_kf_used` distinto del 1.3 por defecto.
- [ ] T4.3 judgment-day (dos jueces ciegos, sobre el commit).
- [ ] T4.4 PR(s), merge, limpieza, archive y sincronización canónica; entrega en Jira y cierre
  manual de la issue.
- [ ] T4.5 **Cada PR de la cadena dice en su cuerpo qué parte de la delta todavía NO es cierta**,
  y el Log lo registra. Entre merges, `develop` sostiene un contrato que describe el estado
  final: `openspec validate --strict` seguirá pasando, porque comprueba la forma, no la verdad.

## Log

**L1 — El contrato anterior murió por una premisa que no medí.** Supuse que `distribution_type`
era «la forma de la ruta single» porque lo era del sinterizado. Una spec-review fresca lo tumbó
con dos líneas de código: `DistributionField` y `expand_distribution_kwargs` discriminan por
`mode`. Coste: redacción y revisión, cero código. Eso es exactamente lo que compra el gate.

**L2 — Medir por API no es medir.** La ronda 1 de Fase 0 solo tocaba la superficie REST, y la
afirmación falsa que se coló era sobre el engine. La ronda 2 corre el engine de verdad y mide
radios: `dpo` uniforme da 60 partículas con el mismo radio. Un contrato que toca una frontera
tiene que medir **en** esa frontera.

**L3 — Lo urgente se invirtió al medir.** Entré creyendo que el problema eran las dos rejillas
rotas; dan 400, que es visible. El problema de verdad es la puerta que **funciona a medias**:
acepta un `mode` que su traductor no entiende y corre con el valor por defecto sin decir nada.

**L4 — La segunda spec-review encontró cinco CRITICAL, y uno era mi propia duda.** Pregunté
expresamente si prometer en tareas el carve-out de R7 era un defecto del contrato que se
aprobaría. Lo era: una delta que contradice un requisito en vigor convierte la aprobación en la
aprobación de una promesa incumplida. Ahora R7 lleva su carve-out **dentro**, con los tres casos
que pasan de 201 a 400.

**L5 — «El único fallo silencioso vivo» era falso, y lo desmentía mi propio diagnóstico.** La
ronda 1 mide que un objeto desnudo barrido por `theoretical_extremes` guarda `'mode'` y
`'value'` **como valores**. Escribí «único» sin releer la evidencia que yo mismo había dejado
versionada dos días antes.

**L6 — Y la evidencia volvía a no correr, por tercera vez.** `python_files = ["test_*.py"]`:
el comando que publiqué en la issue y en el PR, `pytest tests/diagnostics/`, colectaba **cero**.
Los diagnósticos ahora se llaman `test_*.py`, los recoge la suite ordinaria (19) y sus
mediciones son **aserciones**, no prints: si `target_kf_used` deja de llegar o el panic deja de
ser `BaseException`, algo falla en rojo.

**L7 — Un bloque MODIFIED debe reproducir todos los escenarios del canónico.** La herramienta
rechaza omitir uno, así que el título falso de R1.2 («Scalar shorthand normalized to fixed», que
nunca fue cierto) **se hereda por obligación**. Queda una NOTA dentro del escenario para que la
contradicción sea visible en vez de silenciosa; renombrarlo necesita su propio change.

**L8 — El riesgo de la cadena: entre merges, la delta miente, y la herramienta no lo nota.** Con
tres PRs encadenados, `develop` sostiene desde el primero una delta que describe el estado final.
Tras el PR 1, R1 ya promete que `parameter_grid.kf_distribution` acepta `{mode: …}`, y aún no es
verdad; tras el PR 2, R10 todavía llama polidispersidad a lo que no lo es. `openspec validate
--strict` pasa en todos esos puntos porque valida **forma**, no **verdad**, y el archive —que es
donde la delta se vuelve canónica— ocurre solo al final.

No es hipotético: este contrato existe porque una canónica afirmaba algo que el código no hacía,
y el contrato anterior murió por creer a un documento antes que al código. Mitigación aceptada,
sin inventar herramienta nueva: **T4.5**, cada PR declara en su cuerpo qué parte de la delta
todavía no es cierta, y el Log lo registra. Es disciplina, no garantía; se dice para que la
siguiente persona sepa que lo es.

**L9 — Un bloque MODIFIED reemplaza el requisito ENTERO, y la herramienta solo compara nombres
de escenario.** Reparando el hallazgo anterior reescribí R7 y R10 «a mano», conservando los
títulos verbatim que el validador exige. Pasó el gate. Y habría **borrado prosa normativa viva**:
el R7 canónico tiene **ocho** menciones al carve-out del sinterizado que entregué hace dos días,
y mi bloque tenía **cero**; R10 habría perdido las etiquetas exactas, la regla de no enviar `NaN`
y el MUST de que la traducción viva en una función pura.

`openspec validate --strict` no lo caza: comprueba que no falte ningún *nombre* de escenario, no
que no falte el *texto*. La reparación correcta es reconstruir el bloque **desde el canónico** y
añadir encima, nunca reescribirlo de memoria. Lo encontró el juez al que le pedí expresamente
que buscara qué habían roto mis propios arreglos; en el contrato anterior, cuatro de cinco
CRITICAL los introdujeron mis correcciones, y éste iba por el mismo camino.

**L10 — Afirmé una retirada que no hice.** Taché T3.3 y anuncié en la issue que R13.4 quedaba
retirado; el escenario seguía en la delta. Tachar la tarea no borra el requisito.

**L11 — Y el cuerpo de la issue seguía citando un fichero renombrado.** Cuarta vez con la misma
lección, ahora en el artefacto que la persona aprueba. Corregir el comentario no corrige el
cuerpo: el gate apunta al cuerpo.

**L12 — Tercera revisión: cuatro CRITICAL, dos míos otra vez, y los dos por sobrecorregir L9.**
Reparando el borrado de prosa, extraje el bloque canónico de R7 **empezando en su segunda
línea**: desapareció la premisa «cuando la rejilla no incluye ninguna de las cuatro claves», y lo
que quedaba se puede leer al revés. Y en R10 restauré la etiqueta exacta
`"Particle radius (polydispersity)"` **en el mismo requisito donde prohíbo esa palabra**: dos
MUST opuestos sobre el mismo string.

La lección no es «ten más cuidado». Es que **una reparación es código nuevo y no viene revisada
por ser una reparación**. Tres rondas seguidas: 5 CRITICAL, 4 (dos míos), 4 (dos míos).

**L13 — La posición de la prosa decide si existe.** Un párrafo colocado después de un escenario
se absorbe en el `rawText` de ese escenario y **desaparece de `requirement.text`**: el carve-out
de distribuciones de R7 y la prohibición de etiqueta de R10 estaban escritos y eran invisibles
para `openspec show --json`, que es lo que lee el consumidor y lo que acaba en la canónica. Es la
misma familia que la regla 4 de AGENTS.md. La prosa normativa va **antes del primer escenario**,
y se comprueba con el parser, no con los ojos.

**L14 — Cuatro de doce superficies se aceptaban y se descartaban.** R13 decía «entregar o
rechazar» y solo había regla de entrega para las entradas de rejilla. Las dos claves de paridad
en `base_parameters` y las dos barridas quedaban aceptadas y perdidas, que es la familia exacta
que mató a los dos contratos anteriores.

**L15 — Cuarta revisión: dos CRITICAL, y son el defecto que yo mismo cerré hace dos días.** R13.10
prometía que una clave declarada llega al engine, **sin acotar por algoritmo**. Pero el worker
expande `target_kf_distribution` y `dpo_distribution` **solo dentro de su rama `tunable_cc`**, y
solo `run_tunable_cc` declara esos kwargs: para los otros **diez** algoritmos la clave se acepta, se
guarda y no la lee nadie. El serializer no menciona `tunable_cc` ni una vez.

Es **D6 otra vez** —ofrecer algo a algoritmos que no lo consumen—, el defecto que este mismo
repositorio cerró en #97 con `check_algorithm_scope`. Lo cerré para el sinterizado y no se me
ocurrió preguntarme si valía para las otras dos rejillas. **Haber arreglado una instancia de un
defecto no te vacuna contra su clase**: hay que ir a buscarla.

Peor: mi párrafo de exclusión atribuía ese fallo a la ruta de simulación individual, cuando los
hijos del batch corren por **el mismo** `run_simulation_task`. Declaré fuera de alcance algo que
estaba dentro.

**L16 — Quinta revisión: enumerar lo excluido es el error, no un descuido.** Escribí la
allow-list como lista de los ocho algoritmos rechazados. El modelo declara **once**, así que
`limiting` e `imported` se quedaron fuera **en silencio**, aceptando claves que nadie lee: la
misma D6 que esa misma reparación decía cerrar. Una lista de excluidos falla callando; una tabla
de permitidos falla gritando. Ahora es tabla.

**L17 — Y el MUST nuevo chocaba con otro vivo en mi propia delta.** R13 pasó a decir que el
formulario no debe ofrecer esas claves, mientras R10 —bloque MODIFIED de la misma delta— manda
añadirlas al desplegable. Dos MUST opuestos sobre la misma superficie, otra vez (L12). Cada
requisito gobierna lo suyo: R10 dice qué se ofrece, R13 qué se acepta, y R13 ya no invade.

**L18 — «20 passed» incluía once tests que no podían fallar.** El diagnóstico de API solo
imprimía: cero `assert`. Publicarlo como evidencia era contar como medición lo que era un
paseo. Cada caso que el contrato cita lleva ahora su estado esperado.

**L19 — `seed_type` es la tercera instancia de D6 y no la cierro aquí.** R10 lo ofrece a todo
algoritmo salvo `limiting`, y el worker solo lo lee en la rama `tunable_cc`. Es el mismo defecto
una fila más abajo del desplegable. Queda **declarado**, no callado: va al seguimiento #115, y
cerrarlo aquí sería estirar el contrato a mitad de revisión, que es lo que mató al anterior.
