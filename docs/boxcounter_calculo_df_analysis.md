# BOXCOUNTER — `CalculoDf.m` and `casosLimiteEsferas.m` deep analysis

> Analysis of two large MATLAB helpers in `/home/juanjo/code/aglogen3D/BOXCOUNTER/`
> produced for the Rust port (pyaglogen3D). Read-only reference archive; this
> document is strictly descriptive.

Companion to `box_counting_comparison.md`. This report focuses on the two
largest helpers of the legacy GUI BOXCOUNTER and what they mean for the
Rust 3D Morton box-counter.

---

## 1. Executive summary

### 1.1 What `CalculoDf.m` actually is

`CalculoDf.m` is a **single, self-contained function** (file line 1:
`function [x,y,Xc,Yc,Dimension_fractal,Df,Stop,param] = CalculoDf(...)`)
called from exactly one place: the **"Calculate Df" GUI callback** in
`Esferas.m:1935`. It is **not** an orchestrator of `box_count.m` /
`fit_frac.m` / `Prefactor.m` — it does not call them at all. Instead, it
implements **its own analytical box-counting** inline, specialized per
geometry, using sphere–box intersection tests.

Concretely, it is a **synthetic benchmark/expected-value calculator**:
given a geometry selector `modo ∈ {1..11}` plus size parameters, it
returns the box-counting Df of the *exact* analytical sphere arrangement
(line of spheres, cross, asterisk, plane, cuboctahedron, etc.) with no
noise or voxelization — the sphere is kept as an analytic sphere and is
queried by closed-form distance tests at the box corners/center.

### 1.2 What `casosLimiteEsferas.m` actually is

`casosLimiteEsferas.m` is a **cluster-geometry generator** (file line 1:
`function [ clusters ] = casosLimiteEsferas( varargin )`). Given the same
kind of geometry selector (as a string: `'lineal'`, `'cruz2d'`,
`'asterisco'`, `'cruz3d'`, `'plano'`, `'dobleplano'`, `'tripleplano'`,
`'cuboctaedro'`) plus packing mode (`'HC'`, `'CS'`, `'CCC'`) and a
particle diameter `dp0`, it returns an `Nx4` array
`[ xx yy zz r ]` — the centres and radius of every primary sphere.

It is used by the GUI both to *draw* the reference cluster and, via
`crearArchivoDat.m`, to dump coordinates to `.dat` so that external tools
(or the legacy `box_count.m`) can consume them. In the 2D/3D cross, plane,
and cuboctahedron cases it is the **only** place where the reference
sphere-configuration coordinates live.

### 1.3 How the three files relate

```
Esferas.m (GUI)
   ├── "Generate sample" buttons → casosLimiteEsferas.m  (coordinates)
   │                               └── crearArchivoDat.m → .dat file → box_count.m
   │
   ├── "Calculate Df" button     → CalculoDf.m           (analytical Df)
   │                               └── (no calls; inline box counting)
   │
   └── "Calculate Kf" button     → Prefactor.m           (analytical Kf)
                                   └── (closed-form dg/d formulas per modo)
```

So there are **two parallel code paths** for the reference geometries:

1. **Symbolic/analytical** (`CalculoDf.m` + `Prefactor.m`): every geometry
   is known in closed form; Df and Kf come from direct geometric
   computation on spheres without ever building a point cloud.
2. **Empirical** (`casosLimiteEsferas.m` → `crearArchivoDat.m` →
   `box_count.m` → `fit_frac.m`): the same geometry is materialized as
   discrete sphere coordinates and processed through the generic Hou
   bit-interleaving pipeline like any other user cluster.

The two paths converge on the same *expected Df*, which is exactly the
usefulness of the pair for the Rust port: `casosLimiteEsferas.m` gives
you the inputs (sphere centres), the theoretical Df is known for each
case, and `CalculoDf.m` gives you an analytical cross-check free of
voxel/precision artifacts.

### 1.4 Relationship to the 8 `Prefactor` modes

The numeric `modo` argument used across `CalculoDf.m` (cases `1..11`) and
`Prefactor.m` (cases `1..8`) is the same key, and the 8 `Prefactor` modes
map 1-to-1 onto the 3D geometries:

