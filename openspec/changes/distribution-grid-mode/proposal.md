# distribution-grid-mode

## Why

El contrato anterior de esta cadena (`distribution-grid-wiring`, issue #136) **se refutó antes de
implementarse**: elegía `distribution_type` como forma única creyendo que era la de la ruta
single, y la tubería que llega al engine habla `mode`. Este contrato parte de la medición, no de
aquella premisa.

Fase 0 ronda 2 midió **contra el engine**, que es donde se coló el error anterior
(`tests/diagnostics/fase0_distribution_engine_truth.py`):

| Lo que se envía | Qué pasa | Qué recibe el engine |
| --- | --- | --- |
| `parameter_grid.target_kf_distribution = [{mode:"fixed", value:1.8}]` | **201** | `kf_mode="fixed", kf_value=1.8` ✅ |
| Lo mismo con `{mode:"lognormal"}` | **201** | **`{}`** ⇒ corre con el 1.3 por defecto, en silencio |
| `base_parameters.target_kf_distribution` | **201** | funciona igual |
| `parameter_grid.kf_distribution` (la clave de paridad) | **400** con la forma de la interfaz; 201 con `distribution_type` pero **no lo lee nadie** |  — |

**Lo urgente no es lo que está roto a la vista, sino lo que funciona a medias.** Una rejilla que
devuelve 400 avisa. Una puerta que acepta `lognormal` y corre con el valor por defecto produce
ciencia incorrecta en silencio: es la misma familia que cerró `sintering-reaches-engine` (#97),
y **sigue viva**.

### La frontera del engine es plana, y eso ordena todo lo demás

`run_tunable_cc` no recibe ningún diccionario: recibe `kf_mode`, `kf_value`, `kf_mean`,
`kf_std`, `kf_min`, `kf_max` y los `dpo_*` equivalentes. El único traductor es
`expand_distribution_kwargs`, que discrimina por `mode` y **devuelve `{}` ante cualquier otra
grafía**. Por eso la forma del hijo importa: no por estética, sino porque una grafía que su
lector no entiende equivale a no haber pedido nada.

Decisión de la persona (2026-10-25): **convergemos hacia `mode`**, con la consecuencia dicha en
voz alta: el sinterizado entregado en #97 habla `distribution_type`, así que al cerrar este
contrato seguirán existiendo **dos** formas. Unificarlas es un tercer contrato, no éste.

### Y una etiqueta que miente, medida con el engine real

`particle_radius_config` se ofrece como «polidispersidad». No lo es: con `dpo` uniforme entre
0.5 y 2.0, **las 60 partículas de la corrida salen con el mismo radio** (0.5008). El engine
muestrea una vez por corrida y lo dice literal: `monodisperse per run`. Además `radius_max` **se
ignora** para `tunable_cc`: `radius_min=0.5, radius_max=2.0` da `dpo_used=0.5000`.

## What Changes

1. **Se valida la puerta que hoy funciona sin validar.** Un `mode` desconocido en
   `target_kf_distribution` o `dpo_distribution` —en rejilla, en `base_parameters` o barrido por
   `theoretical_extremes`— devuelve 400 en vez de correr con el valor por defecto. También el
   `uniform` invertido (`min >= max`), que hoy entra con 201 y **revienta el worker con un
   `PanicException` de Rust**: deriva de `BaseException`, así que escapa a los `except Exception`
   que envuelven el encolado.

   No es «el único fallo silencioso»: el mismo contrato deja fuera, **declarándolo**, la ruta de
   simulación individual, que acepta estas distribuciones para algoritmos cuyo worker nunca las
   lee (`dla`, `cca`, `fracval`, `gcca`, `box_rfa`). Es la misma familia y es real; ampliarlo
   hasta ahí es lo que mató al contrato anterior.
2. **Las claves de paridad aceptan la forma de la interfaz (`mode`) y se traducen** a los nombres
   que el worker lee, en el mismo sitio que ya traduce el resto de la expansión.
3. **El hijo guarda los DOS nombres**: la clave de rejilla, que leen **cuatro** vistas de
   resultados (`fractal_analysis_summary`, `export_csv`, `formatConfigLabel` y `varyingParams`),
   y el nombre que traduce el worker. Traducir es **añadir**, nunca sustituir: quitar la clave de
   rejilla vacía una columna en las cuatro. Un testigo que solo compruebe «conserva la columna»
   pasa con la columna vacía, así que el testigo comprueba **el valor**.
4. **R7 recibe su carve-out**, como hizo #97: cada 400 nuevo se declara, en vez de contradecir la
   promesa de comportamiento idéntico.
5. **La etiqueta deja de mentir**: R10 pasa a exigir «variación por ejecución del tamaño de
   partícula primaria», no «polidispersidad», porque es lo que el engine entrega.

### Fuera de alcance, dicho para que nadie lo asuma

- **Unificar `mode` y `distribution_type`** entre esta superficie y el sinterizado: tercer contrato.
- **Polidispersidad real por partícula** en `tunable_cc`: es trabajo de engine, no de cableado.
- **La puerta del asistente IA** (ORM directo, sin validación): `study-expansion-single-source`.
- **`radius_max` y `radius_min`**: el engine ignora `radius_max` en `tunable_cc`, y el formulario
  batch no ofrece ninguno de los dos. Pero el que sí tiene efecto es **`radius_min`**, y la API
  batch lo acepta: `parameter_grid = {radius_min: [-1]}` entra con **201** y el hijo corre con
  radio negativo (`dpo_used=-1.0`). Es la misma familia de fallo silencioso, sobre un escalar en
  vez de sobre una config de distribución, así que R13 —escrita para configs— no lo alcanza.
  **Queda fuera de alcance y dicho, no en silencio**: el silencio sobre superficies encontradas a
  mitad de camino es lo que mató a los dos contratos anteriores.
- **La ruta de simulación individual** con distribuciones declaradas para algoritmos que no las
  leen: misma familia, otra superficie, declarada arriba.
- **El `onError` de la página batch** (#115 punto 6): sigue sin dueño.
