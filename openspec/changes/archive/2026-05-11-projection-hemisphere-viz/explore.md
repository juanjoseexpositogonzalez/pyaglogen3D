# Exploration: Projection Hemisphere Visualization

## Executive Summary

**(Az, El) is stored as structured data** in `metadata.json` inside every projection ZIP export — each direction entry has explicit `azimuth` and `elevation` float fields. The single-preview endpoint uses (Az, El) as request parameters. There are **3 projection modes**: `grid` (rectangular Az × El grid), `fibonacci` (golden-angle spiral lattice), and `legacy` (manual Az/El sweep). All three parameterize direction as (azimuth_deg, elevation_deg). Grid elevation spans **[-90°, +90°]** (full sphere, not hemisphere-only). The visualization is **100% pure-frontend** — no backend changes needed.

---

## A. How (Az, El) Is Stored Per Projection

### Single Preview (live)
- **Endpoint**: `POST /api/v1/projects/{pid}/simulations/{sid}/projection/`
- **Request body**: `{azimuth: float, elevation: float, format: "png"|"svg"}`
- **Response**: Raw image bytes (no metadata)
- The frontend keeps `projectionParams` state with `{azimuth, elevation, format}` — see `page.tsx:62-66`

### Batch Export (ZIP download)
- **Endpoint**: `POST /api/v1/projects/{pid}/simulations/{sid}/projection/batch/`
- **Response**: ZIP file containing:
  - Per-direction PNG files: `proj_{idx:03d}_Az{AAA}_El{±EEE}.png` (canonical filename, see `projections.py:77-113`)
  - `metadata.json` at ZIP root with **structured direction data**:
    ```json
    {
      "mode": "grid"|"fibonacci"|"legacy",
      "n_requested": 32,
      "n_generated": 32,
      "parameters": {"n_az": 10, "n_el": 5, "img_size": 512, ...},
      "directions": [
        {"index": 0, "filename": "proj_000_Az000_El-090.png", "azimuth": 0.0, "elevation": -90.0, "pixels_per_100nm": 12.5},
        ...
      ]
    }
    ```
  - Source: `projections.py:116-167` (`build_metadata_json`)

### Key Finding: No Persistent DB Model for Projections
- There is **NO Projection Django model** in `models.py`. Projections are ephemeral: generated on-demand, served as bytes, and optionally packaged into a ZIP for download.
- **(Az, El) lives in**:
  1. The user's request params (single preview)
  2. `metadata.json` inside ZIPs (batch)
  3. Filenames encode it redundantly: `proj_007_Az045_El+030.png`
- For the hemisphere viz, the grid directions are **computable client-side** (we know the formula from the Rust engine). The actually-generated list comes from the user's batch config or from a downloaded ZIP's `metadata.json`.

---

## B. Projection Modes

### 1. Grid Mode (`mode: "grid"`)
- **Parameterization**: (azimuth_deg, elevation_deg)
- **Grid**: `n_az` azimuth samples in `[0°, 360°)` evenly spaced, `n_el` elevation samples in `linspace(-90°, +90°, n_el)` — both poles as endpoints
- **Pole dedup**: El = ±90° emits exactly 1 direction (Az canonicalized to 0°)
- **Count**: `n_az * (n_el - 2) + 2`
- **Source**: `aglogen_core/engine/src/projection/directions.rs:47-84`
- **Can map to (Az, El)**: YES — native parameterization

### 2. Fibonacci Mode (`mode: "fibonacci"`)
- **Parameterization**: Golden-angle Fibonacci lattice on full unit sphere
- **Formula** (per point `i` of `n`):
  ```
  y = 1.0 - (2*i + 1) / n      // symmetric [-1, 1]
  r = sqrt(1 - y²)
  theta = i * φ                 // φ = π(3 - √5)
  azimuth = atan2(r*sin(theta), r*cos(theta)) mod 360°
  elevation = asin(y) in degrees
  ```
- **Count**: Exactly `n`
- **Source**: `directions.rs:106-137`
- **Can map to (Az, El)**: YES — each point IS an (Az, El) pair

### 3. Legacy Mode (`mode: "legacy"`)
- **Parameterization**: Manual sweep `Az ∈ [start, end] step S`, `El ∈ [start, end] step T`
- **Count**: `floor((az_end - az_start)/az_step + 1) × floor((el_end - el_start)/el_step + 1)`
- **Validation**: Az in [0°, 360°], El in [-90°, 90°], positive steps
- **Source**: `views.py:708-908`
- **Can map to (Az, El)**: YES — direct sweep

