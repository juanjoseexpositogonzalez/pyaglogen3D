# Design: redesign-design-system

Decisiones de diseño de la ola 1 del port. Cada una está anclada en el código real del
`frontend/`, no en el prototipo de Base44.

---

## D1. Los tokens CSS son la única fuente de verdad

`globals.css` declara las variables; `tailwind.config.ts` las **deriva**; `lib/chart-theme.ts`
las **lee del documento**. Ninguna de las tres capas repite un literal de color.

**Por qué.** El export de Base44 definió `--series-1…6` en CSS y volvió a escribir los mismos
seis literales en un array JS. `grep var(--series` daba cero usos: dos definiciones que debían
coincidir a mano. En la segunda reexportación ya había divergido en seis componentes, que
seguían pintando con hexes retirados (`#cf8a38`, `#7664bb`, `#728391`) mientras los tokens ya
eran otros. La aplicación pintaba desde dos paletas a la vez.

**Consecuencia operativa, acotada.** La regla rige **lo que esta ola crea**: `components/kit/`,
`components/shell/` y `lib/chart-theme.ts`. No rige el código preexistente.

La primera versión de este contrato exigía "cero literales de color" en todo `components/` y
`lib/`. Era incumplible por dos razones, ambas verificadas:

1. Hay **170 literales** en 24 ficheros de `compare/`, `charts/`, `fraktal/`, `viewer3d/`,
   `analysis/`, `topology/` y `projection/`. Llevarlos a cero obliga a editar exactamente las
   superficies de las olas 2 y 3, contradiciendo la promesa de que esta ola no toca pantallas.
2. Uno de ellos **está mandado por una spec canónica**. `graphUtils.ts:9` contiene `'#9ca3af'`
   porque `contacts-graph-viz.md:98` fija la paleta de coordinación verbatim y su escenario de
   la línea 104 lo afirma. Hay tests que lo comprueban. Tokenizarlo sería romper una capacidad
   canónica, no mejorar la consistencia.

T7.3 pasa a ser **línea base no empeorada**: el recuento de T0.2 no sube. La migración de los
170 pertenece a las olas que reescriben sus pantallas.

---

## D2. Tema claro por defecto, oscuro a un clic

`app/layout.tsx` fija hoy `<html className="dark">` sin alternativa. Pasa a:

- `<html>` sin clase fija; un `data-theme` escrito antes del primer paint por un script
  inline, para que no haya flash de tema incorrecto;
- primera visita: se respeta `prefers-color-scheme`;
- elección explícita: se persiste en `localStorage` y gana sobre la preferencia del sistema;
- el conmutador vive en la barra superior con tres estados, `System / Light / Dark`.

**Por qué claro por defecto.** El canvas claro es la decisión que define el lenguaje visual de
Synaptiq: superficies translúcidas sobre un gradiente claro, con el canvas oscuro
(`--visual-background: #07141d`) reservado a las visualizaciones. Si el tema por defecto fuera
oscuro, esa reserva desaparece y el viewer deja de destacar del chrome.

**Lo que se pierde.** `body.app-background` pinta hoy `/pyAgloGen3DBNG.png` bajo toda la
interfaz con un overlay de legibilidad. Se retira. El fichero PNG se conserva: la pantalla de
autenticación lo reutiliza como hero visual en la ola 2.

---

## D3. El shell se monta en `layout.tsx`, no página a página

`components/layout/Header.tsx` lo importan **17 páginas y un fichero de test**
(`app/projects/[id]/fraktal/batch/__tests__/page.test.tsx`, que ya lo mockea a `null` y por
tanto es inmune al mecanismo de contexto). Sustituirlo en las 17 dentro de esta
ola significaría editar `app/projects/[id]/batch/page.tsx` y `app/projects/[id]/simulations/new/page.tsx`,
que son vecinos inmediatos de los ficheros reservados para la ola 4.

Decisión: el `AppShell` se monta una sola vez en `app/layout.tsx`, envolviendo `{children}`.
`Header` queda **deprecado pero funcional** durante esta ola, y cada página retira su propio
import en la ola que la reescribe. Al cerrar la ola 3 no quedará ninguna importación y el
fichero se borra entonces, no ahora.

**Por qué importa.** Reduce la superficie editada de la ola 1 a cero páginas. Es lo que hace
que este change pueda avanzar en paralelo sin tocar el trabajo ajeno.

