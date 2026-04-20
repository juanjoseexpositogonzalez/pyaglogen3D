# Exploration: Radius of Gyration (Rg) verification

Phase: `sdd-explore` | Change: `verify-rg` | Project: `pyaglogen3D`

## 1. Executive summary

- **Formula is mathematically correct and matches MATLAB 1:1.** Rust
  `calculate_radius_of_gyration` in `aglogen_core/engine/src/simulation/metrics.rs:44`
  implements the exact same mass-weighted moment-of-inertia formula as
  `aglogen3D/calculateRadiusOfGyration.m:33-37`:
  `Ip = Σ [(3/5)·r_i^5 + r_i^3·d_i^2]`, `mp = Σ r_i^3`, `Rg = sqrt(Ip/mp)`.
- **Engine is dimensionless by design.** The frontend intentionally sends
  `radius_min = radius_ratio_min` (default `1.0`, unitless) and stores the
  physical size separately in `parameters.primary_particle_radius_nm` (default
  `25.0 nm`). The engine therefore returns a **unitless Rg**, and the UI
  multiplies by `primary_particle_radius_nm` to get nm.
- **Unit labelling is CORRECT on the main simulation detail page** but
  **INCONSISTENT across the rest of the frontend and the CSV export**. Several
  places display the raw unitless value with no suffix or with a misleading
  suffix, and the `rg_evolution` log-log chart is unscaled and unlabelled.
- **One semantic bug in the display convention**: the user-facing parameter is
  called "Primary Particle **Radius** (nm)" (default `25 nm`) but physically,
  in soot literature and in MATLAB `agloGen3D.m`, the typical value `25 nm`
  refers to the **diameter** `dpo`, not the radius `rp`. This makes every Rg
  in nm off by a factor of 2 against published soot sizes when users leave the
  default.
- **Numerical edge cases are handled but under-tested.** Empty input → 0, single
  particle → `sqrt(3/5)·r` (correct, Lapuerta constant). No degenerate-case or
  round-trip unit tests.

## 2. Mathematical formula comparison (Rust vs MATLAB)

### 2.1 Rust — `metrics.rs:44-69`

```rust
pub fn calculate_radius_of_gyration(coordinates: &[[f64; 3]], radii: &[f64]) -> f64 {
    if coordinates.is_empty() { return 0.0; }
    let cg = calculate_center_of_gravity(coordinates, radii);
    let mut ip = 0.0;
    let mut mp = 0.0;
    for (coord, &r) in coordinates.iter().zip(radii.iter()) {
        let pos = Vector3::new(coord[0], coord[1], coord[2]);
        let d = pos.distance_to(&cg);
        let r3 = r * r * r;
        let r5 = r3 * r * r;
        ip += (3.0 / 5.0) * r5 + r3 * d * d;
        mp += r3;
    }
    if mp > 0.0 { (ip / mp).sqrt() } else { 0.0 }
}
```

The centre of gravity `cg` is computed mass-weighted (mass ∝ r³), at
`metrics.rs:22-37`.

### 2.2 MATLAB — `aglogen3D/calculateRadiusOfGyration.m:33-37`

```matlab
idx = size(part, 1);
ri  = sum( (part(1:idx, 1:3) - repmat(cG, idx, 1)).^2, 2 );   % d_i^2
Ip  = sum( 3/5 * part(1:idx, 4).^5 + part(1:idx, 4).^3 .* ri );
mp  = sum( part(1:idx, 4).^3 );
rg  = sqrt( Ip / mp );
```

Where `part(:,1:3)` are the centres, `part(:,4)` the radii, and `cG` the
centre of gravity of the agglomerate.

### 2.3 Equivalence

Line-by-line match:

| Quantity                | MATLAB                             | Rust                       |
|-------------------------|------------------------------------|----------------------------|
| `d_i^2`                 | `sum((part(:,1:3)-cG).^2, 2)`      | `pos.distance_to(cg)` then `d*d` |
| `Ip` per-particle term  | `3/5 * r_i^5 + r_i^3 * d_i^2`      | `(3.0/5.0)*r5 + r3*d*d`    |
| `mp` per-particle term  | `r_i^3`                            | `r*r*r`                    |
| Final                   | `sqrt(Ip/mp)`                      | `(ip/mp).sqrt()`           |

