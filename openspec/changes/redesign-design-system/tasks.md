# Tasks: redesign-design-system

> No se escribe código hasta que exista `approval.md`. Esta lista se actualiza al avanzar; el
> Log del final recoge la evidencia.
>
> **Entrega en dos PRs:** 1a = T0, T1, T2, T4 (~1.000 líneas). 1b = T3, T5, T6, T7, T8 (~4.000).

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
- [ ] T1.2 Retirar `body.app-background` y su overlay. **No borrar** `/pyAgloGen3DBNG.png`: lo
      reutiliza la ola 2 como hero de autenticación.
- [ ] T1.3 Puente shadcn: re-derivar de los tokens nuevos los **21 tokens que ya existen** en
      `globals.css:7-26`, y **añadir** `--chart-1…5`, que hoy **no existen** ni en `globals.css`
      ni en `tailwind.config.ts`, derivados de `--series-1…5` por si un componente shadcn
      futuro los espera.
- [ ] T1.4 Escala tipográfica y clases de micro-tipografía (`.label-xs`, `.eyebrow`, `.hint`).
- [ ] T1.5 Tests automatizables de R1 y R2: paridad de tokens entre temas y disyunción
      semánticos/series, ambos por **parseo estático de `globals.css` como texto**. jsdom no
      carga la hoja de estilos, así que `getComputedStyle` devolvería cadena vacía para toda
      custom property.
- [ ] T1.6 `app/auth/layout.tsx` re-expresado en tokens. Hoy fija `text-white` y
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
- [ ] T2.3 Tests: el fichero no contiene literal hexadecimal ni `rgb(`, y `darkMode` está
      anclado a `[data-theme]`.

## T3 — Kit de primitivas

- [ ] T3.1 `Num` y `CopyText` — la regla de D7: número mono y tabular, unidad en elemento
      hermano, nunca concatenados.
- [ ] T3.2 `Panel`, `VisualPanel`, `PageHeader`, `DetailList`, `Callout`, `EmptyState`.
- [ ] T3.3 `MetricCard` con tono, delta, barra de progreso y línea de detalle.
- [ ] T3.4 `DataTable` sobre `ui/table`: cabecera sticky, columnas numéricas a la derecha,
      sin cebra.
- [ ] T3.5 `StatusChip`, `QualityBadge`, `StatusDot` — cada uno con etiqueta textual; el estado
      nunca se distingue solo por color. Conviven con los homónimos de `components/common/*`,
      que quedan deprecados sin cambiar ningún import existente (D4).
- [ ] T3.6 `SegmentedControl`, `FilterBar`, `DisclosurePanel`, `DetailsDrawer` sobre
      `ui/dialog`.
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
- [ ] T4.6 La triple codificación **no invade colores atados por otra capacidad**:
      `multi-aggregate-comparison` R6/S5.3 ata cada serie de Rg al color de su simulación, el
      mismo del borde de su viewer. `series(i)` no se impone ahí; `dash(i)` y `marker(i)` sí.

## T5 — Shell

- [ ] T5.1 `components/shell/Sidebar.tsx`: secciones agrupadas, sección de proyecto contextual,
      entrada de IA por acceso, sección admin por rol, `aria-current` en la activa.
- [ ] T5.2 `components/shell/TopBar.tsx`: breadcrumb, conmutador de tema, notificaciones,
      usuario.
- [ ] T5.3 `components/shell/AppShell.tsx` y montaje **único** en `app/layout.tsx` (D3).
- [ ] T5.3b El shell **no** se monta en `/` ni en `/auth/*` (route group o guard por
      `usePathname`). `middleware.ts:13-16` solo protege `/dashboard` y `/projects`, y las
      rutas de auth redirigen fuera al usuario autenticado: un sidebar con breadcrumb y menú de
      usuario sobre la pantalla de login sería incoherente.
- [ ] T5.3c `AppShellContext` montado en `app/providers.tsx`, para que `Header` sepa que debe
      renderizar `null` (D9).
- [ ] T5.4 `Header` deprecado: renderiza `null` bajo el shell. **Ninguna página de producto se
      edita en esta ola.** La única excepción es `app/auth/layout.tsx` (T1.6), que no es página
      de producto ni está reservada por ningún change.