| `modo` | Geometry            | `Prefactor.m` case | `casosLimiteEsferas.m` string |
|-------:|---------------------|-------------------:|-------------------------------|
| 1      | Line (3D)           | 1                  | `'lineal'`                    |
| 2      | Cross 2D            | 2                  | `'cruz2d'`                    |
| 3      | Asterisk            | 3                  | `'asterisco'`                 |
| 4      | Cross 3D            | 4                  | `'cruz3d'`                    |
| 5      | Plane               | 5                  | `'plano'`                     |
| 6      | Double plane        | 6                  | `'dobleplano'`                |
| 7      | Triple plane        | 7                  | `'tripleplano'`               |
| 8      | Cuboctahedron (3D)  | 8                  | `'cuboctaedro'`               |
| 9-11   | 2D versions of 1-3  | —                  | — (2D not in CLE)             |

The 9/10/11 cases in `CalculoDf.m` (`linea2d`, `cruz2d`, `asterisco2d`)
are purely 2D analogues (no `Zi,Zf` terms); they do not appear in
`Prefactor.m`. So there are exactly **8 3D reference geometries** and 3
2D analogues.

---

## 2. `CalculoDf.m` — deep analysis

### 2.1 Signature and flow control

Line 1:

```matlab
function [x,y,Xc,Yc,Dimension_fractal,Df,Stop,param] = ...
  CalculoDf(modo,esferas,esferas2d,capas,CapaEspacial, ...
            EmpaquetamientoPlanar,EmpaquetamientoEspacial, ...
            MinIteraciones,MaxIteraciones)
```

Inputs:

- `modo` (int 1..11): geometry selector; routed by `switch modo` at
  `CalculoDf.m:9`.
- `esferas`: number of primary spheres in the diagonal of 3D
  configurations (cases 1..4).
- `esferas2d`: same role for 2D configurations (cases 9..11).
- `capas`: number of layers for planar/multiplanar configurations (5..7).
- `CapaEspacial`: number of spatial layers for the cuboctahedron (case 8).
- `EmpaquetamientoPlanar` (int 1 or 2): 1 = HC (hexagonal compact),
  2 = CS (simple cubic).
- `EmpaquetamientoEspacial` (int 1, 2, 3): 1 = cuboctahedron/HC,
  2 = SC, 3 = BCC (subcases inside `case 8`, `CalculoDf.m:1054-1395`).
- `MinIteraciones`, `MaxIteraciones`: scan range of an outer iteration
  counter. The outer loop runs `MaxIteraciones - MinIteraciones + 1`
  passes; the inner `Paso` loop sweeps box sizes.

Outputs:

- `x`, `y`: vectors of `-log(box size)` and `log(N_boxes)` — the raw
  log–log data.
- `Xc`, `Yc`: the un-logged `box size` and `N_boxes`.
- `Dimension_fractal`: vector of Df estimates for each outer iteration.
- `Df`: final scalar Df (equal to
  `Dimension_fractal(MaxIteraciones-MinIteraciones+1)` when not cancelled).
- `Stop`: bool, true if the user pressed the waitbar cancel button.
- `param`: the 2-vector `[slope, intercept]` from QR least-squares.

No file IO inside the function; no plotting (the GUI plots later).

### 2.2 The pipeline common to every `case`

The 11 cases are copy-pasted variations of the same 5-step nested loop
(the file really is ~1670 lines almost entirely because of this
replication):

```text
for Iteracion = MinIteraciones : MaxIteraciones                    % outer
  for Paso = MinIteraciones-1 : Iteracion                          % box-size sweep
    Cajas_eje = max(2*Paso, 1)                                     % #boxes per axis
    Lado_Caja = Ancho / Cajas_eje                                  % box side
    for ejex, ejey, ejez in 1..Cajas_eje                           % iterate boxes
      for each sphere analytical index (Py, Px, j, k, i, ...):
        test the 9 box-intersection inequalities:
          (Xi - xc)^2 + (Yi - yc)^2 + (Zi - zc)^2 <= r     (8 corners)
          ((Xi+Xf)/2 - xc)^2 + ((Yi+Yf)/2 - yc)^2 + ((Zi+Zf)/2 - zc)^2 <= r
        if any is true → Indicador = 1, break
      end
      if Indicador==1
        Cajas_con_curva = Cajas_con_curva + 1
    end
    x(Paso-MinIteraciones+2) = -log(Lado_Caja)
    y(Paso-MinIteraciones+2) = log(Cajas_con_curva)
  end
  QR-decompose A = [x, 1] and solve A param = y (least squares)
  Dimension_fractal(Iteracion-MinIteraciones+1) = param(1)
end
Df = Dimension_fractal(end)
```

