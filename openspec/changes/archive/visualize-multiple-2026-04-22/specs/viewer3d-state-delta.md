# Delta: viewer3d-state (implicit capability)

> The canonical `viewer3d-state` capability does not exist as a standalone spec
> document today — it is the implicit behaviour of the global `useViewerStore`
> and the `CameraTracker` component used by the single-sim detail page. This
> delta documents the ONE change to that implicit contract required by
> `visualize-multiple`.
>
> Context: see `../proposal.md` §"Modified capabilities" and `../explore.md` §2
> "Global store coupling" for the race condition this delta resolves.

---

## Changed behaviour: camera state scoping

### R-DELTA-1. Camera state is scoped per route/context

**GIVEN** the application today writes camera azimuth/elevation/zoom to a single
global store slot from any mounted `AgglomerateViewer`
**WHEN** the Compare page mounts N viewers simultaneously (with or without
synchronisation enabled) while the single-sim detail page also exists
**THEN** writes from one context must not overwrite another context's camera
state.

Observable rules:
- The camera-state store (or provider) exposes at least two distinguishable keys/slots: one for the single-sim detail page (e.g. `"single"`) and one for the compare session (e.g. `"compare"` or `"compare/{sessionId}"`).
- A viewer mounted in the single-sim detail context reads/writes only the `"single"` slot.
- Viewers mounted inside a Compare session read/write only the compare slot (shared across the N viewers in that session — they cooperate per R3 of `multi-aggregate-comparison`, not via the global single-sim slot).
- Writes to the compare slot do not mutate the single-sim slot, and vice versa.
- The default slot (when no context is specified) keeps the pre-change semantics so legacy callers are unaffected.

#### Scenarios

- **S-DELTA-1.1 (no cross-contamination)**: Open the single-sim page for sim X → rotate the camera to angle A → open the Compare page (in another tab or after navigating) with sims X, Y, Z → rotate the compare cameras → return to the single-sim page for X → the camera is still at angle A, not at the compare angle.
- **S-DELTA-1.2 (compare cameras start fresh)**: With a saved single-sim camera at angle A for sim X, navigate to the Compare page including sim X → the compare viewer for X starts at the compare page's default framing (computed from bounding sphere per `AgglomerateViewer`), not at angle A.
- **S-DELTA-1.3 (shared within compare)**: Two tabs/routes cannot be relied upon to share the compare slot; within a single compare session the N viewers cooperate on camera sync per R3 of `multi-aggregate-comparison`.
- **S-DELTA-1.4 (legacy single-viewer default unchanged)**: A caller that does not explicitly opt into the compare scope continues to behave as it did before this change.
