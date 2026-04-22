# Spec: viewer3d-state

## Overview

This capability documents the contract for the 3D viewer's camera state
(azimuth / elevation / zoom / orbit target) and how that state is scoped across
the different surfaces that mount `AgglomerateViewer`. It exists because the
original implementation wrote camera state to a single global store slot from
any mounted viewer, which became incorrect once multiple viewers could be live
at the same time (see `multi-aggregate-comparison`).

Scope: the rules in this spec apply to both the single-sim detail page and the
multi-aggregate compare page. Any future surface that mounts an
`AgglomerateViewer` is expected to declare which scope it belongs to.

History: this contract was introduced by the `visualize-multiple` change
(archived `visualize-multiple-2026-04-22`). Prior to that change the camera
state was effectively a single global slot; this spec formalises the scoping
model the compare view requires.

---

## Requirements

### R1. Camera state is scoped per route/context

**GIVEN** the application renders one or more `AgglomerateViewer` instances
across different surfaces (single-sim detail page, compare page, future
contexts)
**WHEN** any viewer's camera is rotated, panned, or zoomed
**THEN** that write is isolated to its own scope and does not overwrite another
scope's camera state.

Observable rules:
- The camera-state store (or provider) exposes at least two distinguishable keys/slots: one for the single-sim detail page (e.g. `"single"`) and one for each compare session (e.g. `"compare"` or `"compare/{sessionId}"`).
- A viewer mounted in the single-sim detail context reads/writes only the `"single"` slot.
- Viewers mounted inside a Compare session read/write only the compare slot (shared across the N viewers in that session — they cooperate per R3 of `multi-aggregate-comparison`, not via the global single-sim slot).
- Writes to the compare slot do not mutate the single-sim slot, and vice versa.
- The default slot (when no context is specified) keeps the pre-change semantics so legacy callers are unaffected.

#### Scenarios

- **S1.1 (no cross-contamination)**: Open the single-sim page for sim X → rotate the camera to angle A → open the Compare page (in another tab or after navigating) with sims X, Y, Z → rotate the compare cameras → return to the single-sim page for X → the camera is still at angle A, not at the compare angle.
- **S1.2 (compare cameras start fresh)**: With a saved single-sim camera at angle A for sim X, navigate to the Compare page including sim X → the compare viewer for X starts at the compare page's default framing (computed from bounding sphere per `AgglomerateViewer`), not at angle A.
- **S1.3 (shared within compare)**: Two tabs/routes cannot be relied upon to share the compare slot; within a single compare session the N viewers cooperate on camera sync per R3 of `multi-aggregate-comparison`.
- **S1.4 (legacy single-viewer default unchanged)**: A caller that does not explicitly opt into the compare scope continues to behave as it did before the `visualize-multiple` change.
