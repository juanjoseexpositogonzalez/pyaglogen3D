# BOXCOUNTER/Esferas.m — Analysis of the Two Box-Counting Methods

> Scope: read-only analysis of the legacy MATLAB GUI application
> `aglogen3D/BOXCOUNTER/Esferas.m` (4669 lines) plus its helpers
> `CalculoDf.m`, `casosLimiteEsferas.m`, `box_count.m`, `fit_frac.m`,
> `fit_frac3D.m`, `Prefactor.m`. The target of comparison is the Rust
> implementation at `pyaglogen_core/src/fractal/{box_counting,box_counting_3d}.rs`.
> This document complements (and does **not** reproduce) the prior analysis in
> `docs/box_counting_comparison.md`.

## 1. Executive summary

### What is `Esferas.m`?

`Esferas.m` is a MATLAB `guide`-generated GUI application that computes the
**box-counting fractal dimension `D_f` of idealised sphere arrangements**
("limit cases") whose `D_f` is known analytically — 1D line, 2D cross,
asterisk, plane, double plane, triple plane, cuboctahedron, etc. The purpose
is **validation**: given that a line of spheres should yield `D_f ≈ 1`, a plane
should give `D_f ≈ 2`, and a 3D packed cuboctahedron should give `D_f ≈ 3`, the
GUI lets the user sweep parameters (number of spheres, number of layers,
packing mode, iteration range) and verify that the numerical algorithm
reproduces the theoretical value. It is **not** an analyser of arbitrary
point clouds — it is a reference-calibration tool.

Inputs: parametric configuration (mode, packing, sphere count, layers,
min/max box-counting iterations). Outputs: `D_f`, auxiliary log-log plot,
convergence-vs-iterations plot, and (via `CalPrefactor_Callback`) the fractal
prefactor `k_f` computed analytically from `Prefactor.m`.

### What are the "two box-counting methods"?

The GUI exposes two selectable dimension families via the radio-button group
`Dimensiones` (`Esferas.m:974-984`, handled by `Dimensiones_SelectionChangeFcn`):

- **Method A — "Box-counting dimension" (`selecciondimension = true`)**:
  a **physically-calibrated** fixed-ε_min variant. The user (or auto mode)
  fixes a minimum box side `LadoCajaMinimo = 0.028` (in particle-radius units);
  `MaxIteraciones` is derived so that the smallest box side equals this
  target, and only the last 15 iterations are used
  (`Esferas.m:1877,1919-1920`). This locks the box-size sweep to a
  sub-particle-radius resolution.
- **Method B — "Scale dimension" (`selecciondimension = false`)**:
  a **global-sweep** variant. `MinIteraciones = 1`, `MaxIteraciones = 50`
  (`Esferas.m:1927-1928`). The box-size sweep starts at the full bounding
  width (one box covers everything) and halves 50 times, touching arbitrarily
  small scales.

Both methods ultimately call the **same** core counting routine
(`CalculoDf.m`). The algorithmic kernel is identical; **they differ only in
the box-size range over which the slope is fitted**.

There is, however, a *second* independent algorithmic dichotomy that the
user also chose to highlight when dropping the folder: `Esferas.m` implements
its counting kernel **analytically** (closed-form sphere-vs-AABB
intersection tests) for every one of the 13 idealised modes, whereas the
standalone helper `box_count.m` ships in the same folder as a **discrete
Morton bit-interleaving** kernel. In practice the GUI callbacks do **not**
call `box_count.m` — they inline the analytical variant. So:

- **Algorithmic Method I** — inline analytical sphere/AABB intersection,
  used by the GUI (`CalculoDf.m`, `CalculoFractal_Callback`, the modo=1..13
  branches of `parametrico_Callback`).
- **Algorithmic Method II** — discrete Morton-code bit-interleaving on a
  point set (`box_count.m` + `fit_frac.m` / `fit_frac3D.m`), present in the
  folder but **not wired into the GUI**.

### Verdict (one paragraph)

`Esferas.m` is a **parameter-sweep validation harness** for the classical
box-counting definition, where the geometric primitive is a set of rigid
unit spheres at algebraically-defined positions. Its 13 mode kernels all
implement the **same mathematical idea**: for each AABB voxel at scale
`ε_k`, test whether any of the 9 sampling points (8 corners + centre) of the
box lies inside the union of spheres, and if so mark the box as occupied.
The two "methods" exposed in the UI (`boxcounting` vs `escala`) are
**not** different algorithms — they are two **box-size windows** over the
same kernel. This is structurally a **2D/3D analytical grid
box-counter**, fundamentally different from the Morton-code variant in the
same folder (which is never invoked from the GUI) and fundamentally different
from the `box_counting_3d.rs` Rust port (which *is* a port of the Morton
variant, not of the analytical one). The unique value of this legacy code is
not a new algorithm but the set of **closed-form geometry encoders for the
13 limit cases**, which serve as ground-truth validation targets.

## 2. GUI structure map

