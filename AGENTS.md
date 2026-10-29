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

## Cómo se trabaja: la issue aprobada es el gate — OBLIGATORIO

El gate de aprobación es una **issue de GitHub con la etiqueta `status:approved`**.
Hasta que esa etiqueta está puesta, no se escribe código. La aprobación es a la vez
legible por máquina (la etiqueta) y por una persona (el contrato en el cuerpo de la
issue). Adoptado el 2026-10-22 por la issue #82; sustituye al gate `approval.md`.

```text
idea
   ↓  explore                  ← anclar en el código real (Fase 0 antes de lockear fórmulas)
   ↓  issue de GitHub con el contrato  +  issue AGLO de seguimiento
issue con `status:approved`    ← ★ solo la persona aprueba
   ↓  rama → commits → push → PR → CI → revisión → merge → limpieza
   ↓  judgment-day antes del merge    ← agentes adversariales frescos, sesión nueva
```

Reglas que un agente cumple sin que se las recuerden:

- **No implementes sin `status:approved`.** El gate es de la persona; ningún agente
  lo sustituye, ni lo deduce de una conversación, ni lo hereda del relato de otra
  sesión. Si la etiqueta no está, el trabajo no empieza.
- **El contrato vive en la issue.** Si la implementación obliga a cambiarlo, para:
  hace falta nueva aprobación. El avance y su evidencia se registran en comentarios.
- **Una issue, un PR pequeño.** Por debajo de **400 líneas cambiadas**, salvo
  excepción de tamaño escrita en la issue. Lo que no quepa se encadena.
- **Tras la aprobación, la entrega no pide permiso paso a paso**: rama, commits,
  push, PR enlazando la issue, CI, merge con *merge commit* y borrado de la rama son
  la continuación ordinaria del flujo.
- **`judgment-day` se delega siempre en agentes nuevos**, sin la conversación autora.
  Lanzarlo es parte del flujo y no requiere autorización adicional. Quien acaba de
  escribir algo lee lo que quiso decir, no lo que pone.
- **Lección del ciclo 3 (obligatoria): Fase 0 primero.** Cuando el contrato dependa
  de una hipótesis numérica o estadística (fórmulas de fit, tolerancias, sesgos de
  estimador), se escribe un diagnóstico (`engine/examples/diagnostics/`) y se corren
  los números reales ANTES de lockear la decisión. Dos hipótesis lockeadas sin
  diagnóstico fueron refutadas por la evidencia.

### Carril corto, sin issue

Erratas, dependencias, despliegue y arreglos que restauran un comportamiento ya
cubierto por un test. Van por PR directo a `develop`. En caso de duda, hay issue.

## OpenSpec: el registro de specs, y sus siete reglas

`openspec/` se conserva como registro: las specs canónicas y el archivo de changes.
Lo que cambió en 2026-10-22 es el **gate de aprobación**, no el registro.

Cuando un trabajo toque specs, estas siete reglas son obligatorias. **Las siete están
verificadas contra el binario `openspec`, y ninguna es evidente leyendo el documento**:

1. Las deltas van en `specs/<capability>/spec.md`. Un fichero plano
   `specs/<capability>.md` **se ignora en silencio** al aplicar y al archivar.
2. Las specs canónicas necesitan esa misma forma de carpeta **y** encabezados
   `### Requirement: <texto>`. Sin ambas cosas el tooling no ve ninguna spec.
3. En un bloque `MODIFIED`, los títulos de escenario deben coincidir con el canónico
   **verbatim**. Un título reescrito se lee como un escenario eliminado.
4. `####` queda reservado a escenarios. Usado como subtítulo de prosa, se cuenta como
   escenario y el recuento miente.
5. `proposal.md` necesita las secciones `## Why` y `## What Changes`, con ese nombre
   exacto, o `openspec show` no lee nada. **Ésta no la caza `validate --strict`.**
6. Una spec canónica necesita una sección `## Purpose`. `## Overview` no vale: sin
   `## Purpose` el parser reporta **cero requisitos** aunque el fichero esté lleno de
   ellos. Verificado aislando un fichero: renombrar ese único encabezado llevó
   `rg-unit-contract` de `requirements 0` a `requirements 7`.
7. Un change que **no lleva deltas** a propósito (exploración, tooling, docs) necesita
   un `.openspec.yaml` con **ambas** líneas: `schema: spec-driven` y
   `skip_specs: true`. `skip_specs` por su cuenta **se ignora en silencio** —sólo se
   honra si el fichero parsea como metadata válida, y la metadata exige el campo
   `schema`—, así que los totales no se mueven y nada apunta a la causa. Y si el valor
   de `schema` es inválido, el validador recorta del error la lista de nombres
   válidos: sondear no la revela.

