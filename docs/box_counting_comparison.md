# Box-Counting Algorithms in pyAgloGen3D — MATLAB Reference vs Rust Port

> Scope: purely read-only investigation. No source file has been modified.
> Coverage: `matlab_reference/box_count.m`, `fit_frac.m`, `LeyDePotencias.m`,
> `kfDfAgglo3D*.m`, `calcularDfAglomerados.m`, `matlab_reference/fraktal/{buscafractal2012,buscafractal2018,dimfrac2012,FRAKTAL}.m`
> vs `aglogen_core/src/fractal/{box_counting,box_counting_3d}.rs`
> and `aglogen_core/src/fractal/fraktal/{bisection,granulated_2012,voxel_2018,image_processing,params,result}.rs`.

## 1. Executive summary

The project contains **two independent fractal-dimension pipelines** that address very different problems but share the confusing label "box-counting" in parts of the code and docs.

**Algorithm A — "aglogen3D original" (Hou-style box-counting).**
`box_count.m` implements the Hou/Liebovitch bit-interleaving variant of box-counting described by Jeferson de Souza and Sidnei Pires Rostirolla in *Computers & Geosciences* 2011 (cited literally in the file header, `matlab_reference/box_count.m:3-7`). It operates on a **raw point set** (any dimensionality `dt = min(size(v))`), normalizes it to the `[0, 2^nb − 1]` integer cube, interleaves bits across dimensions, sorts, and for each bit-depth counts the number of occupied boxes of side `1/2^k`. `fit_frac.m` does a `log2(N) vs log2(ε)` linear fit over a user-supplied index range `eRange = [18 30]` (`calcularDfAglomerados.m:7`) and reports the slope as `D_f` (with sign flipped in `calcularDfAglomerados.m:21`). `LeyDePotencias.m` is an orthogonal growth-law fitter (`Rg` vs `N`), not box-counting. `kfDfAgglo3D.m` and `kfDfAgglo3Dold.m` are **tunable-aggregate generators**, not analyzers — they belong here only because the old version spells out the `(R_g/r_p)^{D_f}` power law used downstream.

**Algorithm B — "FRAKTAL" (Enrique Viera Luis 2014, Gonzalo Moya Plaza 2018, Juan José Expósito González 2021).**
FRAKTAL is **not** a box-counting algorithm in the classical Hausdorff sense. It is a **model-based inverse solver** that extracts `D_f` from a single 2D TEM/SEM image by: (a) measuring projected area `Ap` and 2D radius of gyration `R_g`; (b) assuming the 2010-era Lapuerta-group model of soot morphology (`buscafractal2012.m:3`, "utiliza el modelo de kf del paper 2010, con lagunaridad"); (c) expressing `k_f`, the coordination index `J_f`, and the overlap exponent `z_p` as explicit analytical functions of `D_f`, `N_p`, `δ`; (d) solving the nonlinear equation `k_f(D_f)·(d_p/d_{po})^{D_f} = (A_p/A_{po})^{z_p(D_f)}` by **bisection over `D_f ∈ [1, 3]` with a 0.05 step**, falling back to `fminbnd` if no sign change is found. The 2018 variant (`buscafractal2018.m`) simplifies the model, replaces `δ` with a voxel side `l_{vox} = escala/npix`, and drops the `J_f` coordination term. `FRAKTAL.m` is purely a Spanish/English GUI front-end (`matlab_reference/fraktal/FRAKTAL.m:1-127`) — no algorithmic content.

**Key conceptual difference.** A counts geometry directly (ε → N(ε) → slope). B solves an empirical soot-morphology equation system where `D_f` is the unknown. They would only agree if the sample is a pure soot agglomerate that perfectly obeys the Lapuerta/Brasil model; in general they are complementary, not redundant.

## 2. Algorithm A — Vargas-Martín / original aglogen3D

### 2.1 Mathematical description

Classical box-counting dimension:

> `D_f = lim_{ε → 0} log N(ε) / log(1/ε)`

where `N(ε)` is the minimum number of ε-sided boxes needed to cover the set.
The de Souza & Rostirolla / Hou implementation avoids building a grid for each scale. Instead it:

1. Normalizes each coordinate to `[0, 2^{nb} − 1]` integer space.
2. Computes a `dt`-dimensional Morton-style interleaved key per point, where bit `j` of the key is `bitget(v, nb+1-i)` of each coordinate multiplied by `2^{dt-j}` and summed (`box_count.m:69-85`). For `dt = 3, nb = 32` this is essentially the same construction as a 3D Z-order curve.
3. Sorts the key column-by-column and takes `diff + cumsum` to obtain, at each bit-plane `k = 1..nb`, the number of distinct box identifiers — i.e. the box count at side `ε_k = 2^{-k}` in normalized units (`box_count.m:92-99`).

So the output is a vector `np[1..nb]` where `np[k]` = number of occupied boxes at box side `2^k / 2^{nb}` (after reversal in `fit_frac.m`).

### 2.2 Step-by-step `box_count.m`

- `box_count.m:20` `v=load(file);` — reads ASCII file with N points × dt dims.
- `box_count.m:26` `data_prep` — re-orients so rows are dimensions; subtracts per-dimension minimum; divides by global maximum; scales to `2^{nb}-1`; casts to `uint16/32/64` according to `nb`. **Important:** the normalization is *isotropic* using the global `maxi = max(max(v))` after zero-shift, which compresses the largest dimension to full scale (`box_count.m:51-53`).
- `box_count.m:27` `bit_int` — interleaves bits: for each bit `i ∈ 1..nb`, extracts bit `nb+1-i` from every coordinate, weights dimension `j` by `2^{dt-j}` and sums across dimensions. Final shape: `(n × nb)` uint8 matrix where each column is the bit slice at that resolution.
- `box_count.m:28` `sortrows(v_b)` — sorts lexicographically by bit-level columns (most significant first); this is what makes the duplicate-detection work.
- `box_count.m:29` `bit_mask` — appends a sentinel row `2^{dt}`, takes `diff` (detects changes), `cumsum` along columns (propagates along bit depth), converts to logical, and for monofractal `M==1` returns `np = sum(v_b)` along rows → vector of occupied-box counts per bit level.
- `box_count.m:30` `s = maxi` — returns the physical scale used for normalization so `fit_frac.m` can un-normalize box sizes back to physical units.

