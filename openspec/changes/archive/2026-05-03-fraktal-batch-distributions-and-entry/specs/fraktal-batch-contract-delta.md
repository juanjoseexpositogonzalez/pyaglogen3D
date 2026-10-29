# Delta for fraktal-batch-contract

Existing capability `fraktal-batch-contract` still applies in full. This delta records
two changes introduced by `fraktal-batch-distributions-and-entry`:

1. Simulation detail page gains an "Analyze projections" button that navigates to the
   batch upload page with `?origin=simulation&sim_id={X}` query params.
2. The batch upload page (`/projects/{id}/fraktal/batch/upload`) reads these query params
   and passes them as props to the `FraktalBatchUpload` component, enabling a
   simulation-origin pre-fill flow.

---

## ADDED Requirements

### R-DELTA-I. Simulation detail page exposes "Analyze projections" entry point

Adds to [`fraktal-batch-contract.md`](../../../specs/fraktal-batch-contract.md).

**GIVEN** a simulation detail page at `/projects/{projectId}/simulations/{simId}/`,
**WHEN** the simulation has completed and projection images are available (the simulation
has a non-null projections export or is in a "done" state),
**THEN** the page MUST render an "Analyze projections" button,
**AND** clicking the button MUST navigate to
`/projects/{projectId}/fraktal/batch/upload?origin=simulation&sim_id={simId}`,
**AND** `{simId}` MUST be the UUID of the current simulation,
**AND** the navigation MUST be a client-side route transition (no full page reload).

#### Scenario I.1 — Happy path: button navigates with correct params

- GIVEN a completed simulation with `sim_id = "abc-123"`
- WHEN the user clicks "Analyze projections"
- THEN the browser navigates to
  `/projects/{projectId}/fraktal/batch/upload?origin=simulation&sim_id=abc-123`
- AND the navigation is a client-side transition (Next.js router)

#### Scenario I.2 — Button absent when simulation not yet complete

- GIVEN a simulation whose status is "running" or "pending" (no projections yet)
- WHEN the simulation detail page renders
- THEN the "Analyze projections" button is NOT shown
- AND no navigation to the batch upload page is offered

#### Scenario I.3 — Button present for completed simulation

- GIVEN a simulation with status "done" and projections available
- WHEN the simulation detail page renders
- THEN the "Analyze projections" button IS visible
- AND it carries the correct `href` with both `origin` and `sim_id` params

---

### R-DELTA-J. Batch upload page propagates origin and sim_id query params to component

Adds to [`fraktal-batch-contract.md`](../../../specs/fraktal-batch-contract.md).

**GIVEN** the batch upload page at `/projects/{id}/fraktal/batch/upload`,
**WHEN** it is loaded with query params `?origin=simulation&sim_id={X}`,
**THEN** the page MUST parse both `origin` and `sim_id` from the URL query string,
**AND** pass them as props to the `FraktalBatchUpload` component:
`origin: string | null` and `sim_id: string | null`,
**AND** when `origin = "simulation"` AND `sim_id` is a valid non-empty string, the
`FraktalBatchUpload` component MUST operate in simulation-origin mode (pre-fill from sim),
**AND** when `origin` is absent, or `sim_id` is absent or empty, the component MUST
operate in standard external-upload mode (no pre-fill) without error,
**AND** when query params are malformed (e.g., `sim_id=` empty string, unexpected chars),
the component MUST fall back to external mode and MUST NOT throw or show an error page.

#### Scenario J.1 — Both params present: simulation-origin mode activated

- GIVEN navigation to `…/upload?origin=simulation&sim_id=abc-123`
- WHEN the page mounts and parses query params
- THEN `FraktalBatchUpload` receives `origin="simulation"` and `sim_id="abc-123"` as props
- AND the component enters simulation-origin mode

#### Scenario J.2 — Missing sim_id: falls back to external mode

- GIVEN navigation to `…/upload?origin=simulation` (no `sim_id` param)
- WHEN the page mounts
- THEN `FraktalBatchUpload` receives `origin="simulation"` and `sim_id=null`
- AND the component falls back to standard external-upload mode
- AND no error or warning is shown to the user

#### Scenario J.3 — No query params: standard external mode

- GIVEN navigation to `…/upload` (no query params)
- WHEN the page mounts
- THEN `FraktalBatchUpload` receives `origin=null` and `sim_id=null`
- AND the component renders in the standard external-upload mode unchanged

#### Scenario J.4 — Malformed query param: safe fallback

- GIVEN navigation to `…/upload?origin=simulation&sim_id=` (empty sim_id)
- WHEN the page parses the query string
- THEN `sim_id` is treated as null/empty
- AND the component falls back to external mode
- AND the page does NOT throw, does NOT show an error boundary

#### Scenario J.5 — Unknown origin value: ignored, external mode

- GIVEN navigation to `…/upload?origin=unknown_value&sim_id=abc-123`
- WHEN the page passes props to `FraktalBatchUpload`
- THEN the component does not recognize `origin="unknown_value"` as simulation-origin
- AND operates in external mode (sim_id is ignored when origin is not "simulation")
