# Tasks: redesign-design-system

> No se escribe código hasta que exista `approval.md`. Esta lista se actualiza al avanzar; el
> Log del final recoge la evidencia.
>
> **Entrega en dos PRs.** El reparto se enuncia **aquí y solo aquí**; T8.1 y `proposal.md` se
> remiten a esta tabla en vez de repetirla.
>
> | PR | Tareas | Verificación |
> | --- | --- | --- |
> | **1a** | T0, T1, T2.1, T2.3a, T4 | T7.1, T7.2, T7.3, T7.6, T7.7, T7.8 |
> | **1b** | **T2.2**, T2.3b, T3, T5, T6, T8 | T7 completo |
>
> T7.1–T7.3 y T7.6–T7.8 corren en **ambos** PRs: 1a reescribe los tokens que consume toda la
> interfaz actual, así que necesita su propia puerta.
>
> **T2.2 viaja en 1b, no en 1a**: anclar `darkMode` a `[data-theme="dark"]` mientras nadie
> escribe ese atributo dejaría las 38 variantes `dark:` inertes entre ambos merges. Va con T6.1.
>
> **Su cara B, que T7.8 en 1a debe vigilar:** entre el merge de 1a y el de 1b, `darkMode` sigue
> sin declarar, es decir `media`. Un usuario con sistema operativo oscuro verá esas variantes
> pintando superficies oscuras sobre el lienzo claro, en nueve ficheros. Solo se caza
> recorriendo T7.8 en una máquina con el sistema en oscuro.

## T0 — Línea base

- [ ] T0.1 **`npm ci` en este worktree primero.** Un worktree recién creado no tiene
      `node_modules`, y sin él `tsc --noEmit` falla con cientos de `TS2307` por dependencias
      ausentes y `next lint` muere con `next: command not found`. Después, registrar en el Log
      el estado de partida **observado aquí**, no heredado: `npm test` y `npm run type-check`.
      La cifra de errores preexistentes de `type-check` se fija en esta tarea; no se da por
      buena ninguna cifra previa. Verificado aparte: `frontend/` no tiene **ninguna**
      configuración ESLint (`.eslintrc*` y `eslint.config.*` ausentes) pese a declarar
      `eslint ^8` y `eslint-config-next 14.1`, así que `npm run lint` no es un gate utilizable.
- [ ] T0.2 Capturar el recuento exacto de literales de color bajo `frontend/src/components/` y
      `frontend/src/lib/`. La cifra observada al redactar el contrato es **170 en 24 ficheros**.
      T7.3 exige que no suba, no que baje a cero (D1).
- [ ] T0.3 Confirmar que la rama sale de `origin/develop` y que no hay solape con
      `sintering-reaches-engine` (`git diff --stat` contra su rama).

## T1 — Tokens

- [ ] T1.1 Reescribir `frontend/src/app/globals.css`: superficies, tinta, acentos, semánticos,
      líneas, sombras, radio, canvas de visualización, gradientes tonales y rampa
      `--series-1…6`. Tema claro en `:root`, oscuro en `[data-theme="dark"]`.
- [ ] T1.2 Retirar `body.app-background` y su overlay, y la clase fija `dark` de
      `<html>` (`app/layout.tsx:19`), que hoy es inerte porque `globals.css` no tiene ningún
      selector `.dark` (D9) y lo seguiría siendo tras T2.2. **No borrar** `/pyAgloGen3DBNG.png`: lo
      reutiliza la ola 2 como hero de autenticación.
- [ ] T1.3 Puente shadcn: re-derivar de los tokens nuevos las **20 declaraciones que ya
      existen** bajo `:root` en `globals.css:7-26` (19 de color más `--radius`), y **añadir**
      `--chart-1…5`, que hoy **no existen** ni en `globals.css` ni en `tailwind.config.ts`,
      derivados de `--series-1…5` por si un componente shadcn futuro los espera.
      **Los alias que resuelven por `var()` no se redeclaran en el bloque oscuro**: heredan el
      cambio de su token de origen. R2-S4 los considera cubiertos; duplicarlos por satisfacer
      el test literalmente sería ruido, y debilitar el test está prohibido por AGENTS.md.
