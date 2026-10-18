# AGENTS.md — Reglas del repo pyaglogen3D para cualquier agente

Instrucciones de proyecto que **deben** respetarse en cada sesión, sea cual sea
la herramienta (Pi / Gentle Shell, Claude Code u otra). Política de ciclo de
desarrollo adoptada del repo `isilduria-safety-core` (Magma Agents), adaptada a
este stack y a Jira.

## Qué es esto

**pyAgloGen3D**: plataforma de simulación de aglomerados fractales 3D
tuneables (kf, Df) y análisis fractal. Port del código Matlab de
`matlab_reference/` a un engine Rust (`aglogen_core/`), expuesto vía backend
Django + frontend Next.js, desplegado en Easypanel.

## Estructura

```text
aglogen_core/        # Workspace Rust: engine (cómputo) + python (bindings pyo3)
backend/             # Django REST API + worker (Dockerfile, Dockerfile.worker)
frontend/            # Next.js 14 (vitest)
matlab_reference/    # Referencia original (read-only: la especificación)
openspec/            # SDD: specs canónicas + changes + archive + state.yaml
docs/, scripts/      # Documentación y utilidades
```

# Suite

```bash
cd aglogen_core && PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1 cargo test -p aglogen-engine --release
cd aglogen_core && PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1 cargo check -p aglogen-python
cd backend && pytest && ruff check && mypy .
cd frontend && npm test && npm run lint && npm run type-check
```

Nota: `cargo build -p aglogen-python` falla en el paso de link cdylib por
entorno (pyo3 extension-module en macOS necesita el flag que provee maturin);
`cargo check` es el gate válido de bindings. El build de producción va por
`maturin build --release` en los Dockerfiles.

## Cómo se trabaja: el contrato es el change — OBLIGATORIO

El desarrollo es **Spec-Driven con OpenSpec**. Todo trabajo que altere el
comportamiento del sistema es un *change* en `openspec/changes/<nombre>/`, y
**no se escribe código hasta que su contrato (proposal + specs + design +
tasks) ha pasado `spec-review` y está aprobado por la persona**.

```text
idea / issue Jira
   ↓  explore                  ← anclar en el código real (con diagnóstico si hay incertidumbre: Fase 0 antes de lockear fórmulas)
   ↓  proposal + specs + design + tasks
   ↓  spec-review              ← delegada a agente fresco, sin la conversación autora
contrato aprobado (approval.md)   ← ★ solo la persona aprueba
   ↓  apply                    ← implementación tarea a tarea, con verificación por riesgo
   ↓  adversarial-review       ← agentes adversariales frescos (judgment-day), en sesión nueva
   ↓  archive + canonical sync + PR listo
```

Reglas que un agente cumple sin que se las recuerden:

- **No implementes sin `approval.md`.** El gate de aprobación es de la
  persona; ningún agente lo sustituye. Los cambios ya autorizados en la
  petición original se detallan en `approval.md`, no se infieren.
- **El contrato no se cambia por el camino.** Si la implementación obliga a
  tocar `proposal.md`, `specs/` o decisiones de `design.md`, para: hace falta
  nueva aprobación. `tasks.md` sí se actualiza al avanzar (y su Log con la
  evidencia).
- **`spec-review` y `adversarial-review` se delegan siempre en agentes nuevos,
  sin la conversación autora; salvo indicación en contrario de la persona.**
  Lanzarlas es parte del flujo y **no requiere autorización adicional**. El
  orquestador no las ejecuta *inline*; si el entorno no permite delegarlas, se
  abre sesión nueva antes de continuar. Quien acaba de escribir algo lee lo
  que quiso decir, no lo que pone.
- **Lección del ciclo 3 (obligatoria): Fase 0 primero.** Cuando el contrato
  dependa de una hipótesis numérica/estadística (fórmulas de fit, tolerancias,
  sesgos de estimador), se escribe un diagnóstico (`engine/examples/diagnostics/`)
  y se corren los números reales ANTES de lockear la decisión en `design.md`.
  Dos hipótesis lockeadas sin diagnóstico fueron refutadas por la evidencia.
- **Los ficheros canónicos de openspec se sincronizan en el archive** — el
  archive escribe los bloques MODIFIED/ADDED completos en
  `openspec/specs/`, nunca los difiere (lección del ciclo 2).

