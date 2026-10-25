# Tasks: distribution-grid-wiring

> Estado del contrato: **redactado, pendiente de spec-review y de aprobación de la persona**.
> El gate es una issue de GitHub con la etiqueta `status:approved`. **No se escribe código de
> producción hasta que exista.**
>
> Cadena: segundo de los tres contratos del mapa
> `openspec/changes/_explore-only/distribution-config-surface.md` §7.2. El primero
> (`sintering-reaches-engine`, issue #97) está entregado y archivado.
> Jira: AGLO pendiente de crear al aprobar (transición 21 → En curso).

## T0 — Fase 0 (hecha antes de redactar, no después)

- [x] T0.1 Sonda ejecutada contra el código de hoy: `backend/tests/_fase0_dgw_probe.py`.
- [x] T0.2 **Confirmado D1**: `{mode, …}` da 400 en `kf_distribution` y en
  `particle_radius_config`, y `DistributionSelector.tsx` sigue emitiendo esa forma.
- [x] T0.3 **Confirmado D3, y mejor planteado**: el worker lee `target_kf_distribution` y
  `radius_min`/`radius_max`; las dos claves de la rejilla batch no las lee nadie. La ruta single
  ya declara los nombres buenos como `DistributionField` y los traduce.
- [x] T0.4 **Refutado D7**: casos límite + dos dicts devuelve 201. Lo cerró `add_case` en
  `utils.py` (salta `Mapping`, captura `TypeError` en `sorted()`).
- [x] T0.5 **Refutado D8**: `tunable_cc` no es monodisperso por construcción; `random_radius`
  se usa por partícula y el engine declara `dpo_distribution` y `target_kf_distribution`.
- [x] T0.6 **Hallazgo nuevo**: la spec canónica R1/R2 es falsa en tres de cuatro escenarios
  medidos (`{type}` → 400, atajo escalar → 400, `{fixed, mean}` → 400). Sólo se cumple el cap
  `std/mean <= 0.3`.
- [ ] T0.7 Decidir qué pasa con la sonda: borrarla o convertirla en diagnóstico versionado.

## T1 — Spec-review (agente fresco, antes de pedir aprobación)

- [ ] T1.1 Revisar R8 y R10 canónicos: describen la interfaz y pueden estar contando la forma
  `{mode}` como correcta. Si mienten, entran como MODIFIED en la delta.
- [ ] T1.2 Verificar que los títulos de escenario de los bloques MODIFIED coinciden **verbatim**
  con los canónicos (regla 3 de OpenSpec).
- [ ] T1.3 `openspec validate distribution-grid-wiring --strict` y
  `openspec show distribution-grid-wiring --json --deltas-only`, **antes** del PR y antes del
  archive. Guardar la salida en el Log: archivar la vuelve irreproducible (lección de T8).

## T2 — Backend: una sola forma, y los nombres que el engine lee

- [ ] T2.1 Validación de las dos rejillas con la forma del dominio (`distribution_type`),
  reutilizando el validador compartido en vez de uno nuevo.
- [ ] T2.2 Traducción a `target_kf_distribution` y `dpo_distribution` en el único sitio que
  expande el estudio, con testigo de que el engine recibe el valor (R13.1, R13.2).
- [ ] T2.3 Ningún hijo guarda las claves de rejilla sin consumidor (R13.3), y el
  `parameter_grid` del estudio conserva su clave para la tabla.
- [ ] T2.4 Objeto desnudo en extremos teóricos: 400 en vez de guardar nombres de clave como
  valores (R13.4). Retira el `xfail(strict=True)` del punto 1 de #115.
- [ ] T2.5 Lista de tipos mezclados y `seed_type` inhashable: 400, nunca 500 (R13.5). Retira el
  `xfail` del punto 2 de #115 y cierra el punto 4.

## T3 — Frontend: la traducción vive en una función pura

- [ ] T3.1 Extender la traducción de T6 (`lib/sinteringShape.ts`) a las tres rejillas, o
  extraer la pieza común. Una sola función, no tres.
- [ ] T3.2 `DistributionGridInput` y `DistributionSelector` emiten `{distribution_type}`.
- [ ] T3.3 El campo vacío deja de coaccionarse a `0` (punto 11 de #115): omitir la clave, como
  ya hace el campo de sinterizado de `limiting`.

## T4 — Lo que rompería y nadie detecta

- [ ] T4.1 Testigo de que `BatchResultsTable` conserva su columna por clave de rejilla tras la
  traducción (hoy la pinta por `Object.keys(parameter_grid)`).
- [ ] T4.2 Testigo equivalente para `FractalAnalysisTab.formatConfigLabel`.
- [ ] T4.3 Decidir y **documentar en la interfaz** qué significa cada distribución: muestreo por
  partícula frente a por ejecución. Hoy la etiqueta «polidispersidad» no lo dice.

## T5 — Verificación y cierre

- [ ] T5.1 Los cinco gates, con cada deriva explicada contra la base.
- [ ] T5.2 Verificación con el **engine real**: un hijo con `kf_distribution` declarado produce
  geometría distinta a la del valor por defecto. Sin esto, R13 es una promesa sin testigo.
- [ ] T5.3 judgment-day (dos jueces ciegos, agentes frescos, sobre el commit).
- [ ] T5.4 PR, merge, limpieza, archive y sincronización canónica; comentario de entrega en Jira
  y cierre manual de la issue de GitHub.

## Log

**L1 — Fase 0 primero, y ha servido.** AGENTS.md lo exige desde la lección del ciclo 3, y en
este contrato ha cambiado el alcance antes de escribirlo: dos defectos del mapa (D7, D8) estaban
muertos o mal enunciados, y el que de verdad gobierna —que batch escribe claves que ningún
consumidor lee— no estaba planteado así en ninguna parte. El mapa tenía cuatro días y el
contrato anterior le movió el suelo.

**L2 — La spec canónica es la tercera fuente de desacuerdo, no el árbitro.** R1 documenta
`{type}`, un atajo escalar y la clave `mean`; las tres cosas dan 400. Medido, no leído. Un
contrato que se hubiera escrito «contra la spec» habría pedido que el código volviera a una
forma que nunca existió.
