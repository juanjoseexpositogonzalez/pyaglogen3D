# Tasks: redesign-design-system

> No se escribe código hasta que exista `approval.md`. Esta lista se actualiza al avanzar; el
> Log del final recoge la evidencia.

## T0 — Línea base

- [ ] T0.1 Registrar en el Log el estado verde de partida de las tres suites del frontend:
      `npm test`, `npm run type-check`. Nota conocida: `npm run lint` es `next lint` sin
      configuración ESLint y abre un asistente interactivo; `type-check` arrastra 13 errores
      preexistentes en ficheros ajenos. Ambos se documentan, no se arreglan aquí.
- [ ] T0.2 Capturar el recuento exacto de literales de color bajo `frontend/src/components/`
      y `frontend/src/lib/` antes de empezar. Es la cifra que T7.3 debe llevar a cero.
- [ ] T0.3 Confirmar que el worktree `feature/redesign-design-system` sale de `origin/develop`
      y que no hay solape con `sintering-reaches-engine` (`git diff --stat` contra su rama).

## T1 — Tokens

- [ ] T1.1 Reescribir `frontend/src/app/globals.css`: superficies, tinta, acentos, semánticos,
      líneas, sombras, radio, canvas de visualización, gradientes tonales y rampa
      `--series-1…6`. Tema claro en `:root`, oscuro en `[data-theme="dark"]`.
- [ ] T1.2 Retirar `body.app-background` y su overlay. **No borrar** `/pyAgloGen3DBNG.png`: lo
      reutiliza la ola 2 como hero de autenticación.
- [ ] T1.3 Puente shadcn: regenerar `--background`, `--foreground`, `--primary`, `--border`,
      `--ring` y `--chart-1…5` **derivados** de los tokens nuevos, no copiados a mano.
- [ ] T1.4 Escala tipográfica y clases de micro-tipografía (`.label-xs`, `.eyebrow`, `.hint`).
- [ ] T1.5 Tests R-tokens: todo token de color tiene contraparte en ambos temas y ninguno
      resuelve a cadena vacía.

## T2 — Tailwind

- [ ] T2.1 Reescribir `tailwind.config.ts` derivando de los tokens; añadir familia `mono` y
      `fontVariantNumeric` tabular.
- [ ] T2.2 Test R-tailwind: el fichero no contiene ningún literal hexadecimal ni `rgb(`.

## T3 — Kit de primitivas

- [ ] T3.1 `Num` y `CopyText` — la regla de D7: número mono y tabular, unidad en elemento
      hermano, nunca concatenados.
- [ ] T3.2 `Panel`, `VisualPanel`, `PageHeader`, `DetailList`, `Callout`, `EmptyState`.
- [ ] T3.3 `MetricCard` con tono, delta, barra de progreso y línea de detalle.
- [ ] T3.4 `DataTable` sobre `ui/table`: cabecera sticky, columnas numéricas a la derecha,
      sin cebra.
- [ ] T3.5 `StatusChip`, `QualityBadge`, `StatusDot` — cada uno con etiqueta textual; el
      estado nunca se distingue solo por color.
- [ ] T3.6 `SegmentedControl`, `FilterBar`, `DisclosurePanel`, `DetailsDrawer` sobre
      `ui/dialog`.
- [ ] T3.7 `ShowValues` — el conmutador de alternativa textual (D6). Entra ahora aunque sus
      consumidores lleguen en las olas 2 y 3.
- [ ] T3.8 Tests de cada primitiva, incluidos los escenarios de accesibilidad de la spec.

## T4 — Tema de gráficas Plotly

- [ ] T4.1 `frontend/src/lib/chart-theme.ts`: `series(i)`, `dash(i)`, `marker(i)`, `layout()`.
- [ ] T4.2 Lectura de las variables del documento + re-lectura al cambiar `data-theme`;
      literales solo como fallback SSR.