For multifractal mode `M==2` the file also implements the `q`-partition function (`box_count.m:106-127`), but this path is not used by `calcularDfAglomerados.m` which hard-codes `M = 1`.

### 2.3 How `fit_frac.m`, `LeyDePotencias.m`, `kfDfAgglo3D*.m`, `calcularDfAglomerados.m` fit together

**`calcularDfAglomerados.m`** is the orchestrator. For each agglomerate:

1. Dumps 3D sphere centers `part[min:max, :]` to `<file>.dat` (`calcularDfAglomerados.m:17`).
2. Calls `box_count(file, nb=32, M=1)` → `(np, s, qv)` (`calcularDfAglomerados.m:18`).
3. Calls `fit_frac(np, s, eRange=[18 30])` → linear fit over bit levels 18 to 30 (`calcularDfAglomerados.m:7,19`).
4. Reads the fit coefficients, **reports `Df = -coefficients(1)`** and `kf = coefficients(2)` (`calcularDfAglomerados.m:21-22`). The sign flip is because `fit_frac.m` computes `log2(np) = p(1)·log2(ε) + p(2)` where ε is increasing, so the physical-fractal slope is `-p(1)`.

**`fit_frac.m`** (`fit_frac.m:1-53`):

- `e = 2.^(1:length(np))` — scale vector in normalized units (dyadic).
- `np = np(end:-1:1)` — reverses count vector so that index 1 is coarsest.
- `polyfit(log2(e(e_min:e_max)), log2(np(e_min:e_max)), 1)` — classic OLS in log2-log2.
- Also fits with `fit(..., 'poly1')` to get `confint` → 95 % CI on the slope.
- Un-normalizes x-axis via `x = e/(2^length(np)-1) * maxi`.

**`LeyDePotencias.m`** (`LeyDePotencias.m:1-12`) is unrelated to box-counting: it iterates over agglomerate-growth references and fits `log10(rg) vs log10(N)` → claims `Df = exp(p(1))` and `kf = p(2)`. This is incorrect (the standard relation is `Df = 1/slope` for `log(Rg) vs log(N)`, not `exp(slope)`) and it is not called from `calcularDfAglomerados.m`; it looks like a draft.

**`kfDfAgglo3D.m`** and **`kfDfAgglo3Dold.m`** are **tunable generators**, not analyzers. They take target `(D_f, k_f)` and produce an agglomerate by PC/CC tuning (`kfDfAgglo3D.m:97` delegates to `TuningPC`). The old version (`kfDfAgglo3Dold.m:22-32`) hard-codes the Brasil-Farias-Sorensen 1999 placement formula
`γ = sqrt(N²·(d_p/2)²/(N-1) · (N/k_f)^{2/D_f} − …)`
which is only relevant to fractal analysis here because it cements the `(R_g/r_p)^{D_f}` power law that Algorithm A fits.

### 2.4 Input/output shapes

| Stage | Input | Output |
|-------|-------|--------|
| `box_count` | ASCII `.dat` with `N × dt` (dt = 3 for 3D) | `np[1..nb]` (u32), `s` (f64 scale), `qv` (unused for `M=1`) |
| `fit_frac` | `np`, `s`, `eRange=[18,30]` | `x` (physical box sizes), reversed `np`, `fitresult` (MATLAB `cfit` object) |
| `calcularDfAglomerados` | `part` (N_total × 4: x,y,z,r), `NofPart[]`, `method` | `Df[1..M]`, `kf[1..M]`, `tDf[1..M]` |

### 2.5 Box-size strategy

**Dyadic** (powers of two): `ε_k = 2^{-k}` in normalized units, `k ∈ 1..nb = 32`. This is forced by the bit-interleaving trick; it is not a free choice.

### 2.6 Fitting strategy

- Plain unweighted OLS on `log2(ε)` vs `log2(N)`.
- **Range hard-coded** to `eRange = [18, 30]` (`calcularDfAglomerados.m:7`) — i.e. bit levels 18 through 30 out of 32. That excludes the 17 coarsest levels (where the whole object is in few boxes) and the 2 finest (which saturate near the number of input points). This is a manual, non-adaptive linear-region selector.
- Uses MATLAB `fit(..., 'poly1')` plus `confint` to get a 95 % CI via the Student-t for the slope.
- No weighting, no residual diagnostics, no outlier rejection.

### 2.7 2D vs 3D

`box_count.m` is **dimension-agnostic**: `dt = min(size(v))` takes whatever dimension the input file has. `calcularDfAglomerados.m` feeds sphere centers only (x,y,z), so `dt = 3`. But a 2D slice would also work. The Rust port splits this into two separate files (see §5).

### 2.8 Paper references found in source / docs

| Citation | Where it appears | Relation to algorithm A |
|----------|------------------|-------------------------|
| Jeferson de Souza, Sidnei Pires Rostirolla, *Computers & Geosciences* 2011, "Hou algorithm to estimate fractal and/or f(α) spectrum" | `matlab_reference/box_count.m:3-7` (explicit header) | Direct origin of `box_count.m` |
| Hou et al. 1990 | `aglogen_core/src/fractal/box_counting_3d.rs:3-4` (module docstring) | Claimed origin of bit-interleaving |
| Lapuerta, Ballesteros, Martos (2006) "A Method to Determine the Fractal Dimension of Diesel Soot Agglomerates" | `technical_content/research_report/markdown/07_references.md:50-52`; also implicitly via `constante = 3/5` in `TuningPC.m:25`, `TuningCC.m:152` | Lapuerta 3/5 constant used in tuning generators |
| Mandelbrot 1982; Witten & Sander 1981; Meakin 1983; Kolb et al. 1983 | `technical_content/research_report/markdown/07_references.md:7-26` | Listed in docs but **not** cited in any `.m` file |
| Liebovitch & Toth 1989 "A Fast Algorithm to Determine Fractal Dimensions by Box Counting" | `07_references.md:56-58` | Listed in docs, **not** in source |
| Morton 1966 | `07_references.md:60-62` | Listed in docs, **not** in source |

Everything outside `box_count.m:3-7` is a docs-level citation (`technical_content/research_report/markdown/07_references.md`). **The `.m` source files themselves cite only de Souza/Rostirolla and, indirectly, Lapuerta.**

## 3. Algorithm B — FRAKTAL (Marcos del Blanco / Viera / Moya / Expósito)

### 3.1 Mathematical description and how it differs from A

