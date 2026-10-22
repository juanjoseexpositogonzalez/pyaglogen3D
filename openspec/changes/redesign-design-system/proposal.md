# Proposal: redesign-design-system

> SDD change (política AGENTS.md). **Primero de los cuatro contratos encadenados** que portan
> el rediseño de Base44 (`docs/design/base44-redesign-prompt.md` y sus tres auditorías) al
> `frontend/` real.

## Why

La interfaz de pyAgloGen3D es hoy una plantilla oscura genérica de shadcn/ui: un único bloque
de tokens en `globals.css` con valores dark, sin tema claro, sin sistema tipográfico y sin
primitivas propias. Este change **instala los cimientos** —tokens, temas, escala tipográfica,
kit de componentes y tema de gráficas— y **sustituye el chrome de navegación**.

No reescribe ninguna pantalla. Esa es la razón de que sea el primero de la cadena: es la única
ola cuya superficie no solapa con ningún otro trabajo vivo en el repo.

## La cadena, y por qué se parte

El rediseño toca las doce pantallas del producto. Un solo change sería un PR irrevisable, así
que se parte en cuatro, **ordenados por solape de superficie, no por valor**:

| Ola | Change | Superficie | Estado |
| --- | --- | --- | --- |
| 1 | `redesign-design-system` | `globals.css`, `tailwind.config.ts`, `components/kit/*`, `components/shell/*`, `app/layout.tsx`, tema Plotly | **este contrato** |
| 2 | `redesign-read-surfaces` | Dashboard, Projects, Project detail, Compare, FRAKTAL single y batch | pendiente |
| 3 | `redesign-simulation-detail` | Simulation detail y sus seis pestañas | pendiente |
| 4 | `redesign-forms` | `SimulationForm.tsx`, `BatchSimulationForm.tsx`, `DistributionSelector.tsx` | **bloqueada por fichero**, ver abajo |

### Cambio de política a mitad de cadena (2026-10-22)

La persona ha decidido que **este change se termina bajo OpenSpec y AGENTS.md tal como están
hoy**, y que las olas 2, 3, 4a y 4b se tramitan ya con la política nueva (issue-first con
`status:approved` como gate, Jira AGLO, PRs bajo 400 líneas, revisión adversarial antes del
merge).

Dos consecuencias que este contrato debe dejar atadas, porque es el último artefacto OpenSpec
de la cadena y lo que no quede escrito aquí se pierde en la transición:

1. **La reserva de superficie por fichero sobrevive al cambio de sistema.** No es una cláusula
   de OpenSpec: es un acuerdo entre dos líneas de trabajo sobre tres ficheros concretos. El
   issue de cada ola posterior debe reproducirla en su cuerpo, con su tabla y su protocolo de
   liberación por aviso explícito. Si se pierde, se pierde la protección que impide que un
   rediseño se lleve por delante la corrección del sinterizado.
2. **La condición de la ola 4a sobre D4 viaja igual**: retirar el texto que promete
   `"Particle sizes will vary from X to Y nm"` y deshabilitar el control para `tunable_cc` con
   un callout, sin tocar cálculo.

Las olas 2-4 **no serán changes de OpenSpec**, así que las referencias de abajo a
`redesign-read-surfaces`, `redesign-simulation-detail` y `redesign-forms` nombran unidades de
trabajo, no directorios de `openspec/changes/`.

### Reserva de superficie — obligatoria, y **por fichero**

Un port reescribe el markup entero de un fichero. Mezclar eso con una corrección semántica en
el mismo fichero produce el peor merge posible: o conflicto en casi cada hunk, o —peor— un
merge limpio que se lleva por delante la corrección. `sintering-reaches-engine` corrige un
defecto que hoy hace que un estudio batch con sinterizado *se acepte y se ejecute sin
sinterizado, sin un solo error*: perder ese arreglo en un merge sería devolver al producto
exactamente la clase de fallo que ese change existe para cerrar.

**La condición de liberación no es un hito, son tres, y van por fichero.** Anclarla a un solo
archive desbloquearía antes de tiempo:

