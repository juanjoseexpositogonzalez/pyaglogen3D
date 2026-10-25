# Tasks: distribution-grid-mode

> Estado del contrato: **redactado, pendiente de spec-review y de aprobación de la persona**.
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

- [ ] T1.1 R8 y R10 canónicos: R8.4 documenta la grafía `type`. Con la convergencia a `mode`
  queda desalineado; entra como MODIFIED o se declara fuera con motivo.
- [ ] T1.2 Títulos de escenario de los bloques MODIFIED **verbatim** contra los canónicos.
- [ ] T1.3 R5.2 canónico exige hoy que el hijo guarde `kf_distribution = d1`. Comprobar que R1 y
  R13.3 no lo contradicen, y si lo hacen, modificar R5 explícitamente.
- [ ] T1.4 R7 (compatibilidad): **declarar el carve-out de cada 400 nuevo** en la propia R7, como
  hizo #97. Un 400 no declarado contradice su promesa de comportamiento idéntico.
- [ ] T1.5 `openspec validate --strict` y `show --json --deltas-only`, con la salida al Log,
  **antes** del PR: archivar los vuelve irreproducibles.

## T2 — Backend: validar lo que hoy pasa en silencio (lo urgente)

- [ ] T2.1 `mode` desconocido → 400 en las cuatro superficies de R13 (dos rejillas con nombre de
  engine y las mismas dos en `base_parameters`).
- [ ] T2.2 Testigo de que el engine recibe los kwargs, con espía del binding (R13.1, R13.2).
- [ ] T2.3 Las claves de paridad aceptan `mode` y se traducen a `target_kf_distribution` /
  `dpo_distribution`. Ojo: **dos sitios expanden**, `create_simulation` y
  `expansion_preview._as_child`; si divergen, la validación previa valida una forma que la ruta
  real nunca escribe.
- [ ] T2.4 Los tres tests de expansión que hoy afirman lo contrario
  (`test_kf_distribution_passes_through`, `test_particle_radius_config_passes_through`,
  `test_all_four_keys_expand_correctly`) se invierten **a conciencia**, con su motivo en el Log.

## T3 — Lo que se rompería sin que nadie se entere

- [ ] T3.1 Testigo del **valor**, no de la columna: `fractal_analysis_summary`, `export_csv` y
  `formatConfigLabel` leen `sim.parameters[clave de rejilla]`. Un testigo de «conserva la
  columna» pasa con la columna vacía.
- [ ] T3.2 La etiqueta de la interfaz deja de decir «polidispersidad»: es variación por
  ejecución (T0.5).
- [ ] T3.3 `radius_max` deja de ofrecerse para `tunable_cc` (T0.6, R13.4).

## T4 — Verificación y cierre

- [ ] T4.1 Los cinco gates, con cada deriva explicada contra la base.
- [ ] T4.2 Verificación con el **engine real**, no solo con espía: un hijo con `kf` declarado
  produce `target_kf_used` distinto del 1.3 por defecto.
- [ ] T4.3 judgment-day (dos jueces ciegos, sobre el commit).
- [ ] T4.4 PR(s), merge, limpieza, archive y sincronización canónica; entrega en Jira y cierre
  manual de la issue.

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