FRAKTAL does **not** measure `D_f` from a scaling law. Instead it inverts a parametric soot-morphology model. From a single 2D image it extracts:
- Number of object pixels `nele`.
- Center of gravity `(xcg, ycg)`, 2D radius of gyration `R_g`, projected area `A_p = nele·(escala/npix)^2` (`dimfrac2012.m:15-32`).
- Optional empirical "3D correction" to `R_g` (`dimfrac2012.m:38-62`, `image_processing.rs:249-262`).

Then it solves for `D_f` the equation
`k_f(D_f, N_p, δ)·(d_p/d_{po})^{D_f}  =  (A_p / A_{po}(D_f, N_p, δ))^{z_p(D_f, N_p)}`

where:
- `k_f(D_f)` is a **quadratic polynomial** whose coefficients `(akf, bkf, ckf)` are precomputed from `N_p` and `δ` via three auxiliary magnitudes `Akf, Bkf, Ckf` (`buscafractal2012.m:13-33`).
- `J_f(D_f, k_f, N_p, δ)` is the coordination index with empirical constants `A=1.85, B=0.0191, C=1.45, D=1.5, a=17, b=3.609, c=-0.3901, d=6.2` (`buscafractal2012.m:37-38`).
- `A_{po}(D_f) = ¼ d_{po}²·(π − J_f·acos(1/δ) + J_f/δ · sin(acos(1/δ)))` is the projected area of a single primary particle corrected for overlap (`buscafractal2012.m:47,54,63`).
- `z_p(D_f) = A_{zp} − 1 + (B_{zp} + 1 − A_{zp})^{((D_f−1)/2)^m}` with `A_{zp} = log(N_p)/log(0.8488·N_p + 0.1512)` and `B_{zp} = 1.5/(1 + 0.3005/log(N_p))` (granulated) or `A_{zp} = log(N_{vox})/log(1/2 + π·N_{vox}/4)` and `B_{zp} = 1.5` (voxel) (`buscafractal2012.m:41-48`, `buscafractal2018.m:16-22`).

The outer `dimfrac2012.m` loop iterates the equation, feeding the newly computed `N_p` back in until convergence (`dimfrac2012.m:69-99`). Inside each iteration `buscafractal201X.m` does the bisection.

### 3.2 Step-by-step `buscafractal2012.m`

1. Precompute `γ = 5/4·(1-1/δ)²/(2-1/δ)` (`buscafractal2012.m:11`).
2. Compute `Akf, Bkf, Ckf` using helper functions `alfa(δ,J), beta(δ,J), mu(npo,h)` (`buscafractal2012.m:13-33`, helpers at `:104-113`).
3. Convert to polynomial coefficients: `akf = Akf/2 − Bkf + Ckf/2`, `bkf = −5/2·Akf + 4·Bkf − 3/2·Ckf`, `ckf = 3·Akf − 3·Bkf + Ckf` (`buscafractal2012.m:34`). This gives `k_f(D_f) = akf·D_f² + bkf·D_f + ckf`.
4. Compute `A_{zp}, B_{zp}` for the overlap exponent (`buscafractal2012.m:41`).
5. Walk `dfmat = 1:0.05:3` looking for a sign change of `funa = k_f·(d_p/d_{po})^{D_f} − (A_p/A_{po})^{z_p}` (`buscafractal2012.m:43-58`).
6. If a sign change is found, **bisect** the bracket with `incr = 10^{-5}` (`buscafractal2012.m:59-73`).
7. If no sign change is found in the whole `[1, 3]` range, fall back to `fminbnd` on `|fun(D_f)|` and accept it only if `1.001 < D_f < 2.999` (`buscafractal2012.m:80-97`).
8. Return `D_f, N_{po} = k_f·(d_p/d_{po})^{D_f}, k_f, fun_aprox` (`buscafractal2012.m:99-102`).

### 3.3 Step-by-step `buscafractal2018.m`

Same structure but simplified:

1. Voxel side `l_{vox} = escala/npix` (`buscafractal2018.m:8`).
2. `Akf = 1/(2·sqrt(1/6·(1/2 + 1/N_{vox}²)))`, `Bkf = N_{vox}/(2/3·N_{vox} + 1/3)`, `Ckf = 1` (`buscafractal2018.m:10-12`).
3. Same polynomial conversion (`buscafractal2018.m:13`).
4. `A_{zp} = log(N_{vox})/log(1/2 + π·N_{vox}/4)`, `B_{zp} = 1.5` (`buscafractal2018.m:16-18`).
5. Objective is `k_f·(d_p/l_{vox})^{D_f} − (A_p/l_{vox}²)^{z_p}` — no `A_{po}`, no `J_f`, no `δ` (`buscafractal2018.m:23`).
6. Same bracket-scan + bisection + `fminbnd` fallback (`buscafractal2018.m:19-63`).

### 3.4 `dimfrac2012.m` — full pipeline

`dimfrac2012.m` is the **single-image driver** (`dimfrac2012.m:1-183`):

1. `roicolor(i2d, filmin=10, filmax=240)` — binary mask of dark pixels.
2. Find pixel coordinates → `nele`, centroid, projected area `Ap = nele·(escala/npix)²`, 2D `R_g` in nm.
3. Fork on `(correccion, granulado)` appdata flags to set exponent `m` and optionally apply the `Rg_3D = Rg_2D + A·Rg_2D^B` correction (`dimfrac2012.m:37-62`, with four different `(A, B, m)` combinations).
4. If `granulado == 'Si'`, run `buscafractal2012` in a fixed-point loop on `N_{po}` (`dimfrac2012.m:68-82`); otherwise run `buscafractal2018` (`dimfrac2012.m:83-99`).
5. If converged (`fun == 0`) and `N_{po} ≥ 5`, compute derived quantities: overlap exponent `z_f`, coordination index `J_f`, volume `V = N_{po}·⅙π·d_{po}³·(1 − J_f·(4δ³−6δ²+2)/(8δ³))`, mass `m = 1.85·10^{-6} fg/nm³ · V`, surface area `S = N_{po}·π·d_{po}²·(1 − J_f·(δ−1)/(2δ))` (`dimfrac2012.m:112-118`, `:175-177`).
6. For the non-granulated branch, an **inner nested bisection/`fminbnd` step on `N_{po}` in `[5, 1000]`** is additionally run to self-consistently solve for `N_{po}` given `D_f, k_f, J_f, δ` (`dimfrac2012.m:122-173`).