- [ ] T1.4 Escala tipográfica y clases de micro-tipografía (`.label-xs`, `.eyebrow`, `.hint`).
- [ ] T1.5 Tests automatizables de R2-S4 y R3-S1: paridad de tokens entre temas y disyunción
      semánticos/series, ambos por **parseo estático de `globals.css` como texto**.
      El motivo es que **PostCSS no corre bajo vitest**, así que la hoja importada por
      `layout.tsx` nunca llega al documento de prueba — no que jsdom sea incapaz de resolver
      custom properties. Lo es: una sonda sobre jsdom 23.2.0 (la versión fijada en
      `package-lock.json`) devuelve el valor correcto tanto tras `setProperty` como desde un
      `<style>` inyectado. Por eso T4.4 sí puede inyectarlas.
- [ ] T1.6 `app/auth/layout.tsx` **y las cinco páginas de auth** (`login`, `register`,
      `check-email`, `verify-email`, `oauth-callback`) re-expresadas en tokens, con sus tests
      de R2-S3. `oauth-callback/page.tsx:45-46,56-57` fija `border-blue-600` y `text-gray-600`:
      gris oscuro sobre superficie oscura en cuanto exista el tema oscuro.
      Verificado: además del layout, esas páginas fijan `bg-gray-800`, `bg-gray-700` y
      `text-white` en sus tarjetas; sin tocarlas, tras 1a queda una tarjeta gris oscura sobre
      lienzo claro. Ninguna está reservada por ningún change. Hoy fija `text-white` y
      `text-gray-400` (líneas 16-17), que con el tema claro por defecto dejan el título de
      login blanco sobre fondo claro. Es una página, pero **no está reservada por ningún
      change**, y entregar la ola 1 con el login roto no es aceptable.

## T2 — Tailwind

- [ ] T2.1 Reescribir `tailwind.config.ts` derivando de los tokens; añadir familia `mono` y
      `fontVariantNumeric` tabular. **Se mantiene `theme.extend`**, no `theme`: la paleta por
      defecto de Tailwind no se elimina, porque `hemisphere-grid-viz.md:67-73` fija estados por
      nombre (`gray-400`, `blue-500`, `blue-700`).
- [ ] T2.2 **`darkMode: ['selector', '[data-theme="dark"]']`.** Hoy no se declara, lo que en
      Tailwind 3.4 significa `media`; sin esto las **38 variantes `dark:`** vivas en `src/`
      seguirían a `prefers-color-scheme` y contradirían la elección explícita del usuario (D9).
- [ ] T2.3a **(1a)** Test: `tailwind.config.ts` no contiene literal hexadecimal ni `rgb(`.
- [ ] T2.3b **(1b, con T2.2)** Test: `darkMode` está anclado a `[data-theme]`. Va con T2.2
      porque es la tarea que lo instala; dejarlo en 1a mergearía ese PR con un test en rojo.

## T3 — Kit de primitivas

- [ ] T3.1 `Num` y `CopyText` — la regla de D7: número mono y tabular, unidad en elemento
      hermano, nunca concatenados.
- [ ] T3.2 `Panel`, `VisualPanel`, `PageHeader`, `DetailList`, `Callout`, `EmptyState`.
- [ ] T3.3 `MetricCard` con tono, delta, barra de progreso y línea de detalle.
- [ ] T3.4 `DataTable` **autónomo en `kit/`**, sin dependencia de `ui/table`: cabecera sticky,
      columnas numéricas a la derecha, sin cebra. `components/ui/table.tsx` **no existe** en
      este repo (shadcn está instalado parcialmente, sin `components.json`), y crearlo caería
      fuera de la lista cerrada de ficheros editables.
- [ ] T3.5 `StatusChip`, `QualityBadge`, `StatusDot` — cada uno con etiqueta textual; el estado
      nunca se distingue solo por color. Conviven con los homónimos de `components/common/*`,
      que quedan deprecados sin cambiar ningún import existente (D4).