### Line-count breakdown of `Esferas.m` (4669 lines)

| Segment | Lines | Fraction | Nature |
|---|---|---|---|
| `Esferas` dispatcher + `OpeningFcn` | 1-235 | 5 % | `guide` boilerplate; handle-wiring; default state |
| Tab-switch callbacks (`t*bd`, `a*bd`) | 238-694 | 10 % | `guide` tab UI; `SelecConfig_Callback` picks an illustrative bitmap per mode |
| `OutputFcn` + all `*_CreateFcn` | 696-837 | 3 % | `guide` boilerplate |
| Radio / edit / popup `*_Callback` (state setters) | 838-1246 | 9 % | Pure handle state mutation |
| `Graficar_Callback` (3D plotter) | 1247-1749 | 11 % | 13 switch cases drawing `surf` spheres |
| `graficar2d_Callback` (2D plotter) | 1750-1859 | 2 % | modes 9-11 plot circles |
| **`CalculoFractal_Callback` (Method A entry)** | **1860-1966** | **2 %** | **Single-run BC; delegates to `CalculoDf.m`** |
| **`parametrico_Callback` (Method B entry, parameter sweep)** | **1968-4656** | **58 %** | **Inlined BC kernels for all 13 modes, sweep of N_esf / iterations / structure** |
| `CalPrefactor_Callback` | 4658-4669 | < 1 % | Calls `Prefactor.m` |

**Observation**: ~80 % of the file (~3700 lines) is either `guide` boilerplate
or inline copies of the same counting kernel under different sweep axes;
the actual algorithmic content distills down to:

- **`CalculoDf.m`** (890 lines) — the canonical per-mode analytical kernel
  dispatched by `CalculoFractal_Callback`. Modes 1..8 covered in
  `CalculoDf.m`; modes 9..11 (2D) and modes 12..13 (compound) are only
  inlined inside `parametrico_Callback`.
- **`parametrico_Callback`** (2689 lines) — same kernel re-inlined so the
  algorithm can be run inside an outer loop over `N_esf`, `iterations`, or
  `estructura`, emitting `D_f(N_esf)`, `k_f(N_esf)`, `N_p0(N_esf)`.

### Callbacks that implement box-counting logic

| Callback | Lines | Role |
|---|---|---|
| `CalculoFractal_Callback` | 1860-1966 | Single-shot BC; reads `Avanzado`/`selecciondimension` to decide box range; delegates to `CalculoDf(…)` |
| `parametrico_Callback` | 1968-4656 | Parameter sweep; inlines the same per-mode kernel for modes 1..13; branches over `Entrada ∈ {1 N_esf, 2 Np0, 3 iterations, 4 structure}` × `Salida ∈ {1 Df, 2 Kf, 3 Np0}` |
| `CalPrefactor_Callback` | 4658-4669 | Pure analytical `k_f` via `Prefactor(Df, modo, …)`; no BC |

### Auxiliary functions

| File | Called by | Purpose |
|---|---|---|
| `CalculoDf.m` | `CalculoFractal_Callback` (Esferas.m:1935) | Canonical analytical BC for modes 1..8 |
| `Prefactor.m` | `CalPrefactor_Callback` (Esferas.m:4667) | Closed-form `k_f = n / (Rg/dp)^{Df}` for 8 configurations |
| `casosLimiteEsferas.m` | **Not called from the GUI** — standalone sphere-cluster generator, 890 lines, emits `clusters[:,4] = [x y z r]` for the *same* 8 modes plus `tripleplano` and `cuboctaedro` |
| `box_count.m` | **Not called from the GUI** — Morton bit-interleaving kernel, inherited from `matlab_reference/box_count.m` |
| `fit_frac.m`, `fit_frac3D.m` | **Not called from the GUI** — log-log fitters for the Morton kernel |
| `plotAgglomerate.m`, `determineAngles.m`, `guardarCoordenadas.m`, `crearArchivoDat.m` | Not in the BC path — I/O and visualisation helpers |

## 3. Method A — Analytical sphere / AABB intersection (the GUI kernel)

**Label in the GUI**: the radio group selects between "Dimensión BC"
(`selecciondimension = true`) and "Dimensión de escala"
(`selecciondimension = false`). Both drive the **same** kernel described
below.

### 3.1 Mathematical description

For an agglomerate defined as the union of `N_p` unit-radius spheres at
algebraically-defined centres `{c_i}`, the box-counting dimension is
estimated by a classical cover-counting procedure:

```
N(ε) = #{ box in Z³_ε : box ∩ ⋃_i B(c_i, r) ≠ ∅ }
D_f  ≈ slope of log N(ε) vs log(1/ε) for ε small
```

The intersection test `box ∩ ⋃ B(c_i, r) ≠ ∅` is approximated by a
**9-point sampling**: the box is marked as occupied if **any** of its 8
corners or its centroid lies strictly inside **any** sphere
(`CalculoDf.m:46-54`). No exact sphere-AABB test is performed.