### 3.5 2012 vs 2018 differences

| Aspect | 2012 granulated (`buscafractal2012.m`) | 2018 voxel (`buscafractal2018.m`) |
|--------|----------------------------------------|-----------------------------------|
| Primary unit | Spherical primary particle of diameter `d_{po}` | Voxel of side `l_{vox} = escala/npix` |
| Overlap | Explicit filling factor `δ`, `J_f` coordination, `A_{po}` overlap | None — `A_{po}` replaced by `l_{vox}²` |
| `k_f` polynomial | `Akf, Bkf, Ckf` with soot-specific closed forms | Three simple algebraic expressions in `N_{vox}` only |
| `z_p` | `A_{zp} = log N_p/log(0.8488·N_p + 0.1512)`, `B_{zp} = 1.5/(1+0.3005/log N_p)` | `A_{zp} = log N_{vox}/log(1/2 + π N_{vox}/4)`, `B_{zp} = 1.5` |
| `m` exponent | `1.86 − 1.3·(δ−1)` (3D corr + granulated) | Typically 1.0 |
| Downstream outputs | `V, masa, Asup` via `J_f` and `δ` | `V = N_{vox}·l_{vox}³`, no mass, `S ≈ 4·N_{vox}·l_{vox}²` |

### 3.6 Input / output shapes

- Input (both): uint8 2D grayscale image (MATLAB `imread` → any size), plus scalar parameters `npix, dpo, delta, escala, …`.
- Output (both): `(D_f, N_{po}, k_f, fun_aprox)` at the solver level; the `dimfrac2012.m` wrapper adds `R_g, A_p, z_f, J_f, V, mass, S_{sup}`, and a textual `fallo` status.

### 3.7 Box-size strategy

There is **no box-size strategy**. FRAKTAL does not sweep scales; it measures `A_p` and `R_g` once and solves an algebraic/transcendental equation. The only "grid" is the implicit bit-per-pixel conversion (`escala/npix` → pixel size in nm).

### 3.8 Fitting strategy

Root finding, not regression:
- Step `0.05` over `D_f ∈ [1, 3]` looking for sign changes of `fun(D_f)`.
- Bisection on the bracket with tolerance `10^{-5}`.
- `fminbnd` (Brent minimization of `|fun|`) fallback.
- No confidence interval, no `R²` — the quality metric is `|fun_aprox|` and `npo/npo_visual` ratio.

### 3.9 GUI role

`FRAKTAL.m` (`matlab_reference/fraktal/FRAKTAL.m:1-127`) is a figure-window splash screen with two pushbuttons that forward to `Tipo_fractal_build` (Spanish) or `Tipo_fractal_english_build` (English). All other `Datos_imagenes_*_build.m` files are MATLAB `uicontrol` layouts. **None of them contain algorithmic code** — they only set `appdata` flags (`handles.correccion, handles.granulado`) consumed by `dimfrac2012.m:34-35`.

### 3.10 Paper references found in source / docs for B

| Citation | Where it appears | Relation |
|----------|------------------|----------|
| "paper 2010, con lagunaridad" | `buscafractal2012.m:3` (code comment) | Source of `k_f` model — NOT explicitly citable; most likely Lapuerta 2006/2010 line |
| Enrique Viera Luis (2014), Gonzalo Moya Plaza (2018), Juan José Expósito González (2021), Magín Lapuerta Amigo | `FRAKTAL.m:41-47` (splash text) | Authorship / lineage |
| Brasil, Farias, Carvalho (1999) "A Recipe for Image Characterization of Fractal-Like Aggregates" | `07_references.md:34-36` | Listed in docs as FRAKTAL methodology foundation — **not** cited in `.m` |
| Köylü & Faeth (1992) | `07_references.md:38-40` | Listed in docs, **not** in source |
| Sorensen (2001) | `07_references.md:30-32` | Listed in docs, **not** in source |
| Filippov, Zurita, Rosner (2000) | `07_references.md:46-48` | Listed in docs; referenced via the `Filipov = 0` vs `Lapuerta = 3/5` toggle in `TuningPC.m:25`, `TuningCC.m:152` |
| Bescond, Yon, Ouf et al. (2014); Yon, Bescond, Liu (2015) | `07_references.md:86-92` | Listed as FRAKTAL 2012 / Voxel 2018 references — **not** explicitly cited in `.m` |
| Otsu 1979 | `07_references.md:96-98`; algorithm reimplemented in `image_processing.rs:42-92` | Rust adds Otsu; MATLAB did not use it |

**Conclusion for B.** The `.m` sources cite *no formal papers* by DOI or name. The docs ascribe the models to Brasil et al. 1999 (granulated) and Bescond et al. 2014 / Yon et al. 2015 (voxel), but this attribution lives **only in the docs**, not the code.

## 4. Side-by-side comparison table

| Aspect | A — Vargas-Martín box-counting | B — FRAKTAL 2012/2018 |
|--------|--------------------------------|-----------------------|
| Input data | Arbitrary N×dt point set (typically 3D sphere centers) loaded from ASCII | Single 2D grayscale image (uint8) |
| Dimensionality | Dimension-agnostic; `dt = min(size(v))` | Strictly 2D → infers 3D via empirical `Rg_3D = Rg_2D + A·Rg_2D^B` correction |
| What `D_f` means | True box-counting (Hausdorff-style) dimension from `log N(ε) / log(1/ε)` | Inverse-modeled parameter from Lapuerta-soot equation; only physically meaningful for soot-like aggregates |
| Box covering | Dyadic bit-interleaving (Morton code) + sort + `diff/cumsum` to count unique boxes per scale | No box covering; single global measurement of `A_p, R_g` |
| Box-size range | `2^{-32} … 1` in normalized units; **fit** on bit levels 18..30 → `2^{-30} … 2^{-18}` | N/A (no scales) |
| How boxes count occupancy | A box is occupied if any point has its prefix mapped to it (unique-prefix count after sort) | N/A |
| Fitting method | OLS on `log2(N)` vs `log2(ε)`, manual index window, MATLAB `fit poly1` for CI | Bisection + `fminbnd` on nonlinear residual; tolerance `10^{-5}` |
| Output | `Df`, `kf`, `tDf` per agglomerate | `Df, N_{po}, k_f, z_f, J_f, V, mass, S, Rg, Ap, fun_aprox, fallo` |
| Complexity | `O(N·nb)` for bit construction, `O(N log N)` sort, `O(N·nb)` unique count → `O(N·nb + N log N)` | `O(npix²)` image scan + `O(log(0.0001/2))·O(dfmat)` bisection ≈ `O(npix²)` dominated by image I/O |
| Parallelism | Serial (MATLAB) | Serial (MATLAB) |
| Edge handling | Zero-shift + uniform scale to `2^{nb}-1` → clamp by `uint` cast (`box_count.m:47-61`) | `roicolor` mask; no padding; geometry uses all `true` pixels |
| Pre-processing | Per-dimension minimum subtraction; uniform normalization by global max; integer quantization at `nb` bits | `roicolor(filmin=10, filmax=240)`; optional 3D-correction exponents depending on `correccion`/`granulado` flags |