- [ ] T3.6 `SegmentedControl`, `FilterBar`, `DisclosurePanel`, `DetailsDrawer` sobre
      `ui/dialog` — este sí existe (`components/ui/dialog.tsx`), verificado.
- [ ] T3.7 `ShowValues` — el conmutador de alternativa textual (D6). Entra ahora aunque sus
      consumidores lleguen en las olas 2 y 3.
- [ ] T3.8 Tests de cada primitiva, incluidos los escenarios `[test]` de accesibilidad de R7
      y R8.

## T4 — Tema de gráficas Plotly

- [ ] T4.1 `frontend/src/lib/chart-theme.ts`: `series(i)`, `dash(i)`, `marker(i)`, `layout()`.
- [ ] T4.2 Lectura de las variables del documento + re-lectura al cambiar `data-theme`;
      literales solo como fallback SSR, única excepción permitida por R1.
- [ ] T4.3 Adelgazamiento de marcadores: menos de 60 posiciones en una serie de 500 puntos.
- [ ] T4.4 Tests de R4 y R5: tres señales distintas por serie e indexadas por la misma
      posición; **color respetado cuando lo fija el llamante**; serie única sólida y sin
      marcadores; repintado al mutar `data-theme` con las custom properties inyectadas en el
      test.
- [ ] T4.5 **No se añade recharts.** Verificar que `package.json` no gana dependencias de
      gráficas (D5).
- [ ] T4.6b Test de R1-S2 (los ficheros creados por esta ola no contienen literales de color,
      salvo el fallback SSR documentado), en `src/lib/__tests__/chart-theme.test.ts`.
      **Barrido por glob tolerante a rutas ausentes.** En 1a solo existe `chart-theme.ts`;
      `kit/`, `shell/`, `theme.ts` y `useThemeStore.ts` los entrega 1b. Un test que lea los
      cinco caminos literalmente fallaría con ENOENT y dejaría la puerta T7.1 de 1a en rojo.
- [ ] T4.6 La triple codificación **no invade colores atados por otra capacidad**:
      `multi-aggregate-comparison` R6/S5.3 ata cada serie de Rg al color de su simulación, el
      mismo del borde de su viewer. `series(i)` no se impone ahí; `dash(i)` y `marker(i)` sí.

## T5 — Shell

- [ ] T5.1 `components/shell/Sidebar.tsx`: secciones agrupadas, sección de proyecto contextual,
      entrada de IA por acceso, sección admin por rol, `aria-current` en la activa.
- [ ] T5.2 `components/shell/TopBar.tsx`: breadcrumb, conmutador de tema, notificaciones,
      usuario.
- [ ] T5.3 `components/shell/AppShell.tsx` y montaje **único** en `app/layout.tsx` (D3).
- [ ] T5.3b El shell **no** se monta en `/` ni en `/auth/*`. Se implementa como **guard por
      `usePathname` dentro de `AppShell`**, no como route group, para que sea testable a nivel
      de componente (ver T5.6). `frontend/middleware.ts:12` solo protege `/dashboard` y
      `/projects`, y `:15` redirige fuera de `/auth/login` y `/auth/register` al usuario
      autenticado: un sidebar con breadcrumb y menú de usuario sobre la pantalla de login sería
      incoherente.
- [ ] T5.3c `AppShellContext`, definido en `components/shell/` y montado en
      `app/providers.tsx`, para que `Header` sepa que debe renderizar `null` (D9). **No** en
      `src/contexts/`: esa ruta no está en la lista cerrada.
- [ ] T5.4 `Header` deprecado: renderiza `null` bajo el shell. **Ninguna página de producto se
      edita en esta ola.** Las únicas excepciones son el layout y las cinco páginas de auth
      (T1.6), que no son pantallas de producto ni están reservadas por ningún change. La
      autoridad sobre qué es editable es la lista cerrada del final de este fichero, no esta
      frase.