Durante la transición `Header` renderiza `null` cuando detecta que el `AppShell` ya está
montado (contexto), de modo que no haya doble navegación en pantalla.

---

## D4. El kit convive con shadcn; no lo sustituye

`components/ui/*` (shadcn) se queda. El kit nuevo vive en `components/kit/*` y se construye
sobre las primitivas existentes **donde existen**: `DetailsDrawer` sobre `ui/dialog`, que s	ed
est	ed .

**`DataTable` es aut	ed nomo.** `components/ui/table.tsx` **no existe** en este repo 	ed shadcn est	ed 
instalado parcialmente, sin `components.json` que permita generarlo, y `grep "ui/table"` da
cero. Construir `DataTable` sobre 	ed l obligar	ed a a crear un fichero bajo `components/ui/`, que la
lista cerrada de `tasks.md` no autoriza. Se escribe directamente en `kit/`.

**Por qué.** Sustituir shadcn en la misma ola que se instalan los tokens duplicaría el riesgo
sin ganar nada: las 12 pantallas aún no están reescritas y seguirían consumiendo `ui/*`. La
retirada de shadcn, si llega a interesar, es un change posterior con su propia evidencia.

**Y lo mismo con `components/common/*`.** Ya existen ahí `MetricsCard`, `QualityBadge` y
`StatusBadge`, con seis consumidores. Van a convivir con homónimos del kit. Se tratan igual que
`Header`: quedan deprecados en esta ola y los retira la ola que reescribe a su último
consumidor. Ningún fichero existente cambia de import en la ola 1.

---

## D5. El tema de gráficas es Plotly, no recharts

El producto usa `plotly.js` 2.28 con `react-plotly.js`. El prototipo de Base44 usa recharts.

**El diseño es portable; el código de gráficas no.** Copiar los componentes de recharts
añadiría una segunda librería de gráficas al bundle y una segunda fuente de verdad para la
misma rampa de series.

`lib/chart-theme.ts` expone:

- `series(i)` — color, leído de `--series-{i+1}` en el documento;
- `dash(i)` — patrón de línea: `solid`, `6 3`, `2 3`, `8 3 2 3`, `12 4`, `4 2`;
- `marker(i)` — forma: `circle`, `square`, `triangle-up`, `diamond`, `x`, `star`;
- `layout()` — rejilla, ejes, tipografía y tooltip del sistema;
- se re-lee al cambiar `data-theme`, para que las gráficas repinten con la rampa oscura.

**Triple codificación, obligatoria en multi-serie.** Color, patrón y marcador se indexan por la
misma posición de serie. Una gráfica científica se imprime en gris para un paper; el tono solo
no basta. Los marcadores se dibujan cada N puntos, no en cada muestra: una serie de 500 puntos
con marcador en cada una es una mancha, no una codificación.

**Rampa.** `#1d858c` teal (marca), `#c25d1e` naranja quemado, `#7046b0` violeta, `#6f8540`
oliva, `#a8386b` magenta, `#3e6584` navy. Ordenada por separabilidad: derivada de Okabe–Ito y
retonada para el canvas claro. Los tres azules de baja croma de la paleta anterior
(teal/navy/slate) colapsaban con cuatro series y bajo deuteranopia.

**Semánticos fuera de las series.** `--success #2f8f6d` y `--warning #b8761f` no coinciden con
ningún color de serie. En la paleta anterior `--gold` y `--warning` eran el mismo hex: una
serie de datos era indistinguible de un estado de alerta.

---

## D6. `ShowValues` entra en el kit, no en cada gráfica

La alternativa textual —un conmutador que sustituye la gráfica por la tabla de sus datos, en el
mismo sitio y con el mismo chrome— es un requisito de accesibilidad del brief que se omitió dos
veces en el prototipo.

Entra como primitiva del kit en esta ola, aunque sus consumidores lleguen en las olas 2 y 3.
**Es más barato que la primitiva exista antes que las pantallas que la necesitan**: si llega
después, hay que volver a abrir doce ficheros ya revisados.

---

## D7. Tipografía: dos familias, una regla

`Inter` para todo el texto; `ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace` para
**toda cifra**, con `font-variant-numeric: tabular-nums`.

La regla que lo hace útil: **la unidad nunca forma parte del número.** `68.4` va en el span
mono, `nm` en un span contiguo, más pequeño y apagado. Así las columnas alinean y la unidad no
hereda el ancho tabular.