## 5. Rust port — how faithful is it?

### 5.1 A (`box_count.m` → `box_counting.rs` + `box_counting_3d.rs`)

The Rust port **splits Algorithm A into two different implementations** whose relationship to the MATLAB source is non-trivial.

**`box_counting.rs` (`aglogen_core/src/fractal/box_counting.rs:1-222`) — naive 2D grid, NOT a port of `box_count.m`:**
- Accepts `PyReadonlyArray2<bool>` (a binary image, not a point cloud).
- Generates logarithmically spaced integer box sizes between `min_box_size=2` and `max_box_size=512` with `num_scales=20` (`box_counting.rs:13-58`).
- For each box size, iterates over the grid and checks "has any `true` pixel" with a naive nested loop (`count_boxes`, `box_counting.rs:103-137`).
- Linear regression on `ln(1/ε)` vs `ln(N)` (natural log, not `log2`) with plain OLS (`box_counting.rs:140-184`).
- Hard-codes `linear_region_start = 0` in the result — **no automatic linear-region detection** (`box_counting.rs:98`).

Divergences from MATLAB `box_count.m`:

| What | MATLAB (`box_count.m`) | Rust (`box_counting.rs`) |
|------|------------------------|--------------------------|
| Input | N×dt real-valued point set | Boolean 2D image |
| Box construction | Bit-interleaved Morton keys | Naive pixel iteration per scale |
| Scale spacing | Dyadic `2^{-k}, k=1..nb` | Log-spaced rounded to `usize` with `dedup` |
| Scale count | 32 levels | 20 scales |
| Log base | `log2` | `ln` |
| Linear region | Manual `eRange=[18, 30]` | All points used (no selection) |
| CI | Student-t from MATLAB `fit poly1 confint` | `1.96 × std_error` (z approximation) |

These are **two different algorithms**. The Rust version is a stock 2D image box-counter; it does not inherit the Hou bit-interleaving trick.

**`box_counting_3d.rs` (`aglogen_core/src/fractal/box_counting_3d.rs:1-595`) — Morton-code 3D port, closer in spirit to `box_count.m`:**
- Accepts `PyReadonlyArray2<f64>` of shape `(N, 3)` or `(Nx3 centers + radii)` + option to generate Fibonacci-lattice surface points per sphere (`box_counting_3d.rs:395-497`).
- Normalizes to `[0, 2^{precision}-1]` (precision default 18, max 21 bits/dim → 63-bit Morton code; MATLAB used `nb=32`) (`box_counting_3d.rs:22, 95-131`).
- `expand_bits_3d` uses the standard 3D magic-number bit spread (`box_counting_3d.rs:26-37`).
- Morton encoding + parallel `par_sort_unstable` + masked linear scan for unique prefix counts (`box_counting_3d.rs:132-204`).
- Log base **`ln`** (MATLAB uses `log2`) but this does not affect the slope.
- Uses a custom `linear_regression_robust` that **starts from large scales and adds points from the left**, stopping when standardized residual `> 2` and `R²` drops by `> 0.02` (`box_counting_3d.rs:290-377`).

Divergences vs MATLAB:

| What | MATLAB `box_count.m` + `fit_frac.m` | Rust `box_counting_3d.rs` |
|------|--------------------------------------|---------------------------|
| Bit precision | 32 bits/dim | 18-21 bits/dim |
| Morton magic numbers | Done via `bitget + sum` in MATLAB | Classical `0x1fffff…0x1249249249249249` constants |
| Box scales used | All 32 bit levels, fit on `[18, 30]` (hard-coded) | All `precision` bit levels, **adaptive** linear-region detection |
| Corner case `box_count == N` (saturation) | Kept in the data, filtered by `eRange` | Filtered by `if count < sorted_codes.len()` in `box_counting_3d.rs:147` — excludes the finest scale where every point is its own box |
| Linear region | Hard-coded window | Heuristic: start with last 4 points, extend left until outlier |
| CI | Student-t via `fit poly1 confint` | `1.96 × std_error` (normal approx) |

The 3D Rust port is **algorithmically close to MATLAB** (same core idea: sort Morton codes, count unique prefixes per bit level) but drifts on:

1. **Precision**: 18 bits vs 32 → granular boxes are ~14 bits coarser.
2. **Linear region**: The MATLAB pipeline is deterministic (`[18, 30]`), the Rust one is heuristic and depends on the point distribution; given the same input the slopes will differ at the second decimal place.
3. **Saturation filtering**: Rust drops scales where `box_count == N`; MATLAB keeps them but the user-supplied `eRange` hides them.
4. **Fitting base/CI**: natural log vs `log2` (slope invariant, intercept not); 1.96 z vs Student-t (minor for `n ≥ 30`).

None of these are *bugs*; they are opinionated re-implementations. A strict byte-exact port would keep `precision=32`, `log2`, and a fixed window.

### 5.2 B (`buscafractal2012/2018.m` + `dimfrac2012.m` → `fraktal/*.rs`)

**`bisection.rs` (`aglogen_core/src/fractal/fraktal/bisection.rs:1-260`):**
- Two-phase solver: step search for sign change (step 0.05, matches `buscafractal2012.m:5-6` `dfmat = 1:0.05:3`), then bisection with tolerance `1e-5` (matches MATLAB `incr = 0.00001`).
- Golden-section fallback `fallback_optimization` in place of MATLAB `fminbnd` (`bisection.rs:172-228`). `fminbnd` is Brent's method; golden section is slower but deterministic. Expect sub-percent deviations when the bracket search fails.
- **Convergence criterion divergence**: MATLAB accepts any solution found by bisection as long as `fun_aprox == 0` at the end; Rust adds `converged = final_value.abs() < CONVERGENCE_THRESHOLD = 0.1` (`bisection.rs:13, 157-164`). This threshold can reject solutions MATLAB would accept if `|fun|` is between `0` and `0.1` at the final midpoint. MATLAB's own convergence is "bracket width `< 10^{-5}`", not residual magnitude.
- Fallback validity check `df > 1.001 && df < 2.999` (`bisection.rs:219`) matches `buscafractal2012.m:88`.

