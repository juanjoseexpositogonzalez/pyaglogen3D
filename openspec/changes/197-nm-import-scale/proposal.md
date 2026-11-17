## Why

Issue #197: an aggregate imported by CSV whose coordinates are already in
nanometres is drawn, tabulated and exported multiplied by its own mean radius —
a uniform 12 nm particle reads as 144 nm on screen and in the exported CSV. The
chain: the import stamps `primary_particle_diameter_nm = 2 × mean(radius)`, and
every read boundary multiplies the dimensionless engine values by
`diameter / 2`, so an nm-geometry import is rescaled by its own mean radius.

The first attempt (PR #348, closed without merging) added a guard only to the
TypeScript shim. The judgment day found a critical defect, verified: the TS
module promises byte-for-byte parity with `params.py`, and the backend uses the
same factor in the CSV export, in `scale_factor_nm` and in the
`pixels_per_100nm` of the projections. The screen said 12 while the export kept
saying 144 — a new wrong number, inside an nm file. The rule that governs this
change: **the shim is changed on both sides or not at all.**

## What Changes

- `scale_nm` becomes an explicit, optional input field that **outranks
  everything else** in the scale-factor resolution of both shims
  (`apps.simulations.services.params.get_scale_factor_nm` and
  `frontend/src/lib/units.ts getScaleFactorNm`), in the same position with the
  same acceptance rule (positive finite number). It is not a special case for
  imports: it is one more input field read identically on both sides, and the
  diameter fallback order (`primary_particle_diameter_nm` →
  `primary_particle_radius_nm × 2` → `50.0`) is unchanged.
- The import pipeline stamps `scale_nm = 1.0` when the geometry is already in
  nm: CSV whose declared unit is not `dimensionless` (the parser defaults the
  unit to `nm` when the header omits it; the declared unit is normalized with
  `strip().lower()` so `#unit=NM` behaves like `nm`), and every `.mat` import,
  whose documented convention is that all distances share the radius column's
  physical unit. `primary_particle_diameter_nm` keeps telling the real physical
  diameter (`2 × mean_radius`), so the parameters panel does not lie.
- A dimensionless import carries no `scale_nm` and keeps the
  default-diameter path.
- Mirrored shim tests: every new case in
  `frontend/src/lib/__tests__/units.test.ts` has the same expected value in
  `backend/apps/simulations/tests/test_params_shim.py` — the parity test the
  first attempt lacked and that would have caught the critical.
- Value witnesses on both surfaces where the bug lived: the simulation detail
  page's particle table (radius 12 renders `12.0nm`, not 144) and the CSV
  export's `radius_nm` column (reads 12, not 144).