Formally, for a box `[X_i, X_f] × [Y_i, Y_f] × [Z_i, Z_f]` the occupancy test is

```
occupied := ∃ p ∈ {(X_i|X_f, Y_i|Y_f, Z_i|Z_f), ((X_i+X_f)/2, …)},
           ∃ i ∈ 1..N_p : ||p - c_i||² ≤ r²
```

**Important bug-level detail**: the literal expression in `CalculoDf.m:46`
reads `((Xi-2*r*(Py-1))^2+(Yi)^2+(Zi)^2) <= r` — the right-hand side is `r`,
not `r²`. With `r = 1` (hard-coded, `CalculoDf.m:2`) this accidentally works
because `r == r²`. Any attempt to generalise this code to `r ≠ 1` would
silently produce wrong results. See §8.

### 3.2 Step-by-step pseudocode

```
function CalculoDf(modo, N_esf, capas, EmpaquetamientoPlanar, …,
                   MinIter, MaxIter):
    r   ← 1                               # hard-coded particle radius
    Ancho ← bounding_width(modo, N_esf)   # mode-specific
    (Min_x, Min_y, Min_z) ← (-1, -Ancho/2, -Ancho/2)

    for Iteracion = MinIter .. MaxIter:          # outer loop: stability check
        for Paso = (MinIter-1) .. Iteracion:     # inner loop: box-size sweep
            Cajas_eje ← max(2·Paso, 1)            # grid cells per axis
            Lado_Caja ← Ancho / Cajas_eje         # box side ε

            Cajas_con_curva ← 0
            for (ix, iy, iz) ∈ [1..Cajas_eje]³:   # scan every voxel
                (X_i,X_f) ← Min_x + Lado_Caja·(ix-1 .. ix)
                (Y_i,Y_f) ← …; (Z_i,Z_f) ← …

                Indicador ← 0
                for Py = 1 .. N_p:                # loop over spheres
                    c_i ← position(Py, modo, capas, …)   # closed-form
                    if any 9-sample point is inside B(c_i, r):
                        Indicador ← 1
                        break                     # short-circuit
                if Indicador == 1:
                    Cajas_con_curva += 1

            x[Paso - MinIter + 2] ← -ln(Lado_Caja)
            y[Paso - MinIter + 2] ←  ln(Cajas_con_curva)
            Xc[Paso - MinIter + 2] ← Lado_Caja
            Yc[Paso - MinIter + 2] ← Cajas_con_curva

        # OLS fit via QR factorization
        A ← [x, 1];  [Q,R] ← qr(A);  param ← R \ (Q' · y)
        Dimension_fractal[Iteracion - MinIter + 1] ← param(1)    # slope == D_f

    Df ← Dimension_fractal[MaxIter - MinIter + 1]
    return x, y, Xc, Yc, Dimension_fractal, Df
```

Observation: the slope `param(1)` equals `D_f` directly because the
independent variable is `-ln(ε)` (negative log), making the resulting slope
positive for fractal sets. No sign flip is needed — unlike `fit_frac.m`
which uses `log2(ε)` and recovers `D_f = -slope` (see
`docs/box_counting_comparison.md §2.3`).

### 3.3 Input data type

- **Not a point cloud, not a voxel grid.** The algorithm operates on a
  **symbolic** list of sphere centres generated *on the fly* by a closed-form
  expression inside the kernel itself (e.g. `Esferas.m:2164-2172` for `modo=1`,
  line of spheres, places sphere `Py` at `c_Py = (2r(Py-1), 0, 0)` and tests
  each voxel directly).
- The per-sphere placement formulas are duplicated in both the counting
  kernel (for occupancy test) and in `casosLimiteEsferas.m` (for plotting).
  This duplication is a maintenance risk.
- Dimensionality: 3D for modes 1-8 and 12-13; 2D for modes 9-11 (same kernel
  but the `Z_i/Z_f` axis is dropped and only 5 sampling points are used —
  4 corners + centroid; `Esferas.m:3677-3681`).

### 3.4 Box-size strategy

- **Linear-dyadic hybrid**. `Cajas_eje = 2·Paso`, so the number of boxes per
  axis increases **linearly** with `Paso` (Paso = 1 → 2 cells, Paso = 2 → 4,
  Paso = 3 → 6, …, Paso = 50 → 100). This is **not** purely dyadic; `ε_k` is
  `Ancho / (2k)`, which is dyadic only at `Paso ∈ {1,2,4,8,…}`.
- This linear refinement forces an O(Paso³) voxel scan per iteration, giving
  a total complexity of `O(∑ (2·Paso)³ · N_p)`. For `Paso = 30`, that is
  ~2×10⁵ voxels × `N_p` sphere tests × 9 sampling points — roughly 10⁷-10⁸
  operations for a single `Df` evaluation.
- `Paso = 0` special-cased to `Cajas_eje = 1` (a single box covers everything;
  `CalculoDf.m:32-34`), giving `log(N) = 0` at the coarsest scale — useful
  as an anchor in the fit.