**`granulated_2012.rs` (`aglogen_core/src/fractal/fraktal/granulated_2012.rs:1-464`) vs `buscafractal2012.m` + `dimfrac2012.m`:**

- Helpers `alfa, beta, mu`: exact port (`granulated_2012.rs:35-51` vs `buscafractal2012.m:104-113`).
- `calculate_prefactor_coefficients` (`granulated_2012.rs:57-145`) is a very long but **line-by-line translation** of `buscafractal2012.m:11-34`, including the cube-root term `in_val` and the full `Ckf` expansion. Numerically equivalent modulo f64 rounding.
- `calculate_jf`, `calculate_zp_granulated`, `calculate_apo` match MATLAB exactly (`granulated_2012.rs:152-172` vs `buscafractal2012.m:37-48`).
- **Divergence 1 — search range for Df.** Rust **narrows** the bisection bracket by scanning down from `Df=3.0` in 0.05 steps to find where `kf(Df) > 0.01`, then bisects from `df_search_min = df_min_valid + 0.05` (`granulated_2012.rs:276-292`). MATLAB always searches `[1, 3]`. This is a pragmatic fix for an issue MATLAB does not guard against (the `kf` polynomial goes negative in the middle of `[1, 3]` for some parameter combinations), but it systematically excludes low-`Df` solutions that MATLAB would still bracket.
- **Divergence 2 — multiple initial `npo` seeds.** Rust tries up to 9 different initial `N_{po}` estimates (visual estimate ±30 %, plus `[50, 100, 200, geometry-based, …]`) and returns the first that converges (`granulated_2012.rs:222-254`). MATLAB starts from the hard-coded `npo = 1_000_000` and iterates once (`dimfrac2012.m:68`).
- **Divergence 3 — visual particle counter.** Rust implements `estimate_particle_count_adaptive` using a 2-pass distance transform + local-max detection + non-max suppression (`image_processing.rs:281-448`). MATLAB has no such thing — it relies on `N_p = 1_000_000` as a seed and converges via the outer loop. The Rust path uses the visual estimate both as an initial seed and as a **post-hoc quality check** (`npo_ratio`, `npo_aligned`) which MATLAB does not report.
- **Divergence 4 — segmentation.** MATLAB uses `roicolor(i2d, 10, 240)` unconditionally (`dimfrac2012.m:14`). Rust adds Otsu's method with automatic dark-on-light detection (`image_processing.rs:42-165`), gated by `auto_threshold` param (default true). When `auto_threshold = false` the code falls back to `color_segment(image, pixel_min, pixel_max)` which equals `roicolor`.
- **Divergence 5 — `|kf|` guard.** In `calculate_jf` Rust does `kf.abs().max(0.001)` to avoid `NaN` from `(-kf)^{3.609}` (`granulated_2012.rs:264`). MATLAB leaves it as-is, which silently propagates complex numbers as `NaN`.
- **Divergence 6 — error reporting.** MATLAB returns `fallo` strings; Rust returns a typed `FraktalStatus` enum with `Success | DfOutOfRange | NpoTooSmall | NoConvergence | Error(msg)` (`fraktal/result.rs:6-44`). Richer, not equivalent.

**`voxel_2018.rs` (`aglogen_core/src/fractal/fraktal/voxel_2018.rs:1-220`) vs `buscafractal2018.m`:**

- Prefactor coefficients: exact port (`voxel_2018.rs:19-35` vs `buscafractal2018.m:10-13`).
- `calculate_zp_voxel`: exact port (`voxel_2018.rs:42-50` vs `buscafractal2018.m:16-22`).
- Objective function: exact port (`voxel_2018.rs:104-113` vs `buscafractal2018.m:23,28,35`).
- **Divergence 1 — initial nvox.** Rust seeds `nvox_estimate = 100_000_000.0` (`voxel_2018.rs:94`), MATLAB seeds `100000000` and then `npo1` (`dimfrac2012.m:84-89`). Same order of magnitude.
- **Divergence 2 — outer loop.** Rust iterates up to 50 times with tolerance `0.0001` (`voxel_2018.rs:98-137`), MATLAB also 50 with `incr=0.0001` (`dimfrac2012.m:87`). Match.
- **Divergence 3 — outputs.** Rust returns volume as `nvox·lvox³`, mass as `0`, surface area as `4·nvox·lvox²` (`voxel_2018.rs:160-168`), matching the non-granulated branch of `dimfrac2012.m:109-111`.

### 5.3 Summary of deviations and their likely numerical impact

| # | Where | Kind | Probable effect on Df |
|---|-------|------|-----------------------|
| 1 | `box_counting.rs` vs `box_count.m` | Different algorithm (naive grid vs Hou bit-interleaving) | Systematic bias on 2D images; should only be compared on the same 2D data, and results are not expected to match MATLAB's 3D pipeline |
| 2 | `box_counting_3d.rs` precision 18 vs MATLAB 32 | Simplification | Minor (0.01–0.05 in Df for typical agglomerates) |
| 3 | `box_counting_3d.rs` robust linear region vs MATLAB `[18, 30]` | Opinionated fix | Noticeable (0.05–0.2 in Df) on small/noisy data because the linear region shifts |
| 4 | `box_counting_3d.rs` filters scales where `count == N` | Fix | Usually beneficial |
| 5 | `bisection.rs` `CONVERGENCE_THRESHOLD = 0.1` on `|fun|` | Stricter | Can reject MATLAB-accepted solutions; no effect when residual is small |
| 6 | `granulated_2012.rs` narrows search to `kf > 0` | Fix for `NaN` | Excludes spurious MATLAB results but may also drop legitimate low-Df solutions |
| 7 | `granulated_2012.rs` multiple initial Npo seeds | Robustness | Rust converges in more cases; picks different fixed points in multi-solution regimes |
| 8 | `granulated_2012.rs` Otsu thresholding | Extension | Different `A_p, R_g` than MATLAB on the same image unless `auto_threshold=false` |
| 9 | `granulated_2012.rs` visual Npo estimator + `npo_ratio` | Extension | Doesn't affect `Df`; affects quality labels |
| 10 | Rust uses golden-section instead of `fminbnd` (Brent) | Algorithm swap | Rarely matters because fallback is the unhappy path |