| Fichero | Reservado por | Se libera cuando |
| --- | --- | --- |
| `BatchSimulationForm.tsx` | `sintering-reaches-engine` (T6.1–T6.5) **y de nuevo** `distribution-grid-wiring` (desplegable de parámetros, claves de distribución) | archivado **el segundo**, no el primero |
| `DistributionSelector.tsx` | `distribution-grid-wiring` (planificado en `openspec/changes/_explore-only/distribution-config-surface.md` §7.2; **aún no redactado como change**) únicamente — `sintering-reaches-engine` T6.6 lo declara intacto a propósito | archivado `distribution-grid-wiring` |
| `SimulationForm.tsx` | **nadie** — `polydispersity-single-source` queda aparcado por decisión de la persona (2026-10-22) | **libre ya** |

**Protocolo de liberación.** Cada fichero se libera por **aviso explícito de la sesión dueña**,
no por inferencia desde un archive. Quien implemente la ola 4 no deduce la disponibilidad del
estado de `openspec/changes/archive/`: espera el aviso, y lo registra en el Log de la ola 4 con
fecha y change de origen.

**Decisión tomada (2026-10-22): `polydispersity-single-source` queda aparcado.**
`SimulationForm.tsx` no lo reserva nadie, así que la ola 4 se parte en dos:

- **4a** — `SimulationForm.tsx`. Puede empezar en cuanto la ola 3 esté integrada.
- **4b** — `BatchSimulationForm.tsx` y `DistributionSelector.tsx`, al liberarse cada uno.

**Condición que el aparcado impone a la ola 4a, y que no es negociable.** El port no puede ser
neutral sobre D4: al reescribir esa pantalla, o arrastra el toggle muerto al código nuevo, o
toca comportamiento. Verificado en el código:

- `SimulationForm.tsx:716-718` sobrescribe `radius_min` y `radius_max` con el mismo valor
  cuando `dpoDistribution.mode === 'fixed'`, que es el defecto;
- `simulation/tunable_cc.rs:1121-1128` muestrea **un** dpo por corrida y fuerza
  `radius_min == radius_max`, con la nota explícita del propio engine en `:2621`;
- y el texto de `:1011-1012` sigue prometiendo *"Particle sizes will vary from X to Y nm"*.

La ola 4a **debe** retirar ese texto y deshabilitar el control para `tunable_cc` con un callout
que explique por qué, cumpliendo la regla "un concepto, un control". Es cambio de texto y de
estado habilitado, no de cálculo.

El arreglo de fondo —si `tunable_cc` debe soportar polidispersidad real— toca el engine Rust,
necesita su propia Fase 0 y va como change independiente cuando se retome. El toggle sí
funciona para `dla`, `cca`, `ballistic`, `ballistic_cc` y `tunable`, así que no se borra.

**La reserva es parte del contrato, no un acuerdo verbal entre sesiones.**

## What Changes

### Dentro

1. **Tokens de diseño** en `globals.css`: superficies, tinta, acentos, semánticos, líneas,
   sombras, radio, canvas de visualización, rampa de series de datos. Tema claro por defecto y
   tema oscuro bajo `[data-theme="dark"]`.
2. **`tailwind.config.ts`** reescrito contra esos tokens, incluida la fuente mono para cifras.
3. **Kit de primitivas** en `components/kit/`: `MetricCard`, `Panel`, `VisualPanel`,
   `DataTable`, `StatusChip`, `QualityBadge`, `SegmentedControl`, `FilterBar`,
   `DisclosurePanel`, `DetailsDrawer`, `DetailList`, `Callout`, `EmptyState`, `PageHeader`,
   `ShowValues`, `Num`, `CopyText`.
4. **Tema de gráficas Plotly** en `lib/chart-theme.ts`: rampa de series, patrones de línea,
   formas de marcador, rejilla, ejes y tooltip.
5. **Shell**: `components/shell/{AppShell,Sidebar,TopBar}.tsx`, montado en `app/layout.tsx`.
6. **Conmutador de tema** con persistencia y respeto de `prefers-color-scheme` en la primera
   visita.

### Fuera

- Cualquier reescritura de pantalla (olas 2–4).
- Los tres ficheros reservados de la ola 4.
- `components/ui/*` (shadcn). El kit convive con él; la retirada de shadcn, si llega, es un
  change posterior.
