# Mapa de superficie: configuraciones de distribución en estudios batch

> SDD phase: EXPLORE (consolidado)
> Fecha: 2026-10-21
> Base: `develop` @ `8423c4f`
> Estado: **mapa cerrado** — alimenta tres contratos encadenados (§7)
>
> **Procedencia.** Este documento consolida la exploración inicial y **cuatro rondas de
> spec-review por agentes frescos** sobre el contrato `distribution-config-wiring`, retirado
> por esta misma razón: cada ronda descubría superficie nueva en vez de refinar la conocida.
> El contrato creció de 3 defectos / 1 capability / 1 puerta de entrada a 9 / 2 / 2 más tres
> superficies de entrada. La conclusión no fue "otra corrección" sino "el mapa estaba mal".
>
> Todo lo que sigue está verificado con probe ejecutada, grep sobre el repositorio o lectura
> del código anclada. Las afirmaciones no verificadas se marcan como tales.

---

## 1. Qué se estaba buscando

El usuario reportó que el formulario de batch tenía "dos sitios que definen polidispersidad".
La intuición era correcta, pero lo que hay debajo no es un control duplicado: es una familia de
costuras rotas entre la UI, la API, el worker y el engine.

---

## 2. Los nueve defectos

| # | Defecto | Evidencia |
| --- | --- | --- |
| **D1** | La UI batch emite `{mode}`; el validador de grid exige `{distribution_type}` → `kf_distribution` y `particle_radius_config` dan **400 siempre** | probe: `400 'distribution_type is required in distribution config.'` |
| **D2** | `sintering_config` con esa forma **se acepta** y `apply_sintering_config` cae a `fixed/1.0` | probe: `{mode:'normal',mean:0.8,std:0.05}` → `{'sintering_type':'fixed','sintering_coeff':1.0}` |
| **D3** | `particle_radius_config` / `kf_distribution` no los lee nadie en el worker | `grep particle_radius_config backend/apps/simulations/tasks.py` → 0 |
| **D4** | En el formulario single, el toggle `Polydisperse` está muerto para `tunable_cc` | `SimulationForm.tsx:716-718`; engine `tunable_cc.rs:1121-1128` |
| **D5** | `apply_sintering_config` escribe `sintering_mean` (`utils.py:268`), que **ningún consumidor de producción lee**; el engine toma `sintering_coeff` como media (`lib.rs:602`) | `grep -rn sintering_mean backend frontend aglogen_core` → 2: la escritura y una aserción de test (`tests/test_utils.py:316`) |
| **D6** | La UI ofrece barrido de sinterizado para `fracval`, `gcca` y `box_rfa`, cuyas llamadas al engine no reciben ningún kwarg de sinterizado | `tasks.py:1729,1740,1781` sin `sintering_coeff=` |
| **D7** | Casos límite + entradas dict → `sorted()` sobre dicts. **Ya alcanzable hoy** por cliente de API con la forma `{distribution_type}` | probe: validación pasa; `TypeError: '<' not supported between instances of 'dict' and 'dict'` |
| **D8** | `particle_radius_config` se ofrece como "polidispersidad", pero `tunable_cc` es **monodisperso por construcción** | `tunable_cc.rs:1121-1128`, literal `// monodisperse per run`; canónica `cc-tunable-aggregation` R12 |
| **D9** | La herramienta del asistente IA crea estudios e hijos **directamente por ORM**: sin validación, sin traducción, sin `apply_sintering_config`, sin el pop de `seed_type` | `ai_assistant/tools/study_tools.py:144,166`; registrada en `tools/registration.py:45,87` |

---

## 3. Superficies de entrada del sinterizado — **tres**, no una

Este es el hallazgo que más tarde apareció y el que invalidó el contrato único.

| Superficie | Validada hoy | Consumida en |
| --- | --- | --- |
| `parameter_grid.sintering_config` | sí, laxamente (acepta `{}`, claves desconocidas, campos ausentes) | `views.py:1804` |
| `ParametricStudy.sintering_config` (campo de modelo) | sí, el mismo validador laxo | `views.py:1806` |
| **`base_parameters.sintering_config`** | **no, en absoluto** | `views.py:1804` (llega por `sim_params = dict(base_parameters) | combo`) |