### Conclusion: ALL 3 modes produce (Az, El) pairs. A SINGLE unified hemisphere viz handles all.

---

## C. Frontend Layout Today

### UI Library
- **Tailwind CSS 3.4** + **shadcn/ui** custom components (Card, Button, Input, Slider, Select, Progress, Alert, Label)
- Components in `frontend/src/components/ui/`

### Projection Section Layout (page.tsx:621-647)
```
┌──────────────────────────────────┬───────────────────┐
│   ProjectionViewer (3/4 width)   │  ProjectionControls│
│   Shows single preview image     │  (1/4 width)      │
│   Az/El displayed in title       │  Mode selector     │
│                                  │  Sliders + inputs  │
│                                  │  Download ZIP btn  │
└──────────────────────────────────┴───────────────────┘
```
- Uses `lg:grid-cols-4` — viewer gets `lg:col-span-3`, controls get `lg:col-span-1`
- The ProjectionViewer shows a SINGLE image at a time with Az/El in the header

### Where the hemisphere fits naturally
**Option A (recommended)**: Inside the `ProjectionViewer` Card, BELOW the image. It's a small SVG disk (200-250px diameter) showing "where you are" on the sphere. Minimal layout disruption.

**Option B**: As a separate Card between the viewer and controls (would require changing the grid to 5 columns or stacking). More disruptive.

**Option C**: Inside ProjectionControls card, below the mode selector. Cramped but informative for batch config.

**Recommendation**: Option A — below the preview image, inside `ProjectionViewer`. Minimal coupling, clear visual association ("this image was taken from THIS direction").

---

## D. Discretization Grid

### Grid Mode Specifics
- Elevation: `linspace(-90°, +90°, n_el)` — **FULL sphere** (not hemisphere)
- Azimuth: `linspace(0°, 360°, n_az + 1)[0..n_az]` — excludes 360° to avoid duplication with 0°
- Default UI values: `n_az=10`, `n_el=5` → 32 projections
- User-configurable: any n_az ≥ 1, n_el ≥ 2

### Hemisphere vs Full Sphere
The user said "hemisphere" but the ACTUAL grid spans El ∈ [-90°, +90°] (both hemispheres). Two interpretations:
1. **Stereographic projection of full sphere** — standard stereographic from one pole projects the whole sphere minus one point onto a plane. For El ∈ [-90°, +90°]:
   - Project from south pole: center = north pole (El=90°), outer circle = equator (El=0°), El < 0° maps OUTSIDE the equator circle (to infinity at south pole)
   - Alternative: two hemispheres side-by-side (equirectangular)
2. **If we pick hemisphere (El ≥ 0°)**: Only half the directions shown; the lower hemisphere would need a separate viz or a toggle

**Recommendation**: Use **stereographic from south pole** for El ∈ [0°, 90°] (upper hemisphere) + optionally a ring/area for El < 0° (lower hemisphere). Since most scientific projections use positive elevations only (looking at particle from above), default to showing the upper hemisphere with an expandable option for the full sphere.

### Math for Upper Hemisphere Stereographic (South Pole Projection)
For a point at (Az, El) where El ∈ [0°, 90°]:
```
r = cos(El) / (1 + sin(El))    // r ∈ [0, 1]: center=pole, edge=equator
θ = Az (in radians)
x = r · cos(θ)
y = r · sin(θ)
```
- El = 90° (pole) → r = 0 → center of disk ✓
- El = 0° (equator) → r = cos(0)/(1+sin(0)) = 1/1 = 1 → outer circle ✓
- Parallels → concentric circles (r decreases as El increases)
- Meridians → straight radial lines from center

For El < 0° (optional lower hemisphere expansion):
```
r_lower = cos(El) / (1 + sin(El))  // Note: sin(El) < 0, so denominator < 1, r > 1
```
Points at negative elevation project OUTSIDE the unit circle. Could render as a second concentric ring area beyond the equator circle.

---

## E. Stereographic Projection Math (for implementation)