- Backend, engine, specs canónicas de capacidades funcionales.

## Qué cambia de forma visible, y por qué se enuncia

Tres consecuencias son cambios de comportamiento observable, no cosmética, y por eso este
trabajo es un change y no carril corto:

1. **La aplicación pasa a ser clara por defecto.** Hoy `<html className="dark">` está fijo en
   `app/layout.tsx` y no hay alternativa. Un usuario acostumbrado al fondo oscuro verá otra
   cosa al recargar.
2. **Desaparece el fondo de imagen.** `body.app-background` pinta hoy `/pyAgloGen3DBNG.png`
   bajo toda la interfaz. El canvas del sistema nuevo lo sustituye.
3. **Cambia la estructura de navegación.** La barra superior (`components/layout/Header.tsx`,
   importada por 17 páginas y un fichero de test) se sustituye por un sidebar fijo con
   navegación agrupada y contextual al proyecto. Las páginas públicas (`/` y `/auth/*`)
   quedan fuera del shell; `app/auth/layout.tsx` se re-expresa en tokens porque hoy fija
   `text-white` sobre lo que pasará a ser un fondo claro.

## Qué NO cambia, y las tres fronteras canónicas que sí hay que respetar

- Ninguna ruta, ningún endpoint, ningún cálculo, ninguna tolerancia numérica.
- `viewer3d-state`, `hemisphere-grid-viz` y el resto de specs canónicas siguen cumpliéndose
  tal cual. Ninguna se declara MODIFIED.

Tres de ellas imponen una frontera que este contrato acata en vez de invadir, y que la
spec-review identificó como lo que habría roto la entrega:

| Spec canónica | Lo que fija | Cómo lo acata este change |
| --- | --- | --- |
| `contacts-graph-viz.md:98,104` | La paleta de coordinación verbatim (`0→#9ca3af`, …), con tests que lo afirman | La regla de "sin literales de color" se acota a los ficheros **creados** por esta ola; `graphUtils.ts` no se toca (D1) |
| `contacts-graph-viz.md:252` | El canvas del grafo sigue *"the app's current theme"* | Hoy se cumple por accidente, leyendo `prefers-color-scheme`. T6.4 repara `NetworkCanvas` para que lea `data-theme`, porque esta ola es la que introduce la divergencia (D10) |
| `multi-aggregate-comparison.md:128-136`, S5.3 | Cada serie de Rg lleva **el color de su simulación**, el mismo del borde del viewer | R4 exime del color a las series atadas por otro contrato: patrón y marcador sí aplican, el color no |

Y una frontera que obligó a retirar un requisito: `rg-unit-contract.md:185-213` dice que el
aviso de convención de unidades aparece **solo** para `parameters_schema_version` `null` o
`"v1"`, y su escenario afirma literalmente *"the banner is not shown"* para v2. La primera
versión de este contrato exigía el aviso en *any page*, lo que lo habría incumplido palabra
por palabra. **Retirado de la ola 1**: el componente lo renderizan páginas, y las páginas son
de las olas 2 y 3.

Queda una nota a favor: `contacts-graph-viz` ya exige que la paleta sea *"readable in both
light and dark modes"*, un requisito que la aplicación no podía ejercitar porque no existía el
modo claro. Este change lo hace ejercitable por primera vez.

## Una corrección de premisa, antes de que cueste cara

El prototipo de Base44 usa **recharts**. El producto usa **Plotly** (`plotly.js` 2.28 +
`react-plotly.js`), además de `@react-three/fiber` para el viewer y `vis-network` para el grafo
de topología.