8. Un bloque `MODIFIED` **reemplaza el requisito entero**, y `validate --strict` sólo comprueba
   que no falte ningún **nombre** de escenario: no que no falte **texto**. Un bloque reescrito a
   mano con los títulos correctos **pasa el gate mientras borra prosa normativa viva** —MUSTs,
   tablas, etiquetas exactas, párrafos de excepción— y el borrado sólo se materializa al
   archivar. Medido el 2026-10-25: una reparación del contrato `distribution-grid-mode` habría
   eliminado las **ocho** menciones del carve-out de sinterizado de R7 entregado en #97, más la
   función pura de traducción y la prohibición de `NaN` de R10, con el validador en verde.
   **Se reconstruye el bloque desde el canónico y se añade encima; nunca se reescribe de
   memoria.** Y antes del PR se compara texto a texto, no por títulos.

**Gate antes del PR, no en el archive:**

```bash
openspec validate <change> --strict
openspec show <change> --json --deltas-only

# Y para cada bloque MODIFIED, la comprobación que el validador NO hace (regla 8):
# comparar el texto del bloque contra el canónico, no sólo los títulos de escenario.
diff <(awk '/^### Requirement: R7 /,/^### Requirement: R8 /' openspec/specs/<cap>/spec.md) \
     <(awk '/^### Requirement: R7 /,/^### Requirement: R8 /' openspec/changes/<change>/specs/<cap>/spec.md)
```

Un verde de `validate --strict` significa «la forma es correcta», no «el canónico conserva lo
que decía». Las dos cosas se comprueban por separado.

Por qué importa: `openspec show` no había funcionado nunca sobre ningún change de este
repositorio, y el tooling no veía ninguna de las specs canónicas. Ésa es la causa
mecánica de que el archive tuviera que sincronizarse a mano. Seis rondas de revisión
delegada sobre un contrato no detectaron nada de esto: comprobaban que el contrato
dijera la verdad sobre el código, no que fuera procesable por su propia herramienta.

## Registro dual: issue + tarea

La frontera es temporal, no temática:

- **La issue es el contrato**: lo que se va a construir, antes de construirlo.
- **La tarea ODD / Engram es el registro**: lo que se entregó y qué se
  aprendió. Enlaza a la issue; **no repite su contenido**.

Ningún trabajo que cambie comportamiento puede cerrarse sin registro. Un trabajo
de carril corto puede tener registro sin issue.

## Jira (AGLO) se actualiza en dos momentos — OBLIGATORIO

El issue de Jira es lo que lee quien no abre el repositorio. Se actualiza solo
en estos momentos:

| Cuándo | Qué se hace |
| --- | --- |
| Al **aprobar** la issue (paso ★) | La issue AGLO pasa a **En curso** (transición 21), comentando qué se va a construir y que todavía no existe, y enlaza la issue de GitHub que lleva el gate |
| Al **entregar** (merge a `develop`) | La misma issue recibe el **comentario de entrega** con la evidencia de lo que se comprobó, y pasa a **Finalizada** (transición 41) |
| Si el trabajo se **pausa** | La issue lo dice con fecha y por qué. Una issue en curso sin movimiento miente por inercia |
| Si se **abandona** un trabajo aprobado | El comentario lo registra; la issue vuelve a Por hacer con el motivo y se retira `status:approved` |

**Las issues de GitHub se cierran a mano al mergear a `develop`.** GitHub sólo cierra
automáticamente contra la rama por defecto (`main`), y aquí se mergea a `develop`, así que
un `Closes #N` en el PR no basta: el cierre es manual, con un comentario que enlace el PR
y el commit de merge.

Cada comentario nombra su issue de GitHub y su rama. El
issue de Cycle 3 es **AGLO-2** (proyecto AGLO en `isilduria.atlassian.net`).
El acceso a Jira es vía MCP Atlassian (session-shared o sesión peer con OAuth).

## Cuentas de GitHub: `gh` — OBLIGATORIO leerlo antes de escribir por API

Esta máquina tiene **dos cuentas** en `github.com` y **la activa cambia entre sesiones**:

| Cuenta | Permisos sobre este repo |
| --- | --- |
| `juanjoseexpositogonzalez` | **sí** — es el dueño |
| `jjeg1979` | **no** |

**El síntoma engaña**: `git push` funciona igual, porque va por credencial HTTPS y no por la API. Lo
que falla es **todo lo que escribe por API** — cerrar o crear issues, editar un PR, poner
etiquetas —, y falla de tres formas distintas según el comando: `does not have the correct
permissions`, `403 Must have admin rights`, o `perms=false` al consultar el repo. Depurar el
comando es perder el tiempo: la causa es la cuenta activa.

**Comprobación, una línea, antes de cualquier escritura por API:**

