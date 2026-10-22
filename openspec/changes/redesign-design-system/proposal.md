# Proposal: redesign-design-system

> SDD change (política AGENTS.md). **Primero de los cuatro contratos encadenados** que portan
> el rediseño de Base44 (`docs/design/base44-redesign-prompt.md` y sus tres auditorías) al
> `frontend/` real.

## Intent

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
| `DistributionSelector.tsx` | `distribution-grid-wiring` únicamente — `sintering-reaches-engine` T6.6 lo declara intacto a propósito | archivado `distribution-grid-wiring` |
| `SimulationForm.tsx` | `polydispersity-single-source` (toggle de polidispersidad muerto en `tunable_cc`, asimetrías del formulario single) — **change aún no redactado** | ver abajo |

**Protocolo de liberación.** Cada fichero se libera por **aviso explícito de la sesión dueña**,
no por inferencia desde un archive. Quien implemente la ola 4 no deduce la disponibilidad del
estado de `openspec/changes/archive/`: espera el aviso, y lo registra en el Log de la ola 4 con
fecha y change de origen.

**Decisión abierta para la persona.** `polydispersity-single-source` no está escrito. Si se
aparca, `SimulationForm.tsx` —el mayor de los tres— queda libre antes que los otros dos y la
ola 4 puede partirse en dos. Si se escribe, es el último en liberarse. El alcance de la ola 4
no se cierra hasta que esa decisión exista.

**La reserva es parte del contrato, no un acuerdo verbal entre sesiones.**

## Alcance de este change

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
   importada por 18 páginas) se sustituye por un sidebar fijo con navegación agrupada y
   contextual al proyecto.

## Qué NO cambia

- Ninguna ruta, ningún endpoint, ningún cálculo, ninguna tolerancia numérica.
- `viewer3d-state`, `contacts-graph-viz`, `hemisphere-grid-viz`,
  `multi-aggregate-comparison` y el resto de specs canónicas siguen cumpliéndose tal cual.
  Al contrario: `contacts-graph-viz` ya exige hoy que la paleta de coordinación sea *"readable
  in both light and dark modes"*, un requisito que la aplicación no podía ejercitar porque no
  existía el modo claro. Este change lo hace ejercitable por primera vez.

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
| Un PR enorme pese a la partición | T1–T4 y T5–T6 se commitean como unidades separadas; el PR de la ola 1 no toca páginas |
| Rechazo del tema claro por costumbre | El conmutador recuerda la elección; el tema oscuro queda a un clic |
| Deriva entre tokens CSS y `tailwind.config.ts` | R2: Tailwind **deriva** de los tokens, nunca los repite |
| Deriva entre tokens CSS y tema Plotly | R6: el tema lee las variables del documento y se re-lee al cambiar de tema |
| Solape con la cadena de `distribution-config-surface` | Reserva por fichero con liberación por aviso explícito + shell montado en `layout.tsx`, de modo que la ola 1 no edita ninguna página |
| Desbloquear la ola 4 antes de tiempo | La liberación no se infiere de un archive; se espera aviso de la sesión dueña y se registra en el Log |

## Evidencia de entrada

- `docs/design/base44-redesign-prompt.md` — brief original (ya en `develop`).
- `docs/design/base44-design-delta.md` — primera auditoría: 4 funcionalidades ausentes,
  3 colisiones de color.
- `docs/design/base44-design-delta-2.md` — segunda: paleta aplicada a medias.
- `docs/design/base44-port-checklist.md` — veredicto final y 6 residuales.
- `docs/design/fierce-fractal-logic-lab/` — el export de Base44, como referencia visual.