- [ ] T5.5 Responsive: iconos a <1440px, drawer con trampa de foco a <900px, frame a 1440px.
      Solo la trampa de foco y el nombre accesible son testables; los breakpoints son media
      queries y van a T7.4 manual.
- [ ] T5.6 Tests del shell: scope de proyecto, acceso de IA, rol admin, `aria-current`, y
      ausencia de shell en `/` y en `/auth/login`.

## T6 — Tema

- [ ] T6.0 `useThemeStore` (zustand + `persist`, consistente con `viewerStore`) montado en
      `app/providers.tsx`. Valor inicial leído de `document.documentElement.dataset.theme` para
      no romper la hidratación: `app/layout.tsx` es Server Component (D9).
- [ ] T6.1 Script inline de resolución previa al primer paint.
- [ ] T6.2 Persistencia y precedencia sobre `prefers-color-scheme`.
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

## T8 — Entrega y limpieza

- [ ] T8.1 **Dos PRs encadenados** a `develop`, etiqueta `type:feat` y su issue de Jira: **1a**
      (T0, T1, T2, T4) y **1b** (T3, T5, T6, T7). Un único PR de ~5.000 líneas no es revisable
      y el repo tiene una skill cuyo disparador son los 400.
- [ ] T8.2 Archive con sincronización canónica: los bloques ADDED completos de
      `design-system-foundation` (R1–R8) y `app-shell-navigation` (R1–R6) se escriben íntegros
      en `openspec/specs/`, nunca diferidos.
- [ ] T8.3 `state.yaml` actualizado.
- [ ] T8.4 **Limpieza tras el merge**, ordenada por la persona para esta entrega:
      - rama borrada en local y remoto;
      - `git worktree remove ~/code/.worktrees/pyaglogen3D-redesign-design-system` —
        **nunca con cambios sin commitear**, propios ni ajenos;
      - `git worktree prune` y `git gc` en el clon principal.
- [ ] T8.5 Avisar por intercom a la sesión dueña de la cadena `distribution-config-surface` de
      que la ola 1 está integrada, por si afecta a su rebase.

## Ficheros editables en esta ola — lista cerrada

Cualquier fichero fuera de esta lista es una desviación del contrato:

- `frontend/src/app/{layout,providers}.tsx` y `frontend/src/app/globals.css`
- `frontend/src/app/auth/layout.tsx` (solo T1.6)
- `frontend/tailwind.config.ts`
- `frontend/src/components/layout/Header.tsx` (solo para que renderice `null`)
- `frontend/src/components/topology/NetworkCanvas.tsx` (solo T6.4)
- todo lo **nuevo** bajo `frontend/src/components/kit/`, `frontend/src/components/shell/`,
  `frontend/src/lib/chart-theme.ts`, `frontend/src/stores/useThemeStore.ts`, y sus tests
- `openspec/changes/redesign-design-system/**`

## Deuda conocida que este change NO cierra

- Las 17 páginas y el fichero de test siguen importando `Header`; se retira en las olas 2 y 3,
  y el fichero se borra al cerrar la ola 3.
- `components/ui/*` (shadcn) y `components/common/*` (`MetricsCard`, `QualityBadge`,
  `StatusBadge`, con seis consumidores) conviven con el kit (D4).
- Los 170 literales de color preexistentes en 24 ficheros de pantalla (D1).
- `UnitConventionBanner`: lo renderizan páginas, y `rg-unit-contract.md:185-213` acota cuándo
  aparece — solo para `parameters_schema_version` `null` o `"v1"`. Pertenece a las olas 2 y 3.
- `src/stores/viewerStore.ts:24-29`, cuatro literales de fondo de viewer atados a
  `multi-aggregate-comparison` S7.3.
- Los seis residuales del `base44-port-checklist.md`, que pertenecen a las olas 2–4.
- El destino del export de Base44 (1,4 MB sin commitear) es decisión de la persona (D11).

## Log

<!-- Una entrada por tarea completada, con la evidencia que la respalda. -->
