# Proposal: distribution-config-wiring

> SDD change (política AGENTS.md). Origen: el usuario reportó "dos sitios que definen
> polidispersidad en el formulario batch". La exploración
> (`explore.md`, commit `e44a978`) encontró cuatro defectos; la persona eligió el
> **alcance A** (D1+D2+D3 ahora, D4 como change aparte) y **fix-forward** sin marcado
> retroactivo (decisiones 2026-10-21).

## Intent

Las cuatro *grid keys* que añadió el change archivado `batch-cc-tunable-parameter-parity`
(2026-05-13) se validan y se almacenan, pero **tres de ellas nunca han llegado al engine**.
Este change conecta las costuras y, sobre todo, **elimina el fallo silencioso**: hoy un
estudio batch con sinterizado se acepta y se ejecuta sin sinterizado, sin un solo error.

## Defectos en alcance

| # | Defecto | Evidencia (probe ejecutada contra el serializer real) |
| --- | --- | --- |
| **D1** | La UI batch emite `{mode}`; el validador exige `{distribution_type}` → `kf_distribution` y `particle_radius_config` dan **400 siempre** | `400 -> 'distribution_type is required in distribution config.'` |
| **D2** | `sintering_config` con la misma forma **se acepta** y luego `apply_sintering_config` cae a `fixed/1.0` | `apply_sintering_config({mode:'normal',mean:0.8,std:0.05}) -> {'sintering_type':'fixed','sintering_coeff':1.0}` |
| **D3** | `particle_radius_config` / `kf_distribution` no los lee nadie en el worker | `grep particle_radius_config backend/apps/simulations/tasks.py` → 0 ocurrencias |

**Fuera de alcance (change de seguimiento `polydispersity-single-source`):**

- **D4** — el toggle `Size Distribution / Polydisperse` del formulario single está muerto para
  `tunable_cc` (lo pisa el control de dpo en `SimulationForm.tsx:716-718` y, si el modo no es
  `fixed`, el propio engine en `tunable_cc.rs:1121`). Es semántica de UI para 6 algoritmos y
  merece su propio contrato.
- Cualquier cambio en `aglogen_core/`. **Este change no toca el engine**: `run_tunable_cc` ya
  acepta `dpo_*` y `kf_*` kwargs desde PYA-15.
- Marcado retroactivo de estudios ya creados (decisión de la persona: solo fix-forward,
  documentado en el comentario de entrega de Jira).

## Decisión de vocabulario

Hoy conviven **cuatro** deletreos del mismo concepto:

| Capa | Clave discriminadora |
| --- | --- |
| Frontend (`DistributionValue`, ambos formularios) | `mode` |
| Worker → engine (`expand_distribution_kwargs`) | `mode` |
| API single (`DistributionField`, `fields.py:32`) | `mode` |
| Validación grid batch (`distribution_validation.py:49`) | `distribution_type` |
| Spec canónica `batch-cc-tunable-parameter-parity` R1/R2 | `type` (no lo implementa nadie) |

**Se canoniza `{mode, …}`**: es lo que ya usan tres de las cuatro capas, incluido el único
validador que hoy funciona de verdad (`DistributionField`). Se mueve una sola función de
backend, no el frontend ni el engine.

**El sinterizado conserva su propia forma de dominio** `{distribution_type, coefficient|min,max|mean,std}`:
no es una distribución genérica (sus rangos están acotados a 0.5-1.0 y la variante `fixed`
usa `coefficient`, no `value`), y esa forma la comparten el campo de estudio y los parámetros
de la simulación single. Quien se adapta es la UI batch, no el dominio.

## Capabilities

### Modified Capabilities

- `batch-cc-tunable-parameter-parity`: **MODIFIED** R1, R2 (forma `mode` en vez de `type`),
  R3 (rechazo explícito de formas desconocidas en vez de defaulting silencioso), R10
  (las opciones de distribución solo se ofrecen para los algoritmos que las pueden consumir);
  **ADDED** R11 (cableado grid key → kwargs de engine). Delta en `specs/`.

## Por qué no hay Fase 0

La lección del ciclo 3 obliga a un diagnóstico numérico antes de lockear una hipótesis
estadística. **Este contrato no contiene ninguna**: no hay fórmulas, tolerancias ni sesgos de
estimador. Las tres afirmaciones de hecho que lo sostienen ya están verificadas por una probe
ejecutada contra el código real (ver tabla de defectos), no por lectura. El hilo que sí
requiere Fase 0 es `cc-tunable-df-fidelity` (Df=2.7/N=100 → 2.533), y la exploración descarta
que estos defectos lo expliquen.

## Impacto en comportamiento ya desplegado

D2 cambia el comportamiento a propósito. Los estudios batch cuyo sinterizado se descartó en
silencio empezarán a sinterizar o a fallar en validación. **Los resultados batch anteriores
con `sintering_config` no son lo que sus parámetros dicen**; eso se hace constar en el
comentario de entrega de Jira. Para `kf_distribution` y `particle_radius_config` no hay datos
históricos posibles: la UI nunca consiguió crearlos (400).