**Would numerical outputs match MATLAB within tolerance?**
- **Algorithm B / Voxel 2018**: Yes, expect Df agreement to within 0.01 when segmentation is forced to `roicolor` (`auto_threshold=false`) and both use the same `npix, escala`. The mathematical core is a line-by-line port.
- **Algorithm B / Granulated 2012**: Probably within 0.03–0.05 when `auto_threshold=false` and the same visual `Npo` seed is used; larger divergences possible on images where the `kf(Df)` polynomial is near zero in the relevant range.
- **Algorithm A (3D Morton)**: Within 0.05 on clean fractal point clouds; on small/noisy data the adaptive linear-region picks a different window than `[18, 30]` and outputs will drift more.
- **Algorithm A (2D `box_counting.rs`)**: **Not comparable** with `box_count.m` — they are different algorithms. Only the `test_box_counting_line` / `test_box_counting_filled` self-tests (`box_counting.rs:190-221`) validate basic sanity (Df ≈ 1 for a line, ≈ 2 for a filled square).

## 6. Recommendations

### 6.1 Which implementation is the "reference" for what?

| Use case | Pick |
|----------|------|
| Measuring `D_f` of a simulated 3D agglomerate (point cloud or sphere centers) | `box_counting_3d.rs` — closest to MATLAB `box_count.m` and the only one that scales to real simulation sizes |
| Characterizing a real TEM/SEM image of soot with known `d_{po}` and `δ` | `fraktal/granulated_2012.rs` — direct port of `buscafractal2012.m` with the Lapuerta model |
| Quick fractal estimate of an arbitrary 2D image without soot assumptions | `fraktal/voxel_2018.rs` (simple, faithful) or `box_counting.rs` (naive but generic); prefer voxel if you trust the scale calibration |
| Reproducing a legacy MATLAB result exactly | Run the MATLAB code. The Rust ports are close but not bit-identical |

### 6.2 Obvious improvements to the Rust port

1. **Re-unify `box_counting.rs` with the Hou method.** The current 2D implementation is a textbook naive grid, disconnected from `box_count.m`. Rewrite it in terms of `morton_encode_2d` + sort + masked unique counts so the 2D and 3D paths share the same algorithmic core. Expose `precision` as a parameter.
2. **Parametrize the linear region.** Add `eRange: Option<(usize, usize)>` to `box_counting_3d` so callers can reproduce `[18, 30]` exactly when comparing to MATLAB. Keep the robust detector as the default.
3. **Match MATLAB CI.** Replace `1.96 * std_error` with a proper Student-t (`n-2` degrees of freedom) CI computation; `statrs` already provides the inverse CDF.
4. **Softer bisection convergence.** `CONVERGENCE_THRESHOLD = 0.1` (`bisection.rs:13`) is arbitrary. Either remove it (trust the bracket width) or expose it as a field of `BisectionSolver`.
5. **Document the search-range narrowing** in `granulated_2012.rs:274-292` as a divergence from MATLAB and add a parameter to disable it for strict-parity runs.
6. **Share `linear_regression` across files.** `box_counting.rs:140-184` and `box_counting_3d.rs:247-288` duplicate a fragile piece of numerics; lift it into `fractal::regression` with a proper test suite.
7. **Expose `roicolor`-only mode by default** for `fraktal_*` functions when the caller is a strict reproducer (it already exists via `auto_threshold=false`; just document it prominently).

### 6.3 Missing tests — what should be in `aglogen_core/tests/`?

The `aglogen_core/tests/` folder is empty. Given the two-algorithm structure, I recommend integration tests at the Python boundary covering:

1. **Analytical ground-truth cases** (deterministic):
   - Line of N points in 3D → `Df ≈ 1.00 ± 0.05`.
   - Uniform plane → `Df ≈ 2.00 ± 0.05`.
   - Filled cube → `Df ≈ 3.00 ± 0.05`.
   - Sierpinski carpet / tetrahedron → `Df ≈ log3/log2 ≈ 1.585` / `Df ≈ 2.0`.
   These already exist as unit tests inside `box_counting_3d.rs`; the cross-language versions must be added at integration level.
2. **Cross-validation A vs B** on a single known agglomerate:
   - Generate a Tunable-PC agglomerate with target `Df = 1.8, k_f = 1.3`.
   - Run `box_counting_agglomerate` (A).
   - Project to 2D via `project_to_2d`, feed to `fraktal_voxel_2018` (B).
   - Assert both report `Df ∈ [1.7, 1.9]`.
3. **MATLAB parity tests.** Keep a small fixture under `aglogen_core/tests/data/matlab_golden/` with:
   - `agglomerate_N500_Df180.dat` and its MATLAB-generated `Df, kf` pair.
   - A TEM-like image and the MATLAB `buscafractal2012` reported `(Df, Npo, kf)`.
   Assert absolute tolerances consistent with §5.3.
4. **Robustness tests**:
   - `granulated_2012` with images where `kf(Df)` has no root in `[1.85, 3.0]` → must return `DfOutOfRange`, not panic.
   - `box_counting_3d` with `N < 4` points → `linear_regression_robust` must not divide by zero.
   - `bisection` with flat objective → `fallback_optimization` must honor the `1.001 < df < 2.999` guard.

### 6.4 Suggested cross-validation experiment

1. Generate an ensemble of DLA/CCA agglomerates at target `Df ∈ {1.6, 1.8, 2.0, 2.4}`, `N ∈ {500, 1000, 5000}`.
2. Save coordinates both as MATLAB-readable `.dat` and Rust-callable numpy arrays.
3. Run:
   - MATLAB: `box_count → fit_frac(eRange=[18,30])`
   - Rust: `box_counting_3d(precision=18)` with and without robust-region detection (expose the parameter per §6.2.2).
   - FRAKTAL 2012 on projections (`buscafractal2012` vs `fraktal_granulated_2012`).