### Core Transform
```typescript
function stereoProject(az_deg: number, el_deg: number, R: number): {x: number, y: number} {
  const az = az_deg * Math.PI / 180
  const el = el_deg * Math.PI / 180
  // Stereographic from south pole
  const r = R * Math.cos(el) / (1 + Math.sin(el))
  return { x: r * Math.cos(az), y: r * Math.sin(az) }
}
```

### Grid Lines
- **Parallels** (constant El): circles of radius `R * cos(El) / (1 + sin(El))`
  - Every 15° or 30° of El → 3 or 6 concentric circles for upper hemisphere
- **Meridians** (constant Az): straight lines from center to edge at angle Az
  - Every 30° or 45° → 12 or 8 radial lines

### SVG Structure
```
<svg viewBox="-1.1 -1.1 2.2 2.2" width={size} height={size}>
  <!-- Outer circle (equator) -->
  <circle cx="0" cy="0" r="1" stroke="..." fill="none" />
  
  <!-- Parallels at El = 15°, 30°, 45°, 60°, 75° -->
  {parallels.map(el => <circle r={cos(el)/(1+sin(el))} ... />)}
  
  <!-- Meridians at Az = 0°, 30°, ..., 330° -->
  {meridians.map(az => <line x1="0" y1="0" x2={cos(az)} y2={sin(az)} ... />)}
  
  <!-- Grid dots (all possible) — gray -->
  {gridDirections.map(d => <circle cx={...} cy={...} r="0.02" fill="gray" ... />)}
  
  <!-- Generated dots — accent color -->
  {generatedDirections.map(d => <circle cx={...} cy={...} r="0.025" fill="blue" ... />)}
  
  <!-- Selected dot — ring highlight -->
  {selected && <circle cx={...} cy={...} r="0.04" stroke="orange" fill="none" ... />}
</svg>
```

### Performance
- Worst case Grid: n_az=36, n_el=19 → 36 × 17 + 2 = 614 dots
- Worst case Fibonacci: n=10000 dots
- SVG handles 10k circles trivially. For > 1000 dots, consider `<use>` or canvas fallback.

---

## F. Implementation Strategy Sketch

### Component: `ProjectionHemisphere.tsx`

```typescript
interface ProjectionHemisphereProps {
  /** All grid points (computed from mode params) */
  gridDirections: Array<{az: number, el: number}>
  /** Actually generated/downloaded directions */
  generatedDirections: Array<{az: number, el: number, id?: string}>
  /** Currently viewed projection direction */
  selectedDirection?: {az: number, el: number}
  /** Diameter in px */
  size?: number  // default 220
  /** Click handler for a direction dot */
  onDirectionClick?: (az: number, el: number) => void
  /** Show lower hemisphere (El < 0) */
  showLowerHemisphere?: boolean
}
```

### Where it lives
- New file: `frontend/src/components/projection/ProjectionHemisphere.tsx`
- Export from `frontend/src/components/projection/index.ts`
- Rendered inside `ProjectionViewer.tsx` below the image

### Grid computation (frontend-only)
Replicate the Rust formulas in TypeScript:
```typescript
export function computeGridDirections(nAz: number, nEl: number): Array<{az: number, el: number}> { ... }
export function computeFibonacciDirections(n: number): Array<{az: number, el: number}> { ... }
export function computeLegacyDirections(azStart, azEnd, azStep, elStart, elEnd, elStep): Array<{az: number, el: number}> { ... }
```
These are simple math — no backend call needed.

### Data flow
1. User configures batch params → `ProjectionControls` computes `gridDirections` from params
2. User triggers export → after ZIP download, parse `metadata.json` to get `generatedDirections`
3. User clicks Preview → `selectedDirection` updates
4. Hemisphere re-renders showing all three layers

---

## G. Backend Needs

### Answer: NONE for MVP

All information needed is available client-side:
1. **Grid directions**: Computable from `(n_az, n_el)` or `(n)` using the same math as the Rust engine
2. **Selected direction**: Already in `projectionParams` state (`page.tsx:62`)
3. **Generated directions**: Either:
   - Derive from batch params (we know what was requested)
   - Parse `metadata.json` from downloaded ZIP (for post-download state)

### Optional Enhancement (post-MVP)
If we want to show "which projections exist on disk for this simulation" (e.g. after navigating away and coming back), we'd need a lightweight endpoint:
```
GET /api/v1/projects/{pid}/simulations/{sid}/projection/directions/
→ { directions: [{az, el, index}], mode, n_generated }
```
But this requires persisting export state (currently ephemeral). **Defer to future.**

