# Design: verify-rg

## Architecture overview

The engine stays dimensionless. The unit contract is enforced at every **read
boundary** (frontend display, backend CSV export) through a single helper per
language that converts the unitless Rg into nm using
`scale_nm = primary_particle_diameter_nm / 2`. Legacy data is handled by a
read-side shim that accepts the old `primary_particle_radius_nm` key; new
writes always use the new key AND stamp `parameters_schema_version = "v2"`.

```
                  ┌──────────── Rust engine ────────────┐
                  │  Rg (unitless) — formula unchanged  │
                  │  NEW: invariance + closed-form tests│
                  └──────────────┬──────────────────────┘
                                 │ metrics["radius_of_gyration"]
           ┌─────────────────────┼────────────────────────┐
           ▼                     ▼                        ▼
   Python shim                TS shim                TS shim
   services/params.py         lib/units.ts           lib/units.ts
           │                     │                        │
           ▼                     ▼                        ▼
   CSV export (nm +        Detail / project /      Rg-evolution
   Unit column)            AI / batch tables       chart (scaled)
```

## Key components

### 1. Engine tests (Rust)
**Location**: `aglogen_core/engine/src/simulation/metrics.rs` — extend the
existing `#[cfg(test)] mod tests` (starts line 312).
**Purpose**: Freeze correct Rg behaviour as regression suite.
**New tests**:
- `test_rg_scaling_invariance` — `Rg(α·coords, α·radii) == α·Rg(coords, radii)`
  for α ∈ {2, 10, 0.1}. Tolerance `1e-10`.
- `test_rg_translation_invariance` — adding `[17.3, -4.1, 9.0]` to all coords
  leaves Rg unchanged. Tolerance `1e-10`.
- `test_rg_dimer_closed_form` — 2 spheres r=1 separated by 2: Rg via formula
  vs `sqrt(1 + 3/5)`. Tolerance `1e-10`.
- `test_rg_linear_chain_matches_kf_analytic` — chain N ∈ {3, 5, 10} vs
  `kf_analytic::radius_of_gyration(Line, n, 2.0)`. Tolerance `1e-6`.
- `test_rg_hex_plane_matches_kf_analytic` — Hex N ∈ {7, 19} vs
  `kf_analytic::radius_of_gyration(Hex, n, 2.0)`. Tolerance `1e-6`.

Use `approx::assert_relative_eq!(actual, expected, epsilon = …)`.

### 2. Python shim — `backend/apps/simulations/services/params.py` (new)
```python
PARAM_KEY_DIAMETER = "primary_particle_diameter_nm"
PARAM_KEY_RADIUS_LEGACY = "primary_particle_radius_nm"
DEFAULT_DIAMETER_NM = 50.0  # equivalent to legacy default radius 25 × 2

def get_primary_particle_diameter_nm(params: dict) -> float:
    """Read diameter, preferring v2 key, falling back to v1 radius × 2."""
def get_scale_factor_nm(params: dict) -> float:
    """Return dpo / 2. Single source of truth for nm scaling on backend."""
def get_schema_version(params: dict) -> str | None:
    """Return 'v2', 'v1', or None for ancient rows."""
```
**Fallback order**: v2 key (if positive) → v1 key × 2 (if positive) →
`DEFAULT_DIAMETER_NM`. Non-positive / missing values fall through.

### 3. TS shim — `frontend/src/lib/units.ts` (new)
```typescript
export const DEFAULT_DIAMETER_NM = 50.0;
export function getPrimaryParticleDiameterNm(params: Record<string, unknown>): number
export function getScaleFactorNm(params: Record<string, unknown>): number  // dpo/2
export function getSchemaVersion(params: Record<string, unknown>): "v1" | "v2" | null
```
Same fallback order as Python; both helpers MUST agree.

### 4. CSV export (modify)
**Location**: `backend/apps/simulations/views.py:474` (single export) +
`~1116, ~1143` (batch). Import shim, compute
`scale = get_scale_factor_nm(simulation.parameters)`, multiply the Rg value,
set unit column to `"nm"` (replacing `"particle radii"`). Add `Unit` column
to batch CSVs if missing (additive for consumers).

### 5. Frontend display wiring (modify)
Each surface imports `getScaleFactorNm` and multiplies the raw
`metrics.radius_of_gyration` exactly once:
- `app/projects/[id]/simulations/[simId]/page.tsx:377-378`
- `app/projects/[id]/page.tsx:290-292`
- `app/ai/page.tsx:861` — add ` nm` suffix
- `components/batch/BatchResultsTable.tsx:213,248` — column header `Rg (nm)`
- `components/charts/RgEvolutionChart.tsx` — `yData = rg_evolution.map(v => v * scale)`;
  axis label `"Rg (nm)"` if linear, `"log10(Rg/nm)"` if log retained.
- `components/forms/SimulationForm.tsx` — rename field label/state/default
  to `primary_particle_diameter_nm = 25.0`, help text: "Primary particle
  diameter `dpo` in nm (soot convention)".

