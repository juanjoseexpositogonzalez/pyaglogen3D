# Approval: redesign-design-system

**Aprobado por la persona el 2026-10-22.**

Aprobación explícita del contrato en su estado `3addcfd`, tras cuatro rondas de spec-review
delegadas a agentes frescos (r1–r4) y con `openspec validate --strict` en verde.

## Qué queda aprobado

La ola 1 del port del rediseño de Base44 al `frontend/` real: tokens de diseño y temas claro y
oscuro, `tailwind.config.ts` derivado, el kit de 17 primitivas en `components/kit/`, el tema de
gráficas Plotly, y el shell de sidebar más barra superior montado en `app/layout.tsx`.

Ninguna pantalla de producto se reescribe en esta ola.

## Las decisiones que la persona aprueba expresamente

1. **D2 — La aplicación pasa a tema claro por defecto**, con el oscuro a un clic, y se retira
   el fondo de imagen `/pyAgloGen3DBNG.png` de la interfaz. El fichero se conserva para la
   ola 2.
2. **D3 — El shell se monta una sola vez en `app/layout.tsx`**, y `Header` queda deprecado
   renderizando `null`, de modo que esta ola no edita ninguna página de producto.
3. **D5 — El tema de gráficas se reexpresa en Plotly.** No se importa el código de recharts
   del prototipo ni se añade una segunda librería de gráficas.
4. **D8 — Entrega en dos PRs**, 1a fundación y 1b kit, shell y tema, cada uno con su propia
   puerta de verificación.
5. **D9 — El estado de tema vive en zustand**, junto al precedente de `viewerStore`.
6. **La reserva de superficie por fichero**, con liberación por aviso explícito de la sesión
   dueña y nunca por inferencia desde el archive.

## Decisiones de alcance tomadas durante la redacción

- **`polydispersity-single-source` queda aparcado** (2026-10-22). `SimulationForm.tsx` no lo
  reserva nadie y la ola 4 se parte en 4a y 4b. La ola 4a hereda la obligación de retirar el
  texto que promete tamaños variables y deshabilitar el control para `tunable_cc`, sin tocar
  cálculo.
- **Cambio de política** (2026-10-22): este change se termina bajo OpenSpec y AGENTS.md tal
  como están hoy. Las olas 2, 3, 4a y 4b se tramitan con la política nueva. La reserva de
  superficie y la condición de D4 deben reproducirse en el issue de cada ola posterior.

## Lo que esta aprobación NO cubre

- Las olas 2, 3 y 4: cada una necesita su propia autorización bajo la política nueva.
- La migración de las 21 specs canónicas a la forma que el tooling reconoce: chore aparte.
- La migración de los 170 literales de color preexistentes ni la retirada de shadcn.
- Cualquier cambio en backend, engine, rutas, cálculos o tolerancias numéricas.

## Condición permanente

El contrato no se cambia por el camino. Si la implementación obliga a tocar `proposal.md`,
las specs delta o una decisión de `design.md`, se para y se pide nueva aprobación. `tasks.md`
sí se actualiza al avanzar, con su Log y la evidencia.