Example block: `case 1` (line) at `CalculoDf.m:10-84`. Its sphere test
(9 inequalities at `CalculoDf.m:46-54`) is the model for all other cases:

```matlab
if ((Xi-2*r*(Py-1))^2 + (Yi)^2 + (Zi)^2) <= r || ...
   ((Xi-2*r*(Py-1))^2 + (Yi)^2 + (Zf)^2) <= r || ...
   ... (6 more corners) ...
   (((Xf+Xi)/2 - 2*r*(Py-1))^2 + ((Yf+Yi)/2)^2 + ((Zf+Zi)/2)^2) <= r
```

Note the inequalities compare **squared distance vs `r` (not `r^2`)**
because the unit radius `r = 1` makes them equivalent. This is a latent
bug if anyone ever sets `r ≠ 1` (which the file never does;
`CalculoDf.m:2` is `r=1;`).

### 2.3 Box counting is **inline and analytic**

Critical point for the Rust port: there is **no sphere-to-point-cloud
sampling** anywhere in `CalculoDf.m`. The box–sphere intersection test is
a closed-form inequality evaluated at 9 query points (8 corners + centre).
A box is counted when any of the 9 points lies inside any sphere — this
is a cheap but **approximate** sphere-box coverage test; it misses the
case where a sphere cuts through a box without touching any of the 9
points (possible for boxes larger than the sphere diameter).

This is fundamentally different from:

- `box_count.m` (Hou bit-interleaving on a voxelized grid of points),
- The Rust 3D Morton code (`aglogen_core/src/fractal/box_counting_3d.rs`),
  which also counts occupied boxes but consumes an explicit set of 3D
  points at fixed precision.

So `CalculoDf.m` is not a candidate to port; it is a **reference
implementation** useful only for cross-checking the Df produced by the
empirical pipeline on synthetic inputs where the answer is known.

### 2.4 Least-squares fit

Every case does the fit in-place at the end of the outer iteration
(e.g. `CalculoDf.m:72-79`):

```matlab
A = zeros(length(y), 2);
A(:,1) = x;
A(:,2) = ones(length(y), 1);
[Q,R] = qr(A);          % QR decomposition
c = Q'*y;
param = R\c;            % param = [slope; intercept]
Dimension_fractal(Iteracion-MinIteraciones+1) = param(1);
```

Important differences with the generic fitter:

- **No eRange / saturation detection.** Every `Paso` from
  `MinIteraciones-1` to `Iteracion` is included in the fit, with no
  trimming. Unlike `fit_frac.m` (which requires a manual
  `eRange=[e_min,e_max]`) or `fit_frac3D.m` (which auto-detects the
  plateau), `CalculoDf.m` assumes the user chose a `MinIteraciones /
  MaxIteraciones` range that is already well inside the linear regime.
- **QR instead of `polyfit`.** `fit_frac3D.m` uses `polyfit` and `fit` for
  confidence intervals. `CalculoDf.m` bypasses both and solves the
  normal equations via QR. Numerically equivalent for 2-column `A`; no
  error bars produced.

### 2.5 Geometry details and hardcoded constants, per `case`

The geometry of each case is entirely defined by the sphere centres
*embedded* in the inequality — there is no sphere array anywhere. For
example in `case 5` (plane, HC, `CalculoDf.m:477-508`) the centres are:

- Upper triangle: `(r*(Py-1)+2*r*(Px-Py), sqrt(3)*(Py-1), 0)` for
  `Py ∈ 1..ceil(esferas2/2)`, `Px ∈ Py..esferas2`.
- Lower triangle (mirror in y): `(..., -sqrt(3)*(Py-1), 0)`.

with `esferas2 = capas*2+1` and `Ancho = esferas2*2*r` bounding box.

Magic numbers / hardcoded thresholds that should be flagged:

| Constant            | Location                | Meaning                                          |
|---------------------|-------------------------|--------------------------------------------------|
| `r = 1`             | `CalculoDf.m:2`         | Unit sphere radius; hardcoded                    |
| `2*(sqrt(2)-1)`     | e.g. `:90`, `:1469`     | Gap between even-sized arms for cross cases      |
| `sqrt(3)`           | HC cases                | Row spacing for hexagonal close-packed plane     |
| `sqrt(3)/3`         | cuboctahedron :1129...  | Offset between HC triangular layers              |
| `1.65 * k`          | cuboctahedron :1129...  | z-offset per HC layer (approximates `2*sqrt(6)/3 ≈ 1.6330`; value is **imprecise**, see §6) |
| `1.6345 * k`        | `casosLimiteEsferas.m:728,731,750` | Same z-offset but slightly different value (**inconsistent**, see §6) |
| `4/sqrt(3)`         | CCC case :843-848       | CCC spacing                                      |
| `Cajas_eje = 2*Paso`| every case              | Number of boxes on axis: 2, 4, 6, 8, ... (not powers of 2!) |

