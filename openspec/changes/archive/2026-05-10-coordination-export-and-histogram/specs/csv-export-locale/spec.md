# CSV Export Specification

## Purpose

CSV export behavior for SimulationViewSet and ParametricStudyViewSet. Covers the format, sections, and backward-compatibility rules for both per-simulation and batch export endpoints.

## Requirements

### Requirement: Per-Simulation CSV — Coordination Sections

`GET /api/v1/projects/{project_pk}/simulations/{pk}/export/` MUST include two new sections after the existing content: "Coordination per particle" and "Coordination distribution". Sections are separated from each other and from existing content by a blank line and a comment row.

#### Scenario: Coordination per-particle section present

- GIVEN a simulation has completed with `per_particle` populated
- WHEN `GET /api/v1/projects/{project_pk}/simulations/{pk}/export/` is called
- THEN the response MUST contain a section starting with `# section: coordination_per_particle`
- AND the section header row MUST be `particle_id,n_contacts,contact_neighbors`
- AND exactly N data rows follow (one per particle)
- AND the `contact_neighbors` column is a `;`-separated list of integer IDs, quoted as a single CSV cell (e.g. `"3;7;12"`)

#### Scenario: Coordination distribution section present

- GIVEN a simulation has completed with `distribution` populated
- WHEN `GET /api/v1/projects/{project_pk}/simulations/{pk}/export/` is called
- THEN the response MUST contain a section starting with `# section: coordination_distribution`
- AND the section header row MUST be `coordination,count`
- AND rows cover all coordination numbers 0 through max observed (including zero-count entries)

#### Scenario: Existing sections preserved and ordered

- GIVEN any simulation export
- WHEN the CSV is parsed
- THEN all columns present before this change MUST still be present
- AND their order MUST be unchanged
- AND new sections appear AFTER all existing content

#### Scenario: Simulation without per_particle data (legacy sim)

- GIVEN a simulation completed before this change (no `per_particle` field in metrics)
- WHEN `GET .../export/` is called
- THEN the response MUST still return HTTP 200
- AND the coordination sections MAY be absent or empty (not a 500 error)

#### Scenario: Section delimiter format

- GIVEN any simulation export
- WHEN the raw CSV bytes are inspected
- THEN each section is preceded by one blank line and one comment row matching `# section: <name>`

---

### Requirement: Batch CSV Export — Aggregate Coordination Columns

`GET /api/v1/projects/{project_pk}/studies/{pk}/export/` MUST include four new aggregate columns appended to the existing per-simulation rows: `coord_mean`, `coord_std`, `coord_mode`, `coord_max`.

#### Scenario: New aggregate columns appended

- GIVEN a parametric study with at least one completed simulation
- WHEN `GET /api/v1/projects/{project_pk}/studies/{pk}/export/` is called
- THEN the CSV header MUST include `coord_mean`, `coord_std`, `coord_mode`, `coord_max` as new trailing columns
- AND all pre-existing columns are preserved in their original order

#### Scenario: coord_mode definition — unimodal

- GIVEN a simulation where coordination number 4 has the highest count
- WHEN `coord_mode` is computed for that simulation's row
- THEN `coord_mode = 4`

#### Scenario: coord_mode definition — multimodal tie

- GIVEN a simulation where two coordination numbers share the highest count
- WHEN `coord_mode` is computed
- THEN `coord_mode = min(tied_modes)` (lowest mode wins the tie)

#### Scenario: coord_max definition

- GIVEN a simulation with a maximum observed coordination number of 8
- WHEN `coord_max` is read from the batch CSV
- THEN `coord_max = 8`

#### Scenario: Simulation with no coordination data (legacy or failed)

- GIVEN a batch study containing a simulation with no `per_particle` / `distribution`
- WHEN the batch CSV is generated
- THEN the coordination columns for that row MUST be empty strings (not errors, not 0)

#### Scenario: Per-particle data NOT included by default

- GIVEN a batch export call with no query params
- WHEN the CSV is received
- THEN it MUST NOT contain per-particle rows (column count stays constant)

#### Scenario: Optional per-particle expansion (MAY ship in this cycle)

- GIVEN a batch export call with `?include_per_particle=true`
- WHEN the CSV is received
- THEN each simulation's per-particle section MAY be included as additional rows after its aggregate row
- AND the format SHOULD match the per-simulation CSV section format (R5)
- AND if this param is not implemented in this cycle, the server MUST return 400 with a clear message rather than silently ignoring it

---

### Requirement: JSON Metrics Backward Compatibility

The DRF `SimulationSerializer` exposes `metrics` as a JSON pass-through. No serializer change is required for the new fields, but consumers MUST be able to access them and MUST handle their absence gracefully.

#### Scenario: New fields accessible via GET simulation

- GIVEN a newly completed simulation
- WHEN `GET /api/v1/projects/{project_pk}/simulations/{pk}/` is called
- THEN `response.data.metrics.coordination.distribution` MUST be a dict (not null, not missing)
- AND `response.data.metrics.coordination.per_particle` MUST be a list (not null, not missing)

#### Scenario: Legacy sim does not crash consumer

- GIVEN a simulation completed before this change
- WHEN a frontend consumer reads `response.metrics.coordination.distribution`
- THEN the absence of the field MUST NOT cause a runtime crash
- AND the consumer SHOULD treat absence as "not yet computed" and render a fallback UI state