- [ ] T4.3 Adelgazamiento de marcadores: menos de 60 marcadores en una serie de 500 puntos.
- [ ] T4.4 Tests R-charts: tres señales distintas por serie e indexadas por la misma posición;
      serie única sólida y sin marcadores; repintado al cambiar de tema.
- [ ] T4.5 **No se añade recharts.** Verificar que `package.json` no gana dependencias de
      gráficas (D5).

## T5 — Shell

- [ ] T5.1 `components/shell/Sidebar.tsx`: secciones agrupadas, sección de proyecto
      contextual, entrada de IA por acceso, sección admin por rol, `aria-current` en la activa.
- [ ] T5.2 `components/shell/TopBar.tsx`: breadcrumb, conmutador de tema, notificaciones,
      usuario.
- [ ] T5.3 `components/shell/AppShell.tsx` y montaje **único** en `app/layout.tsx` (D3).
- [ ] T5.4 `Header` deprecado: renderiza `null` bajo el shell. **Ninguna página se edita en
      esta ola.**
- [ ] T5.5 Responsive: iconos a <1440px, drawer con trampa de foco a <900px, frame a 1440px.
- [ ] T5.6 `UnitConventionBanner` adaptado al kit, con persistencia del descarte.
- [ ] T5.7 Tests del shell, incluidos los escenarios de scope de proyecto, acceso y rol.

## T6 — Tema

- [ ] T6.1 Script inline de resolución previa al primer paint; sin flash de tema incorrecto.
- [ ] T6.2 Persistencia en `localStorage` y precedencia sobre `prefers-color-scheme`.
- [ ] T6.3 Tests R-theme: los cuatro escenarios de la spec.

## T7 — Verificación

- [ ] T7.1 `cd frontend && npm test` verde; ningún test preexistente pasa a rojo.
- [ ] T7.2 `npm run type-check` sin errores nuevos respecto a la línea base de T0.1.
- [ ] T7.3 **Grep de literales de color a cero** bajo `components/` y `lib/` (D1, T0.2).
- [ ] T7.4 Verificación visual manual en navegador de los dos temas, en 1440, 1280, 900 y 360
      px, con capturas en el Log. Es un change de interfaz: la suite no sustituye mirar.
- [ ] T7.5 Contraste AA medido sobre las micro-etiquetas en ambos temas.
- [ ] T7.6 Backend y engine **sin tocar**: `git diff --stat` no muestra cambios fuera de
      `frontend/` y `openspec/`.

## T8 — Entrega y limpieza

- [ ] T8.1 PR a `develop` con etiqueta `type:feat` y el issue de Jira correspondiente.
- [ ] T8.2 Archive con sincronización canónica: los bloques ADDED completos de
      `design-system-foundation` y `app-shell-navigation` se escriben íntegros en
      `openspec/specs/`, nunca diferidos.
- [ ] T8.3 `state.yaml` actualizado.
- [ ] T8.4 **Limpieza tras el merge**, ordenada por la persona para esta entrega:
      - rama borrada en local y remoto;
      - `git worktree remove ~/code/.worktrees/pyaglogen3D-redesign-design-system` —
        **nunca con cambios sin commitear**, propios ni ajenos;
      - `git worktree prune` y `git gc` en el clon principal.
- [ ] T8.5 Avisar por intercom a la sesión dueña de la cadena `distribution-config-surface` de
      que la ola 1 está integrada, por si afecta a su rebase.

## Deuda conocida que este change NO cierra

- Las 18 páginas siguen importando `Header`; se retira en las olas 2 y 3, y el fichero se borra
  al cerrar la ola 3.
- `components/ui/*` (shadcn) convive con el kit (D4).
- Los seis residuales del `base44-port-checklist.md` pertenecen a las olas 2–4.
- El destino del export de Base44 (1,4 MB sin commitear) es decisión de la persona (D8).

## Log

<!-- Una entrada por tarea completada, con la evidencia que la respalda. -->