**The `Cajas_eje = 2*Paso` choice is unusual.** Standard Hou box counting
(the Rust port and `box_count.m`) uses box sides `2^-k * L`, so
`Cajas_eje = 2, 4, 8, 16, 32, ...`. `CalculoDf.m` uses
`Cajas_eje = 2, 4, 6, 8, 10, ...` — a **linear** sequence, not dyadic.
This is mathematically valid for box counting (any sequence of scales
works) but makes the MATLAB results harder to compare directly with the
dyadic box_count output; they sample different box sizes.

### 2.6 Known bugs and oddities

1. `CalculoDf.m:46-54` (and every other inequality block): `<= r`
   instead of `<= r^2`. Works only because `r==1`.
2. `CalculoDf.m:586-588` (plane SC): `if Paso==0 Indicador=1;` forces all
   boxes on the coarsest scale to count as "covered". This ensures
   `log(Cajas_con_curva) ≠ log(0)` on iteration 0, but it biases the fit
   for the `SC` plane case. The HC branch does not have this kludge.
3. `case 1` (line, `CalculoDf.m:56-60`): uses `Indicador = Indicador+1`
   (accumulates), not `Indicador = 1; break` like every other case. The
   subsequent `if Indicador > 0` still works but is semantically
   different — there is no early exit. Minor perf bug, not correctness.
4. Outside `case 8`, the inequalities pass `(1.65*k)` additions with
   inconsistent signs between paired branches (e.g. `CalculoDf.m:1137`
   has `((Zf+Zi)/2)^2 - (1.65*k)` — the parentheses place `1.65*k`
   **outside** the squared term; likely a typo). Several places show
   copy-paste asymmetries of that kind in the cuboctahedron branch.
5. `CalculoDf.m:1665-1668`: the function ends with `end` closing the
   `switch`, `delete(h)`, `end` for the function body. Trailing blank
   lines; no `return` value sanity checks.

### 2.7 Output / side effects

- No disk writes.
- Waitbar GUI (`CalculoDf.m:3-5`) — cancellable via
  `getappdata(h,'canceling')`.
- Caller receives `Df`, which the GUI displays and uses for the Kf
  calculation (`Esferas.m` passes it to `Prefactor.m` afterwards).

---

## 3. `casosLimiteEsferas.m` — deep analysis

### 3.1 Signature and usage

Line 1: `function [ clusters ] = casosLimiteEsferas( varargin )`.
Returns `clusters` as an `N×4` matrix of `[x y z r]` rows.

Variable argument calling convention (documented in header `:1-60`):

| Form                                         | Meaning                                        |
|----------------------------------------------|------------------------------------------------|
| `casosLimiteEsferas(np, 'lineal')`           | Line of `np` spheres                            |
| `casosLimiteEsferas(np, 'cruz2d')`           | 2D cross with `np` on the main axis             |
| `casosLimiteEsferas(np, 'asterisco')`        | 6-arm asterisk (2D)                             |
| `casosLimiteEsferas(np, 'cruz3d')`           | 3D cross (+x, ±y diagonals)                     |
| `casosLimiteEsferas(nc, 'plano', 'HC')`      | Single plane, hex close-packed, `nc` layers     |
| `casosLimiteEsferas(nc, 'plano', 'CS')`      | Single plane, simple cubic                      |
| `casosLimiteEsferas(nc, 'dobleplano', 'HC'|'CS')` | Two perpendicular planes                   |
| `casosLimiteEsferas(nc, 'tripleplano', 'HC')`| Three planes @ 60°                              |
| `casosLimiteEsferas(nc, 'cuboctaedro', 'HC'|'CS'|'CCC')` | 3D volume packings              |
| 4th arg `dp0` (default `25`), 5th arg `dibujar` (default `0`) | Diameter in real units; plot flag |

Final scale step: `clusters = clusters * dp0;` (`:890`). The base
geometry is constructed with `r=1`, then everything is multiplied by the
particle diameter `dp0` at the end.