- [ ] T5.5 Responsive: iconos a <1440px, drawer con trampa de foco a <900px, frame a 1440px.
      Solo la trampa de foco y el nombre accesible son testables; los breakpoints son media
      queries y van a T7.4 manual.
- [ ] T5.4b Test de R3 en `components/layout/__tests__/Header.test.tsx`: bajo el shell,
      `Header` no renderiza navegación.
- [ ] T5.6 Tests del shell **a nivel de componente**, renderizando `<AppShell>` con
      `next/navigation` mockeado, como ya hace
      `app/projects/[id]/fraktal/batch/__tests__/page.test.tsx:14-32`. **No se renderiza
      `app/layout.tsx`**: es Server Component e importa `next/font/google`, que ningún test del
      repo monta hoy (`grep "app/layout\|next/font" --include=*.test.tsx` → 0). Un test de ruta
      pasaría en verde vacuamente, porque el layout nunca estaría en el árbol. Cubre: scope de
      proyecto, acceso de IA, rol admin, `aria-current`, **R5** (breadcrumb y control de tema
      de tres estados), **R1-S2** (ninguna página importa el shell, por grep) y ausencia de
      shell con `usePathname` devolviendo `/` y `/auth/login`.

## T6 — Tema

- [ ] T6.0 `useThemeStore` (zustand + `persist`, consistente con `viewerStore`) montado en
      `app/providers.tsx`. Valor inicial leído de `document.documentElement.dataset.theme` para
      no romper la hidratación: `app/layout.tsx` es Server Component (D9).
- [ ] T6.1 Script inline de resolución previa al primer paint. **Lee la misma clave y el mismo
      formato que escribe `persist`**: zustand guarda `{"state":{…},"version":N}` bajo su
      `name` (precedente: `viewerStore.ts:173` → `'viewer-settings'`). Un
      `localStorage.getItem('theme')` ingenuo rompería el escenario de "sin flash" en silencio.
      La clave se fija en esta tarea y se documenta en el Log.
- [ ] T6.2 Persistencia y precedencia sobre `prefers-color-scheme`. **`window.matchMedia` no
      existe en jsdom 23.2.0** y `src/test/setup.ts` no lo stubea (verificado): el resolutor se
      escribe como función pura importable desde `src/lib/theme.ts`, que recibe la preferencia
      guardada y la del sistema como argumentos. Así T6.3 no depende de `matchMedia`.
- [ ] T6.3 Tests de los escenarios `[test]` de R2: la función resolutora escribe el `data-theme`
      correcto en cada combinación de preferencia guardada y preferencia del sistema. El
      escenario de "sin flash" es `[manual]` y va a T7.4.
- [ ] T6.4 `NetworkCanvas.detectTheme()` (`components/topology/NetworkCanvas.tsx:9-12`) pasa a
      leer `document.documentElement.dataset.theme` con fallback a `prefers-color-scheme`, y a
      escuchar el cambio de `data-theme` además del `MediaQueryList`. Hoy cumple
      `contacts-graph-viz.md:252` por accidente; esta ola introduce la divergencia, así que
      esta ola la cierra (D10). Test: con `data-theme="light"` y sistema oscuro,
      `buildVisNetworkData` recibe `'light'`.

## T7 — Verificación

- [ ] T7.1 `cd frontend && npm test` verde; ningún test preexistente pasa a rojo.
- [ ] T7.2 `npm run type-check` sin errores nuevos respecto a la línea base de T0.1.
- [ ] T7.3 **La línea base de literales de color de T0.2 no sube.** No se exige cero: 170 son
      preexistentes y uno está mandado por `contacts-graph-viz` (D1).
- [ ] T7.4 Verificación manual en navegador, con capturas en el Log, de **todos los escenarios
      `[manual]`** de las dos specs: ausencia de flash de tema, alineación de columnas
      numéricas y los cuatro breakpoints (1440, 1280, 900, 360). Es un change de interfaz: la
      suite no sustituye mirar.