`Num` es la primitiva que lo impone; ninguna pantalla concatena número y unidad en una cadena.

---

## D8. La verificaci	ed n se reparte por lo que cada PR deja en `develop`

La ola 1 sale en dos PRs, y 1a **no es invisible**: reescribe los 20 tokens de
`globals.css:7-26` que consume toda la interfaz actual v	ed a `tailwind.config.ts`, y retira
`body.app-background`, que usa `app/layout.tsx:20`. Entre 1a y 1b hay un estado entregado y
visible: aplicaci	ed n clara, sin conmutador y sin shell.

Por eso 1a lleva su propia puerta (T7.1	ed T7.3, T7.6	ed T7.8) en vez de delegar toda la
verificaci	ed n a 1b, y por eso **T2.2 viaja en 1b**: anclar `darkMode` a `[data-theme="dark"]`
mientras nadie escribe ese atributo dejar	ed a las 38 variantes `dark:` inertes entre ambos
merges.

Y por eso existe **T7.8**: "no editar p	ed ginas" no es lo mismo que "no afectarlas". El sidebar
les quita ancho 	ed til a las doce pantallas y los tokens les cambian el fondo;
`multi-aggregate-comparison.md:45` fija la rejilla de viewers por N y nadie m	ed s comprobar	ed a
que siga siendo usable.

---

## D9. El estado de tema vive en zustand, junto al precedente del repo

El repo ya persiste estado de interfaz con zustand: `src/stores/viewerStore.ts` usa `persist`.
El tema reutiliza ese mecanismo en `useThemeStore`, no abre un segundo.

**Hidratación.** `app/layout.tsx` es un Server Component. Un `useState(() => localStorage…)`
provocaría mismatch de hidratación. El valor inicial se lee de
`document.documentElement.dataset.theme`, que el script inline ya escribió antes del primer
paint; el store solo refleja lo que el DOM ya dice.

**Montaje.** El provider va en `app/providers.tsx`, donde ya viven `QueryClientProvider` y
`AuthProvider`. `AppShellContext`, el que permite a `Header` renderizar `null`, se monta en el
mismo sitio.

**Tailwind.** `darkMode` no está declarado hoy, lo que en Tailwind 3.4 significa `media`. Hay
**38 variantes `dark:`** vivas en `src/**/*.tsx`. Si no se ancla a `[data-theme="dark"]`, un
usuario con sistema oscuro que elija "Light" verá componentes mixtos, y R2 de
`design-system-foundation` queda falseado. Anclarlo es obligatorio, no una mejora.

Nota de precisión: `<html className="dark">` en `layout.tsx:19` **no hace nada hoy**.
`globals.css` no tiene ningún selector `.dark`; la aplicación es oscura porque los tokens de
`:root` son oscuros. La premisa del proposal es cierta, pero el mecanismo no es el que su
redacción sugiere.

---

## D10. El grafo de topología debe seguir al tema de la app, no al del sistema

`components/topology/NetworkCanvas.tsx:9-12` resuelve su tema con
`window.matchMedia('(prefers-color-scheme: dark)')`. Hoy cumple `contacts-graph-viz.md:252`
(*"MUST be transparent or match the app's current theme"*) **por accidente**: el tema de la app
es la preferencia del sistema.

En cuanto `data-theme` tenga precedencia sobre el sistema, el grafo quedará en desacuerdo con
la aplicación y esa spec canónica dejará de cumplirse. Por eso T6.4 lo repara dentro de esta
ola: es la ola que introduce la divergencia, así que es la que debe cerrarla.

---

## D11. Qué NO decide este contrato

- El destino del export de Base44 (`docs/design/fierce-fractal-logic-lab/`, 1,4 MB): si entra
  al repo o se queda fuera es decisión de la persona, y no bloquea esta ola.
- La retirada de shadcn.
- El alcance final de la ola 4, que depende de si `polydispersity-single-source` se escribe o
  se aparca.
- La migración de los 170 literales de color preexistentes: pertenece a las olas 2 y 3.
- `src/stores/viewerStore.ts:24-29` tiene cuatro literales de fondo de viewer. Quedan **fuera**
  de esta ola: `multi-aggregate-comparison` S7.3 es canónico sobre ese selector y tocarlo sin
  reescribir Compare sería cambiar comportamiento a ciegas.