Deduplication: `clusters = unique(clusters, 'rows')` at `:887`. This
matters for the double/triple plane and cuboctahedron cases where sphere
centres would otherwise coincide at the intersection axes.

### 3.2 What each `case` generates

All cases build two parallel structures:
- `x{i}, y{i}, z{i}` — surface mesh for plotting (meshgrid on
  `Tetha × Fi`, `:71-73`, `densidad = 20`).
- `clusters(contador,:)` — the numeric centre + radius tuple.

Reading out the algorithms:

**`'lineal'` (`:111-130`)** — `esferas` spheres at
`(2*r*(i-1), 0, 0)`. Expected Df = 1.

**`'cruz2d'` (`:131-248`)** — Depends on parity.
- Odd: central spine on x, perpendicular arms at `(ultima/2-r, ±2*r*j, 0)`.
- Even: two x-segments separated by `2*(sqrt(2)-1)` gap (to let the
  perpendicular arms fit at 45°).

Expected Df = 1 (it is a 1D skeleton embedded in 2D).

**`'asterisco'` (`:249-306`)** — 6 arms at 60°. Centres on the main
vertical axis plus two sets of 60° diagonals at
`(2*r*np/2 + r - np/2*sqrt(3) + (j-1)*sqrt(3), ±(r*np/2 - (j-1)*r), 0)`.

Expected Df = 1.

**`'cruz3d'` (`:307-364`)** — Central spine on z, plus 60° diagonals in
the xz-plane. The 90° perpendicular arms (which one would expect in a
true 3D cross) are **not** generated — only three lines meeting at a
point. Expected Df = 1.

**`'plano'` (`:365-423`)** — 2D hex or CS packing in the xy-plane.
HC: triangular-lattice rows at `y = ±sqrt(3)*(i-1)`,
CS: square grid at spacing `2*r`. Expected Df = 2.

**`'dobleplano'` (`:424-600`)** — Two perpendicular planes (xy and xz).
Expected Df = 2.

**`'tripleplano'` (`:601-688`)** — Three planes @ 60° intersecting along
a common axis. Expected Df = 2.

**`'cuboctaedro'` (`:689-884`)** — This is the only genuinely 3D volume
case. Three sub-packings:
- `'HC'`: triangular base + "layer on top of triangles" stack at
  `z = 1.6345*k`, plus a mirrored back at `z = -1.6345*k`
  (`:723-811`). Expected Df = 3.
- `'CS'`: simple cubic grid, side `2*r` (`:812-836`). Expected Df = 3.
- `'CCC'`: face-centred cubic with two interpenetrating lattices at
  spacing `4/sqrt(3) * r` offset by `2/sqrt(3) * r`
  (`:837-883`). Expected Df = 3.

### 3.3 How theoretical Df is "known"

For every case, Df is known **by construction**:

- 1D skeletons (line, cross, asterisk, 3D cross): Df = 1 exactly.
- 2D sheets (plane, double plane, triple plane): Df = 2 exactly.
- 3D volumes (cuboctahedron with HC/CS/CCC): Df = 3 exactly in the
  limit of infinite layers; for finite `capas` the empirical Df
  approaches 3 as the number of layers grows.

These are *not* Sierpinski-type fractal cases. There is no
non-integer-Df reference case in the file — every "limit case" has
integer theoretical Df. The file is consequently better thought of as
**"integer-Df ground truth cases"** than "fractal test cases". This
restricts its usefulness as a Rust test suite (see §4).

### 3.4 Connection to `Prefactor.m`

The 8 `Prefactor` modes use configuration-specific formulas for the
radius of gyration `dg`. For each mode, they require that `n`
(number of spheres) follows a specific formula of the input parameters:

- Mode 1 (line): `n = Esferas`.
- Mode 2 (cross): `n = 2E-1` (odd) or `2E` (even).
- Mode 3-4 (asterisk, cross3d): `n = 3E-2` (odd only).
- Mode 5 (plane HC): `n = 1 + sum(6*i for i=1..Cp)` — the centred
  hexagonal number.
- Mode 6 (double plane HC): `n = 2*y - (Cp*2+1)` where `y` is that sum.
- Mode 7 (triple plane HC): `n = 3*y - 2*(Cp*2+1)`.
- Mode 8 (cuboctahedron HC): `n = 1 + sum(10*i^2+2 for i=1..Ce-1)` —
  the magic cuboctahedron numbers 13, 55, 147, 309, ... (OEIS A005902).

