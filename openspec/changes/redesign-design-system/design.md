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

**Consecuencia operativa.** Un literal de color fuera de `globals.css` es un defecto, y T7 lo
verifica con un grep que falla la tarea si aparece alguno en `components/` o `lib/`.

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

`components/layout/Header.tsx` lo importan **18 páginas**. Sustituirlo en las 18 dentro de esta
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
**sobre** las primitivas existentes donde tiene sentido (`DataTable` sobre `table`,
`DetailsDrawer` sobre `dialog`).

**Por qué.** Sustituir shadcn en la misma ola que se instalan los tokens duplicaría el riesgo
sin ganar nada: las 12 pantallas aún no están reescritas y seguirían consumiendo `ui/*`. La
retirada de shadcn, si llega a interesar, es un change posterior con su propia evidencia.

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

## D8. Qué NO decide este contrato

- El destino del export de Base44 (`docs/design/fierce-fractal-logic-lab/`, 1,4 MB): si entra
  al repo o se queda fuera es decisión de la persona, y no bloquea esta ola.
- La retirada de shadcn.
- El alcance final de la ola 4, que depende de si `polydispersity-single-source` se escribe o
  se aparca.
