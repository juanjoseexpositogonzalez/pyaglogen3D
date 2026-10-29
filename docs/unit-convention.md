# Unit Convention — Radius of Gyration & Parameters Schema

The Rust engine emits a dimensionless `Rg`; every user-facing surface scales it
to nm using `primary_particle_diameter_nm / 2` as the single source of truth.
Legacy simulations remain readable via a shim keyed on `parameters_schema_version`.

## 1. The engine is dimensionless

`aglogen_core::engine` computes `Rg = sqrt(Σ[(3/5)·r_i^5 + r_i^3·d_i^2] / Σ r_i^3)`
in `aglogen_core/engine/src/simulation/metrics.rs` (`calculate_radius_of_gyration`).
The result carries the same unit as the input radii — which the frontend sends
as unitless ratios (default `radius_min = radius_max = 1.0`). The formula is a
line-by-line match with MATLAB `agloGen3D.m` and is invariant under both
uniform scaling (`Rg(α·coords, α·radii) = α·Rg`) and translation. **Do not
re-derive the formula; link to `metrics.rs` instead.**

## 2. Display scales by diameter / 2

The contract at every read boundary is:

```
Rg_nm = Rg_engine × (primary_particle_diameter_nm / 2)
```

Single source of truth per language:

- **Python**: `backend/apps/simulations/services/params.py` → `get_scale_factor_nm(params)`
- **TypeScript**: `frontend/src/lib/units.ts` → `getScaleFactorNm(params)`

Both helpers MUST return the same value for the same `params` blob. Apply the
scale factor **exactly once**, at the read boundary. Never re-scale downstream
(do not pass both scaled and unscaled values through the same component).

## 3. Parameters schema versioning

The `parameters` JSONField carries an explicit `parameters_schema_version`:

- **v1 (legacy)**: uses `primary_particle_radius_nm`, no version field (or `null` / `"v1"`).
- **v2 (current)**: uses `primary_particle_diameter_nm` **and** `parameters_schema_version: "v2"`.

Read-side shim fallback order (identical in both languages):

1. `primary_particle_diameter_nm` if positive and finite → return it
2. `primary_particle_radius_nm × 2` if positive and finite → return it
3. Default `50.0` nm (equivalent to legacy default radius `25 × 2`)

All **new writes** use v2. v1 remains readable forever; no DB migration is
planned. A transition banner warns users viewing v1 simulations that display
values are now corrected (previously 2× the true nm value).

## 4. Adding a new display surface

Checklist for contributors shipping a new page, chart, export, or component
that renders `Rg`:

1. Import the helper for your side:
   ```python
   from apps.simulations.services.params import get_scale_factor_nm
   ```
   ```typescript
   import { getScaleFactorNm } from "@/lib/units";
   ```
2. Compute `scale = get_scale_factor_nm(params)` (or `getScaleFactorNm(params)`)
   **exactly once** at the read boundary.
3. Multiply the raw `metrics.radius_of_gyration` (or each entry in
   `rg_evolution`) by `scale` before rendering.
4. Label the value `nm` — suffix (`" nm"`), column header (`"Rg (nm)"`), or
   axis label.
5. Do NOT re-scale downstream. Pass the scaled value OR the raw value + scale,
   never both.
6. For log plots, use `log10(Rg/nm)` as the axis label.
7. Add a test or screenshot proving the new surface matches an existing one
   numerically for the same simulation (detail page is the reference).

## Further reading

History, rationale, and alternatives considered: `openspec/changes/verify-rg/`.