Those formulas are the exact cardinalities produced by
`casosLimiteEsferas.m` for the same modes. Example: the cuboctahedron
HC with `Ce=3` layers yields 1 + 12 + 42 = 55 spheres, which matches
`size(clusters, 1)` after the `unique`-deduplication in
`casosLimiteEsferas.m:887`.

So the three files agree by construction: **Prefactor** encodes the
analytical `n` and `dg`; **casosLimiteEsferas** generates the physical
coordinates of the same `n` spheres; **CalculoDf** computes the exact Df
of the same geometry without touching the coordinates. The round-trip
consistency is the point of the triad.

### 3.5 Nothing is written to disk

`casosLimiteEsferas.m` does not call `crearArchivoDat.m` or
`guardarCoordenadas.m` itself — it only returns `clusters`. The GUI
glue code in `Esferas.m` decides whether to dump the coordinates to
`.dat` and run `box_count` afterwards.

### 3.6 Known bugs / inconsistencies

1. `:728, :731` vs `CalculoDf.m:1129`: z-layer spacing is
   `1.6345 * k` in one file and `1.65 * k` in the other. The exact
   analytical value is `2*sqrt(6)/3 ≈ 1.632993`. Both files are
   *wrong* by ~0.1%, and **inconsistently** wrong, which means the
   cuboctahedron clusters produced by `casosLimiteEsferas.m` are
   slightly different from the sphere centres that `CalculoDf.m`
   assumes internally. This will matter at high precision.
2. `:797`: `yy = -sqrt(3)/3+sqrt(3)*(j-1)-(k-1);` — missing
   `* sqrt(3)/3` factor on `(k-1)`. Almost certainly a typo
   (the x coordinate 4 lines above uses `(k-1)*sqrt(3)/3`, and the
   plotted surface `y{j}` on line 794 does include the factor).
3. `:311`, `:252`: silent `esferas = esferas + 1;` when the user
   supplied an even count for `cruz3d` / `asterisco`. Without warning
   this is a footgun — the returned cluster has a different `np` than
   the user requested.
4. `:121` and passim: `clusters` is grown row-by-row inside loops. The
   `%#ok<*AGROW>` pragma suppresses warnings. No performance issue at
   current sizes but worth noting.
5. No input validation on `'cuboctaedro' + 'CCC'` combination —
   `varargin{1}` is mapped to `CapaEspacial`, but the CCC branch uses
   `CapaEspacial` without the `esferas2 = Ce*2+1` convention that HC
   uses.

---

## 4. What is unique and valuable here vs pyaglogen3D?

### 4.1 Tests

The Rust `tests/` folder of pyaglogen3D is empty. `casosLimiteEsferas.m`
provides a bank of **sphere-cluster coordinate generators** that map
directly onto the 8 modes used by `Prefactor`, which means:

- For each mode, you have a closed-form expected number of spheres `n`
  (from `Prefactor.m`).
- For each mode, you have a known integer theoretical Df (1, 2, or 3).
- For each mode, you can generate the coordinates deterministically for
  any `np` / `nc` / `Ce`.

This is **sufficient** as a sanity-check test suite (shape sanity +
integer Df convergence) and **insufficient** as a rigorous fractal
test suite. None of the 8 cases has a non-integer theoretical Df. A
real fractal validation (Sierpinski tetrahedron Df ≈ 2.585, Menger
sponge Df ≈ 2.727, etc.) is **not** present here — you would need to
add those separately in Rust if you want to validate Df accuracy on
non-trivial fractals.

### 4.2 Algorithmic insights

**Sphere-to-point-cloud sampling:** *none*. `CalculoDf.m` does not
voxelize, and `casosLimiteEsferas.m` returns sphere centres only,
not surface points. The surface mesh (`x{i}, y{i}, z{i}` with
`densidad = 20` meshgrid on `Tetha × Fi`, `:71-73`) is exclusively for
plotting and is **not** fed to any box-counting code. So:

> *There is no sphere-to-point-cloud algorithm in either file that the
> Rust port could learn from.* The sampling question the original task
> brief asked about is orthogonal to this code — both MATLAB paths
> either treat spheres analytically (CalculoDf) or dump centres to a
> `.dat` and let the external `box_count` pipeline decide.

The only place where sphere surface is materialized is
`crearArchivoDat.m`, which writes centre + radius per line — still no
surface discretization.