**Es portable el diseño, no el código de gráficas.** Las series, los patrones de línea y las
formas de marcador del prototipo hay que reexpresarlos como tema de Plotly; copiar los
componentes de recharts añadiría una segunda librería de gráficas al bundle y dos fuentes de
verdad para la misma rampa. Por eso T4 existe como tarea propia y no como un detalle de T3.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Un PR enorme pese a la partición | La ola 1 sale en **dos PRs encadenados**, ver abajo. Separar commits no protege al revisor: sigue recibiendo el total de golpe |
| Rechazo del tema claro por costumbre | El conmutador recuerda la elección; el tema oscuro queda a un clic |
| Deriva entre tokens CSS y `tailwind.config.ts` | `design-system-foundation` R1: Tailwind **deriva** de los tokens, nunca los repite |
| Deriva entre tokens CSS y tema Plotly | `design-system-foundation` R5: el tema lee las variables del documento y se re-lee al cambiar de tema |
| Las 38 variantes `dark:` existentes siguen al sistema operativo | `design-system-foundation` R2 exige anclar `darkMode` a `[data-theme="dark"]`. Sin eso, elegir "Light" con un sistema oscuro produce componentes mixtos |
| Solape con la cadena de `distribution-config-surface` | Reserva por fichero con liberación por aviso explícito + shell montado en `layout.tsx`, de modo que la ola 1 no edita ninguna página |
| Desbloquear la ola 4 antes de tiempo | La liberación no se infiere de un archive; se espera aviso de la sesión dueña y se registra en el Log |

## La ola 1 sale en dos PRs

La estimación de la spec-review sitúa la ola 1 en **~5.000 líneas**, dominadas por los tests
(la media real del repo es de 208 líneas por fichero de test). El repo tiene una skill propia
cuyo disparador son los PRs de más de 400 líneas; 5.000 no es revisable.

Aquí solo se enuncia qué deja cada PR en `develop`, que es lo que decide si puede ir solo.

| PR | Estimación | Qué deja en `develop` |
| --- | --- | --- |
| **1a — Fundación** | ~1.000 | Una aplicación **en tema claro, sin conmutador y sin shell** |
| **1b — Kit, shell y tema** | ~4.000 | El rediseño de chrome completo. Si sigue siendo grande al llegar, T3 (el kit) sale como tercer PR: no tiene consumidores hasta la ola 2 |

**El reparto de tareas no se enumera aquí**: vive en la tabla de cabecera de `tasks.md` y en
ningún otro sitio. Dos listas de tareas en dos documentos ya divergieron una vez.

**1a no es invisible, y decirlo sería falso.** Los 20 tokens de `globals.css:7-26` los consume
toda la interfaz actual a través de `tailwind.config.ts` (`bg-background`, `text-foreground`,
`bg-card/80` en `Header.tsx:43`), y T1.2 retira `body.app-background`, que usa
`app/layout.tsx:20`. Entre 1a y 1b hay un estado entregado y visible para el usuario.

De ahí dos consecuencias que el contrato acata:

1. **T2.2 se entrega en 1a** (enmienda del 2026-10-22, autorizada por la persona; el contrato
   aprobado la situaba en 1b). Dejar `darkMode` sin declarar hace que resuelva a `media`, con lo
   que las 38 variantes `dark:` se activan por el sistema operativo y pintan superficies oscuras
   sobre el lienzo claro. Anclarlo las deja inertes hasta T6.1. Entre roto y dormido, dormido.
2. **1a tiene su propia puerta de verificación**: T7.1, T7.2, T7.3, T7.6, T7.7 y la regresión
   visual T7.8. Un PR que reescribe los tokens de toda la interfaz no puede mergearse sin
   verificar.

Y una tarea que existe precisamente porque "no editar páginas" no es lo mismo que "no
afectarlas": **T7.8** recorre a mano las doce pantallas existentes bajo el shell y el tema
nuevo. El sidebar les quita ancho útil y los tokens les cambian el fondo; `multi-aggregate-comparison.md:45`
fija la rejilla de viewers por N y nadie más comprobaría que siga siendo usable.

## Evidencia de entrada

- `docs/design/base44-redesign-prompt.md` — brief original (ya en `develop`).
- `docs/design/base44-design-delta.md` — primera auditoría: 4 funcionalidades ausentes,
  3 colisiones de color.
- `docs/design/base44-design-delta-2.md` — segunda: paleta aplicada a medias.
- `docs/design/base44-port-checklist.md` — veredicto final y 6 residuales.
- `docs/design/fierce-fractal-logic-lab/` — el export de Base44, como referencia visual.
  **No está en este worktree**: vive sin commitear en el clon principal
  `~/code/pyaglogen3D/docs/design/fierce-fractal-logic-lab/` (1,4 MB). Quien implemente aquí
  tiene que abrirlo desde allí.