4. Compute the distribution of `|Df_rust - Df_matlab|` and `|Df_measured - Df_target|`.
5. Publish the numbers as a per-algorithm bias/variance table in `docs/` so the project has a numerical fidelity baseline.

## 7. Appendix

### 7.1 File inventory

#### MATLAB — Algorithm A (`matlab_reference/`)

| File | One-line purpose |
|------|------------------|
| `box_count.m` | Hou bit-interleaving box-counter; outputs `(np[1..nb], s, qv)` |
| `fit_frac.m` | `log2`-`log2` OLS on a user-supplied bit-level window; returns slope ± CI |
| `LeyDePotencias.m` | Draft `Rg` vs `N` power-law fitter; **not called by the main pipeline**, has a wrong formula `Df = exp(p(1))` |
| `calcularDfAglomerados.m` | Orchestrator: for each agglomerate, write `.dat`, call `box_count`, call `fit_frac`, extract `Df, kf` |
| `kfDfAgglo3D.m` | Tunable generator dispatcher (`PC`/`CC`); delegates to `TuningPC` |
| `kfDfAgglo3Dold.m` | Older tunable generator; contains the Brasil-Farias-Sorensen γ formula inline |
| `TuningPC.m` / `TuningCC.m` | Tunable PC/CC generators; only relevant because they expose Lapuerta 3/5 vs Filippov 0 constants |
| `agloGen3D.m` | Random DLA/CCA/T generator driving the initial seed cluster |
| `calculateRadiusOfGyration.m` | 3D Rg used by tunable; not called by Algorithm A analyzer |
| `determineMaximumDiameter.m` | Max projected diameter; used by tunable, not by analyzer |
| All other `matlab_reference/*.m` | Geometry helpers (centers, quaternions, 2D image creation, display); not part of the fractal-dimension pipeline |

#### MATLAB — Algorithm B (`matlab_reference/fraktal/`)

| File | One-line purpose |
|------|------------------|
| `dimfrac2012.m` | Top-level driver: image → `Ap, Rg` → `buscafractal201X` → derived quantities |
| `buscafractal2012.m` | Granulated model inverse solver for `Df` with `J_f, δ, A_{po}` |
| `buscafractal2018.m` | Voxel model inverse solver for `Df` (simpler) |
| `FRAKTAL.m` | Spanish/English splash GUI; no algorithm |
| `Datos_*_build.m`, `instrucciones_*_build.m`, `informacion_*_build.m`, `Tipo_fractal_*_build.m`, `salida_*_build.m`, `version_programa_*_build.m`, `nueva_img_boton_*_build.m`, `instructions_*_build.m`, `information_*_build.m`, `GeneralExe2012*.m` | GUI callbacks and form layouts (MATLAB `uicontrol`); feed `appdata` into `dimfrac2012.m` |
| `*.png`, `*.jpg`, `*.PNG`, `*.asv` | GUI assets and autosaves |

#### Rust — Algorithm A (`aglogen_core/src/fractal/`)

| File | One-line purpose |
|------|------------------|
| `mod.rs` | Re-exports box-counting submodules and `fraktal` |
| `result.rs` | `FractalResult` (internal) / `PyFractalResult` (PyO3); shared by 2D and 3D box-counters |
| `box_counting.rs` | Naive 2D grid box-counter on `PyReadonlyArray2<bool>`; **not a port of `box_count.m`** |
| `box_counting_3d.rs` | Morton-code 3D box-counter on point clouds + sphere-surface sampler; **closest analogue to `box_count.m`** |

#### Rust — Algorithm B (`aglogen_core/src/fractal/fraktal/`)

| File | One-line purpose |
|------|------------------|
| `mod.rs` | Re-exports `analyze_granulated_2012, analyze_voxel_2018`, params and result |
| `bisection.rs` | Generic sign-change bracket + bisection + golden-section fallback solver |
| `params.rs` | `Granulated2012Params, Voxel2018Params` PyO3 classes with defaults |
| `result.rs` | `FraktalResult, PyFraktalResult, FraktalStatus` enums and structs |
| `image_processing.rs` | Otsu threshold, color segmentation, 2D `R_g`, 3D-correction helpers, adaptive particle-count estimator (distance-transform based) |
| `granulated_2012.rs` | Port of `buscafractal2012.m` + extra machinery (multiple seeds, kf-positivity guard, visual Npo alignment) |
| `voxel_2018.rs` | Faithful port of `buscafractal2018.m` |

### 7.2 TODO / FIXME census

- No `TODO`, `FIXME`, `XXX`, `HACK` markers in any `aglogen_core/src/fractal/**/*.rs` file.
- Two harmless markers in unrelated MATLAB files (`matlab_reference/create2DImages.m:5` convention note, `matlab_reference/agloGen3D.m:386` section banner in Spanish).
- `LeyDePotencias.m:11` contains the wrong formula `Df = exp(p(1))` for the `log(Rg)`-vs-`log(N)` slope. It is dead code (not called from `calcularDfAglomerados.m`), so it is not a live bug, but the file should probably be removed or fixed.
- `granulated_2012.rs:247-249` carries an explicit comment documenting that `npo_final` is deliberately only read after the convergence check — not a TODO, but flags a subtle control-flow assumption that tests should lock in.

### 7.3 Loose ends flagged during review

1. **`bisection.rs:13` `CONVERGENCE_THRESHOLD = 0.1`** is a magic number with no MATLAB counterpart. It may silently reject otherwise acceptable bisection outcomes.
2. **`box_counting.rs` (2D)** is labelled "Box-counting fractal dimension analysis" but has no relation to `box_count.m`. The mismatch is likely to confuse any future contributor trying to reconcile numbers with MATLAB. A docstring clarification + a Hou-style 2D implementation would close this gap.
3. **Documentation drift**: `technical_content/research_report/markdown/04_fractal_dimension_estimation.md` advertises `part_1_by_2` as the 3D expansion but the actual `box_counting_3d.rs:26-37` uses a `part_1_by_3`-style different constant set. The docs reference is informally correct but names do not match.
4. **`Bescond 2014` / `Yon 2015`** attribution for FRAKTAL 2012 and Voxel 2018 in the docs is **not supported by citations in the `.m` files** — the MATLAB code cites only "paper 2010 con lagunaridad" (`buscafractal2012.m:3`). This should be verified with the Lapuerta group before being stated as fact in public docs.
5. **`LeyDePotencias.m`** needs either removal or a fix to `Df = 1/p(1)`.