**Multi-scale sweep:** The `MinIteraciones..MaxIteraciones` outer loop
*is* a multi-scale sweep, but it only serves to get one Df per
iteration and keep the last one. There is no outlier detection, no
consensus across scales, nothing the Rust port could adopt. The 3D
Morton port already does a dyadic sweep which is superior.

**Hardcoded correspondence to `Prefactor`:** Confirmed. The 8 geometries
in `casosLimiteEsferas.m` match the 8 cases in `Prefactor.m` by name and
cardinality. That mapping is the valuable piece — it gives the Rust
port a golden Kf per geometry.

### 4.3 What is NOT in the Rust port but should be

- An analytical integer-Df baseline for the **line**, **plane** and
  **cube** cases, parametric in `np` / `nc` / `Ce`. The Rust test
  fixtures in `box_counting_3d.rs` already cover line ≈ 1, plane ≈ 2,
  filled cube ≈ 3 at small fixed sizes — but there is no parametric
  sweep.
- A reference Kf computation from `Prefactor.m` for cross-checking
  analytical prefactors (independent from Df).
- The 5 non-trivial geometries (cross, asterisk, triple plane,
  cuboctahedron HC/CCC) that aren't in the Rust tests at all.

---

## 5. Recommendations for Rust test fixtures

These are the concrete extraction candidates from
`casosLimiteEsferas.m`, in order of usefulness:

| # | Name (suggested)                 | Config                                   | Theoretical Df | Expected Kf source              | MATLAB lines                       |
|--:|----------------------------------|------------------------------------------|---------------:|---------------------------------|------------------------------------|
| 1 | `line_np_spheres`                | `np` spheres on x-axis, radius 1         | 1              | `Prefactor.m` case 1            | `casosLimiteEsferas.m:111-130`     |
| 2 | `cross2d_np_odd`                 | 2D cross, odd `np` (no gap)              | 1              | `Prefactor.m` case 2 (odd)      | `casosLimiteEsferas.m:133-182`     |
| 3 | `cross2d_np_even`                | 2D cross, even `np`, `sqrt(2)-1` gap     | 1              | `Prefactor.m` case 2 (even)     | `casosLimiteEsferas.m:183-248`     |
| 4 | `asterisk_np`                    | 6-arm asterisk, forced odd `np`          | 1              | `Prefactor.m` case 3            | `casosLimiteEsferas.m:249-306`     |
| 5 | `cross3d_np`                     | 3D cross, forced odd `np`                | 1              | `Prefactor.m` case 4            | `casosLimiteEsferas.m:307-364`     |
| 6 | `plane_hc_nc_layers`             | HC plane, `nc` layers, `2*nc+1` on side  | 2              | `Prefactor.m` case 5 (HC only)  | `casosLimiteEsferas.m:366-399`     |
| 7 | `plane_cs_nc_layers`             | CS plane, `(nc+1)^2` spheres             | 2              | n/a (errordlg in Prefactor)     | `casosLimiteEsferas.m:400-422`     |
| 8 | `double_plane_hc_nc`             | Two ⊥ HC planes                          | 2              | `Prefactor.m` case 6            | `casosLimiteEsferas.m:424-484`     |
| 9 | `double_plane_cs_nc`             | Two ⊥ CS planes                          | 2              | n/a                             | `casosLimiteEsferas.m:485-599`     |
|10 | `triple_plane_hc_nc`             | Three HC planes @ 60°                    | 2              | `Prefactor.m` case 7            | `casosLimiteEsferas.m:601-688`     |
|11 | `cuboctahedron_hc_ce_layers`     | HC cuboctahedron, `n = 1 + Σ(10i²+2)`    | 3              | `Prefactor.m` case 8            | `casosLimiteEsferas.m:689-811`     |
|12 | `cuboctahedron_cs_ce`            | Simple cubic cube, `(Ce+1)^3` spheres    | 3              | n/a                             | `casosLimiteEsferas.m:812-836`     |
|13 | `cuboctahedron_ccc_ce`           | FCC lattice                              | 3              | n/a                             | `casosLimiteEsferas.m:837-883`     |

**Implementation note for the Rust side:** each fixture is a *pure
function of 1-2 integer parameters* producing an `Nx4` array (or an
`Nx3` if you drop `r` for unit spheres). No randomness, no file IO.
They port directly as `fn line_cluster(np: usize) -> Vec<[f64; 3]>` and
friends, with assertion that `box_counting_3d::estimate_df(&points, ...)`
returns `1.0 ± tol` / `2.0 ± tol` / `3.0 ± tol`.