Probe: un estudio con `base_parameters = {"sintering_config": {"distribution_type": "fixed"}}`
**valida hoy** y produce `sintering_coeff = 1.0` en silencio.

**Consecuencia para cualquier contrato futuro:** endurecer `apply_sintering_config` para que
lance sin validar antes las tres superficies convierte un fallo silencioso en un **500 con
estudio a medio crear**: `perform_create` (`views.py:1750`) no tiene `try/except`, el proyecto
no define `ATOMIC_REQUESTS` y los hijos ya se han encolado cuando el helper lanzaría.

---

## 4. Puertas de entrada que crean estudios — **dos**

| Puerta | Validación | Traducción | `seed_type` → campo |
| --- | --- | --- | --- |
| API REST: `ParametricStudyViewSet.perform_create` → `create_simulation` (`views.py:1784`) | `ParametricStudySerializer.validate()` | no (D3) | sí |
| Asistente IA: `create_parametric_study_handler` (`study_tools.py:54`, ORM en `:144,166`) | **ninguna** | **ninguna** | **no** |

Barrido exhaustivo de `Simulation.objects.create` / `ParametricStudy.objects.create`:
`views.py:1826,1889`, `study_tools.py:144,166`, `simulation_tools.py:55` (sim individual,
escalares planos, sin claves de distribución — no afectada).

**Precedente del propio repo:** `study_tools.py:101-114` ya enruta `box_counting_params` por el
validador compartido de la API tras el hallazgo JD-A-006, *"so a tool call cannot persist junk
— or a non-dict (JD-B-007) — straight to the ORM"*. Es el mismo problema con otras claves.

---

## 5. Consumidores de las claves de grid (romperlas tiene efectos visibles)

Traducir `particle_radius_config → dpo_distribution` y dejar de persistir la clave de grid
**rompe la tabla de resultados**, y ninguna prueba lo detecta:

- `BatchResultsTable.tsx:97,207-211,237-240` — pinta una columna por
  `Object.keys(parameter_grid)` y la rellena con `result.parameters[param] ?? '-'`.
- `FractalAnalysisTab.tsx:107-110,163-166` — `formatConfigLabel` hace `${k}=${v}` sobre
  `result.parameters[k]`.
- `views.py:2267-2271` — el CSV escribe `Sintering_Type`/`Sintering_Coeff` desde
  `sim.parameters`; hoy imprime `1.0` en estudios `normal` por culpa de D5.

---

## 6. Capabilities canónicas implicadas — **dos**

| Capability | Relación | Anclas |
| --- | --- | --- |
| `batch-cc-tunable-parameter-parity` | R1, R2, R3, **R5.2**, R10 contradicen lo que exige arreglar D1/D3/D6/D8 | `openspec/specs/batch-cc-tunable-parameter-parity.md` |
| `cc-tunable-aggregation` | **R17** (`:869`) dice literalmente *"The batch path (`create_simulation()` in `views.py:1761-1802`) MUST also apply this routing"*. Cualquier extracción de ese helper la toca. **R12** (`:573-590`) fija el muestreo monodisperso por ejecución que desmiente D8 | `openspec/specs/cc-tunable-aggregation.md` |

**Vocabulario:** tres deletreos del discriminador repartidos en cinco sitios — `mode`
(frontend `types.ts:90`, worker `tasks.py:33`, API single `fields.py:24`),
`distribution_type` (validación de grid `distribution_validation.py:49`) y `type` (spec
canónica R1/R2, que **no implementa nadie**).

**Semántica real del sinterizado:** la convención de escalares planos del worker es que
`sintering_coeff` **hace de media** cuando `sintering_type == "normal"` (`lib.rs:602`). El
conjunto exacto que el worker lee es
`{sintering_type, sintering_coeff, sintering_min, sintering_max, sintering_std}`
(`tasks.py:1592-1598`).

**Alcance real por algoritmo** (verificado rama a rama, los once del modelo):