### 3.5 Fitting strategy

- Manual window: `eRange = [MinIteraciones, MaxIteraciones]`, user-controlled
  via `Avanzado` checkbox (`Esferas.m:1189-1205`). No auto linear-region
  detection.
- In **Method A** ("Dimensión BC"), when `Avanzado = false`:
  `MaxIteraciones = floor((Ancho/0.028)/2)` and
  `MinIteraciones = MaxIteraciones - 15` (`Esferas.m:1919-1920`). This ties
  the window to a **fixed minimum physical box side of ε = 0.028 · r**.
- In **Method B** ("Dimensión de escala"), when `Avanzado = false`:
  `MinIteraciones = 1`, `MaxIteraciones = 50` (`Esferas.m:1927-1928`). The
  window spans the full dyadic range.
- Fit: OLS via QR factorisation (`CalculoDf.m:73-79`) on `(−ln ε, ln N)`.
  No R², no CI, no outlier trimming.
- **Convergence monitoring**: `Dimension_fractal[Iteracion]` stores the
  slope from a *sub-range* of iterations `MinIter .. Iteracion`, so the plot
  `axes3` shows `D_f` as a function of how many iterations were included.
  This is a **visual**, not algorithmic, convergence test.

### 3.6 Outputs

- `Df` (scalar slope of the final log-log fit).
- `x, y` — log-scale series for plotting.
- `Xc, Yc` — raw (ε, N(ε)) pairs, used for the secondary `axes4` plot.
- `Dimension_fractal` — slope vs iteration count, for the `axes3` convergence
  plot.
- **No R², no residual, no confidence interval, no error bar.**
- `k_f` is available separately via `Prefactor.m`, **analytically, not
  fitted**; it is derived from `D_f` plus the exact geometric `R_g` of the
  limit case (see `docs/box_counting_comparison.md §2.3` for the analogous
  role of `kfDfAgglo3Dold.m`).

### 3.7 Quirks specific to sphere handling

- **9-point sampling**. The 8 corners of an AABB plus its centroid. This is
  more robust than a pure centre-of-box test (which misses spheres that
  clip only a corner) but less exact than a true sphere-AABB distance
  computation (which would compute `‖c_i − p_clamp‖²` where `p_clamp` is
  `c_i` clamped to the AABB). In practice it works because the sphere
  radius equals the grid's coarsest step — there is no "thin sphere" regime
  where the 9-point sample can miss.
- **Mode-specific centre placement** is hard-coded **three times**: once in
  `CalculoDf.m`, once (re-copied) in `parametrico_Callback`, once in
  `casosLimiteEsferas.m`. Each is subtly different — for example
  `casosLimiteEsferas.m:114` shifts x by `x00 + 2r(i-1)` whereas
  `CalculoDf.m:46` uses `Xi − 2r(Py-1)` without the global offset. The two
  must agree up to the grid offset `Min_x = -1` to sample the same geometry.
- **Normalisation**: coordinates stay in physical units (`r = 1`). There is
  no `2^nb-1` integer normalisation as in `box_count.m`, so `Lado_Caja` is
  already physical. This makes the log-log fit immediately physical, at the
  cost of losing the Morton-code acceleration.

### 3.8 Key line references

| Feature | Location |
|---|---|
| Hard-coded `r = 1` | `CalculoDf.m:2` |
| Mode dispatch | `CalculoDf.m:9` |
| 9-point occupancy test (modo=1) | `CalculoDf.m:46-54` |
| Box-side formula `Lado_Caja = Ancho / Cajas_eje` | `CalculoDf.m:35, 113, 259, 361, 467, 560, 643, …` |
| `Paso=0 → Cajas_eje=1` special case | `CalculoDf.m:32-34` |
| Linear refinement `Cajas_eje = 2·Paso` | `CalculoDf.m:31` |
| QR OLS fit | `CalculoDf.m:73-79` |
| Dimension vs iterations | `CalculoDf.m:79` |
| `LadoCajaMinimo = 0.028` | `Esferas.m:1877` |
| `MaxIter/MinIter` auto-derivation (Method A) | `Esferas.m:1919-1920` |
| `MinIter=1/MaxIter=50` (Method B) | `Esferas.m:1927-1928` |

## 4. Method B — Scale-dimension variant (same kernel, different window)

The GUI presents this as a distinct dimension type ("Dimensión de escala")
via the radio `boxcounting` vs the alternative in
`Dimensiones_SelectionChangeFcn` (`Esferas.m:974-984`). On paper this is the
"scale dimension" (a capacity dimension with a coarser box-size window).
In the code however **it calls the exact same** `CalculoDf(…)` **as Method A**
(`Esferas.m:1935`) with no behavioural difference other than the choice of
`MinIteraciones` and `MaxIteraciones`.

### 4.1 What actually differs

