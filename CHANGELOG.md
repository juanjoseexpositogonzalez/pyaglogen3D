# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to conventional commits.

## verify-rg (unreleased)

### Changed — UNIT CONVENTION UPDATED (observable to all users)

- Rg values displayed in the UI and CSV exports are now in **nm**, scaled
  from the dimensionless engine value by `primary_particle_diameter_nm / 2`.
- CSV exports: single-sim export uses `Unit = "nm"` (was `"particle radii"`);
  batch export renames the `Rg` column to `Rg_nm`.
- Simulations previously displayed had Rg at **2×** the correct nm value
  due to a long-standing naming bug (field called "radius" stored as diameter).
  **Stored data is unchanged**; only the display scaling is corrected.

### Added

- `parameters_schema_version` field on `Simulation.parameters` (`"v1"` legacy,
  `"v2"` current). Read-side shim handles both; writes always use `v2`.
- UnitConventionBanner on simulation detail and project list pages for
  legacy (v1) simulations. Dismissable per-user.
- `docs/unit-convention.md` — contributor reference.

### Fixed

- Rg display inconsistency across 5 surfaces (detail page, project page,
  AI sidebar, batch table, evolution chart).
- RgEvolutionChart axis label now reads `log10(Rg/nm)` (was `log10(Rg)`).

### Tests

- 5 engine Rg correctness tests (scaling, translation, dimer, chain, hex).
- 25 Python shim + 32 TypeScript shim tests (byte-for-byte parity).
- 6 serializer + 3 tasks.py mapping + 4 CSV export integration tests.
- 6 UnitConventionBanner component tests.

Total: ~81 new tests.