- [ ] T7.5 Contraste AA medido sobre las micro-etiquetas en ambos temas, con la cifra en el Log.
- [ ] T7.6 Backend y engine **sin tocar**: `git diff --stat` no muestra cambios fuera de
      `frontend/` y `openspec/`.
- [ ] T7.7 `coordinationColor(0)` sigue devolviendo `'#9ca3af'` y la suite de `graphUtils` sigue
      verde: la paleta canónica de `contacts-graph-viz` no se ha tocado.
- [ ] T7.8 **Regresión visual de las doce pantallas de producto**, que esta ola no edita pero
      sí afecta (hay 23 ficheros `page.tsx`; doce son pantallas distintas y 17 importan
      `Header`; aquí se recorren las doce): el sidebar fijo les quita ancho útil y los tokens nuevos les cambian el fondo.
      Recorrido manual de las doce pantallas en ambos temas a 1440px, con capturas en el Log.
      En **1a no hay conmutador de tema** (T5.2, T6.0 y T6.1 son de 1b): el tema oscuro se
      alcanza poniendo `data-theme="dark"` a mano en devtools, ya que el bloque existe desde
      T1.1. Atención explícita a `multi-aggregate-comparison.md:45`, que fija la rejilla de viewers
      por N: comprobar que sigue siendo usable con el sidebar montado. Corre en **ambos** PRs.

## T8 — Entrega y limpieza

- [ ] T8.1 **Dos PRs encadenados** a `develop`, etiqueta `type:feat` y su issue de Jira, con el
      reparto de la tabla de cabecera de este fichero. Un único PR de ~5.000 líneas no es
      revisable y el repo tiene una skill cuyo disparador son los 400.
- [ ] T8.0 `openspec validate redesign-design-system --strict` en verde **antes del PR de 1a**.
      Es un gate real y barato que cuatro rondas de spec-review no ejecutaron: las deltas deben
      vivir en `specs/<capability>/spec.md`, no en `specs/<capability>.md`; un fichero plano se
      **ignora en silencio** al aplicar y al archivar.
- [ ] T8.2 Archive con sincronización canónica: los bloques ADDED completos de
      `design-system-foundation` (R1–R8) y `app-shell-navigation` (R1–R6) se escriben íntegros,
      nunca diferidos, en **`openspec/specs/<capability>/spec.md`** — forma de carpeta, no
      fichero plano. Verificado: `openspec list --specs` responde hoy **"No specs found"**
      porque las 21 canónicas del repo son planas y el tooling no ve ninguna. Estas dos serían
      las primeras visibles. Migrar las otras 21 es un chore aparte, decisión de la persona; no
      lo hace este change.
- [ ] T8.2b Comprobar que, tras el archive, `openspec list --specs` lista
      `design-system-foundation` y `app-shell-navigation` con sus 8 y 6 requisitos. Si no las
      lista, el archive fue silencioso y hay que repararlo antes de cerrar.
- [ ] T8.3 `state.yaml` actualizado. Incluye reconciliar `state.yaml:33`, que declara
      `lint_cmd: "cd frontend && npm run lint"` como gate cuando no existe configuración ESLint
      alguna (T0.1): o se anota como no ejecutable, o se retira.
- [ ] T8.4 **Limpieza tras el merge**, ordenada por la persona para esta entrega:
      - rama borrada en local y remoto;
      - `git worktree remove ~/code/.worktrees/pyaglogen3D-redesign-design-system` —
        **nunca con cambios sin commitear**, propios ni ajenos;
      - `git worktree prune` y `git gc` en el clon principal.
- [ ] T8.5 Avisar por intercom a la sesión dueña de la cadena `distribution-config-surface` de
      que la ola 1 está integrada, por si afecta a su rebase.

## Ficheros editables en esta ola — lista cerrada

Cualquier fichero fuera de esta lista es una desviación del contrato:

**Editables existentes:**