| Parameter | Method A (box-counting) | Method B (scale) |
|---|---|---|
| Auto `MaxIter` | `floor((Ancho/0.028)/2)` — typically 50-250 | `50` (fixed) |
| Auto `MinIter` | `MaxIter − 15` | `1` |
| Typical ε window | `ε ∈ [0.028, ~0.45]·r` | `ε ∈ [Ancho/100, Ancho]` |
| Intended regime | **Short scales, below particle size** (resolves surface fractality) | **Full range, across particle size** (resolves mass fractality) |

### 4.2 Implication

Because the kernel is identical, the only distinction is **which part of
the `log N(ε) vs log(1/ε)` curve is linearly fitted**. In classical soot
literature this corresponds to the distinction between:

- **ε < r_p** → *surface* fractal dimension (boundary fractality of a
  single sphere → should tend to 2 in the limit).
- **ε > r_p** → *mass* fractal dimension (aggregate-level fractality → the
  `D_f` of the arrangement, the quantity of physical interest).

So Method A samples **below the particle radius** and Method B samples
**across it**. This is a physically important distinction, and it is
precisely what `fit_frac.m`'s manual `eRange = [18, 30]` does in the Hou
Morton variant (`docs/box_counting_comparison.md §2.5`): by choosing the
dyadic indices 18..30 the user selects the mass-fractal window.

### 4.3 Input / output / quirks

Identical to Method A (§3.3-3.8), modulo the window.

### 4.4 Pseudocode

```
# Dispatcher differs only in window setup
if selecciondimension == true:                  # Method A
    MaxIter ← floor((Ancho / 0.028) / 2)
    MinIter ← MaxIter - 15
else:                                            # Method B
    MinIter ← 1
    MaxIter ← 50

# both paths call the same kernel
[x, y, Xc, Yc, Dim_f, Df, Stop, param]
    ← CalculoDf(modo, N_esf, …, MinIter, MaxIter)
```

## 5. Side-by-side comparison

| Feature | **Method A (Esferas GUI)** | **Method B (Esferas GUI)** | **box_count.m (Morton)** | **box_counting_3d.rs (Rust port)** |
|---|---|---|---|---|
| Input data type | Symbolic sphere list (algebraic centres) | Symbolic sphere list (algebraic centres) | ASCII point cloud `.dat` | `&[[f64;3]]` point cloud |
| Sphere surface sampling | Implicit — 9-point box test vs analytical centres | Implicit — 9-point box test vs analytical centres | Points must be pre-sampled on surface by caller | `generate_sphere_points` (`box_counting_3d.rs:464`) samples the surface with `density` parameter |
| Dimensionality | 2D (modes 9-11) and 3D (modes 1-8, 12-13) | Same | `dt = min(size(v))` — any dim (config: `nb=32`, `dt=3` typical) | 3D only (fixed 3 coordinates) |
| Box-covering strategy | Exhaustive AABB scan `[1..Cajas_eje]³` | Same | Morton bit-interleave + `sortrows` + `diff/cumsum` | Morton encode + sort + masked unique-count |
| Box-size schedule | **Linear** `Cajas_eje = 2·Paso` ≤ 100 (Method A: ≤ 0.028·Ancho) | Same but `Paso ∈ [1..50]` (full range) | **Dyadic** `ε_k = 2^k/2^nb` for `k ∈ 1..nb` | **Dyadic** via shift masks; scales = `[1/2, 1/4, …, 1/2^precision]` |
| Box-size range | Method A: `ε_min ≈ 0.028·r` fixed; Method B: `Ancho/100` to `Ancho` | `Ancho/100` to `Ancho` | Bit-levels 1..32, physical range un-normalised via `s = max(coord)` | Physical range from bounding box × `2^-precision` |
| Linear region selection | **Manual only**: `eRange = [MinIter, MaxIter]`; Method A auto-picks last 15 iterations | Same (window 1..50) | `fit_frac.m`: manual `eRange = [18 30]`; `fit_frac3D.m`: **auto** via 5-point sliding window (buggy, see §8) | **Auto** via `linear_regression_robust` — starts from coarsest scales, extends window while R² stays high |
| Fit base | `ln(1/ε) vs ln(N)` — positive slope = `D_f` | Same | `log2(ε) vs log2(N)` — slope = `-D_f` | `ln(ε)` / `ln(N)` |
| Fit method | OLS via QR factorisation, no diagnostics | Same | `polyfit` + `fit(…,'poly1')` + `confint` 95 % CI | `linear_regression_robust` with R², SE, residuals |
| Output fields | `Df, x, y, Xc, Yc, Dim_fractal, Stop` | Same | `np, s, qv` (multifractal) | `slope, intercept, r_squared, se, residuals, (log_scales, log_counts)` |
| `k_f` computation | **Analytical only** via `Prefactor.m` (closed form for 8 modes) | Same | Reported as intercept `kf = coefficients(2)` from the log-log fit | Reported as intercept |
| Saturation handling | Relies on `Cajas_eje ≤ 100` bound | Same | None (outer caller truncates) | Caller provides precision (default 18 bits) |
| Complexity | `O(∑ k³ · N_p)` ≈ `O(P⁴ · N_p)` | Same | `O(N · nb)` sort-dominated | `O(N log N · precision)` |
| Intended use | **Ground-truth validation of idealised cases** | Same | **Generic monofractal D_f on a point cloud** | **Same as box_count.m, ported to Rust** |