Derivation (for reference): for a set of solid spheres treated as rigid bodies,
the mass-weighted moment of inertia about the centre of mass is
`I = Σ mᵢ (d_i² + (2/5)·r_i²)`. With `mᵢ ∝ r_i³`, dividing by total mass and
multiplying out `(2/5)·r_i²·r_i³ = (2/5)·r_i⁵` gives the canonical form used
here, except the Filippov/Sorensen convention drops the `(2/5)` → `(3/5)`
factor on the self-term (some authors write `Rg² = ⟨d²⟩ + (3/5)⟨r²⟩` with
`⟨·⟩` mass-averaged — the same result). The `(3/5)` is consistent with
`test_radius_of_gyration` at `metrics.rs:328-337` which asserts
`Rg = sqrt(3/5)·r` for a single particle.

### 2.4 Other Rg implementations in the codebase

- `aglogen_core/engine/src/simulation/cca.rs:128` — calls the canonical
  `calculate_radius_of_gyration`. OK.
- `aglogen_core/engine/src/simulation/fracval.rs:561,617` — precomputes `Rg`
  per cluster using an incremental rule and uses `calculate_radius_of_gyration`
  for the final value. The incremental rule is:
  `Rg²_merged = (m₁·(Rg₁² + d₁²) + m₂·(Rg₂² + d₂²)) / (m₁+m₂)` — parallel-axis,
  mass-weighted. Correct, and consistent with the formula above.
- `aglogen_core/engine/src/simulation/gcca.rs:112` — `(rg_sq / total_mass).sqrt()`,
  same parallel-axis scheme as fracval. Correct.
- `aglogen_core/engine/src/fractal/kf_analytic.rs:64` — closed-form `Rg` for
  analytical packing modes (line, plane, cuboctahedron, etc.) used for kf
  reference. Separate code path, analytical, correct per Lapuerta/Sorensen
  closed forms and covered by tests.