- `frontend/src/app/{layout,providers}.tsx` y `frontend/src/app/globals.css`
- `frontend/src/app/auth/layout.tsx` (solo T1.6)
- `frontend/tailwind.config.ts`
- `frontend/src/components/layout/Header.tsx` (solo para que renderice `null`)
- `frontend/src/components/topology/NetworkCanvas.tsx` (solo T6.4)
- `frontend/src/components/topology/__tests__/NetworkCanvas.test.tsx` (solo el caso de T6.4)

**Nuevos autorizados:**

- todo bajo `frontend/src/components/kit/` y `frontend/src/components/shell/`
- `frontend/src/lib/chart-theme.ts` y `frontend/src/lib/theme.ts` (el resolutor puro de T6.2)
- `frontend/src/stores/useThemeStore.ts`
- los tests que las tareas exigen y que no caen bajo `kit/` ni `shell/`:
  `frontend/src/app/__tests__/globals-tokens.test.ts` (T1.5),
  `frontend/src/__tests__/tailwind-config.test.ts` (T2.3a y T2.3b) — **dentro de `src/`**:
  `vitest.config.ts:10-15` solo recoge `src/**`, así que un test en `frontend/__tests__/`
  no se ejecutaría nunca y pasaría en verde vacuamente,
  `frontend/src/lib/__tests__/chart-theme.test.ts` (T4.4 y T4.6b),
  `frontend/src/lib/__tests__/theme.test.ts` (T6.3),
  `frontend/src/components/layout/__tests__/Header.test.tsx` (T5.4b, escenario R3 — el directorio no
  existe todavía),
  `frontend/src/app/auth/__tests__/layout.test.tsx` (R2 S3)
- `frontend/src/app/auth/{login,register,check-email,verify-email,oauth-callback}/page.tsx`
  (solo T1.6) y
  `frontend/src/app/auth/__tests__/`
- `openspec/changes/redesign-design-system/**` (las deltas en
  `specs/<capability>/spec.md`, que es la única forma que `openspec validate` acepta)

**Y, solo en T8 (archive):** `openspec/specs/design-system-foundation/spec.md`,
`openspec/specs/app-shell-navigation/spec.md`, `openspec/state.yaml` y
`openspec/changes/archive/**`.

Cualquier otro fichero, nuevo o existente, es una desviación del contrato. En particular **no**
se crea nada bajo `frontend/src/components/ui/` ni se modifica `frontend/vitest.config.ts`.

## Deuda conocida que este change NO cierra

- **R3 de `app-shell-navigation` es transitorio**: normaliza que `Header` siga siendo
  importable durante la migración. La ola 3, al borrar el fichero, debe declarar esa capacidad
  MODIFIED y retirar R3; si no, la spec canónica hablará de un fichero inexistente.
- Las 17 páginas y el fichero de test siguen importando `Header`; se retira en las olas 2 y 3,
  y el fichero se borra al cerrar la ola 3.
- `components/ui/*` (shadcn) y `components/common/*` (`MetricsCard`, `QualityBadge`,
  `StatusBadge`, con seis consumidores) conviven con el kit (D4).
- Los 170 literales de color preexistentes en 24 ficheros de pantalla (D1).
- `UnitConventionBanner`: lo renderizan páginas, y `rg-unit-contract.md:185-213` acota cuándo
  aparece — solo para `parameters_schema_version` `null` o `"v1"`. Pertenece a las olas 2 y 3.
- `src/stores/viewerStore.ts:24-29`, cuatro literales de fondo de viewer atados a
  `multi-aggregate-comparison` S7.3.
- **Los títulos de escenario llevan el sufijo `[test]` / `[manual]` y pasan así a la spec
  canónica.** El archive empareja los bloques MODIFIED por **título verbatim**, escenario a
  escenario. Cualquier ola futura que modifique estas dos capacidades debe reproducir el
  título completo, sufijo incluido, o el tooling dará por omitidos los escenarios sin avisar.
- Los seis residuales del `base44-port-checklist.md`, que pertenecen a las olas 2–4.
- El destino del export de Base44 (1,4 MB sin commitear) es decisión de la persona (D11).

## Log

<!-- Una entrada por tarea completada, con la evidencia que la respalda. -->