## 6. What is UNIQUE to `BOXCOUNTER/Esferas.m` that does NOT exist in pyaglogen3D

### 6.1 Analytical sphere-arrangement generator

- **Yes, unique.** Both `CalculoDf.m`/`parametrico_Callback` kernels and
  `casosLimiteEsferas.m` embed **closed-form expressions for sphere
  centres** in 13 idealised configurations:

  | modo | Name | theoretical Df | Geometry |
  |---|---|---|---|
  | 1 | Lineal | 1 | N spheres along x-axis |
  | 2 | Cruz | 1 (odd)/1 (even, offset by √2) | Cross in x-y |
  | 3 | Asterisco | 1 | 3 lines at 60° in a plane |
  | 4 | Cruz 3D | 1 | 3 lines at 90° in 3D |
  | 5 | Plano | 2 | Single hexagonal / square plane |
  | 6 | Doble plano | 2 | Two perpendicular planes |
  | 7 | Triple plano | 2 | Three planes at 60° (HC only) |
  | 8 | Cuboctaedro | 3 | HC / CS / CCC 3D packing |
  | 9 | Linea 2D | 1 | 2D line |
  | 10 | Cruz 2D | 1 | 2D cross |
  | 11 | Asterisco 2D | 1 | 2D asterisk |
  | 12 | Linea→Cruz→Asterisco sweep | 1 | Parametric sweep of modes 1-3 |
  | 13 | Plano→DoblePlano→TriplePlano sweep | 2 | Parametric sweep of modes 5-7 |

- Each entry has a `D_f` ground-truth known analytically, making this a
  **self-validating test harness**. This is absent from pyaglogen3D.

### 6.2 Analytical `k_f` via `Prefactor.m`

- **Unique**. `Prefactor.m` computes `k_f = N_p / (R_g / d_p)^{D_f}` using a
  closed-form `R_g` expression for each of the 8 primary modes. This pairs
  with the BC-derived `D_f` to yield `(D_f, k_f)` both analytically and
  numerically, enabling consistency checks (expected `k_f(mode,D_f_exact)`
  vs observed `k_f(mode, D_f_BC)`).
- In pyaglogen3D, `k_f` is not computed at all from box counting; the Rust
  port only emits `slope + intercept` from the log-log fit.

### 6.3 Iteration-convergence plot (`D_f` vs `MaxIteracion`)

- **Unique**. `CalculoDf.m` outputs `Dimension_fractal[1..MaxIter-MinIter+1]`,
  i.e. the slope computed after progressively enlarging the fit window. The
  GUI plots this in `axes3`. It is a diagnostic of **stability of the slope
  as more iterations are added** — an operator-visible proxy for a linear
  region that pyaglogen3D could adopt.
- Rust `linear_regression_robust` performs a similar analysis internally
  (expanding window from coarsest scales, cutting at first outlier) but does
  not expose the intermediate slope series as a returned value. Exposing it
  would be a low-cost, high-value addition.

### 6.4 Parameter-sweep harness

- **Unique**. `parametrico_Callback` lets the user sweep:
  - `Entrada = 1`: `N_esferas` from `MinEsf..MaxEsf` by `Intervalo` → emits
    `D_f(N_esferas)`.
  - `Entrada = 2`: target `N_p0` → back-solves the needed `N_esferas` per
    mode and reports the `D_f` for that specific `N_p0`.
  - `Entrada = 3`: sweeps `MaxIter` from `MinIter..MaxIter` → emits
    `D_f(iterations)` for convergence plots.
  - `Entrada = 4`: sweeps the structure (line→cross→asterisk or
    plane→doubleplane→tripleplane) → emits `D_f(structure)`.
  - Combined with `Salida ∈ {Df, Kf, Np0}` this is a 4×3 matrix of sweeps.
- pyaglogen3D has no equivalent. The Rust port is a single-shot function
  `box_counting_agglomerate(points, precision) → result`.

### 6.5 Limit-case validation with theoretical Df targets

- **Unique**. Because every mode has `D_f_theory ∈ {1, 2, 3}`, the GUI is
  effectively a **unit-test generator**: pick a mode, sweep sphere counts,
  compare `D_f_BC` to `D_f_theory`. The `aglogen_core` crate has tests
  (`test_box_counting_line/plane/cube`, `box_counting_3d.rs:495-569`) that
  already cover the 1D/2D/3D canonical cases but *only for uniform discrete
  grids*, not for the union of spheres. Porting the sphere modes would
  give the Rust test suite a much stronger set of closed-form targets.

### 6.6 Fixed-ε_min strategy (Method A's `LadoCajaMinimo = 0.028`)