- `aglogen_core/engine/src/fractal/fraktal/image_processing.rs:200-244` —
  **2D image-domain Rg** for FRAKTAL (Mateos-Iriondo's image analysis). Formula
  is different on purpose: it's the pixel-based `Rg = sqrt(Σd²/n) · nm_per_px`
  with unit `r_px` treated uniformly (no per-pixel mass). This returns
  `radius_of_gyration_nm` directly in nm. Not a bug, different domain.

**Conclusion:** only one canonical Rg formula in the 3D simulation pipeline,
and it matches MATLAB.

## 3. Pipeline trace (inputs → display)

| Layer | Component | What Rg is | Units |
|-------|-----------|------------|-------|
| 0 | Frontend form `SimulationForm.tsx:661-671` | — | User selects **Primary Particle Radius (nm)** default `25`; plus dimensionless ratios `radius_ratio_min=1.0`, `radius_ratio_max=1.0` |
| 1 | Frontend → API | POST body `parameters` | `radius_min=1.0` (unitless), `radius_max=1.0`, `primary_particle_radius_nm=25.0` |
| 2 | Django task `simulations/tasks.py:1185-1186` | Passes radii through | `radius_min/radius_max` passed as-is to `aglogen_core.run_*` |
| 3 | PyO3 binding `python/src/lib.rs` | Forwards to engine | Unitless `radius_min/radius_max` |
| 4 | Rust engine (all `run_*_internal`) | Places particles with these radii, computes `Rg = sqrt(Ip/mp)` | **Unitless** (same unit as radii) |
| 5 | `PySimulationResult.radius_of_gyration` | Last value of `rg_evolution` (`python/src/lib.rs:342-346`) | Unitless |
| 6 | Django stores `simulation.metrics["radius_of_gyration"]` (`tasks.py:1529`) | JSON field | Unitless `float` |
| 7 | REST API `/simulations/{id}` serializer | Passes `metrics` as-is (JSONField) | Unitless |
| 8 | Frontend detail page `simulations/[simId]/page.tsx:377-378` | `Rg × primary_particle_radius_nm` | nm, label `" (nm)"` when `scaleFactor ≠ 1.0` |

Analogous flow for coordinates: raw coords from engine are unitless, frontend
scales them by `primary_particle_radius_nm` for 3D view
(`simulations/[simId]/page.tsx:199-209`).

## 4. Potential issues (ordered by severity)

### 4.1 HIGH — Default "Primary Particle Radius = 25 nm" is actually a diameter semantically

**Where:** `frontend/src/components/forms/SimulationForm.tsx:189,897-913`.

**What:** Default value `primary_particle_radius_nm: 25.0` plus label
`"Primary Particle Radius (nm)"` and help text `"Physical size of primary
particles."`. In the soot/AgloGen literature (thesis ch. 6, MATLAB
`agloGen3D.m`, FRAKTAL code) the canonical value ~25 nm is the **diameter
`dpo`**, not the radius `rp`. The same backend confirms this at
`backend/apps/ai_assistant/tools/analysis_tools.py:209`
(`"dpo: Mean primary particle diameter in nm."`) and at
`backend/apps/rag/services/chunking.py:199`
(`("dpo", "Primary particle diameter (dpo)")`).

**Effect:** with default settings every Rg displayed is **double** the value a
physicist would expect for the same geometry. Easy to see: default `radii_min
= 1.0` unitless inside the engine, so Rg comes out ~N^(1/Df) unitless; we
scale by `25` → result. But the number the user *thinks* they entered is a
diameter, so the physical radius they wanted is `12.5 nm`, not `25 nm`.

**Fix options (for PROPOSE):**
- (a) Rename field to "Primary Particle Diameter (nm)" and divide by 2 when
  building the scale factor. (Matches soot/FRAKTAL convention; breaks stored
  historical values.)
- (b) Keep field as "radius" and change default to `12.5`. (Preserves
  stored data, less idiomatic.)
- (c) Add both fields with a toggle.

### 4.2 MEDIUM — Inconsistent Rg display across pages

| Location | Shows | Scales? | Label |
|---|---|---|---|
| `frontend/src/app/projects/[id]/simulations/[simId]/page.tsx:377-378` | `Rg × scale` | Yes | `Radius of Gyration (nm)` when scale ≠ 1 |
| `frontend/src/app/projects/[id]/page.tsx:290-292` | `Rg × scale` | Yes | ` nm` suffix when scale ≠ 1 |
| `frontend/src/app/ai/page.tsx:861` | **raw `Rg.toFixed(1)`** | **No** | Bare `Rg: …` with no unit |
| `frontend/src/components/batch/BatchResultsTable.tsx:213,248` | **raw `Rg`** | **No** | Column header "Rg", no unit |
| `frontend/src/components/charts/RgEvolutionChart.tsx:64` | log10 of raw `rg_evolution` | No | Axis `log10(Rg)`, no unit |
| Engine export CSV `backend/apps/simulations/views.py:474` | raw `Rg` | N/A (backend) | Unit column says `"particle radii"` |
| Batch study export CSV `backend/apps/simulations/views.py:1116,1143` | raw `Rg` in column `"Rg"` | No | No unit |

The "particle radii" label in the export CSV is at least honest, but:
- misleads when the user *also* applies a scale factor mentally,
- contradicts what the detail page displays (which is nm).

**Effect:** A user who looks at Df = 1.8, Rg = 18.5 on the main page thinks
nm. The same simulation in the AI sidebar shows Rg = 0.74 (same number / 25)
with no unit, and in the CSV shows 0.7401 "particle radii". Confusing.

### 4.3 MEDIUM — Rg-evolution chart is not scaled and axis unit is missing

**Where:** `frontend/src/components/charts/RgEvolutionChart.tsx`.

The chart plots `log10(rg_evolution[i])` vs `log10(i+1)`. Because `rg_evolution`
is unitless, the slope is invariant under scaling (it's Df), so the chart
still gives a correct visual Df. However:
- the y-intercept is in log10 of unitless Rg, not log10(Rg/nm) and not
  log10(Rg/rp), so comparison with published kf values is impossible without
  manual unit work,
- the axis label `log10(Rg)` carries no unit annotation,
- the chart does not use `primary_particle_radius_nm` even when available.

### 4.4 LOW — Porosity uses Rg as bounding-sphere approximation

**Where:** `metrics.rs:164-184`.

```rust
let rg = calculate_radius_of_gyration(coordinates, radii);
let bounding_volume = (4.0 / 3.0) * PI * (2.0 * rg).powi(3);
```

Not a bug in Rg itself, but worth flagging: the porosity metric downstream
depends on Rg. Since Rg is correct, this propagates correctly; just note that
any change to Rg will also shift porosity.

### 4.5 LOW — Single-particle Rg is non-zero, which is semantically correct but frontend-unaware

`calculate_radius_of_gyration` returns `sqrt(3/5)·r ≈ 0.7746·r` for one
particle (Lapuerta constant). Correct. But `fracval.rs:94` initialises cluster
Rg at `0.0` for single-particle clusters and the incremental parallel-axis
formula compensates. Verified consistent.

### 4.6 LOW — CSV export labels Rg as "particle radii" even for scaled inputs

`views.py:474` writes `Rg` with unit column `"particle radii"`. This is
literally true for the engine's output, but a user who paid attention to the
`primary_particle_radius_nm` field will assume the number is nm. Since the
backend itself does not know about the frontend's scaling convention, the
cleanest fix is either (a) have the backend multiply by
`params.primary_particle_radius_nm` before exporting and label "nm", or
(b) explicitly state the convention and keep units unitless. Consistency
matters more than the choice.

### 4.7 LOW — FracVAL / GCCA send different radius semantics

- **FracVAL** (`run_fracval`): uses `geometric_mean` and `geometric_std`
  (lognormal sizes) — the frontend sends `geometric_mean: 1.0` by default
  (unitless), and the result Rg is still unitless, so scaling works the same
  way in principle. But FracVAL doesn't use `radius_min/radius_max`, so its
  relationship to `primary_particle_radius_nm` is conceptually fuzzier: is
  `geometric_mean=1.0` a mean *radius* or *diameter*? The backend treats it as
  a radius (engine-side convention). Worth documenting.
- **GCCA**: uses `radius_min/radius_max` with both defaults 1.0. OK.

### 4.8 INFO — Two MATLAB references exist

`aglogen3D/calculateRadiusOfGyration.m` and `calculateRadiusOfGyrationOld.m`
are identical in formula; they differ only in how they unpack `part` (the
newer one supports cell-arrays). The Rust port matches both.

## 5. Open questions (need user input)

1. **Convention choice:** should the field be labelled as *radius* (`rp`,
   current) or *diameter* (`dpo`, MATLAB/soot-literature standard)? The rest
   of the codebase (AI tools, FRAKTAL, RAG chunking) uses `dpo`. The 3D
   simulator uniquely uses `rp_nm`. Recommend aligning with `dpo`.
2. **Scope:** does the user want this to be a read-only verification (add
   tests and documentation only) or fix the display inconsistencies too? The
   task description says "verify" but also "Do the units match?" which
   implies a display fix is in scope.
3. **CSV unit convention:** should exports be in nm (scaled by
   `primary_particle_radius_nm`) or stay unitless? Scaling is friendlier;
   unitless is closer to what the engine actually produced.
4. **Default value:** if the field is renamed to diameter, default becomes
   `25 nm` (matches soot). If kept as radius, default should be `12.5 nm`.
5. **rg_evolution** chart: scale it too, or keep it unitless and add "(rp)"
   to the axis?

## 6. Recommendations for the PROPOSE phase

A proposed change should include, at minimum:

1. **New formal unit tests (engine side):**
   - Known-configuration Rg for a dimer, trimer, linear chain N=3..10
     (compare against `kf_analytic::radius_of_gyration(Line, n, dp)`).
   - Hexagonal plane (compare against `kf_analytic::radius_of_gyration(Hex, n, dp)`).
   - Scaling invariance: `calculate_radius_of_gyration(10·coords, 10·radii)
     == 10 × calculate_radius_of_gyration(coords, radii)` within fp tolerance.
   - Translation invariance: adding a constant vector to all coords leaves Rg
     unchanged.
2. **Decide and execute unit convention:**
   - Option A (recommended): rename `primary_particle_radius_nm` →
     `primary_particle_diameter_nm`, default `25`, and introduce a derived
     `scale_factor = dpo_nm / 2` in frontend. This aligns with the rest of
     the codebase (FRAKTAL, AI tools). Needs a simple frontend migration
     layer for existing simulations that still carry the old key.
   - Option B (minimal): keep the name, change default to `12.5` nm, update
     help text.
3. **Propagate the scale factor to ALL display paths:**
   - `frontend/src/app/ai/page.tsx:861`
   - `frontend/src/components/batch/BatchResultsTable.tsx:213,248`
   - `frontend/src/components/charts/RgEvolutionChart.tsx` (scale `yData`
     or at minimum label unit).
   - Batch-study export CSV `backend/apps/simulations/views.py:1116,1143`.
4. **Clarify CSV units:** either scale server-side before writing, or add a
   dedicated column "Unit" with `"rp"` / `"nm"` and document the convention.
5. **Docs:** add a short section to `docs/` explaining the unit convention
   (engine is unitless; nm is purely a display scaling based on
   `primary_particle_{radius|diameter}_nm`). This stops future
   contributors from re-asking the same question.

## Ready for proposal

**Yes.** The verification concluded:

- The formula is provably correct (line-by-line match with MATLAB).
- The engine is intentionally dimensionless; the scaling contract works but
  is partially implemented only on two display surfaces.
- There is one high-severity semantic issue (`radius` vs `diameter`
  labelling) and several medium-severity display inconsistencies.
- Open questions (§5) should be answered by the user before proposing. A
  minimal "tests-only" change is low-risk; a full "fix + tests + rename"
  change is the recommended path.