| Clave | Algoritmos que la consumen |
| --- | --- |
| `dpo_*`, `kf_*` | sólo `tunable_cc` (`tasks.py:1680-1703`) |
| sinterizado completo | `dla`, `cca`, `ballistic`, `ballistic_cc`, `tunable`, `tunable_cc` (`:1608,1623,1636,1650,1665,1695`) |
| sinterizado sólo `fixed` | `limiting` (`:1800`, ignora type/min/max/std) |
| ninguno | `fracval` (`:1729`), `gcca` (`:1740`), `box_rfa` (`:1781`), `imported` (sin rama) |

---

## 7. Troceado propuesto (decisión de la persona, 2026-10-21)

Tres contratos encadenados, cada uno revisable por sí solo:

### 7.1 `sintering-reaches-engine` — primero

D2 + D5 + la tercera superficie (`base_parameters`). **Es el único que hoy produce ciencia
incorrecta en silencio**: el usuario pide sinterizado y obtiene "sin sinterizado" sin error.

Incluye: regla única de validación para las tres superficies; `sintering_coeff` como media;
contrato de fallo de la expansión (validar antes, o envolver para que no quede un estudio a
medias); alcance por algoritmo del sinterizado (D6); escenario de borde de engine.

### 7.2 `distribution-grid-wiring` — después

D1 + D3 + D8 + los consumidores de UI del §5, **sólo en la ruta REST**. Toca
`batch-cc-tunable-parameter-parity` R1, R2, R5.2, R10 con restatements completos.

### 7.3 `study-expansion-single-source` — último

D9 + la canónica R17. Extrae la expansión a un sitio único que sirva a las dos puertas.
Va al final porque necesita que 7.1 y 7.2 hayan fijado ya la regla que se comparte.

### Seguimiento, fuera de los tres

- `polydispersity-single-source`: D4 y las asimetrías gemelas del formulario single
  (`SimulationSerializer` acepta `dpo_distribution` para cualquier algoritmo;
  `SimulationForm.tsx:688-695` envía `sintering_*` también para `fracval`/`gcca`/`box_rfa`).
- Polidispersidad real en batch: el único algoritmo que la implementa es **FracVAL**
  (lognormal, `fracval.rs:108-121`), hoy no expuesto en batch.
- D7 (casos límite + dicts): defecto preexistente alcanzable por API. Puede ir con 7.2 o como
  carril corto propio.
- `DistributionSelector.tsx` se instancia **cuatro** veces con bases distintas (dpo `1.0`,
  `target_kf` `1.3`, y las tres claves de batch vía `DistributionGridInput`): su default de
  `uniform` emite `min == max`, inválido para `fields.py:59`. Cualquier arreglo debe respetar
  a la vez `max > min` y, cuando alimenta sinterizado, `[0.5, 1.0]`.

---

## 8. Condiciones de entorno

- **El repo no tiene CI**: `.github/workflows/` existe y está vacío; `gh pr checks` responde
  "no checks reported". Toda verificación es local.
- **Línea base roja preexistente del backend**: `15 failed, 31 errors, 1221 passed`. Los 31
  errores son de *setup de fixtures* (`TypeError: User() got unexpected keyword arguments:
  'username'`, `apps/accounts/models.py:26`), no de colección.
- Frontend: `55 ficheros, 597 tests` en verde. `npm run lint` existe (`next lint`) pero el repo
  no tiene configuración de ESLint, así que lanza el asistente interactivo.
- Módulos que cubren esta superficie (154 tests en verde):
  `apps/simulations/tests/{test_distribution_validation,test_parametric_study_serializer,test_grid_expansion,test_distribution_field,test_distribution_plumbing,test_distribution_serializer}.py`,
  `tests/{test_utils,test_serializers}.py`,
  `tests/integration/test_parametric_values_pipeline.py`.

---

## 9. Lección de proceso

Cuatro rondas de spec-review encontraron, en este orden: refinamientos (r1, r2), una segunda
puerta de entrada (r3), y una tercera superficie de entrada más una segunda capability
canónica más un consumidor de UI (r4). **Un contrato cuyo número de hallazgos deja de bajar y
cuyos hallazgos cambian de "errata" a "superficie nueva" no necesita otra corrección: necesita
otro mapa.** Este documento es ese mapa.