- **Unique**. The idea of tying `ε_min` to a physically-motivated **fraction
  of the particle radius** (0.028·r ≈ 1/36 of the particle radius) is
  absent from the Rust port, which uses a fixed `precision = 18` bits by
  default (giving `ε_min = Ancho / 2^18`). A physically-motivated stop
  criterion would avoid wasted computation at sub-pixel scales.

### 6.7 Auto linear-region via `fit_frac3D.m`

- **Not unique, but different flavour.** The Rust `linear_regression_robust`
  starts at coarse scales and extends **inward** until an outlier is
  detected. `fit_frac3D.m` slides a **fixed 5-point window** across the full
  range to find where the slope stabilises. These are two different
  strategies; porting `fit_frac3D`'s window-based approach as an alternative
  mode could be valuable for comparison.

### 6.8 Saturation-truncation (`fit_frac3D.m:4-12`)

- **Partial overlap.** `fit_frac3D.m` detects saturation by looking for the
  first `t` where `np[t] == np[t+1]` and truncates there. The Rust port
  does not do this — it relies on the caller's precision parameter to stop
  before saturation. This is a candidate feature to port.

## 7. Cross-reference with existing Rust port

| Feature | Already in `box_counting(_3d).rs`? | Port candidate? |
|---|---|---|
| Morton bit-interleaving counter | Yes (`box_counting_3d.rs:42`) — port of `box_count.m`, not of Esferas kernel | N/A (already done) |
| 9-point AABB/sphere test for implicit surfaces | **No** — Rust port operates only on pre-sampled points | **Low priority.** The current strategy (sample sphere surface first, then Morton-count) is a superset: any implicit primitive can be sampled. Adding an analytical test would couple the counter to sphere geometry. |
| Closed-form sphere-arrangement generator (13 modes) | **No** | **High priority.** These are ground-truth validation cases. A `fractal::limits` module exposing `generate_cluster_mode(mode, N_esferas, …) -> Vec<[f64;3]>` (mirroring `casosLimiteEsferas.m`) would let us extend the existing unit tests from uniform line/plane/cube to the full 13-case matrix with known `D_f`. |
| `k_f` analytical prefactor via closed-form `R_g` | **No** | **Medium priority.** Port `Prefactor.m` as `fractal::kf_analytic(mode, N, config)` for regression tests against the `aglomerado_core` generators. |
| Convergence-vs-iterations plot data | **Partial** — `linear_regression_robust` computes it internally but doesn't return the series | **Low-effort.** Extend `FractalResult` with `slope_by_window: Vec<(usize, f64)>` so the Python TUI can plot `D_f(Paso)`. |
| Parameter sweep (`D_f vs N_esf`) | **No** | **Low priority.** This is a notebook-level concern; Python side can loop over `box_counting_agglomerate` calls. |
| Fixed-`ε_min` stop criterion (0.028·r) | **No** — Rust stops at `precision` bits | **Medium priority.** Add a `min_box_physical` parameter that overrides `precision` when specified, enabling the same "stop at 1/36 particle radius" behaviour. |
| Saturation detection (`np[t] == np[t+1]` truncation) | **No** | **High priority.** Very cheap to add. Currently the Rust port will happily include saturated bit-levels in the fit, skewing the slope at very fine precisions. |
| Sliding-window linear-region detector | **No** — Rust uses expanding-window from coarse end | **Medium priority** as an optional mode. The 5-point window approach is standard in the aerosol literature. |
| 2D analytical kernel (modes 9-11) | `box_counting.rs` is 2D but uses a naive grid over `bool` arrays, not sphere-occupancy | **Low priority** unless a full port of the limit-case validation is attempted. |
| Sweep over packing modes (HC / CS / CCC) | **Partial** — `generate_sphere_points` knows nothing about packings | **Medium priority.** Would require porting the packing-specific centre formulas from `casosLimiteEsferas.m:365-884`. |

## 8. Appendix — potential bugs spotted

### 8.1 `fit_frac3D.m:24` — `while` condition short-circuits immediately

```matlab
while ( m < length( np ) - group - 1 ) || ( er( m + 1 ) - er( m ) > tol )
    e_min = m;  e_max = e_min + group;  m = m + 1;
end
```

The condition is `A || B`. The second clause `er(m+1) - er(m) > tol`
references `er(m+1)` at `m = 1`, where `er` is zero-initialised, so
`er(2) - er(1) = 0`, not `> tol`. But **the first clause is almost always
true at `m = 1`** (because `length(np) - group - 1 ≥ 1` for any realistic
`np`), so the loop *does* iterate. However, the loop body never updates
`er`, so `er(m+1) - er(m)` remains `0` for all `m` while the first clause
controls termination. In effect this means `||` behaves just like the first
clause alone — the second clause is dead code. The comment above claims the
loop is "trying to detect the straight line", which requires **`&&`**
(continue while the window hasn't saturated **and** the slope change is
above tol). As written, the loop always iterates to the very last window.
**Recommended fix**: change `||` to `&&`, and update `er` inside the loop
(which also requires moving the `polyfit`/`confint` block inside).