```bash
gh auth status | grep Active      # ¿la activa es juanjoseexpositogonzalez?
gh api repos/juanjoseexpositogonzalez/pyaglogen3D --jq .permissions.push   # debe decir true
```

**Arreglo preferido — sin tocar la cuenta activa.** El clon es compartido con otras sesiones y
cambiar la activa les cambia el contexto a ellas. Se pone el token de la cuenta correcta **solo para
ese comando**:

```bash
GH_TOKEN=$(gh auth token --user juanjoseexpositogonzalez) gh issue close 141 --reason completed
```

**Y ojo con el push**, que aquí muerde igual: `git push` directo por SSH falla en este entorno (el
agente no tiene identidades), así que el que se usa es el *credential helper* de `gh` —
`git -c credential.helper='!gh auth git-credential' push …`—, y **ese sí obedece a la cuenta
activa**: con `jjeg1979` activa devuelve `Permission … denied` y `403`. El mismo prefijo lo arregla:

```bash
GH_TOKEN=$(gh auth token --user juanjoseexpositogonzalez) \
  git -c credential.helper='!gh auth git-credential' push origin <rama>
```

**Si de verdad hace falta cambiar la activa** (`gh auth switch --user juanjoseexpositogonzalez`),
avisar primero por intercom: la configuración de `gh` no es por repositorio.

## Flujo de trabajo Git — OBLIGATORIO

**`main ← develop ← rama de trabajo`**:

- **`main`**: estable. Nunca commitear directo; solo recibe `develop`.
- **`develop`**: integración. Nunca commitear directo: todo entra por PR.
- **`feat/<nº-issue>-<slug>`**: un trabajo aprobado, con el número de su issue.
  **`fix/*`**, **`chore/*`**, **`docs/*`**, **`style/*`**: carril corto.
  Todas salen de `develop` y vuelven a `develop` por PR.

Tras la aprobación de la issue **no hay rebase ni force-push**: la rama se
actualiza con merge de `develop`. El merge del PR se hace con *merge commit*.

Tras el merge, la limpieza es **parte de la entrega y no pide permiso**
(decisión de la persona, 2026-10-23, sustituye a la regla anterior que la
hacía depender de una orden por entrega):

- **La rama mergeada se borra**, local y en el remoto: la historia vive en
  `develop`. Lo mismo su worktree, si lo tenía.
- **Nunca se retira un worktree con cambios sin commitear**, propio ni ajeno.
- **Las ramas sin merge se conservan** y se listan en el registro de la sesión.
- La autorización cubre **lo mergeado**. Borrar una rama ajena, o una que no
  ha entrado en `develop`, sigue necesitando una orden expresa.

Si dos sesiones comparten el mismo clon, ninguna cambia de rama, borra ramas
ni monta o retira worktrees sin avisar a las demás por el canal de
coordinación (intercom): el working tree es un recurso compartido.

**El ciclo de entrega se ejecuta completo, siempre**: una vez el trabajo está
verificado y ha pasado la revisión adversarial, cerrar la entrega —push
de la rama, PR enlazando el issue Jira (`AGLO-N`) con la etiqueta única
`type:*` (`bug|feat|test|docs|chore`), espera de CI, merge con merge commit y
limpieza de la rama— no pide autorización en cada paso: es la continuación
ordinaria del flujo, salvo indicación en contrario de la persona para esa
entrega concreta.

**Las etiquetas `type:*` del repo son `type:feat`, `type:bug`, `type:test`,
`type:docs` y `type:chore`.** `type:bug` no existía hasta el 2026-10-25, y
hasta entonces los arreglos se etiquetaban con `bug` a secas. Se creó para que
la familia fuera completa: una etiqueta suelta entre cuatro `type:*` era la
anomalía, no la que faltaba.

La etiqueta antigua `bug` sigue existiendo y marca issues anteriores a esa
fecha. **No se reetiquetan**: mover etiquetas de issues cerradas reescribe el
pasado sin aportar nada. Para trabajo nuevo, `type:bug`.

## Convenciones

- **Conventional Commits** en inglés; **sin atribución de AI** (ni
  Co-Authored-By). Los artefactos técnicos (código, comentarios, tests, docs
  del repo) en inglés; la conversación con la persona, en su idioma.
- Los tests de tolerancias numéricas **no se debilitan en silencio**: si una
  tolerancia cambia, es porque la evidencia de un diagnóstico lo dice, y esa
  evidencia queda en la issue y en la spec canónica.
- `state.yaml` es el índice del SDD: se actualiza en cada archive.

## Comandos útiles

```bash
# Diagnósticos del engine (Fase 0 / auditorías)
cargo run --release -p aglogen-engine --example <diagnostico>

# Suite completa del engine
cd aglogen_core && PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1 cargo test -p aglogen-engine --release
```