Tolerances: because every case has integer theoretical Df, and the
MATLAB `CalculoDf.m` would converge to the integer only as
`Cajas_eje → ∞`, a reasonable tolerance is **±0.05** for small fixtures
and **±0.02** for fixtures with `np ≥ 20` or `Ce ≥ 4`.

---

## 6. Appendix — suspected bugs, TODOs, dead code

### 6.1 Clear bugs

1. **`fit_frac3D.m:24`** — `||` in `while ( m < ... ) || ( er(...) > tol )`
   is almost certainly `&&`. As written, the loop never exits early on
   convergence (the left predicate keeps it alive); it only exits when
   `m >= length(np) - group - 1`. Minor perf bug, but worth fixing when
   porting the auto-linear-region detection.
2. **Cuboctahedron z-spacing discrepancy**: `1.65*k` in `CalculoDf.m`
   vs `1.6345*k` in `casosLimiteEsferas.m` vs exact `2*sqrt(6)/3*k ≈
   1.632993*k`. Both MATLAB files are wrong, but *differently wrong*
   — the analytical Df of `CalculoDf.m` does not describe the same
   geometry that `casosLimiteEsferas.m` produces. For the Rust port,
   use the exact value.
3. **`casosLimiteEsferas.m:797`** missing `* sqrt(3)/3` factor: the
   back-face triangle-layer y-coordinate doesn't match the x-scaling of
   the same layer.
4. **`CalculoDf.m` squared-distance comparison vs `r` instead of `r^2`**
   (everywhere). Only safe because `r=1`.
5. **`CalculoDf.m:586-588`** (`case 5 / SC`): `if Paso==0 Indicador=1;`
   — kludge to avoid `log(0)`; present only in the SC branch.
6. **`CalculoDf.m:1137, :1148, :1167, :1178`** cuboctahedron cases: the
   z-subtraction `- (1.65*k)` lives outside the squared term; this is a
   paren-placement bug and would silently yield wrong inside/outside
   decisions on the layer boundaries.

### 6.2 Dead code / commented-out

- `casosLimiteEsferas.m:304-306`: commented-out `errordlg` for even `np`
  in `asterisco`; replaced by silent `+1` correction at `:252`.
- `casosLimiteEsferas.m:362-364`: same pattern for `cruz3d`.
- `fit_frac3D.m:29,39,41,46,48,55`: extensive debug `disp` output and
  commented `polyval` / `polyconf` / `delta` lines suggest this file
  was in active development and was left mid-rewrite.

### 6.3 TODO candidates (not present in code, but implied)

- No unit on radius: the whole `CalculoDf.m` assumes `r=1`. Making `r` a
  parameter would require rewriting every `<= r` to `<= r^2`.
- No verification that the theoretical Df is actually reached at the
  chosen `MaxIteraciones`. Nothing tells the user "you're still in the
  asymptotic transient".
- No error bars on Df (the QR solve does not propagate covariance).

---

## 7. Summary / takeaway for the Rust port

1. **Both files are non-portable as algorithms** — `CalculoDf.m` uses an
   inline analytical test that is specific to known sphere
   arrangements; `casosLimiteEsferas.m` is a coordinate generator. The
   Rust 3D Morton code already covers the generic path.
2. **The 8-mode geometry catalog is valuable and should be ported as
   test fixtures.** It gives a direct cross-check for `Df` (integer
   limits) and `Kf` (from `Prefactor.m` formulas).
3. **No sphere-to-point-cloud sampling exists in either file** — that
   question stays open; look at `crearArchivoDat.m` + the external
   `box_count.m` pipeline if sphere discretization matters for the port
   (Hou's algorithm reads points, not spheres, so sampling must happen
   somewhere).
4. **Small bugs and inconsistencies** (`1.65` vs `1.6345`, `&&`/`||` in
   `fit_frac3D`, missing `sqrt(3)/3` factor) should be corrected in
   the Rust translations, not replicated.
5. **The test suite gap in pyaglogen3D is real**: beyond the three
   trivial line/plane/cube cases already in `box_counting_3d.rs`, the
   5 more interesting integer-Df geometries (cross, asterisk,
   double-plane, triple-plane, cuboctahedron) would be immediately
   worth porting. A true fractal Df validation (Sierpinski, Menger)
   still needs to be *added*, not ported — neither MATLAB file covers
   that.