### 8.2 `CalculoDf.m:46` and all 9-point tests — compare to `r` instead of `r²`

All occupancy tests have the form

```matlab
((Xi-2*r*(Py-1))^2+(Yi)^2+(Zi)^2)<=r
```

but the correct inequality for "distance ≤ radius" is `≤ r²`. This works
*only because* `r = 1` (hard-coded in `CalculoDf.m:2`, `Esferas.m:1871`,
`Esferas.m:1983`, `casosLimiteEsferas.m:65`), where `r == r²`. Any
refactoring toward variable radii will break all 13 kernels silently. This
is a **latent bug**, not an active one.

### 8.3 `CalculoDf.m:9` — `Indicador` scope leaks across boxes in modo=1

In mode 1 only (`CalculoDf.m:9-83`), the `Indicador` variable is used as
a **running counter** (`Indicador = Indicador + 1` at line 56) instead of
a boolean flag (as in all other modes, which use `Indicador = 1; break`).
The counter is reset after each box but is not short-circuited; this means
mode 1 runs `9·N_p` arithmetic operations per voxel even when the first
corner already hits a sphere. All other modes short-circuit via `break`.
**Not a correctness bug, just a latent slowdown** of up to 9× on mode 1.

### 8.4 `Prefactor.m` — magic constants `1.6345`

In `casosLimiteEsferas.m:728, 731, 750, 773, 776, 795, 798` the constant
`1.6345` appears as the z-offset for HC stacking. The exact value is
`sqrt(8/3) ≈ 1.6330` (inter-plane distance for close-packed unit spheres),
so `1.6345` is a rounded approximation with error ~0.1 %. For a 3-layer
cuboctahedron this is 0.3 % of the total size — probably negligible for
`D_f` to 3 decimals, but worth flagging.

### 8.5 `parametrico_Callback` modo=5..7 — copy-paste drift between `CalculoDf.m` and `Esferas.m`

The 2D/3D kernels for planar / double-plane / triple-plane modes appear
twice: once in `CalculoDf.m` (lines 440-740), once inlined in
`parametrico_Callback` (lines 2494-3090 approximately). They are structurally
identical but differ in waitbar strings and loop labels. A single bug-fix
must be applied in two places; this is a maintenance smell, not a bug.

### 8.6 `fit_frac3D.m:37` — `er(1, m) = …` overwrites `er(1, 1)` every iteration

```matlab
er( 1, m ) = abs(ci(1,1)-ci(2,1))/2;
```

After the while-loop exits, `m` holds the terminal window index, so this
assignment writes a single scalar — but the variable was initialised as
`er = zeros(1, length(np) - group)`. Because the `m` that exits the loop is
always `length(np) - group`, this writes to the **last** entry, leaving
`er(1:m-1) = 0`. The subsequent `disp(['error=',num2str(er)])` then
prints `0 0 0 … 0 <real>`. Harmless but misleading.

### 8.7 `Esferas.m:2098` — typo `CapaEspecial` vs `CapaEspacial`

In `parametrico_Callback`:

```matlab
elseif modo==8
    MinEsf=handles.CapaEspecial;   % <-- 'Especial', should be 'Espacial'
    MaxEsf=MinEsf;
```

`handles.CapaEspecial` is never set (the real field is `handles.CapaEspacial`,
used everywhere else including `Esferas.m:1866, 1902-1908, 4664`). With
`Entrada = 3` and `modo = 8` this will throw `Reference to non-existent
field 'CapaEspecial'`. Easy fix but confirms the code is not exercised on
that path.

## 9. Summary of recommendations for the Rust port

Ranked by cost/value:

1. **Port `casosLimiteEsferas.m` as `aglogen_core::fractal::limits`** (13 modes,
   closed-form centre placement) → extends unit tests with 13 ground-truth
   targets. **High value, low-medium cost**.
2. **Port `Prefactor.m` as `aglogen_core::fractal::kf_analytic`** → gives the
   Rust agglomerate-generator tests a reference `k_f` per mode for
   regression. **High value, low cost**.
3. **Add saturation-truncation** (`np[t] == np[t+1]`) inside
   `linear_regression_robust` → matches `fit_frac3D.m` behaviour; avoids
   skew at high precision. **High value, trivial cost**.
4. **Expose slope-by-window series in `FractalResult`** → allows Python
   side to render the `D_f(iteration)` convergence plot. **Medium value,
   trivial cost**.
5. **Add `min_box_physical` parameter** to `box_counting_3d_morton` → enables
   Method-A-style "stop at 1/36 particle radius". **Medium value, low cost**.
6. **Fix `fit_frac3D.m:24`** (`||` → `&&`) if keeping MATLAB reference
   lying around. **Low value for pyaglogen3D directly**, but the
   documented reference is misleading.