---

## Open Questions

1. **Click-to-generate**: Should clicking a non-generated dot trigger a single projection preview? (Easy: just call the existing preview endpoint with that Az/El. Recommend YES for MVP — trivial.)

2. **Lower hemisphere rendering**: Since elevation spans [-90°, +90°], should we:
   - Default to upper hemisphere only (El ≥ 0°) with a toggle for full sphere?
   - Always show full sphere with outer ring for negative elevations?
   - **Recommend**: Default to upper hemisphere, toggle for full. Most users care about positive elevations.

3. **Progress animation**: Show dots appearing as batch export progresses? (The polling already returns `{current, total}` — map `current/total` to filling dots. Nice UX, low effort.)

4. **Hover tooltip**: Show "Az: 45°, El: 30°" on hover? (**Yes** — trivial with SVG `<title>` or a Tailwind tooltip.)

5. **Fibonacci layout on hemisphere**: Fibonacci points are non-uniform on the stereographic projection (denser near poles). Is this confusing? (No — it accurately represents the distribution. Label the mode clearly.)

---

## Affected Areas

- `frontend/src/components/projection/ProjectionHemisphere.tsx` — **NEW FILE** (core viz component)
- `frontend/src/components/projection/index.ts` — Add export
- `frontend/src/components/projection/ProjectionViewer.tsx` — Render hemisphere below image
- `frontend/src/components/projection/ProjectionControls.tsx` — Pass gridDirections to parent (or compute in parent page)
- `frontend/src/app/projects/[id]/simulations/[simId]/page.tsx` — Wire hemisphere props, compute directions from current mode params
- `frontend/src/lib/projectionMath.ts` — **NEW FILE** (direction generators + stereographic transform)

---

## Approaches

### 1. SVG-Only React Component (Recommended)
- **Description**: Pure SVG rendered via React JSX, stereographic math in a utility module, all frontend
- **Pros**: Zero dependencies, fast, accessible (SVG is DOM), testable, pixel-perfect
- **Cons**: None significant for this scale (< 10k elements)
- **Effort**: Low-Medium (2-3 days including tests)

### 2. Canvas-Based Component
- **Description**: HTML5 Canvas with imperative drawing
- **Pros**: Better perf for > 10k points
- **Cons**: No DOM events per dot (need hit-testing), less accessible, harder to test
- **Effort**: Medium
- **When**: Only if fibonacci n=10000 causes SVG lag (unlikely)

### 3. D3.js Integration
- **Description**: Use d3-geo for stereographic projection + d3-selection for rendering
- **Pros**: Mathematically precise projections, handles edge cases
- **Cons**: Heavy dependency, React+D3 interop complexity, overkill for this
- **Effort**: Medium-High
- **When**: Only if we need rotatable/interactive globe later

---

## Recommendation

**Approach 1 (SVG-Only)** with:
- Stereographic math in `lib/projectionMath.ts` (unit-testable, no DOM)
- `ProjectionHemisphere.tsx` as a presentational React component
- Placed inside `ProjectionViewer` card below the image
- Click-to-preview on any dot (connected to existing preview handler)
- Upper hemisphere default, toggle for full sphere
- Hover tooltips via SVG `<title>` elements

This is a **pure-frontend** feature. Zero backend changes. The math is trivial (< 30 lines). The component is self-contained. Tests via vitest + React Testing Library.

---

## Risks

1. **Fibonacci 10k points SVG perf**: Unlikely bottleneck, but worth profiling. Mitigation: lazy-render only visible dots, or switch to canvas for n > 2000.
2. **State sync after export**: If user exports, then navigates away and comes back, we lose "which were generated". Mitigation: For MVP, hemisphere shows the CONFIGURED grid (all dots same color) + highlights current preview. Post-MVP: persist export metadata.
3. **Lower hemisphere stereographic distortion**: Points near El = -90° project to infinity. Mitigation: clamp display to El ≥ -60° or use a separate visualization for lower hemisphere.

---

## Ready for Proposal

**Yes** — all critical unknowns resolved:
- (Az, El) parameterization is universal across all 3 modes
- No backend changes needed
- Layout slot identified (inside ProjectionViewer card)
- Math documented
- Component API designed
- Risk profile is low