### Carril corto, sin change

Erratas, documentación, dependencias, despliegue y arreglos que restauran un
comportamiento ya cubierto por una spec o un test. Van por PR directo a
`develop`. En caso de duda, es un change.

## Registro dual: change + tarea

La frontera es temporal, no temática:

- **El change es el contrato**: lo que se va a construir, antes de construirlo.
- **La tarea ODD / Engram es el registro**: lo que se entregó y qué se
  aprendió. Enlaza al change; **no repite su contenido**.

Ningún trabajo que cambie comportamiento puede tener change sin registro al
cerrarlo. Un trabajo de carril corto puede tener registro sin change.

## Jira (AGLO) se actualiza en dos momentos — OBLIGATORIO

El issue de Jira es lo que lee quien no abre el repositorio. Se actualiza solo
en estos momentos:

| Cuándo | Qué se hace |
| --- | --- |
| Al **aprobar** el contrato (paso ★) | La issue pasa a **En curso** (transición 21), comentando qué se va a construir y que todavía no existe |
| Al **archivar** | La misma issue recibe el **comentario de entrega** con la evidencia de lo que se comprobó, y pasa a **Finalizada** (transición 41) |
| Si el trabajo se **pausa** | La issue lo dice con fecha y por qué. Una issue en curso sin movimiento miente por inercia |
| Si se **abandona** un change aprobado | El comentario lo registra; la issue vuelve a Por hacer con el motivo |

Cada comentario nombra su change (`cc-tunable-bc-alignment`) y su rama. El
issue de Cycle 3 es **AGLO-2** (proyecto AGLO en `isilduria.atlassian.net`).
El acceso a Jira es vía MCP Atlassian (session-shared o sesión peer con OAuth).

## Flujo de trabajo Git — OBLIGATORIO

**`main ← develop ← rama de trabajo`**:

- **`main`**: estable. Nunca commitear directo; solo recibe `develop`.
- **`develop`**: integración. Nunca commitear directo: todo entra por PR.
- **`feature/<nombre-del-change>`**: un change, con su mismo nombre.
  **`fix/*`**, **`chore/*`**, **`docs/*`**, **`style/*`**: carril corto.
  Todas salen de `develop` y vuelven a `develop` por PR.

Tras la aprobación del contrato **no hay rebase ni force-push**: la rama se
actualiza con merge de `develop`. El merge del PR se hace con *merge commit*.

Tras el merge, la entrega se cierra con una limpieza que **siempre ordena la
persona** para esa entrega — no es una autorización permanente:

- **La rama de trabajo se borra**, local y en el remoto: la historia vive en
  `develop`.
- **Nunca se retira un worktree con cambios sin commitear**, propio ni ajeno.
- **Las ramas sin merge se conservan** y se listan en el registro de la sesión.

Si dos sesiones comparten el mismo clon, ninguna cambia de rama, borra ramas
ni monta o retira worktrees sin avisar a las demás por el canal de
coordinación (intercom): el working tree es un recurso compartido.

**El ciclo de entrega se ejecuta completo, siempre**: una vez el change está
archivado con su verificación y revisión adversarial, cerrar la entrega —push
de la rama, PR enlazando el issue Jira (`AGLO-N`) con la etiqueta única
`type:*` (`bug|feat|test|docs|chore`), espera de CI, merge con merge commit y
limpieza de la rama— no pide autorización en cada paso: es la continuación
ordinaria del flujo, salvo indicación en contrario de la persona para esa
entrega concreta.

## Convenciones

- **Conventional Commits** en inglés; **sin atribución de AI** (ni
  Co-Authored-By). Los artefactos técnicos (código, comentarios, tests, docs
  del repo) en inglés; la conversación con la persona, en su idioma.
- Los tests de tolerancias numéricas **no se debilitan en silencio**: si una
  tolerancia cambia, es porque la evidencia de un diagnóstico lo dice, y esa
  evidencia queda en el Log del change y en la spec canónica.
- `state.yaml` es el índice del SDD: se actualiza en cada archive.

## Comandos útiles

```bash
# Diagnósticos del engine (Fase 0 / auditorías)
cargo run --release -p aglogen-engine --example <diagnostico>

# Suite completa del engine
cd aglogen_core && PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1 cargo test -p aglogen-engine --release
```