### 6. Transition banner — `frontend/src/components/banners/UnitConventionBanner.tsx` (new)
```typescript
interface Props {
  simulationId: string;
  schemaVersion: "v1" | null;  // never rendered for v2
  userId: string;
  onDismiss: () => void;
}
```
- Dismissal key: `localStorage["dismissed-banner:unit-convention:" + userId]`
  (boolean). Persists across simulations and sessions for the same user.
- Mount points: top of simulation detail page AND project list page.
- Copy: "Unit convention updated. Rg values previously displayed were 2× the
  correct nm value; display is now corrected. Stored data unchanged. [Learn
  more](/docs/unit-convention) [Dismiss]."

### 7. Docs — `docs/unit-convention.md` (new)
Four sections: (1) engine is dimensionless, (2) display = `Rg × dpo/2`,
(3) schema v1 (`primary_particle_radius_nm`) vs v2
(`primary_particle_diameter_nm` + `parameters_schema_version: "v2"`),
(4) how to add a new display surface (import helper, multiply, label nm).

## Data model changes

### Parameters JSON payload v1 → v2
```jsonc
// v1 (legacy, still accepted on read)
{ "primary_particle_radius_nm": 25.0, "radius_min": 1.0, "radius_max": 1.0 /* ... */ }

// v2 (new writes)
{
  "primary_particle_diameter_nm": 25.0,
  "parameters_schema_version": "v2",
  "radius_min": 1.0,
  "radius_max": 1.0
  /* ... */
}
```
No Django migration. `parameters` is already `JSONField` on the Simulation
model; schema lives inside the JSON blob.

**Write sites to update**:
- `backend/apps/simulations/serializers.SimulationSerializer.create` — stamp
  `parameters_schema_version = "v2"` at creation.
- `backend/apps/simulations/tasks.py` (around 1185) — read diameter via shim
  before mapping to engine inputs.

## Data flow (before / after)

```
BEFORE:  engine Rg (unitless) ──► metrics JSON ──► 2 surfaces scale, 5 don't
                                                     (inconsistent)

AFTER:   engine Rg (unitless) ──► metrics JSON ──► getScaleFactorNm(params)
                                                     × Rg everywhere ──► nm
                                  schema v1 or null ──► banner until dismissed
```

## Algorithm notes

- `kf_analytic::radius_of_gyration(Line, n, dp=2.0)` returns Rg for a chain
  with **diameter** `dp=2`, so primary radius `r=1`. Tests call it with
  `dp=2.0` to match `radii = vec![1.0; n]`.
- Hex packing index convention: `kf_analytic` assumes hexagonal close-packed
  plane; N must be a centred-hex number (1, 7, 19, 37, …). Use 7 and 19.

## Edge cases

- **Legacy row with `primary_particle_radius_nm = 0` or negative**: shim
  ignores and falls through to next step (eventually `DEFAULT_DIAMETER_NM`).
- **Both keys present** (shouldn't happen, but defensive): new key wins if
  positive.
- **CSV export of v1 simulation**: shim returns `radius × 2`, Rg scales, unit
  column says `"nm"`. Correct.
- **User dismisses banner on sim A, opens sim B (also v1)**: banner does NOT
  reappear — `localStorage` key is per-user, not per-simulation.
- **rg_evolution is empty array** (early-failure sim): chart renders "no
  data", no division / multiplication happens.

## Backwards compatibility

- **Engine**: no API change. Tests are purely additive.
- **Database**: zero migrations. Existing rows keep their JSON blob verbatim;
  shim reads them via v1 fallback.
- **CSV consumers**: the `Unit` value changes from `"particle radii"` to
  `"nm"` AND the numerical Rg value changes by `dpo/2` factor. Documented in
  changelog. The single-sim CSV already had a `Unit` column, so structure is
  unchanged. Batch CSVs gain a column (additive).
- **Frontend**: old simulations render correctly via shim; banner warns the
  user their Rg now displays at the true physical value.

## Testing strategy

| Layer | What | Where |
|---|---|---|
| Engine unit | Scaling, translation, dimer, Line N, Hex N | `metrics.rs` tests mod |
| Python unit | Shim fallback order, schema detection | `backend/apps/simulations/tests/test_params_shim.py` (new) |
| TS unit | `getScaleFactorNm` parity with Python fallback | `frontend/src/lib/__tests__/units.test.ts` (new) |
| Backend integration | CSV export for v1 and v2 simulations — Rg numeric + Unit=nm | extend existing CSV export test |
| Frontend component | Banner shows for v1, hidden for v2, stays dismissed | `UnitConventionBanner.test.tsx` |
| Manual | Side-by-side screenshot of all 5 display surfaces → same Rg, all "nm" | acceptance checklist |

## Open questions

- RgEvolutionChart: keep log-log (label `log10(Rg/nm)`) or switch to linear
  (label `Rg (nm)`)? Default: keep log-log, update axis label. Confirm in
  TASKS phase.
- Should `parameters_schema_version` ALSO be written as a top-level column on
  the `Simulation` model for queryability? Default: no — keep inside JSON
  blob for this change. Revisit if future migrations need it.
